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

  # Builds a real .zip entirely in memory and returns its bytes.
  defp zip_bytes(files, name) do
    entries = Enum.map(files, fn {n, c} -> {to_charlist(n), c} end)
    {:ok, {_name, bytes}} = :zip.create(to_charlist(name), entries, [:memory])
    bytes
  end

  # Streams an archive to the analyze endpoint as a raw octet-stream body.
  defp post_archive(conn, server_id, bytes, filename) do
    conn
    |> put_req_header("content-type", "application/octet-stream")
    |> put_req_header("x-filename", filename)
    |> post(~p"/api/backups/#{server_id}/import/analyze", bytes)
  end

  describe "POST /api/backups/:server_id/import/analyze (streaming)" do
    test "400 NO_FILE when x-filename header is absent", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      resp =
        conn
        |> put_req_header("content-type", "application/octet-stream")
        |> post(~p"/api/backups/#{server.id}/import/analyze", "anything")

      assert json_response(resp, 400)["code"] == "NO_FILE"
    end

    test "400 UNSUPPORTED_FORMAT for a .rar filename", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      resp = post_archive(conn, server.id, "data", "evil.rar")
      assert json_response(resp, 400)["code"] == "UNSUPPORTED_FORMAT"
    end

    test "404 SERVER_NOT_FOUND for an unknown server", %{conn: conn} do
      resp = post_archive(conn, Ecto.UUID.generate(), zip_bytes(%{"a" => "b"}, "w.zip"), "w.zip")
      assert json_response(resp, 404)["code"] == "SERVER_NOT_FOUND"
    end

    test "streams the archive and returns the analysis", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      bytes = zip_bytes(%{"world/level.dat" => "lvl", "server.properties" => "p"}, "w.zip")

      resp = post_archive(conn, server.id, bytes, "My World.zip")
      body = json_response(resp, 200)

      assert is_binary(body["importId"])
      assert "world/" in body["categories"]["world"]
      dest = Path.join([data_dir, "temp", "import-#{body["importId"]}", "My World.zip"])
      assert File.read!(dest) == bytes
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

    test "world-only import replaces the world instead of merging into it",
         %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      # A pre-existing world with a file the imported archive does NOT contain
      # (player data — position/inventory). A world-only import must replace the
      # world, so this stale file must be gone afterwards.
      File.mkdir_p!(Path.join([server.directory, "world", "playerdata"]))
      File.write!(Path.join([server.directory, "world", "playerdata", "steve.dat"]), "old-player")
      File.write!(Path.join([server.directory, "world", "level.dat"]), "OLD")

      import_id =
        analyze(
          conn,
          server,
          %{"world/level.dat" => "NEW", "world/region/r.5.5.mca" => "newchunk"},
          "w.zip"
        )

      resp =
        post(conn, ~p"/api/backups/#{server.id}/import/#{import_id}/execute", %{
          "selection" => %{"preset" => "world-only"}
        })

      assert json_response(resp, 200)["message"] == "Import completed successfully"

      # New world content is present.
      assert File.read!(Path.join([server.directory, "world", "level.dat"])) == "NEW"

      assert File.read!(Path.join([server.directory, "world", "region", "r.5.5.mca"])) ==
               "newchunk"

      # The stale old-world file is gone — replace, not merge.
      refute File.exists?(Path.join([server.directory, "world", "playerdata", "steve.dat"]))
    end
  end

  # Drives the analyze endpoint and returns the import id for an execute test.
  defp analyze(conn, server, files, filename) do
    bytes = zip_bytes(files, filename)
    resp = post_archive(conn, server.id, bytes, filename)
    json_response(resp, 200)["importId"]
  end
end
