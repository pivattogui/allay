defmodule AllayWeb.ServerJSON do
  @moduledoc """
  Wire serializer for server resources, byte-compatible with the legacy TS
  backend's camelCase shape. Reused by every controller that returns a server.

  The wire row is the 20 persisted columns (camelCase) plus a `status` object.
  `status` always carries `state`; `pid`, `uptime`, and `lastError` are omitted
  when nil (legacy optional-field parity).
  """

  alias Allay.Servers.Server

  @doc "Renders `{servers: [wire]}` for the index action."
  def index(%{servers: pairs}) do
    %{servers: Enum.map(pairs, &server/1)}
  end

  @doc "Renders `{server: wire}` for show/create/update actions."
  def show(%{server: server, status: status}) do
    %{server: server(%{server: server, status: status})}
  end

  @doc "Renders one server's wire map (the 20-field row + status object)."
  def server(%{server: %Server{} = server, status: status}) do
    %{
      id: server.id,
      name: server.name,
      type: server.type,
      version: server.version,
      port: server.port,
      ramMinMb: server.ram_min_mb,
      ramMaxMb: server.ram_max_mb,
      javaVersion: server.java_version,
      directory: server.directory,
      autoStart: server.auto_start,
      autoRestart: server.auto_restart,
      restartLimit: server.restart_limit,
      iconPath: server.icon_path,
      jvmArgs: server.jvm_args,
      javaPath: server.java_path,
      restartSchedule: server.restart_schedule,
      rconPort: server.rcon_port,
      # rcon_password never crosses the API boundary — it is a secret
      # between the panel and the Java process on localhost.
      status: status(status),
      createdAt: DateTime.to_iso8601(server.inserted_at),
      updatedAt: DateTime.to_iso8601(server.updated_at)
    }
  end

  @doc """
  Serializes a runtime status map to the wire object: `state` always present,
  optional fields included only when non-nil.
  """
  def status(%{state: state} = status) do
    %{state: to_string(state)}
    |> put_optional(:pid, Map.get(status, :pid))
    |> put_optional(:uptime, Map.get(status, :uptime))
    |> put_optional(:lastError, Map.get(status, :last_error))
  end

  defp put_optional(map, _key, nil), do: map
  defp put_optional(map, key, value), do: Map.put(map, key, value)
end
