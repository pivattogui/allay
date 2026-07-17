defmodule AllayWeb.ServerFileController do
  use AllayWeb, :controller

  alias Allay.Servers
  alias AllayWeb.DownloadTicket
  alias AllayWeb.UploadStream

  action_fallback AllayWeb.FallbackController

  def list(conn, %{"id" => server_id} = params) do
    scope = conn.assigns.current_scope
    rel = Map.get(params, "path", "")

    with {:ok, %{path: path, entries: entries}} <-
           files(Servers.list_entries(scope, server_id, rel)) do
      json(conn, %{path: path, entries: Enum.map(entries, &render_entry/1)})
    end
  end

  def read(conn, %{"id" => server_id, "path" => path_segments} = params) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    encoding =
      case Map.get(params, "encoding") do
        "base64" -> :base64
        _ -> :utf8
      end

    with {:ok, info} <- files(Servers.read_file(scope, server_id, rel, encoding)) do
      json(conn, render_read(info))
    end
  end

  def write(conn, %{"id" => server_id, "path" => path_segments} = params) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    with :ok <- require_string_content(params),
         {:ok, %{path: path, size: size, sensitive: sensitive}} <-
           files(Servers.write_file(scope, server_id, rel, params["content"])) do
      json(conn, %{success: true, path: path, size: size, sensitive: sensitive})
    end
  end

  def mkdir(conn, %{"id" => server_id, "path" => path_segments}) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    with {:ok, %{path: path}} <- files(Servers.mkdir(scope, server_id, rel)) do
      json(conn, %{success: true, path: path})
    end
  end

  def rename(conn, %{"id" => server_id} = params) do
    scope = conn.assigns.current_scope

    with :ok <- require_paths(params),
         {:ok, %{old_path: old_path, new_path: new_path}} <-
           files(Servers.rename_path(scope, server_id, params["oldPath"], params["newPath"])) do
      json(conn, %{success: true, oldPath: old_path, newPath: new_path})
    end
  end

  def download(conn, %{"id" => server_id, "path" => path_segments}) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    with {:ok, _full, _basename} <- files(Servers.download_path(scope, server_id, rel)) do
      json(conn, %{downloadPath: DownloadTicket.issue(conn, {:server_file, server_id, rel})})
    end
  end

  def upload(conn, %{"id" => server_id, "path" => path_segments}) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    with {:ok, %{temporary: temporary}} <- files(Servers.prepare_upload(scope, server_id, rel)),
         {:ok, conn, size} <- UploadStream.write(conn, temporary),
         {:ok, %{path: path}} <-
           commit_upload(scope, server_id, rel, temporary, size) do
      json(conn, %{success: true, path: path, size: size})
    end
  end

  def delete(conn, %{"id" => server_id, "path" => path_segments}) do
    scope = conn.assigns.current_scope
    rel = Enum.join(path_segments, "/")

    with {:ok, %{path: path, type: type}} <- files(Servers.delete_path(scope, server_id, rel)) do
      json(conn, %{success: true, path: path, type: type})
    end
  end

  # ── Private helpers ──────────────────────────────────────────────────────────

  # Translates the generic {:error, :not_found} that Servers.get_server emits
  # into :server_not_found so the FallbackController can emit SERVER_NOT_FOUND
  # instead of the generic NOT_FOUND used for file-level 404s.
  defp files({:error, :not_found}), do: {:error, :server_not_found}
  defp files(other), do: other

  defp require_string_content(%{"content" => content}) when is_binary(content), do: :ok
  defp require_string_content(_params), do: {:error, :content_required}

  defp require_paths(%{"oldPath" => old, "newPath" => new})
       when is_binary(old) and is_binary(new),
       do: :ok

  defp require_paths(_params), do: {:error, :paths_required}

  defp commit_upload(scope, server_id, rel, temporary, size) do
    case files(Servers.commit_upload(scope, server_id, rel, temporary, size)) do
      {:ok, _info} = success ->
        success

      error ->
        File.rm(temporary)
        error
    end
  end

  # Omit nil extension/editable/sensitive/fileType keys for directories (legacy:
  # those fields are absent — not null — on directory entries).
  defp render_entry(%{type: "directory"} = entry) do
    %{
      name: entry.name,
      type: entry.type,
      size: entry.size,
      modified: DateTime.to_iso8601(entry.modified)
    }
  end

  defp render_entry(entry) do
    %{
      name: entry.name,
      type: entry.type,
      size: entry.size,
      modified: DateTime.to_iso8601(entry.modified),
      extension: entry.extension,
      editable: entry.editable,
      sensitive: entry.sensitive,
      fileType: entry.file_type
    }
  end

  defp render_read(%{too_large: true} = info) do
    %{
      path: info.path,
      name: info.name,
      size: info.size,
      modified: DateTime.to_iso8601(info.modified),
      editable: info.editable,
      sensitive: info.sensitive,
      fileType: info.file_type,
      tooLarge: true,
      content: nil,
      encoding: nil
    }
  end

  defp render_read(%{message: message} = info) do
    %{
      path: info.path,
      name: info.name,
      size: info.size,
      modified: DateTime.to_iso8601(info.modified),
      editable: info.editable,
      sensitive: info.sensitive,
      fileType: info.file_type,
      content: nil,
      encoding: nil,
      message: message
    }
  end

  defp render_read(info) do
    %{
      path: info.path,
      name: info.name,
      size: info.size,
      modified: DateTime.to_iso8601(info.modified),
      editable: info.editable,
      sensitive: info.sensitive,
      fileType: info.file_type,
      content: info.content,
      encoding: info.encoding
    }
  end
end
