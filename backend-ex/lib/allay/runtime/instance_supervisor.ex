defmodule Allay.Runtime.InstanceSupervisor do
  @moduledoc """
  One subtree per server: ServerRuntime (owns the Port) + LogWatcher
  (tails latest.log). MetricsSampler is added dynamically by
  ServerRuntime once the server reaches `:running` (the sampler needs
  the OS pid, which only exists after spawn) and removed when it leaves
  `:running`.

  Strategy is `:one_for_all`: ServerRuntime and LogWatcher are
  co-dependent — a dead ServerRuntime makes its LogWatcher pointless and
  vice versa, so the whole instance restarts together. The sampler is
  started with `restart: :temporary`, so a sampler crash does NOT cycle
  the subtree; it simply disappears (deliberate — the sampler is a
  read-only side channel and its absence must not take a running server
  down). It is recreated on the next `:running` transition.

  The supervisor registers itself under `{:instance, id}` so
  ServerRuntime can reach it to add/remove the sampler without a
  start-time pid hand-off.
  """

  use Supervisor

  alias Allay.Runtime
  alias Allay.Runtime.{LogWatcher, MetricsSampler, ServerRuntime, Spec}

  def start_link(opts) do
    spec = Keyword.fetch!(opts, :spec)
    Supervisor.start_link(__MODULE__, opts, name: Runtime.instance_via(spec.server_id))
  end

  @impl true
  def init(opts) do
    spec = Keyword.fetch!(opts, :spec)
    env = Keyword.get(opts, :env, [])

    children = [
      Supervisor.child_spec(
        {ServerRuntime, spec: spec, env: env, name: Runtime.runtime_via(spec.server_id)},
        id: ServerRuntime,
        shutdown: 40_000
      ),
      {LogWatcher,
       server_id: spec.server_id,
       directory: spec.directory,
       poll_ms: spec.log_poll_ms,
       name: Runtime.log_watcher_via(spec.server_id)}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  @doc """
  Starts the MetricsSampler as a temporary child of the given instance
  supervisor. Idempotent: an already-present sampler is left in place.
  """
  def start_sampler(sup_pid, %Spec{} = spec, os_pid) do
    child =
      Supervisor.child_spec(
        {MetricsSampler,
         server_id: spec.server_id,
         os_pid: os_pid,
         ram_max_mb: spec.ram_max_mb,
         interval_ms: spec.metrics_interval_ms,
         name: Runtime.metrics_via(spec.server_id)},
        id: MetricsSampler,
        restart: :temporary
      )

    case Supervisor.start_child(sup_pid, child) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      {:error, :already_present} -> :ok
    end
  end

  @doc "Stops and forgets the sampler so the next `:running` can re-add it."
  def stop_sampler(sup_pid) do
    _ = Supervisor.terminate_child(sup_pid, MetricsSampler)
    _ = Supervisor.delete_child(sup_pid, MetricsSampler)
    :ok
  end
end
