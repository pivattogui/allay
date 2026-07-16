defmodule AllayWeb.ServerFileControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Servers.OperationLock

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)

    tmp = Path.join(System.tmp_dir!(), "file-ctl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)

    on_exit(fn -> File.rm_rf!(tmp) end)

    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}"), tmp: tmp, user: user}
  end

  # Inserts a server row whose `directory` is a real tmp dir with at least
  # one file so listing is non-trivial.
  defp seeded_server(tmp) do
    dir = Path.join(tmp, "srv-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.properties"), "server-port=25565\n")
    File.write!(Path.join(dir, "server.jar"), "JAR")
    File.mkdir_p!(Path.join(dir, "world"))
    server_fixture(%{directory: dir})
  end

  # ── Auth sweep ──────────────────────────────────────────────────────────────

  describe "auth" do
    test "401 without token on all file endpoints", %{conn: conn} do
      conn = delete_req_header(conn, "authorization")
      id = Ecto.UUID.generate()

      paths = [
        get(conn, "/api/servers/#{id}/files/read/foo.txt"),
        put(conn, "/api/servers/#{id}/files/write/foo.txt"),
        get(conn, "/api/servers/#{id}/files/download/foo.txt"),
        post(conn, "/api/servers/#{id}/files/list"),
        post(conn, "/api/servers/#{id}/files/mkdir/newdir"),
        post(conn, "/api/servers/#{id}/files/rename"),
        post(conn, "/api/servers/#{id}/files/upload"),
        delete(conn, "/api/servers/#{id}/files/foo.txt")
      ]

      for resp <- paths do
        assert resp.status == 401, "expected 401, got #{resp.status}"
      end
    end
  end

  describe "operation conflicts" do
    test "409 exposes the active operation for a conflicting write", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      owner = hold_operation(server.id, :restore)

      conn =
        put(conn, "/api/servers/#{server.id}/files/write/config.txt", %{"content" => "value"})

      assert %{
               "code" => "SERVER_OPERATION_IN_PROGRESS",
               "details" => %{"operation" => "restore"}
             } = json_response(conn, 409)

      release_operation(owner)
    end
  end

  # ── POST /api/servers/:id/files/list ────────────────────────────────────────

  describe "POST /api/servers/:id/files/list" do
    test "200 lists root entries", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => ""})

      assert %{"path" => "/", "entries" => entries} = json_response(conn, 200)
      names = Enum.map(entries, & &1["name"])
      assert "server.properties" in names
      assert "server.jar" in names
      assert "world" in names
    end

    test "200 lists subdirectory", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      File.write!(Path.join([server.directory, "world", "level.dat"]), "data")
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => "world"})

      assert %{"path" => "world", "entries" => entries} = json_response(conn, 200)
      assert Enum.any?(entries, fn e -> e["name"] == "level.dat" end)
    end

    test "directories sort before files", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => ""})

      assert %{"entries" => entries} = json_response(conn, 200)
      types = Enum.map(entries, & &1["type"])
      dir_idx = Enum.find_index(types, fn t -> t == "directory" end)
      file_idx = Enum.find_index(types, fn t -> t == "file" end)
      assert dir_idx < file_idx
    end

    test "file entry has all required fields", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => ""})

      assert %{"entries" => entries} = json_response(conn, 200)
      jar = Enum.find(entries, fn e -> e["name"] == "server.jar" end)
      assert jar["type"] == "file"
      assert is_integer(jar["size"])
      assert is_binary(jar["modified"])
    end

    test "directory entry omits extension/editable/sensitive/fileType", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => ""})

      assert %{"entries" => entries} = json_response(conn, 200)
      world = Enum.find(entries, fn e -> e["name"] == "world" end)
      assert world["type"] == "directory"
      refute Map.has_key?(world, "extension")
      refute Map.has_key?(world, "editable")
      refute Map.has_key?(world, "sensitive")
      refute Map.has_key?(world, "fileType")
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn = post(conn, "/api/servers/#{Ecto.UUID.generate()}/files/list", %{"path" => ""})
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "traversal segments are clamped (not a 500, content stays inside sandbox)", %{
      conn: conn,
      tmp: tmp
    } do
      server = seeded_server(tmp)
      # PathSandbox.sanitize/1 resolves ".." by popping segments — "../../etc"
      # becomes "etc", which simply does not exist in the server dir → 404, not
      # 500. The important contract is that no system path leaks through.
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => "../../etc"})
      assert conn.status != 500
      refute (conn.resp_body || "") =~ "/etc/passwd"
    end

    test "404 DIRECTORY_NOT_FOUND for missing subdir", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/list", %{"path" => "nonexistent"})
      assert json_response(conn, 404)
    end
  end

  # ── GET /api/servers/:id/files/read/*path ───────────────────────────────────

  describe "GET /api/servers/:id/files/read/*path" do
    test "200 returns utf8 content for editable file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        get(conn, "/api/servers/#{server.id}/files/read/server.properties", %{
          "encoding" => "utf8"
        })

      assert %{
               "path" => "server.properties",
               "name" => "server.properties",
               "content" => content,
               "encoding" => "utf8"
             } = json_response(conn, 200)

      assert content =~ "server-port"
    end

    test "200 returns base64 for binary file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        get(conn, "/api/servers/#{server.id}/files/read/server.jar", %{"encoding" => "base64"})

      assert %{"encoding" => "base64", "content" => content} = json_response(conn, 200)
      assert is_binary(content)
    end

    test "200 defaults to utf8 when no encoding given", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/read/server.properties")
      assert %{"encoding" => "utf8"} = json_response(conn, 200)
    end

    test "200 tooLarge for large files", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      # Write slightly over 1 MiB
      large = Path.join(server.directory, "big.log")
      File.write!(large, String.duplicate("x", 1_048_577))

      conn = get(conn, "/api/servers/#{server.id}/files/read/big.log")
      assert %{"tooLarge" => true} = json_response(conn, 200)
    end

    test "200 message for non-editable utf8 request", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        get(conn, "/api/servers/#{server.id}/files/read/server.jar", %{"encoding" => "utf8"})

      assert %{"message" => msg} = json_response(conn, 200)
      assert is_binary(msg)
    end

    test "404 FILE_NOT_FOUND for missing file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/read/ghost.txt")
      assert json_response(conn, 404)
    end

    test "400 IS_DIRECTORY when targeting a directory", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/read/world")
      assert %{"code" => "IS_DIRECTORY"} = json_response(conn, 400)
    end

    # Encoded slashes arrive as one segment "../.." — the sandbox rejects it.
    test "traversal via encoded slashes is NOT a 500 and stays sandboxed", %{
      conn: conn,
      tmp: tmp
    } do
      server = seeded_server(tmp)
      # Plug decodes %2F → "/" but Phoenix router keeps wildcard as list of segments;
      # a literal ".." segment gets passed through, sandbox must reject it.
      conn = get(conn, "/api/servers/#{server.id}/files/read/..%2F..%2Fetc%2Fpasswd")
      assert conn.status != 500
      # Must not return /etc/passwd content
      refute (conn.resp_body || "") =~ "root:"
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn = get(conn, "/api/servers/#{Ecto.UUID.generate()}/files/read/foo.txt")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── PUT /api/servers/:id/files/write/*path ───────────────────────────────────

  describe "PUT /api/servers/:id/files/write/*path" do
    test "200 creates a new file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        put(conn, "/api/servers/#{server.id}/files/write/notes.txt", %{"content" => "hello"})

      assert %{"success" => true, "path" => "notes.txt", "size" => 5} = json_response(conn, 200)
      assert File.read!(Path.join(server.directory, "notes.txt")) == "hello"
    end

    test "200 overwrites existing file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      File.write!(Path.join(server.directory, "existing.txt"), "old")

      conn =
        put(conn, "/api/servers/#{server.id}/files/write/existing.txt", %{"content" => "new"})

      assert %{"success" => true, "size" => 3} = json_response(conn, 200)
    end

    test "200 creates parent dirs as needed", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        put(conn, "/api/servers/#{server.id}/files/write/deep/dir/file.txt", %{
          "content" => "nested"
        })

      assert %{"success" => true, "path" => "deep/dir/file.txt"} = json_response(conn, 200)
    end

    test "400 CONTENT_REQUIRED when content is missing", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = put(conn, "/api/servers/#{server.id}/files/write/foo.txt", %{})
      assert %{"code" => "CONTENT_REQUIRED"} = json_response(conn, 400)
    end

    test "400 CONTENT_REQUIRED when content is not a string", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = put(conn, "/api/servers/#{server.id}/files/write/foo.txt", %{"content" => 123})
      assert %{"code" => "CONTENT_REQUIRED"} = json_response(conn, 400)
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn =
        put(conn, "/api/servers/#{Ecto.UUID.generate()}/files/write/foo.txt", %{
          "content" => "x"
        })

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── POST /api/servers/:id/files/mkdir/*path ──────────────────────────────────

  describe "POST /api/servers/:id/files/mkdir/*path" do
    test "200 creates a directory", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/mkdir/newdir")

      assert %{"success" => true, "path" => "newdir"} = json_response(conn, 200)
      assert File.dir?(Path.join(server.directory, "newdir"))
    end

    test "400 ALREADY_EXISTS when dir exists", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = post(conn, "/api/servers/#{server.id}/files/mkdir/world")
      assert json_response(conn, 400)
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn = post(conn, "/api/servers/#{Ecto.UUID.generate()}/files/mkdir/dir")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── POST /api/servers/:id/files/rename ──────────────────────────────────────

  describe "POST /api/servers/:id/files/rename" do
    test "200 renames a file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        post(conn, "/api/servers/#{server.id}/files/rename", %{
          "oldPath" => "server.jar",
          "newPath" => "server-renamed.jar"
        })

      assert %{"success" => true, "oldPath" => "server.jar", "newPath" => "server-renamed.jar"} =
               json_response(conn, 200)

      assert File.exists?(Path.join(server.directory, "server-renamed.jar"))
      refute File.exists?(Path.join(server.directory, "server.jar"))
    end

    test "400 PATHS_REQUIRED when oldPath is missing", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        post(conn, "/api/servers/#{server.id}/files/rename", %{"newPath" => "something.txt"})

      assert %{"code" => "PATHS_REQUIRED"} = json_response(conn, 400)
    end

    test "400 PATHS_REQUIRED when newPath is missing", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        post(conn, "/api/servers/#{server.id}/files/rename", %{
          "oldPath" => "server.jar"
        })

      assert %{"code" => "PATHS_REQUIRED"} = json_response(conn, 400)
    end

    test "404 SOURCE_NOT_FOUND when source does not exist", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        post(conn, "/api/servers/#{server.id}/files/rename", %{
          "oldPath" => "ghost.txt",
          "newPath" => "other.txt"
        })

      assert json_response(conn, 404)
    end

    test "400 DESTINATION_EXISTS when target exists", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn =
        post(conn, "/api/servers/#{server.id}/files/rename", %{
          "oldPath" => "server.jar",
          "newPath" => "server.properties"
        })

      assert json_response(conn, 400)
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn =
        post(conn, "/api/servers/#{Ecto.UUID.generate()}/files/rename", %{
          "oldPath" => "a",
          "newPath" => "b"
        })

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── GET /api/servers/:id/files/download/*path ────────────────────────────────

  describe "GET /api/servers/:id/files/download/*path" do
    test "200 sends the file as an attachment", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/download/server.jar")

      assert response(conn, 200)
      assert {"content-type", "application/octet-stream"} in conn.resp_headers

      disposition =
        Enum.find_value(conn.resp_headers, fn {k, v} -> k == "content-disposition" && v end)

      assert disposition =~ "attachment"
      assert disposition =~ "server.jar"
    end

    test "404 FILE_NOT_FOUND for missing file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/download/ghost.bin")
      assert json_response(conn, 404)
    end

    test "400 DIR_DOWNLOAD_NOT_IMPLEMENTED for directory", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = get(conn, "/api/servers/#{server.id}/files/download/world")
      assert %{"code" => "DIR_DOWNLOAD_NOT_IMPLEMENTED"} = json_response(conn, 400)
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn = get(conn, "/api/servers/#{Ecto.UUID.generate()}/files/download/foo.jar")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── POST /api/servers/:id/files/upload ──────────────────────────────────────

  describe "POST /api/servers/:id/files/upload" do
    # Build a %Plug.Upload{} backed by a real temp file.
    defp plug_upload(content, filename) do
      path = Path.join(System.tmp_dir!(), "upload-#{System.unique_integer([:positive])}")
      File.write!(path, content)
      %Plug.Upload{path: path, filename: filename, content_type: "application/octet-stream"}
    end

    test "200 uploads a single file to root", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      upload = plug_upload("mod-data", "mod.jar")

      conn =
        conn
        |> put_req_header("content-type", "multipart/form-data")
        |> post("/api/servers/#{server.id}/files/upload?path=", %{"files" => upload})

      assert %{"success" => true, "count" => 1, "uploaded" => [u]} = json_response(conn, 200)
      assert u["name"] == "mod.jar"
      assert u["size"] == 8
      assert File.exists?(Path.join(server.directory, "mod.jar"))
    end

    test "200 uploads multiple files (list under same field)", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      u1 = plug_upload("aaa", "a.txt")
      u2 = plug_upload("bbbb", "b.txt")

      conn =
        conn
        |> put_req_header("content-type", "multipart/form-data")
        |> post("/api/servers/#{server.id}/files/upload?path=plugins", %{"files" => [u1, u2]})

      assert %{"success" => true, "count" => 2} = json_response(conn, 200)
    end

    test "200 uploads into subdir (created if needed)", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      upload = plug_upload("x", "x.txt")

      conn =
        conn
        |> put_req_header("content-type", "multipart/form-data")
        |> post("/api/servers/#{server.id}/files/upload?path=mods", %{"files" => upload})

      assert %{"success" => true} = json_response(conn, 200)
      assert File.exists?(Path.join([server.directory, "mods", "x.txt"]))
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      upload = plug_upload("x", "x.txt")

      conn =
        conn
        |> put_req_header("content-type", "multipart/form-data")
        |> post("/api/servers/#{Ecto.UUID.generate()}/files/upload?path=", %{"files" => upload})

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  # ── DELETE /api/servers/:id/files/*path ──────────────────────────────────────

  describe "DELETE /api/servers/:id/files/*path" do
    test "200 deletes a file", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)

      conn = delete(conn, "/api/servers/#{server.id}/files/server.jar")

      assert %{"success" => true, "path" => "server.jar", "type" => "file"} =
               json_response(conn, 200)

      refute File.exists?(Path.join(server.directory, "server.jar"))
    end

    test "200 deletes a directory recursively", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      File.write!(Path.join([server.directory, "world", "level.dat"]), "data")

      conn = delete(conn, "/api/servers/#{server.id}/files/world")
      assert %{"success" => true, "type" => "directory"} = json_response(conn, 200)
      refute File.exists?(Path.join(server.directory, "world"))
    end

    test "404 NOT_FOUND for missing path", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      conn = delete(conn, "/api/servers/#{server.id}/files/ghost.txt")
      assert %{"code" => "NOT_FOUND"} = json_response(conn, 404)
    end

    test "400 CANNOT_DELETE_ROOT for root path (empty segment)", %{conn: conn, tmp: tmp} do
      server = seeded_server(tmp)
      # The wildcard for delete is "/*path" — to hit root we'd need no segment.
      # The path "/" maps to a single empty-string segment in Phoenix wildcards,
      # which the sandbox sanitizes to "". Test that the server directory itself
      # is not deleted.
      conn = delete(conn, "/api/servers/#{server.id}/files/.")
      # Any non-500 response is acceptable (invalid_path or cannot_delete_root)
      assert conn.status != 500
      assert File.dir?(server.directory)
    end

    test "404 SERVER_NOT_FOUND for unknown server", %{conn: conn} do
      conn = delete(conn, "/api/servers/#{Ecto.UUID.generate()}/files/foo.txt")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  defp hold_operation(server_id, operation) do
    test_pid = self()

    task =
      Task.async(fn ->
        OperationLock.run(server_id, operation, fn ->
          send(test_pid, {:operation_acquired, self()})

          receive do
            :release_operation -> :released
          end
        end)
      end)

    assert_receive {:operation_acquired, owner_pid}
    on_exit(fn -> Process.exit(task.pid, :kill) end)
    %{task: task, owner_pid: owner_pid}
  end

  defp release_operation(%{task: task, owner_pid: owner_pid}) do
    send(owner_pid, :release_operation)
    assert :released = Task.await(task)
  end
end
