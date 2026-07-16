defmodule Allay.Servers.Import.SessionTest do
  use ExUnit.Case, async: false

  alias Allay.Servers.Import.Session

  defp data_dir do
    dir =
      Path.join(System.tmp_dir!(), "allay_import_session_#{System.unique_integer([:positive])}")

    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf(dir) end)
    dir
  end

  describe "create/3 + archive_path/2" do
    test "copies a binary upload into temp/import-{id}/{filename} and resolves it back" do
      dir = data_dir()

      assert {:ok, import_id} =
               Session.create({:binary, "ARCHIVE-BYTES"}, "world.zip", data_dir: dir)

      assert {:ok, path} = Session.archive_path(import_id, data_dir: dir)

      assert Path.basename(path) == "world.zip"
      assert Path.dirname(path) == Path.join([dir, "temp", "import-#{import_id}"])
      assert File.read!(path) == "ARCHIVE-BYTES"
    end

    test "copies a source file upload into temp/import-{id}/{filename}" do
      dir = data_dir()
      src = Path.join(System.tmp_dir!(), "src_#{System.unique_integer([:positive])}.tgz")
      File.write!(src, "TGZ")
      on_exit(fn -> File.rm(src) end)

      assert {:ok, import_id} = Session.create({:file, src}, "backup.tar.gz", data_dir: dir)
      assert {:ok, path} = Session.archive_path(import_id, data_dir: dir)
      assert File.read!(path) == "TGZ"
      assert Path.basename(path) == "backup.tar.gz"
    end

    test "archive_path/2 → {:error, :import_not_found} for a missing dir" do
      dir = data_dir()

      assert {:error, :import_not_found} =
               Session.archive_path(Ecto.UUID.generate(), data_dir: dir)
    end

    test "archive_path/2 deletes and reports an expired (mtime > 30 min) dir" do
      dir = data_dir()
      assert {:ok, import_id} = Session.create({:binary, "X"}, "a.zip", data_dir: dir)
      import_dir = Path.join([dir, "temp", "import-#{import_id}"])

      old = System.os_time(:second) - 31 * 60
      File.touch!(import_dir, old)

      assert {:error, :import_not_found} = Session.archive_path(import_id, data_dir: dir)
      refute File.exists?(import_dir)
    end

    test "archive_path/2 keeps a fresh dir (mtime within the 30 min window)" do
      dir = data_dir()
      assert {:ok, import_id} = Session.create({:binary, "X"}, "a.zip", data_dir: dir)
      import_dir = Path.join([dir, "temp", "import-#{import_id}"])

      recent = System.os_time(:second) - 5 * 60
      File.touch!(import_dir, recent)

      assert {:ok, _path} = Session.archive_path(import_id, data_dir: dir)
      assert File.exists?(import_dir)
    end
  end

  describe "sweep/1" do
    test "removes only expired import-* dirs, leaving fresh ones and non-import dirs" do
      dir = data_dir()
      temp = Path.join(dir, "temp")
      File.mkdir_p!(temp)

      {:ok, fresh} = Session.create({:binary, "X"}, "a.zip", data_dir: dir)
      {:ok, stale} = Session.create({:binary, "Y"}, "b.zip", data_dir: dir)

      stale_dir = Path.join(temp, "import-#{stale}")
      File.touch!(stale_dir, System.os_time(:second) - 31 * 60)

      other = Path.join(temp, "tar-extract-keepme")
      File.mkdir_p!(other)

      :ok = Session.sweep(data_dir: dir)

      assert File.exists?(Path.join(temp, "import-#{fresh}"))
      refute File.exists?(stale_dir)
      assert File.exists?(other)
    end

    test "sweep/1 is a no-op when temp dir is absent" do
      dir = data_dir()
      File.rm_rf(Path.join(dir, "temp"))
      assert :ok = Session.sweep(data_dir: dir)
    end
  end

  describe "start_upload/2" do
    test "creates the import dir and returns the destination path" do
      dir = Path.join(System.tmp_dir!(), "sess-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf!(dir) end)

      assert {:ok, import_id, dest} = Session.start_upload("World Backup.zip", data_dir: dir)

      assert is_binary(import_id)
      assert dest == Path.join([dir, "temp", "import-#{import_id}", "World Backup.zip"])
      assert File.dir?(Path.dirname(dest))
    end

    test "keeps only the basename of the filename" do
      dir = Path.join(System.tmp_dir!(), "sess-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf!(dir) end)

      assert {:ok, _id, dest} = Session.start_upload("../../etc/evil.zip", data_dir: dir)
      assert Path.basename(dest) == "evil.zip"
    end
  end

  describe "delete/2" do
    test "removes the import dir" do
      dir = data_dir()
      {:ok, import_id} = Session.create({:binary, "X"}, "a.zip", data_dir: dir)
      import_dir = Path.join([dir, "temp", "import-#{import_id}"])
      assert File.exists?(import_dir)

      assert :ok = Session.delete(import_id, data_dir: dir)
      refute File.exists?(import_dir)
    end

    test "delete/2 is idempotent for a missing dir" do
      dir = data_dir()
      assert :ok = Session.delete(Ecto.UUID.generate(), data_dir: dir)
    end
  end
end
