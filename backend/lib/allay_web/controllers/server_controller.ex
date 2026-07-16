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

  def migrate(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    type = Map.get(params, "type")
    version = Map.get(params, "version")

    with :ok <- validate_migrate_input(type, version),
         {:ok, _server} <- fetch_server(scope, id),
         {:ok, result} <- migrate(scope, id, type, version) do
      json(conn, %{
        message: "Migration successful",
        backupId: to_string(result.backup_id),
        migration: %{
          fromType: result.migration.from_type,
          fromVersion: result.migration.from_version,
          toType: result.migration.to_type,
          toVersion: result.migration.to_version
        }
      })
    end
  end

  # The context's generic :invalid_server_type is shared with the system
  # /versions endpoint (VALIDATION_ERROR); migration needs its own code.
  defp migrate(scope, id, type, version) do
    case Servers.migrate_server(scope, id, type, version) do
      {:error, :invalid_server_type} -> {:error, :invalid_migration_type}
      other -> other
    end
  end

  # Legacy parity: type+version presence is a manual 400 INVALID_INPUT, distinct
  # from the INVALID_SERVER_TYPE the context raises for a present-but-bad type.
  defp validate_migrate_input(type, version)
       when is_binary(type) and type != "" and is_binary(version) and version != "",
       do: :ok

  defp validate_migrate_input(_type, _version), do: {:error, :invalid_input}

  # Translates the context's generic :not_found into the SERVER_NOT_FOUND code.
  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
