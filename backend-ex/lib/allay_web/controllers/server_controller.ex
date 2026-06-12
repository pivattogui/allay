defmodule AllayWeb.ServerController do
  use AllayWeb, :controller

  alias Allay.Runtime
  alias Allay.Servers
  alias AllayWeb.ServerParams

  action_fallback AllayWeb.FallbackController

  plug :put_view, json: AllayWeb.ServerJSON

  def index(conn, _params) do
    scope = conn.assigns.current_scope
    servers = Servers.list_servers(scope)
    pairs = Enum.map(servers, &%{server: &1, status: Runtime.status(&1.id)})
    render(conn, :index, servers: pairs)
  end

  def show(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- fetch_server(scope, id) do
      render(conn, :show, server: server, status: Runtime.status(server.id))
    end
  end

  def create(conn, params) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- Servers.create_server(scope, ServerParams.to_attrs(params)) do
      conn
      |> put_status(:created)
      |> render(:show, server: server, status: Runtime.status(server.id))
    end
  end

  def update(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, updated} <- Servers.update_server(scope, id, ServerParams.to_attrs(params)) do
      render(conn, :show, server: updated, status: Runtime.status(updated.id))
    end
  end

  def delete(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         :ok <- Servers.delete_server(scope, id) do
      json(conn, %{message: "Server deleted successfully"})
    end
  end

  # Translates the context's generic :not_found into the SERVER_NOT_FOUND code.
  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
