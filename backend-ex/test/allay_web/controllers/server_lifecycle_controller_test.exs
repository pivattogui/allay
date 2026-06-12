defmodule AllayWeb.ServerLifecycleControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Runtime
  alias Allay.Runtime.{Event, FakeRcon}

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      server = server_fixture()
      conn = delete_req_header(conn, "authorization")
      assert json_response(post(conn, ~p"/api/servers/#{server.id}/start"), 401)
    end
  end

  describe "guards (no OS process)" do
    test "POST /start 500 typed preflight when server.jar is missing", %{conn: conn} do
      dir = Path.join(System.tmp_dir!(), "nojar-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf!(dir) end)

      server =
        server_fixture(%{directory: dir, java_path: @fake_java, java_version: "21"})

      on_exit(fn -> Runtime.remove_instance(server.id) end)

      conn = post(conn, ~p"/api/servers/#{server.id}/start")
      assert %{"code" => "SERVER_JAR_NOT_FOUND"} = json_response(conn, 500)
    end

    test "POST /start 404 for unknown id", %{conn: conn} do
      conn = post(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/start")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "POST /stop 409 SERVER_NOT_RUNNING on never-started server", %{conn: conn} do
      server = server_fixture()
      conn = post(conn, ~p"/api/servers/#{server.id}/stop")
      assert %{"code" => "SERVER_NOT_RUNNING"} = json_response(conn, 409)
    end

    test "POST /kill 200 even on never-started server", %{conn: conn} do
      server = server_fixture()
      conn = post(conn, ~p"/api/servers/#{server.id}/kill")

      assert %{"message" => "Server killed", "status" => %{"state" => "stopped"}} =
               json_response(conn, 200)
    end

    test "POST /command 400 INVALID_COMMAND on blank", %{conn: conn} do
      server = server_fixture()
      conn = post(conn, ~p"/api/servers/#{server.id}/command", %{"command" => "  "})
      assert %{"code" => "INVALID_COMMAND"} = json_response(conn, 400)
    end

    test "POST /command 409 SERVER_NOT_RUNNING on never-started server", %{conn: conn} do
      server = server_fixture()
      conn = post(conn, ~p"/api/servers/#{server.id}/command", %{"command" => "list"})
      assert %{"code" => "SERVER_NOT_RUNNING"} = json_response(conn, 409)
    end

    test "GET /status 200 stopped on never-started server", %{conn: conn} do
      server = server_fixture()
      conn = get(conn, ~p"/api/servers/#{server.id}/status")
      assert %{"status" => %{"state" => "stopped"}} = json_response(conn, 200)
    end

    test "GET /status 404 for unknown id", %{conn: conn} do
      conn = get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/status")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "GET /logs 200 empty list on never-started server", %{conn: conn} do
      server = server_fixture()
      conn = get(conn, ~p"/api/servers/#{server.id}/logs")
      assert %{"logs" => []} = json_response(conn, 200)
    end
  end

  describe "happy-path lifecycle (fake java + FakeRcon)" do
    setup do
      {:ok, _} = FakeRcon.start_registry()
      # Test seam (mirrors :boot_autostart): the lifecycle controller forwards
      # these opts to Servers.start_server so the happy-path can drive the fake
      # java harness and FakeRcon without a real Minecraft jar.
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
      :ok
    end

    test "start → running → command → logs → stop", %{conn: conn} do
      rcon_port = System.unique_integer([:positive])
      dir = Path.join(System.tmp_dir!(), "live-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      File.write!(Path.join(dir, "server.jar"), "fake")
      on_exit(fn -> File.rm_rf!(dir) end)

      server =
        server_fixture(%{
          directory: dir,
          java_path: @fake_java,
          java_version: "21",
          rcon_port: rcon_port,
          rcon_password: "pw"
        })

      on_exit(fn -> Runtime.remove_instance(server.id) end)
      Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server.id))

      start_conn = post(conn, ~p"/api/servers/#{server.id}/start")

      assert %{"message" => "Server starting", "status" => %{"state" => state}} =
               json_response(start_conn, 200)

      assert state in ["starting", "running"]

      FakeRcon.set(rcon_port, %{ready?: true})
      assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

      assert %{"status" => %{"state" => "running"}} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/status"), 200)

      FakeRcon.set(rcon_port, %{ready?: true, on_exec: fn "list" -> {:ok, "3 players"} end})

      cmd_conn = post(conn, ~p"/api/servers/#{server.id}/command", %{"command" => "list"})
      assert %{"message" => "Command sent", "command" => "list"} = json_response(cmd_conn, 200)

      assert %{"logs" => logs} = json_response(get(conn, ~p"/api/servers/#{server.id}/logs"), 200)
      assert Enum.any?(logs, &(&1 =~ "Done"))

      %{pid: os_pid} = Runtime.status(server.id)

      FakeRcon.set(rcon_port, %{
        ready?: true,
        on_exec: fn
          "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
          _ -> {:ok, ""}
        end
      })

      stop_conn = post(conn, ~p"/api/servers/#{server.id}/stop")

      assert %{"message" => "Server stopped", "status" => %{"state" => "stopping"}} =
               json_response(stop_conn, 200)
    end
  end
end
