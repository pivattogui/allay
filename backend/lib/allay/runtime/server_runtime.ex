defmodule Allay.Runtime.ServerRuntime do
  @moduledoc """
  Owns one Minecraft server OS process. State machine:
  stopped → starting → running → stopping → stopped, plus crashed.

  Readiness is an RCON handshake retried every second while starting —
  the log line "Done" is informational only. Commands open one RCON
  connection per call (connect→auth→exec→close): a few calls per
  minute at most, and it sidesteps connection-desync entirely.

  Auto-restart is deliberately policy here, not OTP supervision: an
  OTP restart would replace this GenServer but not respawn Java with
  window/limit semantics. The window anchors at the first attempt
  (legacy parity); the counter resets once the server reaches running
  again AND has outlived the window (legacy never reset it — a server
  crashing every 9 minutes eventually exhausted its limit forever).
  Resetting only after the window elapses keeps a crash storm
  (crash → respawn → crash within the window) counted against the
  limit, while still forgiving a server that genuinely recovered.

  A respawned process that crashes again during `:starting` (before
  reaching `running`) stays `:crashed` and does not consume the remaining
  restart budget — legacy parity: the legacy backend also bailed when the
  crash happened before the server ever reached running.
  """

  use GenServer

  alias Allay.Runtime.{Event, InstanceSupervisor, Spec}

  @stdout_tail_limit 50

  def start_link(opts) do
    case Keyword.get(opts, :name) do
      nil -> GenServer.start_link(__MODULE__, opts)
      name -> GenServer.start_link(__MODULE__, opts, name: name)
    end
  end

  def status(server), do: GenServer.call(server, :status)

  def stop(server), do: GenServer.call(server, :stop)

  def kill(server), do: GenServer.call(server, :kill)

  # The handler opens a fresh RCON connection (5s connect + exec) inside the
  # call, so the default 5s GenServer timeout could fire before RCON does.
  def send_command(server, command),
    do: GenServer.call(server, {:send_command, command}, 15_000)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)
    spec = Keyword.fetch!(opts, :spec)
    env = Keyword.get(opts, :env, [])

    state = %{
      spec: spec,
      env: env,
      port: nil,
      os_pid: nil,
      machine_state: :stopped,
      intent: :none,
      started_at: nil,
      stdout_tail: [],
      restart_count: 0,
      restart_window_started_at: nil,
      last_error: nil,
      timers: %{}
    }

    case preflight(spec) do
      :ok -> {:ok, spawn_server(state)}
      {:error, reason} -> {:stop, {:preflight, reason}}
    end
  end

  @impl true
  def handle_call(:status, _from, state) do
    {:reply, status_map(state), state}
  end

  def handle_call(:stop, _from, %{machine_state: ms} = state) when ms in [:stopped, :crashed] do
    # A crashed instance may have a :respawn scheduled; an explicit stop must
    # cancel it so the server does not come back after the user ordered it down.
    {:reply, :ok, cancel_restart(state)}
  end

  def handle_call(:stop, _from, state) do
    state =
      state
      |> cancel_restart()
      |> Map.put(:intent, :stopping)
      |> transition(:stopping)

    rcon_stop(state)

    state =
      state
      |> schedule_timer(:stop_escalate_term, state.spec.stop_timeout_ms)
      |> schedule_timer(
        :stop_escalate_kill,
        state.spec.stop_timeout_ms + state.spec.term_timeout_ms
      )

    {:reply, :ok, state}
  end

  def handle_call(:kill, _from, state) do
    state =
      state
      |> cancel_restart()
      |> Map.put(:intent, :killing)

    signal(state.os_pid, "-KILL")
    {:reply, :ok, state}
  end

  def handle_call({:send_command, command}, _from, %{machine_state: :running} = state) do
    {:reply, one_shot_rcon(state, command), state}
  end

  def handle_call({:send_command, _command}, _from, state) do
    {:reply, {:error, :not_running}, state}
  end

  @impl true
  def handle_info(:rcon_probe, %{machine_state: :starting} = state) do
    spec = state.spec

    case spec.rcon_mod.connect(spec.rcon_host, spec.rcon_port, spec.rcon_password, timeout: 1_000) do
      {:ok, conn} ->
        spec.rcon_mod.close(conn)
        {:noreply, mark_running(state)}

      {:error, _} ->
        {:noreply, schedule_timer(state, :rcon_probe, spec.rcon_probe_ms)}
    end
  end

  def handle_info(:rcon_probe, state), do: {:noreply, state}

  def handle_info(:startup_timeout, %{machine_state: :starting} = state) do
    signal(state.os_pid, "-KILL")

    state =
      state
      |> Map.put(:intent, :startup_timeout)
      |> Map.put(:last_error, "Server did not pass startup handshake within timeout (startup)")

    {:noreply, state}
  end

  def handle_info(:startup_timeout, state), do: {:noreply, state}

  def handle_info(:stop_escalate_term, state) do
    signal(state.os_pid, "-TERM")
    {:noreply, cancel_timer(state, :stop_escalate_term)}
  end

  def handle_info(:stop_escalate_kill, state) do
    signal(state.os_pid, "-KILL")
    {:noreply, cancel_timer(state, :stop_escalate_kill)}
  end

  def handle_info(:respawn, state) do
    case preflight(state.spec) do
      :ok ->
        {:noreply, spawn_server(state)}

      {:error, reason} ->
        state = %{state | last_error: "Respawn preflight failed: #{inspect(reason)}"}
        {:noreply, transition(state, :crashed)}
    end
  end

  def handle_info({port, {:data, {:eol, line}}}, %{port: port} = state) do
    tail = Enum.take([line | state.stdout_tail], @stdout_tail_limit)
    {:noreply, %{state | stdout_tail: tail}}
  end

  def handle_info({port, {:data, _}}, %{port: port} = state) do
    {:noreply, state}
  end

  def handle_info({port, {:exit_status, code}}, %{port: port} = state) do
    {:noreply, handle_exit(state, code)}
  end

  # With trap_exit on, the linked Port delivers an {:EXIT, port, reason} when it
  # closes. exit_status is the authoritative signal, so this is benign noise.
  def handle_info({:EXIT, port, _reason}, %{port: port} = state) do
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{os_pid: os_pid} = state) when is_integer(os_pid) do
    # Closing the Port does not kill its child, so the GenServer must reap the
    # OS process itself. SIGTERM lets the JVM run its shutdown hook (Minecraft
    # saves and stops); escalate to SIGKILL if it outlives term_timeout_ms.
    signal(os_pid, "-TERM")

    unless wait_for_exit(os_pid, state.spec.term_timeout_ms) do
      signal(os_pid, "-KILL")
    end

    broadcast_final_status(state)
    :ok
  end

  def terminate(_reason, state) do
    broadcast_final_status(state)
    :ok
  end

  # When the whole subtree dies (e.g. :one_for_all restart, supervisor
  # shutdown) the runtime vanishes without ever transitioning. Emit a final
  # status so observers see a definite terminal state — :crashed if the
  # machine already crashed, :stopped otherwise — instead of a silent gap.
  defp broadcast_final_status(%{machine_state: :crashed} = state) do
    Event.broadcast(state.spec.server_id, :status, %{
      status_map(state)
      | state: :crashed,
        pid: nil
    })
  end

  defp broadcast_final_status(state) do
    Event.broadcast(state.spec.server_id, :status, %{
      status_map(state)
      | state: :stopped,
        pid: nil,
        uptime: nil
    })
  end

  defp wait_for_exit(os_pid, remaining_ms) when remaining_ms > 0 do
    if os_alive?(os_pid) do
      Process.sleep(50)
      wait_for_exit(os_pid, remaining_ms - 50)
    else
      true
    end
  end

  defp wait_for_exit(os_pid, _remaining_ms), do: not os_alive?(os_pid)

  defp os_alive?(os_pid) do
    {_, status} = System.cmd("kill", ["-0", to_string(os_pid)], stderr_to_stdout: true)
    status == 0
  end

  defp handle_exit(state, code) do
    was_running = state.machine_state == :running
    stop_sampler(state)

    state =
      state
      |> clear_lifecycle_timers()
      |> Map.merge(%{port: nil, os_pid: nil, started_at: nil})

    cond do
      state.intent == :startup_timeout ->
        state
        |> Map.put(:intent, :none)
        |> transition(:crashed)

      state.intent in [:stopping, :killing] or code == 0 ->
        state
        |> Map.put(:intent, :none)
        |> transition(:stopped)

      true ->
        state
        |> Map.put(:intent, :none)
        |> Map.put(:last_error, crash_error(code, state.stdout_tail))
        |> transition(:crashed)
        |> maybe_respawn(was_running, code)
    end
  end

  defp crash_error(code, stdout_tail) do
    base = "Process exited with status #{code}"

    case Enum.reverse(stdout_tail) do
      [] -> base
      lines -> base <> "\n" <> Enum.join(lines, "\n")
    end
  end

  defp maybe_respawn(state, was_running, code) do
    policy = state.spec.auto_restart

    if policy.enabled? and was_running and code != 0 do
      now = System.monotonic_time(:millisecond)

      window_start =
        if is_nil(state.restart_window_started_at) or
             now - state.restart_window_started_at > policy.window_ms do
          now
        else
          state.restart_window_started_at
        end

      count = if window_start == now, do: 1, else: state.restart_count + 1

      state = %{state | restart_count: count, restart_window_started_at: window_start}

      if count > policy.limit do
        state
      else
        schedule_timer(state, :respawn, state.spec.respawn_delay_ms)
      end
    else
      state
    end
  end

  defp mark_running(state) do
    state =
      state
      |> cancel_timer(:rcon_probe)
      |> cancel_timer(:startup_timeout)
      |> Map.put(:started_at, System.monotonic_time(:second))
      |> Map.put(:last_error, nil)
      |> reset_restart_window_if_elapsed()
      |> transition(:running)

    start_sampler(state)
    state
  end

  # The sampler is a dynamic, temporary child of this server's
  # InstanceSupervisor — it needs the OS pid, which only exists post-spawn.
  # When ServerRuntime runs standalone (unit tests), there is no registered
  # instance supervisor and the sampler is simply skipped.
  #
  # start/stop run in an unlinked Task: Supervisor.start_child/terminate_child
  # are synchronous calls against this process's OWN parent. If the parent is
  # mid :one_for_all shutdown, calling it from a handle_* would block forever,
  # the GenServer would never reach terminate/2, and the JVM would be orphaned
  # after the 40s brutal kill. The sampler is a read-only side channel, so a
  # failed start/stop is logged and ignored — the runtime must never block on
  # its parent.
  defp start_sampler(%{os_pid: os_pid} = state) when is_integer(os_pid) do
    spec = state.spec

    sample_async(spec.server_id, fn sup_pid ->
      InstanceSupervisor.start_sampler(sup_pid, spec, os_pid)
    end)
  end

  defp start_sampler(_state), do: :ok

  defp stop_sampler(state) do
    sample_async(state.spec.server_id, &InstanceSupervisor.stop_sampler/1)
  end

  defp sample_async(server_id, fun) do
    Task.start(fn ->
      case instance_supervisor(server_id) do
        nil ->
          :ok

        sup_pid ->
          try do
            fun.(sup_pid)
          catch
            kind, reason ->
              require Logger
              Logger.warning("sampler management failed: #{inspect({kind, reason})}")
          end
      end
    end)

    :ok
  end

  defp instance_supervisor(server_id) do
    case Registry.lookup(Allay.Runtime.Registry, {:instance, server_id}) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  # The restart counter resets once the server has recovered and stayed up
  # past the window — legacy never reset it, so a server crashing just inside
  # its window forever exhausted the limit. Resetting only after the window
  # elapses keeps crash storms (rapid crash → respawn → crash) counted against
  # the limit while still forgiving a genuinely recovered server.
  defp reset_restart_window_if_elapsed(%{restart_window_started_at: nil} = state), do: state

  defp reset_restart_window_if_elapsed(state) do
    now = System.monotonic_time(:millisecond)

    if now - state.restart_window_started_at > state.spec.auto_restart.window_ms do
      %{state | restart_count: 0, restart_window_started_at: nil}
    else
      state
    end
  end

  defp spawn_server(state) do
    spec = state.spec

    port =
      Port.open(
        {:spawn_executable, spec.java_bin},
        [
          :binary,
          :exit_status,
          {:line, 4096},
          {:args, Spec.java_args(spec)},
          {:cd, spec.directory},
          {:env, env_charlists(state.env)}
        ]
      )

    os_pid =
      case Port.info(port, :os_pid) do
        {:os_pid, pid} -> pid
        nil -> nil
      end

    state
    |> Map.merge(%{port: port, os_pid: os_pid, intent: :none, stdout_tail: []})
    |> schedule_timer(:rcon_probe, spec.rcon_probe_ms)
    |> schedule_timer(:startup_timeout, spec.startup_timeout_ms)
    |> transition(:starting)
  end

  defp env_charlists(env) do
    Enum.map(env, fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end)
  end

  defp preflight(spec) do
    cond do
      not File.dir?(spec.directory) ->
        {:error, :server_dir_not_found}

      not File.exists?(Path.join(spec.directory, "server.jar")) ->
        {:error, :server_jar_not_found}

      true ->
        clear_session_locks(spec.directory)
        :ok
    end
  end

  defp clear_session_locks(directory) do
    for world <- ["world", "world_nether", "world_the_end"] do
      File.rm(Path.join([directory, world, "session.lock"]))
    end

    :ok
  end

  defp rcon_stop(state) do
    spec = state.spec

    case spec.rcon_mod.connect(spec.rcon_host, spec.rcon_port, spec.rcon_password, timeout: 1_000) do
      {:ok, conn} ->
        spec.rcon_mod.exec(conn, "stop")
        spec.rcon_mod.close(conn)
        :ok

      {:error, _} ->
        :ok
    end
  end

  defp one_shot_rcon(state, command) do
    spec = state.spec

    case spec.rcon_mod.connect(spec.rcon_host, spec.rcon_port, spec.rcon_password, timeout: 5_000) do
      {:ok, conn} ->
        result = spec.rcon_mod.exec(conn, command)
        spec.rcon_mod.close(conn)
        result

      {:error, _} = error ->
        error
    end
  end

  defp signal(os_pid, sig) when is_integer(os_pid) do
    System.cmd("kill", [sig, to_string(os_pid)])
    :ok
  end

  defp signal(_os_pid, _sig), do: :ok

  defp transition(state, machine_state) do
    state = %{state | machine_state: machine_state}
    Event.broadcast(state.spec.server_id, :status, status_map(state))
    state
  end

  defp status_map(state) do
    %{
      state: state.machine_state,
      pid: state.os_pid,
      uptime: uptime(state),
      last_error: state.last_error
    }
  end

  defp uptime(%{machine_state: :running, started_at: started_at}) when is_integer(started_at) do
    System.monotonic_time(:second) - started_at
  end

  defp uptime(_state), do: nil

  defp schedule_timer(state, key, delay_ms) do
    state = cancel_timer(state, key)
    ref = Process.send_after(self(), key, delay_ms)
    %{state | timers: Map.put(state.timers, key, ref)}
  end

  defp cancel_timer(state, key) do
    case Map.get(state.timers, key) do
      nil ->
        state

      ref ->
        Process.cancel_timer(ref)
        %{state | timers: Map.delete(state.timers, key)}
    end
  end

  defp clear_lifecycle_timers(state) do
    state
    |> cancel_timer(:rcon_probe)
    |> cancel_timer(:startup_timeout)
    |> cancel_timer(:stop_escalate_term)
    |> cancel_timer(:stop_escalate_kill)
  end

  # An explicit stop/kill ends the current restart episode: cancel the pending
  # respawn and forget the crash-storm counters so a later genuine restart
  # starts with a fresh budget.
  defp cancel_restart(state) do
    state
    |> cancel_timer(:respawn)
    |> Map.merge(%{restart_count: 0, restart_window_started_at: nil})
  end
end
