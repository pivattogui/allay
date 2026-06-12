defmodule Allay.Runtime do
  @moduledoc """
  Facade over the runtime supervision tree — the only module the rest of
  the app calls to drive servers. Every public function takes a string
  `server_id` (except `start_server`, which takes a resolved `Spec`) and
  resolves the per-server processes through `Allay.Runtime.Registry`.

  Lifecycle invariant (legacy parity): a stopped or crashed instance
  STAYS in the tree so its `status`, `logs`, and `last_error` remain
  queryable. It is torn down only when `start_server` for the same id
  replaces it or `remove_instance/1` deletes it. The legacy manager
  never deleted its map entries; this preserves that behavior.
  """

  alias Allay.Runtime.{Event, InstanceSupervisor, LogWatcher, ServerRuntime, Spec}

  @registry Allay.Runtime.Registry
  @server_supervisor Allay.Runtime.ServerSupervisor

  @stopped_status %{state: :stopped, pid: nil, uptime: nil, last_error: nil}

  @live_states [:starting, :running, :stopping]

  # --- Registry via-tuples -------------------------------------------------

  def instance_via(id), do: {:via, Registry, {@registry, {:instance, id}}}
  def runtime_via(id), do: {:via, Registry, {@registry, {:runtime, id}}}
  def log_watcher_via(id), do: {:via, Registry, {@registry, {:log_watcher, id}}}
  def metrics_via(id), do: {:via, Registry, {@registry, {:metrics, id}}}

  # --- Facade --------------------------------------------------------------

  @spec start_server(Spec.t(), list()) ::
          {:ok, pid()}
          | {:error, :already_running | :server_jar_not_found | :server_dir_not_found}
  def start_server(%Spec{} = spec, env \\ []) do
    case runtime_state(spec.server_id) do
      state when state in @live_states ->
        {:error, :already_running}

      _stopped_or_crashed_or_absent ->
        remove_instance(spec.server_id)
        start_instance(spec, env)
    end
  end

  @spec stop_server(String.t()) :: :ok | {:error, :not_found}
  def stop_server(id) do
    with_runtime(id, &ServerRuntime.stop/1)
  end

  @spec kill_server(String.t()) :: :ok | {:error, :not_found}
  def kill_server(id) do
    with_runtime(id, &ServerRuntime.kill/1)
  end

  @spec send_command(String.t(), String.t()) ::
          {:ok, String.t()} | {:error, :not_running | :not_found}
  def send_command(id, command) do
    case runtime_pid(id) do
      nil -> {:error, :not_found}
      pid -> ServerRuntime.send_command(pid, command)
    end
  end

  @spec status(String.t()) :: map()
  def status(id) do
    case runtime_pid(id) do
      nil -> @stopped_status
      pid -> ServerRuntime.status(pid)
    end
  end

  @spec logs(String.t(), pos_integer()) :: [map()]
  def logs(id, count \\ 100) do
    case log_watcher_pid(id) do
      nil -> []
      pid -> LogWatcher.logs(pid, count)
    end
  end

  @spec running_server_ids() :: [String.t()]
  def running_server_ids do
    @registry
    |> Registry.select([{{{:runtime, :"$1"}, :_, :_}, [], [:"$1"]}])
    |> Enum.filter(&(runtime_state(&1) == :running))
  end

  @spec remove_instance(String.t()) :: :ok
  def remove_instance(id) do
    case instance_pid(id) do
      nil ->
        :ok

      pid ->
        _ = DynamicSupervisor.terminate_child(@server_supervisor, pid)
        :ok
    end
  end

  @spec subscribe(String.t()) :: :ok | {:error, term()}
  def subscribe(id) do
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(id))
  end

  # --- Internals -----------------------------------------------------------

  defp start_instance(spec, env) do
    case DynamicSupervisor.start_child(
           @server_supervisor,
           {InstanceSupervisor, spec: spec, env: env}
         ) do
      {:ok, _sup_pid} ->
        {:ok, runtime_pid(spec.server_id)}

      {:error, reason} ->
        {:error, translate_start_error(reason)}
    end
  end

  defp translate_start_error({:shutdown, {:failed_to_start_child, _id, {:preflight, reason}}}),
    do: reason

  defp translate_start_error({:preflight, reason}), do: reason
  defp translate_start_error(other), do: other

  defp with_runtime(id, fun) do
    case runtime_pid(id) do
      nil -> {:error, :not_found}
      pid -> fun.(pid)
    end
  end

  defp runtime_state(id) do
    case runtime_pid(id) do
      nil -> nil
      pid -> ServerRuntime.status(pid).state
    end
  end

  defp runtime_pid(id), do: whereis({:runtime, id})
  defp instance_pid(id), do: whereis({:instance, id})
  defp log_watcher_pid(id), do: whereis({:log_watcher, id})

  defp whereis(key) do
    case Registry.lookup(@registry, key) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end
end
