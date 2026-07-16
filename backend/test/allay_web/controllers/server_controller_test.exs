defmodule AllayWeb.ServerControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures
  import Ecto.Query

  alias Allay.Accounts
  alias Allay.Servers.JavaRegistry

  @manifest %{
    "versions" => [
      %{"id" => "1.21.11", "type" => "release", "url" => "https://piston-meta.example/v.json"}
    ]
  }

  @meta %{
    "javaVersion" => %{"majorVersion" => 21},
    "downloads" => %{
      "server" => %{"url" => "https://piston-data.example/server.jar", "sha1" => nil}
    }
  }

  @wire_keys ~w(
    id name type version port ramMinMb ramMaxMb javaVersion directory
    autoStart autoRestart restartLimit iconPath jvmArgs javaPath
    restartSchedule rconPort status createdAt updatedAt
  )

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}"), user: user}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      conn = delete_req_header(conn, "authorization")
      assert %{"code" => "UNAUTHORIZED"} = json_response(get(conn, ~p"/api/servers"), 401)
    end
  end

  describe "GET /api/servers" do
    test "returns servers ordered newest first", %{conn: conn} do
      s1 = server_fixture()
      s2 = server_fixture(%{port: 25_566, rcon_port: 35_566})

      past = DateTime.utc_now() |> DateTime.add(-60, :second) |> DateTime.truncate(:second)

      Allay.Repo.update_all(from(s in Allay.Servers.Server, where: s.id == ^s1.id),
        set: [inserted_at: past]
      )

      assert %{"servers" => [first, second]} = json_response(get(conn, ~p"/api/servers"), 200)
      assert first["id"] == s2.id
      assert second["id"] == s1.id
    end
  end

  describe "GET /api/servers/:id" do
    test "200 with the exact wire shape", %{conn: conn} do
      server = server_fixture()
      assert %{"server" => wire} = json_response(get(conn, ~p"/api/servers/#{server.id}"), 200)
      assert MapSet.new(Map.keys(wire)) == MapSet.new(@wire_keys)
      assert wire["id"] == server.id
      assert wire["status"] == %{"state" => "stopped"}
    end

    test "404 SERVER_NOT_FOUND for unknown id", %{conn: conn} do
      assert %{"code" => "SERVER_NOT_FOUND"} =
               json_response(get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}"), 404)
    end
  end

  describe "POST /api/servers" do
    test "201 with {server: wire} on the happy path", %{conn: conn} do
      data_dir = Path.join(System.tmp_dir!(), "create-ok-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf!(data_dir) end)
      Application.put_env(:allay, :data_dir, data_dir)
      on_exit(fn -> Application.put_env(:allay, :data_dir, "data") end)

      JavaRegistry.put(%{21 => "/fake/java21/bin/java"})
      on_exit(fn -> JavaRegistry.put(%{}) end)

      Req.Test.stub(Allay.Minecraft.APIStub, fn c ->
        case c.host do
          "launchermeta.mojang.com" -> Req.Test.json(c, @manifest)
          "piston-meta.example" -> Req.Test.json(c, @meta)
          "piston-data.example" -> Plug.Conn.send_resp(c, 200, "PK fake jar")
        end
      end)

      conn =
        post(conn, ~p"/api/servers", %{
          "name" => "Fresh",
          "type" => "vanilla",
          "version" => "1.21.11",
          "port" => 25_565
        })

      assert %{"server" => wire} = json_response(conn, 201)
      assert MapSet.new(Map.keys(wire)) == MapSet.new(@wire_keys)
      assert wire["name"] == "Fresh"
      assert wire["port"] == 25_565
      assert wire["status"] == %{"state" => "stopped"}
    end

    test "400 VALIDATION_ERROR with details on invalid body", %{conn: conn} do
      conn = post(conn, ~p"/api/servers", %{"name" => "", "type" => "vanilla"})
      assert %{"code" => "VALIDATION_ERROR", "details" => _} = json_response(conn, 400)
    end

    test "409 PORT_IN_USE when port already taken", %{conn: conn} do
      # Drive the full provisioning pipeline: stub Mojang/jar, install Java 21,
      # point data_dir at a tmp, and collide on an existing in-range port so the
      # DB unique constraint surfaces as :port_in_use → 409.
      data_dir = Path.join(System.tmp_dir!(), "create-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf!(data_dir) end)
      Application.put_env(:allay, :data_dir, data_dir)
      on_exit(fn -> Application.put_env(:allay, :data_dir, "data") end)

      JavaRegistry.put(%{21 => "/fake/java21/bin/java"})
      on_exit(fn -> JavaRegistry.put(%{}) end)

      Req.Test.stub(Allay.Minecraft.APIStub, fn c ->
        case c.host do
          "launchermeta.mojang.com" -> Req.Test.json(c, @manifest)
          "piston-meta.example" -> Req.Test.json(c, @meta)
          "piston-data.example" -> Plug.Conn.send_resp(c, 200, "PK fake jar")
        end
      end)

      _existing = server_fixture(%{port: 25_565, rcon_port: 35_565})

      conn =
        post(conn, ~p"/api/servers", %{
          "name" => "Dup",
          "type" => "vanilla",
          "version" => "1.21.11",
          "port" => 25_565
        })

      assert %{"code" => "PORT_IN_USE"} = json_response(conn, 409)
    end
  end

  describe "PATCH /api/servers/:id" do
    test "200 updates editable fields and returns wire shape", %{conn: conn} do
      server = server_fixture()

      conn = patch(conn, ~p"/api/servers/#{server.id}", %{"name" => "Renamed"})
      assert %{"server" => wire} = json_response(conn, 200)
      assert wire["name"] == "Renamed"
      assert MapSet.new(Map.keys(wire)) == MapSet.new(@wire_keys)
    end

    test "404 for unknown id", %{conn: conn} do
      conn = patch(conn, ~p"/api/servers/#{Ecto.UUID.generate()}", %{"name" => "x"})
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "409 PORT_IN_USE when changing to a taken port", %{conn: conn} do
      taken = server_fixture(%{port: 25_565, rcon_port: 35_565})
      server = server_fixture(%{port: 25_566, rcon_port: 35_566})

      conn = patch(conn, ~p"/api/servers/#{server.id}", %{"port" => taken.port})
      assert %{"code" => "PORT_IN_USE"} = json_response(conn, 409)
    end

    test "port change syncs server.properties", %{conn: conn} do
      dir = Path.join(System.tmp_dir!(), "patch-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      File.write!(Path.join(dir, "server.properties"), "server-port=25565\n")
      on_exit(fn -> File.rm_rf!(dir) end)

      server = server_fixture(%{port: 25_565, rcon_port: 35_565, directory: dir})

      conn = patch(conn, ~p"/api/servers/#{server.id}", %{"port" => 25_566})
      assert json_response(conn, 200)

      assert File.read!(Path.join(dir, "server.properties")) =~ "server-port=25566"
    end
  end

  describe "DELETE /api/servers/:id" do
    test "200 with success message", %{conn: conn} do
      server = server_fixture()
      conn = delete(conn, ~p"/api/servers/#{server.id}")
      assert json_response(conn, 200) == %{"message" => "Server deleted successfully"}
    end

    test "404 for unknown id", %{conn: conn} do
      conn = delete(conn, ~p"/api/servers/#{Ecto.UUID.generate()}")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end
end
