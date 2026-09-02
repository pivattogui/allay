defmodule AllayWeb.DownloadController do
  use AllayWeb, :controller

  alias Allay.Accounts.Scope
  alias Allay.Backups
  alias Allay.Servers
  alias AllayWeb.DownloadTicket

  action_fallback AllayWeb.FallbackController

  def show(conn, %{"token" => token}) do
    with {:ok, resource} <- DownloadTicket.verify(conn, token) do
      send_resource(conn, resource)
    end
  end

  defp send_resource(conn, {:server_file, server_id, relative_path}) do
    case Servers.download_path(Scope.system(), server_id, relative_path) do
      {:ok, path, filename} ->
        send_file_download(conn, path, filename, "application/octet-stream")

      _ ->
        {:error, :download_not_found}
    end
  end

  defp send_resource(conn, {:backup, server_id, backup_id}) do
    case Backups.backup_file_path(Scope.system(), server_id, backup_id) do
      {:ok, path, filename} -> send_file_download(conn, path, filename, "application/gzip")
      _ -> {:error, :download_not_found}
    end
  end

  defp send_resource(_conn, _resource), do: {:error, :download_not_found}

  # `path` is resolved by the authorized server or backup context before it reaches this boundary.
  # sobelow_skip ["Traversal.SendDownload"]
  defp send_file_download(conn, path, filename, content_type) do
    conn
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_header("referrer-policy", "no-referrer")
    |> send_download({:file, path}, filename: filename, content_type: content_type)
  end
end
