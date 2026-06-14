defmodule AllayWeb.BackupControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Backups.Backup
  alias Allay.Backups.BackupConfig
  alias Allay.Repo
  alias Allay.Runtime
  alias Allay.Runtime.FakeRcon

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)

    data_dir = Path.join(System.tmp_dir!(), "backup-ctl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(data_dir)
    prev = Application.get_env(:allay, :data_dir)
    Application.put_env(:allay, :data_dir, data_dir)

    on_exit(fn ->
      if prev, do: Application.put_env(:allay, :data_dir, prev)
      File.rm_rf!(data_dir)
    end)

    {:ok,
     conn: put_req_header(conn, "authorization", "Bearer #{token}"),
     data_dir: data_dir,
     user: user}
  end

  # A server seeded on disk under the configured data_dir, ready to back up.
  defp seeded_server(data_dir, overrides \\ %{}) do
    dir = Path.join([data_dir, "servers", "srv-#{System.unique_integer([:positive])}"])
    File.mkdir_p!(Path.join(dir, "world"))
    File.write!(Path.join([dir, "world", "level.dat"]), "level-data")
    File.write!(Path.join(dir, "server.jar"), "JAR")
    server_fixture(Map.merge(%{directory: dir}, overrides))
  end

  defp insert_backup(server, attrs \\ %{}) do
    Repo.insert!(
      struct(
        %Backup{
          server_id: server.id,
          filename: "#{server.id}_2026.tar.gz",
          size_bytes: 42,
          type: "manual",
          status: "completed"
        },
        attrs
      )
    )
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      conn = delete_req_header(conn, "authorization")
      assert json_response(get(conn, ~p"/api/backups/#{Ecto.UUID.generate()}"), 401)
    end
  end

  describe "GET /api/backups/:serverId" do
    test "200 lists backups and config", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      insert_backup(server)

      Repo.insert!(%BackupConfig{
        server_id: server.id,
        enabled: true,
        interval_minutes: 30,
        max_backups: 5,
        include_logs: true
      })

      conn = get(conn, ~p"/api/backups/#{server.id}")

      assert %{"backups" => [b], "config" => config} = json_response(conn, 200)

      assert b["serverId"] == server.id
      assert b["sizeBytes"] == 42
      assert b["type"] == "manual"
      assert b["status"] == "completed"
      assert is_binary(b["filename"])
      assert is_binary(b["id"])
      assert is_binary(b["createdAt"])

      assert config["serverId"] == server.id
      assert config["enabled"] == true
      assert config["intervalMinutes"] == 30
      assert config["maxBackups"] == 5
      assert config["includeLogs"] == true
    end

    test "200 with null config when none exists", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = get(conn, ~p"/api/backups/#{server.id}")
      assert %{"backups" => [], "config" => nil} = json_response(conn, 200)
    end

    test "404 for unknown server", %{conn: conn} do
      conn = get(conn, ~p"/api/backups/#{Ecto.UUID.generate()}")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "POST /api/backups/:serverId" do
    test "201 creates a backup, ignoring the body", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = post(conn, ~p"/api/backups/#{server.id}", %{"junk" => "ignored"})

      assert %{"backup" => backup} = json_response(conn, 201)
      assert backup["serverId"] == server.id
      assert backup["status"] == "completed"
      assert backup["type"] == "manual"
    end

    test "404 for unknown server", %{conn: conn} do
      conn = post(conn, ~p"/api/backups/#{Ecto.UUID.generate()}")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "POST /api/backups/:serverId/:backupId/restore" do
    test "200 restores the backup", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      create = post(conn, ~p"/api/backups/#{server.id}")
      assert %{"backup" => %{"id" => backup_id}} = json_response(create, 201)

      conn = post(conn, ~p"/api/backups/#{server.id}/#{backup_id}/restore")
      assert %{"message" => "Backup restored successfully"} = json_response(conn, 200)
    end

    test "404 for unknown backup", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = post(conn, ~p"/api/backups/#{server.id}/#{Ecto.UUID.generate()}/restore")
      assert %{"code" => "BACKUP_NOT_FOUND"} = json_response(conn, 404)
    end

    test "404 when the archive file is missing", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      backup = insert_backup(server)
      conn = post(conn, ~p"/api/backups/#{server.id}/#{backup.id}/restore")
      assert %{"code" => "BACKUP_FILE_NOT_FOUND"} = json_response(conn, 404)
    end

    test "409 while the server is running", %{conn: conn, data_dir: data_dir, user: user} do
      {:ok, _} = FakeRcon.start_registry()
      rcon_port = System.unique_integer([:positive])

      server =
        seeded_server(data_dir, %{
          java_path: @fake_java,
          java_version: "21",
          rcon_port: rcon_port,
          rcon_password: "pw"
        })

      backup = insert_backup(server)

      on_exit(fn -> Runtime.remove_instance(server.id) end)

      Application.put_env(:allay, :lifecycle_start_opts,
        env: [{"FAKE_BEHAVIOR", "ok"}],
        spec_overrides: [
          rcon_mod: FakeRcon,
          startup_timeout_ms: 2_000,
          stop_timeout_ms: 300,
          term_timeout_ms: 300,
          respawn_delay_ms: 50
        ]
      )

      on_exit(fn -> Application.delete_env(:allay, :lifecycle_start_opts) end)

      scope = Accounts.Scope.for_user(user)
      Allay.Runtime.subscribe(server.id)

      {:ok, _} =
        Allay.Servers.start_server(
          scope,
          server.id,
          Application.get_env(:allay, :lifecycle_start_opts)
        )

      FakeRcon.set(rcon_port, %{ready?: true})
      assert_receive %Allay.Runtime.Event{type: :status, data: %{state: :running}}, 3_000

      conn = post(conn, ~p"/api/backups/#{server.id}/#{backup.id}/restore")
      assert %{"code" => "SERVER_RUNNING"} = json_response(conn, 409)
    end
  end

  describe "DELETE /api/backups/:serverId/:backupId" do
    test "200 deletes the backup", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      backup = insert_backup(server)

      conn = delete(conn, ~p"/api/backups/#{server.id}/#{backup.id}")
      assert %{"message" => "Backup deleted successfully"} = json_response(conn, 200)
      refute Repo.get(Backup, backup.id)
    end

    test "404 for unknown backup", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = delete(conn, ~p"/api/backups/#{server.id}/#{Ecto.UUID.generate()}")
      assert %{"code" => "BACKUP_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "GET /api/backups/:serverId/:backupId/download" do
    test "streams the archive as gzip attachment", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      create = post(conn, ~p"/api/backups/#{server.id}")

      assert %{"backup" => %{"id" => backup_id, "filename" => filename}} =
               json_response(create, 201)

      conn = get(conn, ~p"/api/backups/#{server.id}/#{backup_id}/download")

      assert response(conn, 200)
      assert {"content-type", "application/gzip"} in conn.resp_headers

      disposition =
        Enum.find_value(conn.resp_headers, fn {k, v} -> k == "content-disposition" && v end)

      assert disposition =~ "attachment"
      assert disposition =~ filename
      assert byte_size(conn.resp_body) > 0
    end

    test "404 when the archive file is missing", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      backup = insert_backup(server)
      conn = get(conn, ~p"/api/backups/#{server.id}/#{backup.id}/download")
      assert %{"code" => "BACKUP_FILE_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "PATCH /api/backups/:serverId/config" do
    test "200 updates an existing config", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      Repo.insert!(%BackupConfig{
        server_id: server.id,
        enabled: false,
        interval_minutes: 60,
        max_backups: 10,
        include_logs: false
      })

      conn =
        patch(conn, ~p"/api/backups/#{server.id}/config", %{
          "enabled" => true,
          "intervalMinutes" => 120,
          "maxBackups" => 7,
          "includeLogs" => true
        })

      assert %{"config" => config} = json_response(conn, 200)
      assert config["enabled"] == true
      assert config["intervalMinutes"] == 120
      assert config["maxBackups"] == 7
      assert config["includeLogs"] == true
    end

    test "400 VALIDATION_ERROR on out-of-range interval", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      Repo.insert!(%BackupConfig{server_id: server.id})

      conn = patch(conn, ~p"/api/backups/#{server.id}/config", %{"intervalMinutes" => 1})
      assert %{"code" => "VALIDATION_ERROR"} = json_response(conn, 400)
    end

    test "404 CONFIG_NOT_FOUND when no config row exists", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = patch(conn, ~p"/api/backups/#{server.id}/config", %{"enabled" => false})
      assert %{"code" => "CONFIG_NOT_FOUND"} = json_response(conn, 404)
    end
  end
end
