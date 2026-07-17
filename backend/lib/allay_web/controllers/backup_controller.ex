defmodule AllayWeb.BackupController do
  use AllayWeb, :controller

  alias Allay.Backups
  alias Allay.Servers
  alias AllayWeb.BackupJSON
  alias AllayWeb.DownloadTicket

  action_fallback AllayWeb.FallbackController

  @config_field_map %{
    "enabled" => :enabled,
    "intervalMinutes" => :interval_minutes,
    "maxBackups" => :max_backups,
    "includeLogs" => :include_logs
  }

  def index(conn, %{"serverId" => server_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id) do
      backups = Backups.list_backups(scope, server_id)
      config = Backups.get_config(scope, server_id)

      json(conn, %{
        backups: Enum.map(backups, &BackupJSON.backup/1),
        config: BackupJSON.config(config)
      })
    end
  end

  def create(conn, %{"serverId" => server_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         {:ok, backup} <- Backups.create_backup(scope, server_id, "manual") do
      conn
      |> put_status(:created)
      |> json(%{backup: BackupJSON.backup(backup)})
    end
  end

  def restore(conn, %{"serverId" => server_id, "backupId" => backup_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         :ok <- Backups.restore_backup(scope, server_id, backup_id) do
      json(conn, %{message: "Backup restored successfully"})
    end
  end

  def delete(conn, %{"serverId" => server_id, "backupId" => backup_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         :ok <- Backups.delete_backup(scope, server_id, backup_id) do
      json(conn, %{message: "Backup deleted successfully"})
    end
  end

  def download(conn, %{"serverId" => server_id, "backupId" => backup_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         {:ok, _path, _filename} <- Backups.backup_file_path(scope, server_id, backup_id) do
      json(conn, %{downloadPath: DownloadTicket.issue(conn, {:backup, server_id, backup_id})})
    end
  end

  def update_config(conn, %{"serverId" => server_id} = params) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         {:ok, config} <- update_config(scope, server_id, params) do
      json(conn, %{config: BackupJSON.config(config)})
    end
  end

  # The context returns :not_found for a missing config row; the controller
  # surfaces it as the CONFIG_NOT_FOUND code (distinct from SERVER_NOT_FOUND).
  defp update_config(scope, server_id, params) do
    case Backups.update_config(scope, server_id, config_attrs(params)) do
      {:error, :not_found} -> {:error, :config_not_found}
      other -> other
    end
  end

  defp config_attrs(params) do
    Enum.reduce(@config_field_map, %{}, fn {wire_key, attr_key}, acc ->
      case Map.fetch(params, wire_key) do
        {:ok, value} -> Map.put(acc, attr_key, value)
        :error -> acc
      end
    end)
  end

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
