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

  @doc """
  Discovers runtimes under the configured scan dirs and stores them. Returns
  the map. Scan dirs come from `:java_scan_dirs` (the Linux JDK locations the
  release image populates; override with JAVA_SCAN_DIRS for native dev, e.g. an
  asdf/Homebrew install root).
  """
  def discover do
    scan_dirs = Application.get_env(:allay, :java_scan_dirs, [])

    runtimes =
      if Application.get_env(:allay, :java_auto_discovery, true) do
        JavaRuntime.discover_system(scan_dirs)
      else
        JavaRuntime.discover(scan_dirs)
      end

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

  @doc """
  Resolves an executable runtime for a start operation. A stale or missing
  registry entry triggers discovery once before the operation is rejected.
  """
  def find_available_compatible(required) when is_integer(required) do
    case available_compatible(runtimes(), required) do
      nil -> discover() |> available_compatible(required)
      runtime -> runtime
    end
  end

  defp available_compatible(runtimes, required) do
    case JavaRuntime.find_compatible(runtimes, required) do
      {major, path} ->
        if JavaRuntime.probe_major(path) == major, do: {major, path}

      nil ->
        nil
    end
  end
end
