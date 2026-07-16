defmodule Allay.Runtime.Supervisor do
  @moduledoc """
  Top of the runtime tree: a unique Registry for per-server process
  lookup and a DynamicSupervisor that holds one InstanceSupervisor
  subtree per active server.

  InstanceSupervisors are started `:temporary`: a server whose subtree
  dies (e.g. ServerRuntime exhausting its restart limit and the
  one_for_all cascade unwinding) is NOT auto-restarted by OTP — restart
  is application policy inside ServerRuntime, and a removed/deleted
  server must stay gone.
  """

  use Supervisor

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    children = [
      {Registry, keys: :unique, name: Allay.Runtime.Registry},
      {DynamicSupervisor, name: Allay.Runtime.ServerSupervisor, strategy: :one_for_one}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
