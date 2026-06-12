defmodule Allay.Servers.RuntimeBridge do
  @moduledoc """
  Builds a `%Allay.Runtime.Spec{}` from a persisted `%Server{}` row, resolving
  the Java binary upfront so the runtime never touches the DB or the registry.

  Resolver policy (parity debt carried from Plans 2/3 — pinned by tests):

    1. `server.java_path` present → used verbatim as the java binary. The
       registry is NOT consulted; an explicit override wins unconditionally.
    2. else `server.java_version` parses to an integer major →
       `JavaRegistry.find_compatible/1` (exact or forward-fall). A miss is a
       typed `{:error, {:java_runtime_unavailable, msg}}` — it NEVER falls
       back to a PATH java. The legacy asdf/PATH fallback is intentionally dead.
    3. else (java_version nil or unparseable) →
       `{:error, {:java_runtime_unavailable, msg}}`. Every Elixir-provisioned
       row has a java_version, so this is a guard, not a routine path.
  """

  alias Allay.Runtime.Spec
  alias Allay.Servers.JavaRegistry
  alias Allay.Servers.Server

  @restart_window_ms 600_000

  @spec build_spec(Server.t(), keyword()) ::
          {:ok, Spec.t()} | {:error, {:java_runtime_unavailable, String.t()}}
  def build_spec(%Server{} = server, opts \\ []) do
    with {:ok, java_bin} <- resolve_java_bin(server) do
      {:ok, build(server, java_bin, opts)}
    end
  end

  defp resolve_java_bin(%Server{java_path: path}) when is_binary(path) and path != "" do
    {:ok, path}
  end

  defp resolve_java_bin(%Server{java_version: version} = server) do
    case parse_major(version) do
      {:ok, major} -> resolve_from_registry(major)
      :error -> {:error, {:java_runtime_unavailable, unparseable_message(server)}}
    end
  end

  defp resolve_from_registry(major) do
    case JavaRegistry.find_compatible(major) do
      {_major, path} -> {:ok, path}
      nil -> {:error, {:java_runtime_unavailable, unavailable_message(major)}}
    end
  end

  defp build(server, java_bin, opts) do
    overrides = Keyword.get(opts, :spec_overrides, [])

    %Spec{
      server_id: server.id,
      directory: server.directory,
      java_bin: java_bin,
      ram_min_mb: server.ram_min_mb,
      ram_max_mb: server.ram_max_mb,
      jvm_args: server.jvm_args || "",
      rcon_host: "127.0.0.1",
      rcon_port: server.rcon_port,
      rcon_password: server.rcon_password,
      auto_restart: %{
        enabled?: server.auto_restart,
        limit: server.restart_limit,
        window_ms: @restart_window_ms
      }
    }
    |> struct(overrides)
  end

  defp parse_major(version) when is_binary(version) do
    case Integer.parse(version) do
      {major, ""} -> {:ok, major}
      _ -> :error
    end
  end

  defp parse_major(_), do: :error

  defp unavailable_message(major) do
    "Server requires Java #{major}, but only [#{installed_list()}] are installed"
  end

  defp unparseable_message(%Server{java_version: version}) do
    "Server has no resolvable Java major (java_version: #{inspect(version)})"
  end

  defp installed_list do
    case JavaRegistry.runtimes() |> Map.keys() |> Enum.sort() do
      [] -> "none"
      majors -> Enum.join(majors, ", ")
    end
  end
end
