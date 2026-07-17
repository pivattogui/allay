defmodule Allay.BackupsTest do
  use Allay.DataCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Backups
  alias Allay.Backups.Backup
  alias Allay.Backups.BackupConfig
  alias Allay.Repo
  alias Allay.Test.StubRuntime

  defp scope do
    Accounts.Scope.for_user(user_fixture())
  end

  # Builds a tmp data_dir with a server directory tree at
  # {data_dir}/servers/{id} containing a world, a server.jar and a logs dir,
  # then inserts a server row pointing at it. Returns {scope, server, data_dir}.
  defp seed_server do
    scope = scope()
    data_dir = Path.join(System.tmp_dir!(), "allay_backups_#{System.unique_integer([:positive])}")
    server = server_fixture()
    dir = Path.join([data_dir, "servers", server.id])

    File.mkdir_p!(Path.join(dir, "world"))
    File.write!(Path.join([dir, "world", "level.dat"]), "level-data")
    File.write!(Path.join(dir, "server.jar"), "JAR-BYTES")
    File.mkdir_p!(Path.join(dir, "logs"))
    File.write!(Path.join([dir, "logs", "latest.log"]), "log-line")

    # Persist the tmp directory so context lookups (get_server) see it.
    server = Repo.update!(Ecto.Changeset.change(server, directory: dir))

    on_exit(fn -> File.rm_rf(data_dir) end)
    {scope, server, data_dir}
  end

  # tar binary that exits 2 — drives the >1 failure branch deterministically
  # (bsdtar collapses real filesystem errors to exit 1, which the contract
  # tolerates as success).
  defp failing_tar, do: Path.expand("../support/fake_tar_fail.sh", __DIR__)

  defp recording_tar(data_dir) do
    arguments_path = Path.join(data_dir, "tar-arguments")
    wrapper_path = Path.join(data_dir, "recording-tar")

    File.write!(
      wrapper_path,
      "#!/bin/sh\nprintf '%s\\n' \"$@\" > #{arguments_path}\nexec tar \"$@\"\n"
    )

    File.chmod!(wrapper_path, 0o755)
    {wrapper_path, arguments_path}
  end

  defp untar_to_scratch(archive_path) do
    scratch = Path.join(System.tmp_dir!(), "scratch_#{System.unique_integer([:positive])}")
    File.mkdir_p!(scratch)
    on_exit(fn -> File.rm_rf(scratch) end)
    {_out, 0} = System.cmd("tar", ["-xzf", archive_path, "-C", scratch], stderr_to_stdout: true)
    scratch
  end

  describe "create_backup/4 happy path" do
    test "creates a completed backup excluding jars and logs by default" do
      {scope, server, data_dir} = seed_server()

      assert {:ok, %Backup{} = backup} =
               Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      assert backup.status == "completed"
      assert backup.type == "manual"
      assert backup.size_bytes > 0
      assert String.starts_with?(backup.filename, "#{server.id}_")
      assert String.ends_with?(backup.filename, ".tar.gz")

      archive_path = Path.join([data_dir, "backups", backup.filename])
      assert File.exists?(archive_path)

      scratch = untar_to_scratch(archive_path)
      base = Path.basename(server.directory)
      assert File.exists?(Path.join([scratch, base, "world", "level.dat"]))
      refute File.exists?(Path.join([scratch, base, "server.jar"]))
      refute File.exists?(Path.join([scratch, base, "logs"]))
    end

    test "include_logs config keeps logs in the archive" do
      {scope, server, data_dir} = seed_server()

      Repo.insert!(%BackupConfig{
        server_id: server.id,
        enabled: true,
        interval_minutes: 60,
        max_backups: 10,
        include_logs: true
      })

      assert {:ok, backup} =
               Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      scratch = untar_to_scratch(Path.join([data_dir, "backups", backup.filename]))
      base = Path.basename(server.directory)
      assert File.exists?(Path.join([scratch, base, "logs", "latest.log"]))
      refute File.exists?(Path.join([scratch, base, "server.jar"]))
    end

    test "filename replaces colons and dots from the ISO8601 timestamp" do
      {scope, server, data_dir} = seed_server()

      assert {:ok, backup} =
               Backups.create_backup(scope, server.id, "scheduled", data_dir: data_dir)

      ts = String.replace_prefix(backup.filename, "#{server.id}_", "")
      ts = String.replace_suffix(ts, ".tar.gz", "")
      refute String.contains?(ts, ":")
      refute String.contains?(ts, ".")
    end

    test "uses gzip level 1 and produces an extractable archive" do
      {scope, server, data_dir} = seed_server()
      {tar_command, arguments_path} = recording_tar(data_dir)

      assert {:ok, backup} =
               Backups.create_backup(scope, server.id, "manual",
                 data_dir: data_dir,
                 tar_cmd: tar_command
               )

      arguments = arguments_path |> File.read!() |> String.split("\n", trim: true)
      assert "--use-compress-program=gzip -1" in arguments
      assert File.dir?(untar_to_scratch(Path.join([data_dir, "backups", backup.filename])))
    end
  end

  describe "create_backup/4 errors" do
    test "unknown server passes through :not_found" do
      assert {:error, :not_found} =
               Backups.create_backup(scope(), Ecto.UUID.generate(), "manual", data_dir: "/tmp")
    end

    test "tar failure (exit > 1) yields a failed row and leaves no archive" do
      {scope, server, data_dir} = seed_server()

      assert {:error, {:backup_failed, _output}} =
               Backups.create_backup(scope, server.id, "manual",
                 data_dir: data_dir,
                 tar_cmd: failing_tar()
               )

      row = Repo.one!(from b in Backup, where: b.server_id == ^server.id)
      assert row.status == "failed"
      refute File.exists?(Path.join([data_dir, "backups", row.filename]))
    end
  end

  describe "create_backup/4 running server commands" do
    test "issues save-off, save-all then save-on around a successful backup" do
      {scope, server, data_dir} = seed_server()
      runtime = StubRuntime.install(:running)

      assert {:ok, _backup} =
               Backups.create_backup(scope, server.id, "manual",
                 data_dir: data_dir,
                 runtime: runtime,
                 save_wait_ms: 0
               )

      assert_received {:stub_command, _, "save-off"}
      assert_received {:stub_command, _, "save-all"}
      assert_received {:stub_command, _, "save-on"}
    end

    test "save-on is still issued after a failed backup" do
      {scope, server, data_dir} = seed_server()
      runtime = StubRuntime.install(:running)

      assert {:error, {:backup_failed, _}} =
               Backups.create_backup(scope, server.id, "manual",
                 data_dir: data_dir,
                 runtime: runtime,
                 save_wait_ms: 0,
                 tar_cmd: failing_tar()
               )

      assert_received {:stub_command, _, "save-off"}
      assert_received {:stub_command, _, "save-on"}
    end

    test "stopped server issues no commands" do
      {scope, server, data_dir} = seed_server()
      runtime = StubRuntime.install(:stopped)

      assert {:ok, _} =
               Backups.create_backup(scope, server.id, "manual",
                 data_dir: data_dir,
                 runtime: runtime
               )

      refute_received {:stub_command, _, _}
    end
  end

  describe "list_backups/2 and get_backup/3" do
    test "lists newest first by inserted_at" do
      {scope, server, _data_dir} = seed_server()

      older =
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: "#{server.id}_older.tar.gz",
          type: "manual",
          status: "completed",
          inserted_at: ~U[2026-01-01 00:00:00Z]
        })

      newer =
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: "#{server.id}_newer.tar.gz",
          type: "manual",
          status: "completed",
          inserted_at: ~U[2026-01-02 00:00:00Z]
        })

      ids = scope |> Backups.list_backups(server.id) |> Enum.map(& &1.id)
      assert ids == [newer.id, older.id]
    end

    test "get_backup returns the row or :backup_not_found" do
      {scope, server, data_dir} = seed_server()
      {:ok, backup} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)
      assert {:ok, %Backup{}} = Backups.get_backup(scope, server.id, backup.id)

      assert {:error, :backup_not_found} =
               Backups.get_backup(scope, server.id, Ecto.UUID.generate())
    end
  end

  describe "retention" do
    test "trims rows and files beyond max_backups when a config row exists" do
      {scope, server, data_dir} = seed_server()
      backups_dir = Path.join(data_dir, "backups")
      File.mkdir_p!(backups_dir)

      Repo.insert!(%BackupConfig{
        server_id: server.id,
        enabled: true,
        interval_minutes: 60,
        max_backups: 10,
        include_logs: false
      })

      filenames =
        for i <- 1..12 do
          fname = "#{server.id}_seed-#{String.pad_leading("#{i}", 2, "0")}.tar.gz"
          File.write!(Path.join(backups_dir, fname), "archive-#{i}")

          ts = DateTime.add(~U[2026-01-01 00:00:00Z], i, :minute)

          Repo.insert!(%Backup{
            server_id: server.id,
            filename: fname,
            size_bytes: 10,
            type: "manual",
            status: "completed",
            inserted_at: ts
          })

          {i, fname}
        end

      # A fresh create triggers retention; it leaves max_backups (10) rows.
      {:ok, _newest} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      remaining = scope |> Backups.list_backups(server.id) |> length()
      assert remaining == 10

      # Oldest two seeds (i=1, i=2) and their files are gone.
      for {i, fname} <- filenames, i <= 2 do
        refute File.exists?(Path.join(backups_dir, fname))
        refute Repo.exists?(from b in Backup, where: b.filename == ^fname)
      end
    end

    test "no config row means no retention" do
      {scope, server, data_dir} = seed_server()
      backups_dir = Path.join(data_dir, "backups")
      File.mkdir_p!(backups_dir)

      for i <- 1..12 do
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: "#{server.id}_keep-#{i}.tar.gz",
          size_bytes: 10,
          type: "manual",
          status: "completed",
          inserted_at: DateTime.add(~U[2026-01-01 00:00:00Z], i, :minute)
        })
      end

      {:ok, _} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)
      # 12 seeds + 1 fresh, nothing trimmed.
      assert scope |> Backups.list_backups(server.id) |> length() == 13
    end
  end

  describe "config" do
    test "get_config returns nil when absent, the row when present" do
      {scope, server, _data_dir} = seed_server()
      assert Backups.get_config(scope, server.id) == nil

      config = Repo.insert!(%BackupConfig{server_id: server.id})
      assert %BackupConfig{id: id} = Backups.get_config(scope, server.id)
      assert id == config.id
    end

    test "update_config validates ranges and persists" do
      {scope, server, _data_dir} = seed_server()
      Repo.insert!(%BackupConfig{server_id: server.id})

      assert {:ok, config} =
               Backups.update_config(scope, server.id, %{
                 enabled: false,
                 interval_minutes: 30,
                 max_backups: 5,
                 include_logs: true
               })

      assert config.enabled == false
      assert config.interval_minutes == 30
      assert config.max_backups == 5
      assert config.include_logs == true
    end

    test "update_config rejects out-of-range interval and max" do
      {scope, server, _data_dir} = seed_server()
      Repo.insert!(%BackupConfig{server_id: server.id})

      assert {:error, %Ecto.Changeset{}} =
               Backups.update_config(scope, server.id, %{interval_minutes: 4})

      assert {:error, %Ecto.Changeset{}} =
               Backups.update_config(scope, server.id, %{interval_minutes: 1441})

      assert {:error, %Ecto.Changeset{}} =
               Backups.update_config(scope, server.id, %{max_backups: 0})

      assert {:error, %Ecto.Changeset{}} =
               Backups.update_config(scope, server.id, %{max_backups: 101})
    end

    test "update_config on a missing config row returns :not_found" do
      {scope, server, _data_dir} = seed_server()
      assert {:error, :not_found} = Backups.update_config(scope, server.id, %{enabled: false})
    end

    test "unknown server passes through nil/:not_found for config reads/writes" do
      scope = scope()
      assert Backups.get_config(scope, Ecto.UUID.generate()) == nil
      assert {:error, :not_found} = Backups.update_config(scope, Ecto.UUID.generate(), %{})
    end
  end

  describe "restore_backup/3" do
    test "restores archived content, drops live-only changes and reseeds the jar" do
      {scope, server, data_dir} = seed_server()
      {:ok, backup} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      jar_bytes = File.read!(Path.join(server.directory, "server.jar"))

      # Mutate the live directory AFTER the backup: add a marker, delete a
      # world file. The restore must undo both.
      File.write!(Path.join(server.directory, "MARKER"), "live-only")
      File.rm!(Path.join([server.directory, "world", "level.dat"]))

      assert :ok = Backups.restore_backup(scope, server.id, backup.id, data_dir: data_dir)

      assert File.read!(Path.join([server.directory, "world", "level.dat"])) == "level-data"
      refute File.exists?(Path.join(server.directory, "MARKER"))
      # Jar is excluded from archives but reseeded from the set-aside copy.
      assert File.read!(Path.join(server.directory, "server.jar")) == jar_bytes

      # No pre_restore leftovers in the parent.
      parent = Path.dirname(server.directory)
      leftovers = parent |> File.ls!() |> Enum.filter(&String.contains?(&1, "_pre_restore_"))
      assert leftovers == []
    end

    test "refuses to restore while the server is running or starting" do
      {scope, server, data_dir} = seed_server()
      {:ok, backup} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      runtime = StubRuntime.install(:running)

      assert {:error, :server_running} =
               Backups.restore_backup(scope, server.id, backup.id,
                 data_dir: data_dir,
                 runtime: runtime
               )

      StubRuntime.install(:starting)

      assert {:error, :server_running} =
               Backups.restore_backup(scope, server.id, backup.id,
                 data_dir: data_dir,
                 runtime: StubRuntime
               )
    end

    test "unknown backup yields :backup_not_found" do
      {scope, server, data_dir} = seed_server()

      assert {:error, :backup_not_found} =
               Backups.restore_backup(scope, server.id, Ecto.UUID.generate(), data_dir: data_dir)
    end

    test "missing archive file yields :backup_file_not_found" do
      {scope, server, data_dir} = seed_server()

      backup =
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: "#{server.id}_ghost.tar.gz",
          type: "manual",
          status: "completed"
        })

      assert {:error, :backup_file_not_found} =
               Backups.restore_backup(scope, server.id, backup.id, data_dir: data_dir)
    end

    test "a corrupt archive rolls the original directory back intact" do
      {scope, server, data_dir} = seed_server()

      # A real, completed backup row whose file is garbage (tar -xzf fails).
      backups_dir = Path.join(data_dir, "backups")
      File.mkdir_p!(backups_dir)
      filename = "#{server.id}_corrupt.tar.gz"
      File.write!(Path.join(backups_dir, filename), "not a real gzip stream")

      backup =
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: filename,
          type: "manual",
          status: "completed"
        })

      before = dir_snapshot(server.directory)

      assert {:error, {:restore_failed, _reason}} =
               Backups.restore_backup(scope, server.id, backup.id, data_dir: data_dir)

      assert dir_snapshot(server.directory) == before

      parent = Path.dirname(server.directory)
      leftovers = parent |> File.ls!() |> Enum.filter(&String.contains?(&1, "_pre_restore_"))
      assert leftovers == []
    end
  end

  describe "delete_backup/3" do
    test "removes the archive file and the row" do
      {scope, server, data_dir} = seed_server()
      {:ok, backup} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)
      archive_path = Path.join([data_dir, "backups", backup.filename])
      assert File.exists?(archive_path)

      assert :ok = Backups.delete_backup(scope, server.id, backup.id, data_dir: data_dir)

      refute File.exists?(archive_path)
      assert {:error, :backup_not_found} = Backups.get_backup(scope, server.id, backup.id)
    end

    test "unknown backup yields :backup_not_found" do
      {scope, server, data_dir} = seed_server()

      assert {:error, :backup_not_found} =
               Backups.delete_backup(scope, server.id, Ecto.UUID.generate(), data_dir: data_dir)
    end
  end

  describe "backup_file_path/3" do
    test "returns the archive path and filename for an existing backup" do
      {scope, server, data_dir} = seed_server()
      {:ok, backup} = Backups.create_backup(scope, server.id, "manual", data_dir: data_dir)

      assert {:ok, path, filename} =
               Backups.backup_file_path(scope, server.id, backup.id, data_dir: data_dir)

      assert filename == backup.filename
      assert path == Path.join([data_dir, "backups", backup.filename])
      assert File.exists?(path)
    end

    test "missing file yields :backup_file_not_found" do
      {scope, server, data_dir} = seed_server()

      backup =
        Repo.insert!(%Backup{
          server_id: server.id,
          filename: "#{server.id}_ghost.tar.gz",
          type: "manual",
          status: "completed"
        })

      assert {:error, :backup_file_not_found} =
               Backups.backup_file_path(scope, server.id, backup.id, data_dir: data_dir)
    end

    test "unknown backup yields :backup_not_found" do
      {scope, server, data_dir} = seed_server()

      assert {:error, :backup_not_found} =
               Backups.backup_file_path(scope, server.id, Ecto.UUID.generate(),
                 data_dir: data_dir
               )
    end
  end

  # Recursively snapshots a directory's relative file paths and contents so a
  # rollback can be asserted byte-for-byte.
  defp dir_snapshot(dir) do
    dir
    |> Path.join("**")
    |> Path.wildcard(match_dot: true)
    |> Enum.filter(&File.regular?/1)
    |> Map.new(fn path -> {Path.relative_to(path, dir), File.read!(path)} end)
  end
end
