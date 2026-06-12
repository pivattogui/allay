defmodule Allay.ServersTest do
  use Allay.DataCase, async: false

  import Allay.ServersFixtures
  import Allay.AccountsFixtures

  alias Allay.Accounts
  alias Allay.Runtime
  alias Allay.Runtime.{Event, FakeRcon}
  alias Allay.Servers

  @fake_java Path.expand("../support/fake_java.sh", __DIR__)

  defp scope do
    user = user_fixture()
    Accounts.Scope.for_user(user)
  end

  # Provisions a server row whose java_path points at the fake_java harness
  # (override path = no registry needed) and whose directory holds a server.jar.
  defp runnable_server(rcon_port) do
    dir = Path.join(System.tmp_dir!(), "srv-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "fake")
    on_exit(fn -> File.rm_rf!(dir) end)

    srv =
      server_fixture(%{
        directory: dir,
        java_path: @fake_java,
        java_version: "21",
        rcon_port: rcon_port,
        rcon_password: "pw"
      })

    on_exit(fn -> Runtime.remove_instance(srv.id) end)
    %{server: srv, dir: dir}
  end

  defp spec_overrides do
    [
      rcon_mod: FakeRcon,
      startup_timeout_ms: 2_000,
      stop_timeout_ms: 300,
      term_timeout_ms: 300,
      respawn_delay_ms: 50
    ]
  end

  describe "list_servers/1" do
    test "returns empty list when no servers" do
      assert [] = Servers.list_servers(scope())
    end

    test "returns all servers and orders newest first" do
      s1 = server_fixture()
      s2 = server_fixture(%{port: 25_566, rcon_port: 35_566})

      # Force distinct inserted_at values (utc_datetime truncates to seconds)
      past = DateTime.utc_now() |> DateTime.add(-60, :second) |> DateTime.truncate(:second)

      Repo.update_all(Allay.Servers.Server |> where([s], s.id == ^s1.id),
        set: [inserted_at: past]
      )

      result = Servers.list_servers(scope())
      ids = Enum.map(result, & &1.id)

      assert [s2.id, s1.id] == ids
    end

    test "scope is required as first arg (compile-level: just call it)" do
      sc = scope()
      assert is_list(Servers.list_servers(sc))
    end
  end

  describe "get_server/2" do
    test "returns {:ok, server} for existing id" do
      s = server_fixture()
      assert {:ok, fetched} = Servers.get_server(scope(), s.id)
      assert fetched.id == s.id
    end

    test "returns {:error, :not_found} for unknown uuid" do
      assert {:error, :not_found} = Servers.get_server(scope(), Ecto.UUID.generate())
    end

    test "returns {:error, :not_found} for invalid uuid string" do
      assert {:error, :not_found} = Servers.get_server(scope(), "not-a-uuid")
    end

    test "returns {:error, :not_found} for empty string" do
      assert {:error, :not_found} = Servers.get_server(scope(), "")
    end
  end

  describe "lifecycle (fake java + FakeRcon)" do
    setup do
      {:ok, _} = FakeRcon.start_registry()
      rcon_port = System.unique_integer([:positive])
      %{rcon_port: rcon_port}
    end

    defp start_running!(sc, srv, rcon_port) do
      Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(srv.id))

      {:ok, %{state: state}} =
        Servers.start_server(sc, srv.id,
          env: [{"FAKE_BEHAVIOR", "ok"}],
          spec_overrides: spec_overrides()
        )

      assert state in [:starting, :running]
      FakeRcon.set(rcon_port, %{ready?: true})
      assert_receive %Event{type: :status, data: %{state: :running}}, 3_000
    end

    test "full happy path: start → running → command → logs → stop → delete", %{
      rcon_port: rcon_port
    } do
      sc = scope()
      %{server: srv, dir: dir} = runnable_server(rcon_port)

      start_running!(sc, srv, rcon_port)

      assert {:ok, %{state: :running}} = Servers.server_status(sc, srv.id)

      FakeRcon.set(rcon_port, %{ready?: true, on_exec: fn "list" -> {:ok, "3 players"} end})
      assert {:ok, "3 players"} = Servers.send_command(sc, srv.id, "list")

      assert {:ok, lines} = Servers.server_logs(sc, srv.id)
      assert is_list(lines)
      assert Enum.all?(lines, &is_binary/1)
      assert Enum.any?(lines, &(&1 =~ "Done"))
      assert Enum.any?(lines, &Regex.match?(~r/^\[\d{4}-\d{2}-\d{2}T/, &1))

      %{pid: os_pid} = Runtime.status(srv.id)

      FakeRcon.set(rcon_port, %{
        ready?: true,
        on_exec: fn
          "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
          _ -> {:ok, ""}
        end
      })

      assert {:ok, %{state: :stopping}} = Servers.stop_server_process(sc, srv.id)
      assert_receive %Event{type: :status, data: %{state: :stopped}}, 2_000

      assert :ok = Servers.delete_server(sc, srv.id)
      refute File.dir?(dir)
      assert {:error, :not_found} = Servers.get_server(sc, srv.id)
      assert %{state: :stopped, pid: nil} = Runtime.status(srv.id)
    end

    test "delete stops an active instance before removing it", %{rcon_port: rcon_port} do
      sc = scope()
      %{server: srv, dir: dir} = runnable_server(rcon_port)
      start_running!(sc, srv, rcon_port)
      %{pid: os_pid} = Runtime.status(srv.id)

      FakeRcon.set(rcon_port, %{
        ready?: true,
        on_exec: fn
          "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
          _ -> {:ok, ""}
        end
      })

      assert :ok = Servers.delete_server(sc, srv.id)
      refute File.dir?(dir)
      assert %{state: :stopped, pid: nil} = Runtime.status(srv.id)
    end
  end

  describe "lifecycle guards" do
    test "start_server on unknown id returns not_found" do
      assert {:error, :not_found} = Servers.start_server(scope(), Ecto.UUID.generate())
    end

    test "stop_server_process on a never-started (stopped) server returns not_running" do
      sc = scope()
      srv = server_fixture()
      assert {:error, :not_running} = Servers.stop_server_process(sc, srv.id)
    end

    test "kill_server on a never-started server returns ok with stopped status" do
      sc = scope()
      srv = server_fixture()
      assert {:ok, %{state: :stopped}} = Servers.kill_server(sc, srv.id)
    end

    test "send_command with a blank command returns invalid_command" do
      sc = scope()
      srv = server_fixture()
      assert {:error, :invalid_command} = Servers.send_command(sc, srv.id, "   ")
    end

    test "send_command with a nil command returns invalid_command" do
      sc = scope()
      srv = server_fixture()
      assert {:error, :invalid_command} = Servers.send_command(sc, srv.id, nil)
    end

    test "send_command on a never-started server returns not_running" do
      sc = scope()
      srv = server_fixture()
      assert {:error, :not_running} = Servers.send_command(sc, srv.id, "list")
    end

    test "server_status on a never-started server returns stopped" do
      sc = scope()
      srv = server_fixture()
      assert {:ok, %{state: :stopped}} = Servers.server_status(sc, srv.id)
    end

    test "server_logs on a never-started server returns an empty list" do
      sc = scope()
      srv = server_fixture()
      assert {:ok, []} = Servers.server_logs(sc, srv.id)
    end

    test "delete_server on a never-started server removes the row" do
      sc = scope()
      srv = server_fixture()
      assert :ok = Servers.delete_server(sc, srv.id)
      assert {:error, :not_found} = Servers.get_server(sc, srv.id)
    end
  end

  describe "update_server/3" do
    test "updates editable fields and returns the row" do
      sc = scope()
      srv = server_fixture(%{name: "Old"})

      assert {:ok, updated} = Servers.update_server(sc, srv.id, %{"name" => "New"})
      assert updated.name == "New"
    end

    test "returns not_found for unknown id" do
      assert {:error, :not_found} = Servers.update_server(scope(), Ecto.UUID.generate(), %{})
    end

    test "maps a duplicate port to port_in_use" do
      sc = scope()
      taken = server_fixture(%{port: 25_565, rcon_port: 35_565})
      srv = server_fixture(%{port: 25_566, rcon_port: 35_566})

      assert {:error, :port_in_use} = Servers.update_server(sc, srv.id, %{"port" => taken.port})
    end

    test "returns a changeset on invalid input" do
      sc = scope()
      srv = server_fixture()
      long_name = String.duplicate("a", 51)

      assert {:error, %Ecto.Changeset{}} =
               Servers.update_server(sc, srv.id, %{"name" => long_name})
    end

    test "syncs server.properties when the port changes" do
      sc = scope()
      dir = Path.join(System.tmp_dir!(), "upd-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      File.write!(Path.join(dir, "server.properties"), "server-port=25565\nmotd=hi\n")
      on_exit(fn -> File.rm_rf!(dir) end)

      srv = server_fixture(%{port: 25_565, rcon_port: 35_565, directory: dir})

      assert {:ok, _} = Servers.update_server(sc, srv.id, %{"port" => 25_566})
      content = File.read!(Path.join(dir, "server.properties"))
      assert content =~ "server-port=25566"
      assert content =~ "motd=hi"
    end
  end

  describe "update_server_config/3" do
    test "returns {:ok, server, needs_restart} with needs_restart false when stopped" do
      sc = scope()
      srv = server_fixture()

      assert {:ok, updated, false} =
               Servers.update_server_config(sc, srv.id, %{"jvm_args" => "-XX:+UseZGC"})

      assert updated.jvm_args == "-XX:+UseZGC"
    end

    test "returns not_found for unknown id" do
      assert {:error, :not_found} =
               Servers.update_server_config(scope(), Ecto.UUID.generate(), %{})
    end

    test "returns a changeset on invalid restart_limit" do
      sc = scope()
      srv = server_fixture()

      assert {:error, %Ecto.Changeset{}} =
               Servers.update_server_config(sc, srv.id, %{"restart_limit" => 99})
    end
  end
end
