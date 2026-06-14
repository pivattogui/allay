defmodule AllayWeb.ImportControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Backups.Backup
  alias Allay.Repo

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)

    data_dir = Path.join(System.tmp_dir!(), "import-ctl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(data_dir)
    prev = Application.get_env(:allay, :data_dir)
    Application.put_env(:allay, :data_dir, data_dir)

    on_exit(fn ->
      if prev, do: Application.put_env(:allay, :data_dir, prev)
      File.rm_rf!(data_dir)
    end)

    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}"), data_dir: data_dir}
  end

  # Seeds a server on disk under the configured data_dir with a marker file that
  # proves rollback restored the original content.
  defp seeded_server(data_dir) do
    dir = Path.join([data_dir, "servers", "srv-#{System.unique_integer([:positive])}"])
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "JAR")
    File.write!(Path.join(dir, "MARKER.txt"), "original-marker")
    server_fixture(%{directory: dir, rcon_port: 35_999, rcon_password: "secretpw"})
  end

  # Builds a real .zip on disk and wraps it as a Plug.Upload for multipart.
  defp zip_upload(files, filename) do
    path = Path.join(System.tmp_dir!(), "upl_#{System.unique_integer([:positive])}.zip")
    on_exit(fn -> File.rm(path) end)
    entries = Enum.map(files, fn {name, content} -> {to_charlist(name), content} end)
    {:ok, _} = :zip.create(to_charlist(path), entries)
    %Plug.Upload{path: path, filename: filename, content_type: "application/zip"}
  end

  describe "POST /api/backups/:server_id/import/analyze" do
    test "400 NO_FILE when no file field", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      resp = post(conn, ~p"/api/backups/#{server.id}/import/analyze", %{})
      assert json_response(resp, 400)["code"] == "NO_FILE"
    end

    test "400 UNSUPPORTED_FORMAT for a .rar upload", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      upload = zip_upload(%{"world/level.dat" => "x"}, "evil.rar")
      resp = post(conn, ~p"/api/backups/#{server.id}/import/analyze", %{"file" => upload})
      assert json_response(resp, 400)["code"] == "UNSUPPORTED_FORMAT"
    end

    test "200 returns analysis with camelCase categories", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      upload =
        zip_upload(
          %{
            "world/level.dat" => "lvl",
            "world/region/r.0.0.mca" => "reg",
            "server.properties" => "enable-rcon=false\n",
            "plugins/AuthMe.jar" => "p"
          },
          "backup.zip"
        )

      resp = post(conn, ~p"/api/backups/#{server.id}/import/analyze", %{"file" => upload})
      body = json_response(resp, 200)

      assert body["detectedType"] == "full-backup"
      assert body["suggestedPreset"] == "world-configs"
      assert "world/" in body["categories"]["world"]
      assert "server.properties" in body["categories"]["configs"]
      assert "plugins/AuthMe.jar" in body["categories"]["plugins"]
      assert is_integer(body["totalSize"])
      assert is_binary(body["importId"])
    end
  end

  describe "POST /api/backups/:server_id/import/:import_id/execute" do
    test "404 IMPORT_NOT_FOUND for an unknown import id", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      resp =
        post(conn, ~p"/api/backups/#{server.id}/import/#{Ecto.UUID.generate()}/execute", %{
          "selection" => %{"preset" => "world-only"}
        })

      assert json_response(resp, 404)["code"] == "IMPORT_NOT_FOUND"
    end

    test "400 EMPTY_SELECTION when nothing matches", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      import_id = analyze(conn, server, %{"world/level.dat" => "lvl"}, "w.zip")

      resp =
        post(conn, ~p"/api/backups/#{server.id}/import/#{import_id}/execute", %{
          "selection" => %{"preset" => nil, "include" => [], "exclude" => []}
        })

      assert json_response(resp, 400)["code"] == "EMPTY_SELECTION"
    end

    test "end-to-end: world-configs lands files, takes pre-import backup, re-injects RCON",
         %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      import_id =
        analyze(
          conn,
          server,
          %{
            "world/level.dat" => "imported-level",
            "world/region/r.0.0.mca" => "imported-region",
            "server.properties" => "enable-rcon=false\nmotd=Imported\n",
            "paper.jar" => "should-not-land"
          },
          "full.zip"
        )

      resp =
        post(conn, ~p"/api/backups/#{server.id}/import/#{import_id}/execute", %{
          "selection" => %{"preset" => "world-configs"}
        })

      body = json_response(resp, 200)
      assert body["message"] == "Import completed successfully"
      assert is_binary(body["backupId"])
      assert "server.properties" in body["importedPaths"]

      # Files landed in the server dir.
      assert File.read!(Path.join(server.directory, "world/level.dat")) == "imported-level"

      assert File.read!(Path.join([server.directory, "world", "region", "r.0.0.mca"])) ==
               "imported-region"

      # Jars were never part of the world-configs preset.
      refute File.exists?(Path.join(server.directory, "paper.jar"))

      # A pre-import backup row exists.
      assert Repo.get_by(Backup, server_id: server.id, type: "pre-import")

      # RCON keys re-injected from the DB row over the imported (rcon-disabled) file.
      props = File.read!(Path.join(server.directory, "server.properties"))
      assert props =~ "enable-rcon=true"
      assert props =~ "rcon.port=35999"
      assert props =~ "rcon.password=secretpw"
      assert props =~ "motd=Imported"
    end

    test "rollback: a corrupted archive after analyze yields 500 and restores the server dir",
         %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      import_id =
        analyze(conn, server, %{"world/level.dat" => "lvl", "server.properties" => "p"}, "c.zip")

      # Corrupt the staged archive's first local file header so the central
      # directory (and thus analysis) stays valid but extraction fails after the
      # pre-import backup is taken — exercising the rollback path.
      session_dir = Path.join([data_dir, "temp", "import-#{import_id}"])
      [file] = File.ls!(session_dir)
      archive = Path.join(session_dir, file)
      data = File.read!(archive)
      {idx, 4} = :binary.match(data, "PK\x03\x04")
      <<pre::binary-size(idx), _sig::binary-size(4), rest::binary>> = data
      File.write!(archive, pre <> "XXXX" <> rest)

      resp =
        post(conn, ~p"/api/backups/#{server.id}/import/#{import_id}/execute", %{
          "selection" => %{"preset" => "world-configs"}
        })

      assert json_response(resp, 500)["code"] == "IMPORT_FAILED"

      # The original marker file survived the rollback intact.
      assert File.read!(Path.join(server.directory, "MARKER.txt")) == "original-marker"
    end
  end

  # Drives the analyze endpoint and returns the import id for an execute test.
  defp analyze(conn, server, files, filename) do
    upload = zip_upload(files, filename)
    resp = post(conn, ~p"/api/backups/#{server.id}/import/analyze", %{"file" => upload})
    json_response(resp, 200)["importId"]
  end
end
