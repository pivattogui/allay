defmodule Allay.Runtime.ServerRuntimeTest do
  use ExUnit.Case, async: false

  alias Allay.Runtime.{Event, FakeRcon, ServerRuntime, Spec}

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  setup do
    {:ok, _} = FakeRcon.start_registry()
    dir = Path.join(System.tmp_dir!(), "srv-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "fake")
    on_exit(fn -> File.rm_rf!(dir) end)

    server_id = "srv-#{System.unique_integer([:positive])}"
    rcon_port = System.unique_integer([:positive])
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))

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

  defp start_runtime!(spec, env \\ [{"FAKE_BEHAVIOR", "ok"}]) do
    start_supervised!({ServerRuntime, spec: spec, env: env, name: nil})
  end

  test "reaches running when the RCON handshake succeeds", ctx do
    pid = start_runtime!(ctx.spec)
    assert_receive %Event{type: :status, data: %{state: :starting}}, 1_000

    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert %{state: :running, pid: os_pid, uptime: _} = ServerRuntime.status(pid)
    assert is_integer(os_pid)
  end

  test "startup timeout kills the process and reports crashed", ctx do
    spec = %{ctx.spec | startup_timeout_ms: 300}
    pid = start_runtime!(spec)

    assert_receive %Event{type: :status, data: %{state: :crashed, last_error: error}}, 2_000
    assert error =~ "startup"
    assert %{state: :crashed} = ServerRuntime.status(pid)
  end

  test "early crash captures stdout in last_error", ctx do
    pid = start_runtime!(ctx.spec, [{"FAKE_BEHAVIOR", "early-crash"}])

    assert_receive %Event{type: :status, data: %{state: :crashed, last_error: error}}, 2_000
    assert error =~ "Could not reserve enough space"
    assert %{state: :crashed} = ServerRuntime.status(pid)
  end

  test "graceful stop via RCON stop command", ctx do
    pid = start_runtime!(ctx.spec)
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    %{pid: os_pid} = ServerRuntime.status(pid)

    FakeRcon.set(ctx.rcon_port, %{
      ready?: true,
      on_exec: fn
        "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
        _ -> {:ok, ""}
      end
    })

    assert :ok = ServerRuntime.stop(pid)
    assert_receive %Event{type: :status, data: %{state: :stopping}}, 1_000
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 2_000
  end

  test "stop escalates to SIGKILL when the process ignores everything", ctx do
    pid = start_runtime!(ctx.spec, [{"FAKE_BEHAVIOR", "ignore-term"}])
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert :ok = ServerRuntime.stop(pid)
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 3_000
  end

  test "kill reports stopped, never crashed", ctx do
    pid = start_runtime!(ctx.spec)
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert :ok = ServerRuntime.kill(pid)
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 2_000
    refute_receive %Event{type: :status, data: %{state: :crashed}}, 300
  end

  test "send_command requires running and round-trips through RCON", ctx do
    pid = start_runtime!(ctx.spec)
    assert {:error, :not_running} = ServerRuntime.send_command(pid, "list")

    FakeRcon.set(ctx.rcon_port, %{ready?: true, on_exec: fn "list" -> {:ok, "3 players"} end})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert {:ok, "3 players"} = ServerRuntime.send_command(pid, "list")
  end

  test "auto-restart respawns after a crash and respects the limit", ctx do
    crash_file = Path.join(ctx.dir, "crash-trigger")
    # respawn_delay 300ms gives the test room to remove the crash trigger
    # before the respawned fake checks for it.
    spec = %{
      ctx.spec
      | auto_restart: %{enabled?: true, limit: 1, window_ms: 60_000},
        rcon_probe_ms: 100,
        respawn_delay_ms: 300
    }

    pid =
      start_runtime!(spec, [{"FAKE_BEHAVIOR", "ok"}, {"FAKE_CRASH_FILE", crash_file}])

    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    # Drain the boot :starting so the later assert_receive :starting matches the
    # respawn's, not this one (assert_receive selectively receives in FIFO order).
    assert_receive %Event{type: :status, data: %{state: :starting, last_error: nil}}, 1_000
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    # trigger first crash → respawn (attempt 1 of limit 1)
    File.touch!(crash_file)
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 3_000
    File.rm!(crash_file)

    assert_receive %Event{type: :status, data: %{state: :starting}}, 2_000
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    # trigger second crash → limit exceeded, stays crashed
    File.touch!(crash_file)
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 3_000
    refute_receive %Event{type: :status, data: %{state: :starting}}, 1_000
    assert %{state: :crashed} = ServerRuntime.status(pid)
  end

  test "stop cancels a pending respawn after a crash", ctx do
    crash_file = Path.join(ctx.dir, "crash-trigger")

    spec = %{
      ctx.spec
      | auto_restart: %{enabled?: true, limit: 3, window_ms: 60_000},
        rcon_probe_ms: 100,
        respawn_delay_ms: 500
    }

    pid = start_runtime!(spec, [{"FAKE_BEHAVIOR", "ok"}, {"FAKE_CRASH_FILE", crash_file}])

    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :starting, last_error: nil}}, 1_000
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    File.touch!(crash_file)
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 3_000
    File.rm!(crash_file)

    # User stops the crashed server before the scheduled respawn fires.
    assert :ok = ServerRuntime.stop(pid)
    refute_receive %Event{type: :status, data: %{state: :starting}}, 1_500
    assert %{state: :crashed} = ServerRuntime.status(pid)
  end

  test "auto_restart disabled means a crash produces no respawn", ctx do
    crash_file = Path.join(ctx.dir, "crash-trigger")

    spec = %{
      ctx.spec
      | auto_restart: %{enabled?: false, limit: 3, window_ms: 60_000},
        rcon_probe_ms: 100
    }

    start_runtime!(spec, [{"FAKE_BEHAVIOR", "ok"}, {"FAKE_CRASH_FILE", crash_file}])

    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :starting, last_error: nil}}, 1_000
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    File.touch!(crash_file)
    assert_receive %Event{type: :status, data: %{state: :crashed}}, 3_000
    refute_receive %Event{type: :status, data: %{state: :starting}}, 1_000
  end

  test "terminating the GenServer kills the OS process", ctx do
    pid = start_runtime!(ctx.spec)
    FakeRcon.set(ctx.rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    %{pid: os_pid} = ServerRuntime.status(pid)
    assert os_alive?(os_pid)

    :ok = stop_supervised(ServerRuntime)
    assert eventually_dead?(os_pid)
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

  test "preflight failures surface as typed errors", ctx do
    File.rm!(Path.join(ctx.dir, "server.jar"))

    # init returns {:stop, {:preflight, reason}}, so start_link returns the
    # typed error. Trap exits because the failing child emits a linked exit
    # signal carrying the same reason.
    Process.flag(:trap_exit, true)

    assert {:error, {:preflight, :server_jar_not_found}} =
             ServerRuntime.start_link(spec: ctx.spec, env: [], name: nil)
  end
end
