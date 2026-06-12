defmodule AllayWeb.ServerConfigController do
  use AllayWeb, :controller

  alias Allay.Servers
  alias AllayWeb.ServerParams

  action_fallback AllayWeb.FallbackController

  def show(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- fetch_server(scope, id) do
      json(conn, %{config: config_projection(server)})
    end
  end

  def update(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    attrs = ServerParams.to_attrs(params)

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, updated, needs_restart} <- Servers.update_server_config(scope, id, attrs) do
      json(conn, %{config: config_projection(updated), needsRestart: needs_restart})
    end
  end

  defp config_projection(server) do
    %{
      id: server.id,
      name: server.name,
      type: server.type,
      version: server.version,
      port: server.port,
      ramMinMb: server.ram_min_mb,
      ramMaxMb: server.ram_max_mb,
      jvmArgs: server.jvm_args,
      javaPath: server.java_path,
      autoStart: server.auto_start,
      autoRestart: server.auto_restart,
      restartLimit: server.restart_limit,
      restartSchedule: server.restart_schedule,
      iconPath: server.icon_path
    }
  end

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
