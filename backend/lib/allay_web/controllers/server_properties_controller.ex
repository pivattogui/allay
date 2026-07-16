defmodule AllayWeb.ServerPropertiesController do
  @moduledoc """
  server.properties editing endpoints consumed by the frontend Settings tab.
  The key-value pair (`/properties`) and raw-text (`/properties/raw`) variants
  mirror the legacy TS routes; PUT responses additionally carry `portConflict`
  (the legacy backend skipped a port collision silently).
  """

  use AllayWeb, :controller

  alias Allay.Servers

  action_fallback AllayWeb.FallbackController

  def show(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, properties} <- Servers.get_properties(scope, id) do
      json(conn, %{properties: properties})
    end
  end

  def update(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    properties = Map.get(params, "properties", %{})

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, result} <- Servers.put_properties(scope, id, properties) do
      json(conn, %{needsRestart: result.needs_restart, portConflict: result.port_conflict})
    end
  end

  def show_raw(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, content} <- Servers.get_properties_raw(scope, id) do
      json(conn, %{content: content})
    end
  end

  def update_raw(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    content = Map.get(params, "content", "")

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, result} <- Servers.put_properties_raw(scope, id, content) do
      json(conn, %{needsRestart: result.needs_restart, portConflict: result.port_conflict})
    end
  end

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
