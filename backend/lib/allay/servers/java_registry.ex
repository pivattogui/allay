defmodule Allay.Servers.JavaRegistry do
  @moduledoc """
  Holds the installed Java runtimes map (`%{major => bin_path}`) discovered
  at boot. Provisioning and the runtime bridge consult it to resolve a
  compatible JVM for a server's required major. Boot-time discovery runs in
  `Allay.Servers.Boot` (Task 3); started empty so the supervision tree does
  not block on filesystem scanning.
  """

  use Agent

  alias Allay.Minecraft.JavaRuntime

  def start_link(opts) do
    runtimes = Keyword.get(opts, :runtimes, %{})
    Agent.start_link(fn -> runtimes end, name: __MODULE__)
  end

  @doc "Runs JavaRuntime.discover/0 and stores the result. Returns the map."
  def discover do
    runtimes = JavaRuntime.discover()
    put(runtimes)
    runtimes
  end

  def runtimes, do: Agent.get(__MODULE__, & &1)

  @doc "Replaces the stored runtimes map. Primarily a test seam."
  def put(runtimes) when is_map(runtimes) do
    Agent.update(__MODULE__, fn _ -> runtimes end)
  end

  @doc """
  Resolves a runtime for the required major against the stored map.
  `{major, path}` on hit (exact or forward-fall), `nil` on miss.
  """
  def find_compatible(required) when is_integer(required) do
    JavaRuntime.find_compatible(runtimes(), required)
  end
end
