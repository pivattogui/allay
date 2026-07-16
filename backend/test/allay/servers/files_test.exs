defmodule Allay.Servers.FilesTest do
  use Allay.DataCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Servers

  defp scope do
    Accounts.Scope.for_user(user_fixture())
  end

  # Inserts a server row whose `directory` points at a fresh tmp dir that
  # exists on disk (PathSandbox.resolve requires it). Returns {scope, server,
  # dir}. The dir is removed after the test.
  defp seed do
    scope = scope()
    dir = Path.join(System.tmp_dir!(), "allay_files_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    server = server_fixture(%{directory: dir})
    {scope, server, dir}
  end

  describe "server + sandbox guards (shared by every operation)" do
    test "unknown server id → {:error, :not_found}" do
      assert {:error, :not_found} =
               Servers.list_entries(scope(), Ecto.UUID.generate(), "")
    end

    test "invalid_path from the sandbox passes through" do
      {scope, server, _dir} = seed()
      # A path that resolves above the root is sanitized to "" by the sandbox,
      # so to force :invalid_path we point the server dir at a missing path.
      bad = server_fixture(%{directory: "/nonexistent/#{System.unique_integer([:positive])}"})
      assert {:error, :invalid_path} = Servers.list_entries(scope, bad.id, "")
      # And a valid server still works.
      assert {:ok, _} = Servers.list_entries(scope, server.id, "")
    end
  end

  describe "list_entries/3" do
    test "root path reported as \"/\" with dirs-first then name-ascending" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "zeta.txt"), "z")
      File.write!(Path.join(dir, "alpha.txt"), "a")
      File.mkdir_p!(Path.join(dir, "world"))
      File.mkdir_p!(Path.join(dir, "configs"))

      assert {:ok, %{path: "/", entries: entries}} = Servers.list_entries(scope, server.id, "")
      assert Enum.map(entries, & &1.name) == ["configs", "world", "alpha.txt", "zeta.txt"]
      assert Enum.map(entries, & &1.type) == ["directory", "directory", "file", "file"]
    end

    test "non-root path echoed sanitized" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "plugins"))
      assert {:ok, %{path: "plugins"}} = Servers.list_entries(scope, server.id, "plugins")
    end

    test "entry fields: file" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "server.properties"), "x=1")

      assert {:ok, %{entries: [entry]}} = Servers.list_entries(scope, server.id, "")
      assert entry.name == "server.properties"
      assert entry.type == "file"
      assert entry.size == 3
      assert %DateTime{} = entry.modified
      assert entry.extension == ".properties"
      assert entry.editable == true
      assert entry.sensitive == false
      assert entry.file_type == "config"
    end

    test "entry fields: directory has size 0, nil extension, nil file_type" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "world"))

      assert {:ok, %{entries: [entry]}} = Servers.list_entries(scope, server.id, "")
      assert entry.type == "directory"
      assert entry.size == 0
      assert entry.extension == nil
      assert entry.file_type == nil
    end

    test "extensionless file has nil extension" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "README"), "hi")

      assert {:ok, %{entries: [entry]}} = Servers.list_entries(scope, server.id, "")
      assert entry.extension == nil
    end

    test "sensitive file flagged" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "eula.txt"), "eula=true")

      assert {:ok, %{entries: [entry]}} = Servers.list_entries(scope, server.id, "")
      assert entry.sensitive == true
    end

    test "missing directory → {:error, :directory_not_found}" do
      {scope, server, _dir} = seed()
      assert {:error, :directory_not_found} = Servers.list_entries(scope, server.id, "missing")
    end

    test "path that is a file → {:error, :not_a_directory}" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "file.txt"), "x")
      assert {:error, :not_a_directory} = Servers.list_entries(scope, server.id, "file.txt")
    end
  end

  describe "read_file/4" do
    test "missing file → {:error, :file_not_found}" do
      {scope, server, _dir} = seed()
      assert {:error, :file_not_found} = Servers.read_file(scope, server.id, "nope.txt", :utf8)
    end

    test "directory → {:error, :is_directory}" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "world"))
      assert {:error, :is_directory} = Servers.read_file(scope, server.id, "world", :utf8)
    end

    test "editable utf8 read returns content and common fields" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "server.properties"), "x=1")

      assert {:ok, result} = Servers.read_file(scope, server.id, "server.properties", :utf8)
      assert result.path == "server.properties"
      assert result.name == "server.properties"
      assert result.size == 3
      assert %DateTime{} = result.modified
      assert result.editable == true
      assert result.sensitive == false
      assert result.file_type == "config"
      assert result.content == "x=1"
      assert result.encoding == "utf8"
    end

    test "non-editable + utf8 → content nil with editor message" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "icon.png"), "PNGDATA")

      assert {:ok, result} = Servers.read_file(scope, server.id, "icon.png", :utf8)
      assert result.editable == false
      assert result.content == nil
      assert result.encoding == nil
      assert result.message == "File is not editable. Use download endpoint."
    end

    test "base64 read of a non-editable file bypasses the editable gate" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "icon.png"), "PNGDATA")

      assert {:ok, result} = Servers.read_file(scope, server.id, "icon.png", :base64)
      assert result.editable == false
      assert result.encoding == "base64"
      assert result.content == Base.encode64("PNGDATA")
      refute Map.has_key?(result, :message)
    end

    test "file larger than 1 MiB → too_large with content nil" do
      {scope, server, dir} = seed()
      big = String.duplicate("a", 1_048_576 + 1)
      File.write!(Path.join(dir, "big.txt"), big)

      assert {:ok, result} = Servers.read_file(scope, server.id, "big.txt", :utf8)
      assert result.too_large == true
      assert result.content == nil
      assert result.encoding == nil
      assert result.size == 1_048_576 + 1
    end

    test "exactly 1 MiB is still readable" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "edge.txt"), String.duplicate("a", 1_048_576))

      assert {:ok, result} = Servers.read_file(scope, server.id, "edge.txt", :utf8)
      refute Map.get(result, :too_large)
      assert result.content != nil
    end
  end

  describe "write_file/4" do
    test "creates nested parents and returns size + sensitive" do
      {scope, server, dir} = seed()

      assert {:ok, result} =
               Servers.write_file(scope, server.id, "config/sub/app.yml", "key: value")

      assert result.path == "config/sub/app.yml"
      assert result.size == byte_size("key: value")
      assert result.sensitive == false
      assert File.read!(Path.join(dir, "config/sub/app.yml")) == "key: value"
    end

    test "overwrites existing file" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "a.txt"), "old")
      assert {:ok, _} = Servers.write_file(scope, server.id, "a.txt", "new")
      assert File.read!(Path.join(dir, "a.txt")) == "new"
    end

    test "sensitive basename flagged in the result" do
      {scope, server, _dir} = seed()
      assert {:ok, %{sensitive: true}} = Servers.write_file(scope, server.id, "ops.json", "[]")
    end

    test "write onto an existing directory → {:error, :write_error}" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "adir"))
      assert {:error, :write_error} = Servers.write_file(scope, server.id, "adir", "x")
    end
  end

  describe "mkdir/3" do
    test "empty sanitized name → {:error, :name_required}" do
      {scope, server, _dir} = seed()
      assert {:error, :name_required} = Servers.mkdir(scope, server.id, "")
    end

    test "creates nested dirs" do
      {scope, server, dir} = seed()
      assert {:ok, %{path: "a/b/c"}} = Servers.mkdir(scope, server.id, "a/b/c")
      assert File.dir?(Path.join(dir, "a/b/c"))
    end

    test "already-existing path → {:error, :already_exists}" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "world"))
      assert {:error, :already_exists} = Servers.mkdir(scope, server.id, "world")
    end
  end

  describe "delete_path/3" do
    test "empty path → {:error, :cannot_delete_root}" do
      {scope, server, _dir} = seed()
      assert {:error, :cannot_delete_root} = Servers.delete_path(scope, server.id, "")
    end

    test "missing path → {:error, :path_not_found}" do
      {scope, server, _dir} = seed()
      assert {:error, :path_not_found} = Servers.delete_path(scope, server.id, "ghost")
    end

    test "deletes a file and reports type" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "a.txt"), "x")

      assert {:ok, %{path: "a.txt", type: "file"}} =
               Servers.delete_path(scope, server.id, "a.txt")

      refute File.exists?(Path.join(dir, "a.txt"))
    end

    test "recursively deletes a populated directory and reports type" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "world/region"))
      File.write!(Path.join(dir, "world/level.dat"), "lvl")
      File.write!(Path.join(dir, "world/region/r.0.0.mca"), "region")

      assert {:ok, %{path: "world", type: "directory"}} =
               Servers.delete_path(scope, server.id, "world")

      refute File.exists?(Path.join(dir, "world"))
    end
  end

  describe "rename_path/4" do
    test "missing source → {:error, :source_not_found}" do
      {scope, server, _dir} = seed()
      assert {:error, :source_not_found} = Servers.rename_path(scope, server.id, "a.txt", "b.txt")
    end

    test "destination already exists → {:error, :destination_exists}" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "a.txt"), "a")
      File.write!(Path.join(dir, "b.txt"), "b")

      assert {:error, :destination_exists} =
               Servers.rename_path(scope, server.id, "a.txt", "b.txt")
    end

    test "renames in place returning sanitized rels" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "a.txt"), "a")

      assert {:ok, %{old_path: "a.txt", new_path: "b.txt"}} =
               Servers.rename_path(scope, server.id, "a.txt", "b.txt")

      refute File.exists?(Path.join(dir, "a.txt"))
      assert File.read!(Path.join(dir, "b.txt")) == "a"
    end

    test "acts as a move creating destination parents" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "a.txt"), "a")

      assert {:ok, %{old_path: "a.txt", new_path: "nested/deep/b.txt"}} =
               Servers.rename_path(scope, server.id, "a.txt", "nested/deep/b.txt")

      assert File.read!(Path.join(dir, "nested/deep/b.txt")) == "a"
    end

    test "invalid old path → {:error, :invalid_old_path}" do
      {scope, server, _dir} = seed()
      bad = server_fixture(%{directory: "/nonexistent/#{System.unique_integer([:positive])}"})
      assert {:error, :invalid_old_path} = Servers.rename_path(scope, bad.id, "a", "b")
      _ = server
    end
  end

  describe "download_path/3" do
    test "missing file → {:error, :file_not_found}" do
      {scope, server, _dir} = seed()
      assert {:error, :file_not_found} = Servers.download_path(scope, server.id, "nope.bin")
    end

    test "directory → {:error, :is_directory_download}" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "world"))
      assert {:error, :is_directory_download} = Servers.download_path(scope, server.id, "world")
    end

    test "returns full path and basename" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "sub"))
      File.write!(Path.join(dir, "sub/file.bin"), "bytes")

      assert {:ok, full, "file.bin"} = Servers.download_path(scope, server.id, "sub/file.bin")
      assert full == Path.join(dir, "sub/file.bin")
    end
  end

  describe "save_uploads/4" do
    defp tmp_upload(name, content) do
      path = Path.join(System.tmp_dir!(), "allay_upload_#{System.unique_integer([:positive])}")
      File.write!(path, content)
      on_exit(fn -> File.rm_rf!(path) end)
      %{filename: name, path: path}
    end

    test "creates the target dir and reports uploaded names + sizes + count" do
      {scope, server, dir} = seed()
      u1 = tmp_upload("a.txt", "aaa")
      u2 = tmp_upload("b.txt", "bb")

      assert {:ok, %{uploaded: uploaded, count: 2}} =
               Servers.save_uploads(scope, server.id, "incoming", [u1, u2])

      assert Enum.sort_by(uploaded, & &1.name) == [
               %{name: "a.txt", size: 3},
               %{name: "b.txt", size: 2}
             ]

      assert File.read!(Path.join(dir, "incoming/a.txt")) == "aaa"
    end

    test "client traversal filename is reduced to its basename inside the target" do
      {scope, server, dir} = seed()
      u = tmp_upload("../../evil.txt", "pwn")

      assert {:ok, %{uploaded: [%{name: "evil.txt"}], count: 1}} =
               Servers.save_uploads(scope, server.id, "drop", [u])

      assert File.read!(Path.join(dir, "drop/evil.txt")) == "pwn"
      # Nothing escaped the sandbox root.
      refute File.exists?(Path.join(dir, "../evil.txt"))
      refute File.exists?(Path.expand("../evil.txt", dir))
    end

    test "silently overwrites an existing file" do
      {scope, server, dir} = seed()
      File.mkdir_p!(Path.join(dir, "drop"))
      File.write!(Path.join(dir, "drop/a.txt"), "old")
      u = tmp_upload("a.txt", "new")

      assert {:ok, %{count: 1}} = Servers.save_uploads(scope, server.id, "drop", [u])
      assert File.read!(Path.join(dir, "drop/a.txt")) == "new"
    end

    test "target path that is an existing file → {:error, :not_a_directory}" do
      {scope, server, dir} = seed()
      File.write!(Path.join(dir, "afile"), "x")
      u = tmp_upload("a.txt", "y")
      assert {:error, :not_a_directory} = Servers.save_uploads(scope, server.id, "afile", [u])
    end

    test "any copy failure → {:error, :upload_error}" do
      {scope, server, _dir} = seed()

      missing = %{
        filename: "a.txt",
        path: Path.join(System.tmp_dir!(), "absent_#{System.unique_integer([:positive])}")
      }

      assert {:error, :upload_error} = Servers.save_uploads(scope, server.id, "drop", [missing])
    end
  end
end
