defmodule AllayWeb.ServerMigrateControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Runtime
  alias Allay.Runtime.FakeRcon
  alias Allay.Servers.JavaRegistry

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  @jar_bytes "PK fake new jar bytes"

  @manifest %{
    "versions" => [
      %{
        "id" => "1.21.11",
        "type" => "release",
        "url" => "https://piston-meta.example/1.21.11.json"
      }
    ]
  }

  @meta %{
    "javaVersion" => %{"majorVersion" => 21},
    "downloads" => %{
      "server" => %{"url" => "https://piston-data.example/server.jar", "sha1" => nil}
    }
  }

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)

    data_dir = Path.join(System.tmp_dir!(), "migrate-ctl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(data_dir)
    prev = Application.get_env(:allay, :data_dir)
    Application.put_env(:allay, :data_dir, data_dir)

    JavaRegistry.put(%{21 => "/fake/java"})

    on_exit(fn ->
      if prev, do: Application.put_env(:allay, :data_dir, prev)
      File.rm_rf!(data_dir)
      JavaRegistry.put(%{})
    end)

    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}"), data_dir: data_dir}
  end

  defp stub_apis do
    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      case conn.host do
        "launchermeta.mojang.com" -> Req.Test.json(conn, @manifest)
        "piston-meta.example" -> Req.Test.json(conn, @meta)
        "piston-data.example" -> Plug.Conn.send_resp(conn, 200, @jar_bytes)
        _ -> Plug.Conn.send_resp(conn, 404, "not stubbed: #{conn.host}")
      end
    end)
  end

  defp seeded_server(data_dir, overrides \\ %{}) do
    dir = Path.join([data_dir, "servers", "srv-#{System.unique_integer([:positive])}"])
    File.mkdir_p!(Path.join(dir, "world"))
    File.write!(Path.join([dir, "world", "level.dat"]), "x")
    File.write!(Path.join(dir, "server.jar"), "OLD")
    attrs = Map.merge(%{type: "vanilla", version: "1.21.0", directory: dir}, overrides)
    server_fixture(attrs)
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      conn = delete_req_header(conn, "authorization")

      assert json_response(
               post(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/migrate", %{
                 "type" => "vanilla",
                 "version" => "1.21.11"
               }),
               401
             )
    end
  end

  describe "POST /api/servers/:id/migrate" do
    test "200 migrates and returns pre-update values", %{conn: conn, data_dir: data_dir} do
      stub_apis()
      server = seeded_server(data_dir)

      conn =
        post(conn, ~p"/api/servers/#{server.id}/migrate", %{
          "type" => "vanilla",
          "version" => "1.21.11"
        })

      assert %{
               "message" => "Migration successful",
               "backupId" => backup_id,
               "migration" => migration
             } = json_response(conn, 200)

      assert is_binary(backup_id)
      assert migration["fromType"] == "vanilla"
      assert migration["fromVersion"] == "1.21.0"
      assert migration["toType"] == "vanilla"
      assert migration["toVersion"] == "1.21.11"
    end

    test "400 INVALID_INPUT when type is missing", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = post(conn, ~p"/api/servers/#{server.id}/migrate", %{"version" => "1.21.11"})
      assert %{"code" => "INVALID_INPUT"} = json_response(conn, 400)
    end

    test "400 INVALID_INPUT when version is missing", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)
      conn = post(conn, ~p"/api/servers/#{server.id}/migrate", %{"type" => "vanilla"})
      assert %{"code" => "INVALID_INPUT"} = json_response(conn, 400)
    end

    test "400 INVALID_SERVER_TYPE for an unsupported type", %{conn: conn, data_dir: data_dir} do
      server = seeded_server(data_dir)

      conn =
        post(conn, ~p"/api/servers/#{server.id}/migrate", %{
          "type" => "forge",
          "version" => "1.21.11"
        })

      assert %{"code" => "INVALID_SERVER_TYPE"} = json_response(conn, 400)
    end

    test "404 for unknown server", %{conn: conn} do
      conn =
        post(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/migrate", %{
          "type" => "vanilla",
          "version" => "1.21.11"
        })

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "409 SERVER_RUNNING with the migration-specific message while running", %{
      conn: conn,
      data_dir: data_dir
    } do
      {:ok, _} = FakeRcon.start_registry()
      rcon_port = System.unique_integer([:positive])

      server =
        seeded_server(data_dir, %{
          java_path: @fake_java,
          java_version: "21",
          rcon_port: rcon_port,
          rcon_password: "pw"
        })

      on_exit(fn -> Runtime.remove_instance(server.id) end)

      start_opts = [
        env: [{"FAKE_BEHAVIOR", "ok"}],
        spec_overrides: [
          rcon_mod: FakeRcon,
          startup_timeout_ms: 2_000,
          stop_timeout_ms: 300,
          term_timeout_ms: 300,
          respawn_delay_ms: 50
        ]
      ]

      Runtime.subscribe(server.id)
      {:ok, _} = Allay.Servers.start_server(Accounts.Scope.system(), server.id, start_opts)
      FakeRcon.set(rcon_port, %{ready?: true})
      assert_receive %Allay.Runtime.Event{type: :status, data: %{state: :running}}, 3_000

      conn =
        post(conn, ~p"/api/servers/#{server.id}/migrate", %{
          "type" => "vanilla",
          "version" => "1.21.11"
        })

      assert %{
               "code" => "SERVER_RUNNING",
               "error" => "Server must be stopped before migration"
             } = json_response(conn, 409)
    end

    test "500 JAR_DOWNLOAD_FAILED when the jar can't be fetched", %{
      conn: conn,
      data_dir: data_dir
    } do
      # java gate succeeds (manifest + meta), but the jar download 404s.
      Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
        case conn.host do
          "launchermeta.mojang.com" -> Req.Test.json(conn, @manifest)
          "piston-meta.example" -> Req.Test.json(conn, @meta)
          "piston-data.example" -> Plug.Conn.send_resp(conn, 404, "gone")
          _ -> Plug.Conn.send_resp(conn, 404, "x")
        end
      end)

      server = seeded_server(data_dir)

      conn =
        post(conn, ~p"/api/servers/#{server.id}/migrate", %{
          "type" => "vanilla",
          "version" => "1.21.11"
        })

      assert %{"code" => "JAR_DOWNLOAD_FAILED"} = json_response(conn, 500)
    end
  end
end
