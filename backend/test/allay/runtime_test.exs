defmodule Allay.RuntimeTest do
  use ExUnit.Case, async: false

  alias Allay.Runtime
  alias Allay.Runtime.{Event, FakeRcon, Spec}

  @fake_java Path.expand("../support/fake_java.sh", __DIR__)

  setup do
    {:ok, _} = FakeRcon.start_registry()
    dir = Path.join(System.tmp_dir!(), "rt-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "fake")
    on_exit(fn -> File.rm_rf!(dir) end)

    server_id = "srv-#{System.unique_integer([:positive])}"
    rcon_port = System.unique_integer([:positive])
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))
    on_exit(fn -> Runtime.remove_instance(server_id) end)

    spec = %Spec{
      server_id: server_id,
      directory: dir,
      java_bin: @fake_java,
      ram_min_mb: 512,
      ram_max_mb: 1024,
      rcon_port: rcon_port,
      rcon_password: "pw",
      rcon_mod: FakeRcon,
      startup_timeout_ms: 2_000,
      stop_timeout_ms: 300,
      term_timeout_ms: 300,
      respawn_delay_ms: 50
    }

    %{spec: spec, server_id: server_id, rcon_port: rcon_port, dir: dir}
  end

  defp start_running!(ctx, env \\ [{"FAKE_BEHAVIOR", "ok"}]) do
    {:ok, pid} = Runtime.start_server(ctx.spec, env)
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000
    pid
  end

  defp os_alive?(os_pid) do
    {_, status} = System.cmd("kill", ["-0", Integer.to_string(os_pid)], stderr_to_stdout: true)
    status == 0
  end

  defp eventually_dead?(os_pid, attempts \\ 50) do
    cond do
      not os_alive?(os_pid) -> true
      attempts == 0 -> false
      true -> Process.sleep(20) && eventually_dead?(os_pid, attempts - 1)
    end
  end

  defp eventually(fun, attempts \\ 50) do
    cond do
      fun.() -> true
      attempts == 0 -> false
      true -> Process.sleep(20) && eventually(fun, attempts - 1)
    end
  end

  test "full lifecycle: start, status running, stop, instance stays queryable", ctx do
    start_running!(ctx)

    assert %{state: :running, pid: os_pid, uptime: _, last_error: nil} =
             Runtime.status(ctx.server_id)

    assert is_integer(os_pid)
    assert ctx.server_id in Runtime.running_server_ids()

    %{pid: os_pid} = Runtime.status(ctx.server_id)

    FakeRcon.set(ctx.rcon_port, %{
      ready?: true,
      on_exec: fn
        "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
        _ -> {:ok, ""}
      end
    })

    assert :ok = Runtime.stop_server(ctx.server_id)
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 2_000

    assert %{state: :stopped} = Runtime.status(ctx.server_id)
    refute ctx.server_id in Runtime.running_server_ids()
  end

  test "logs flow through LogWatcher and the facade returns them", ctx do
    start_running!(ctx)

    assert eventually(fn ->
             Enum.any?(Runtime.logs(ctx.server_id), &(&1.message =~ "Done"))
           end)
  end

  test "logs default returns at most 100 lines", ctx do
    start_running!(ctx)
    log_path = Path.join([ctx.dir, "logs", "latest.log"])

    lines = for i <- 1..150, do: "[12:00:00 INFO]: line-#{i}"
    File.write!(log_path, Enum.join(lines, "\n") <> "\n", [:append])

    assert eventually(fn -> length(Runtime.logs(ctx.server_id)) == 100 end)
  end

  test "duplicate start while running returns already_running", ctx do
    start_running!(ctx)
    assert {:error, :already_running} = Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "ok"}])
  end

  test "concurrent starts never leak a raw already_started tuple", ctx do
    parent = self()

    for _ <- 1..2 do
      spawn(fn ->
        send(parent, {:start_result, Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "ok"}])})
      end)
    end

    results =
      for _ <- 1..2 do
        assert_receive {:start_result, result}, 3_000
        result
      end

    for result <- results do
      assert match?({:ok, pid} when is_pid(pid), result) or result == {:error, :already_running},
             "unexpected start result: #{inspect(result)}"
    end
  end

  test "start replaces a crashed instance", ctx do
    {:ok, _pid} = Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "early-crash"}])
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 2_000
    assert %{state: :crashed} = Runtime.status(ctx.server_id)

    {:ok, pid} = Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "ok"}])
    assert is_pid(pid)
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000
  end

  test "kill_server reports stopped and reaps the OS process", ctx do
    start_running!(ctx)
    %{pid: os_pid} = Runtime.status(ctx.server_id)

    assert :ok = Runtime.kill_server(ctx.server_id)
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 2_000
    refute_receive %Event{type: :status, data: %{state: :crashed}}, 300
    assert eventually_dead?(os_pid)
  end

  test "send_command requires running and round-trips through RCON", ctx do
    {:ok, _pid} = Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "ok"}])
    assert {:error, :not_running} = Runtime.send_command(ctx.server_id, "list")

    FakeRcon.set(ctx.rcon_port, %{ready?: true, on_exec: fn "list" -> {:ok, "3 players"} end})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert {:ok, "3 players"} = Runtime.send_command(ctx.server_id, "list")
  end

  test "preflight failure surfaces as a typed error and leaves no instance", ctx do
    File.rm!(Path.join(ctx.dir, "server.jar"))

    assert {:error, :server_jar_not_found} =
             Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "ok"}])

    assert %{state: :stopped, pid: nil} = Runtime.status(ctx.server_id)
  end

  test "remove_instance tears down the subtree and reaps the OS process", ctx do
    start_running!(ctx)
    %{pid: os_pid} = Runtime.status(ctx.server_id)

    assert :ok = Runtime.remove_instance(ctx.server_id)
    assert eventually_dead?(os_pid)
    assert %{state: :stopped, pid: nil} = Runtime.status(ctx.server_id)
  end

  test "remove_instance is a no-op for an unknown id", _ctx do
    assert :ok = Runtime.remove_instance("does-not-exist")
  end

  describe "unknown id contracts" do
    test "status returns the stopped shape" do
      assert %{state: :stopped, pid: nil, uptime: nil, last_error: nil} =
               Runtime.status("ghost")
    end

    test "logs returns an empty list" do
      assert [] = Runtime.logs("ghost")
    end

    test "stop_server returns not_found" do
      assert {:error, :not_found} = Runtime.stop_server("ghost")
    end

    test "kill_server returns not_found" do
      assert {:error, :not_found} = Runtime.kill_server("ghost")
    end

    test "send_command returns not_found" do
      assert {:error, :not_found} = Runtime.send_command("ghost", "list")
    end
  end

  test "stop_server on a crashed instance is a clean no-op", ctx do
    {:ok, _pid} = Runtime.start_server(ctx.spec, [{"FAKE_BEHAVIOR", "early-crash"}])
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 2_000

    assert :ok = Runtime.stop_server(ctx.server_id)
    assert %{state: :crashed} = Runtime.status(ctx.server_id)
  end

  describe "player_count/1" do
    test "returns 0 for an unknown server id" do
      assert Runtime.player_count("does-not-exist") == 0
    end

    test "returns 0 when running with no joins yet", ctx do
      start_running!(ctx)

      assert Runtime.player_count(ctx.server_id) == 0
    end
  end
end
