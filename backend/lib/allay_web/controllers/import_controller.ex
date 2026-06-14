defmodule AllayWeb.ImportController do
  use AllayWeb, :controller

  require Logger

  alias Allay.Imports
  alias Allay.Imports.Analyzer
  alias Allay.Imports.Session
  alias Allay.Runtime
  alias Allay.Servers

  action_fallback AllayWeb.FallbackController

  @allowed_extensions ~w(.zip .tar.gz .tgz)
  @upload_chunk_bytes 1_000_000

  def analyze(conn, %{"server_id" => server_id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         {:ok, filename} <- fetch_filename(conn),
         :ok <- validate_extension(filename),
         :ok <- ensure_not_busy(server_id),
         {:ok, import_id, dest} <- start_session(filename),
         {:ok, conn} <- stream_body(conn, dest, import_id),
         {:ok, archive_path} <- Session.archive_path(import_id),
         {:ok, analysis} <- Analyzer.analyze(archive_path) do
      json(conn, %{
        importId: import_id,
        detectedType: analysis.detected_type,
        categories: render_categories(analysis.categories),
        suggestedPreset: analysis.suggested_preset,
        totalSize: analysis.total_size
      })
    end
  end

  def execute(conn, %{"server_id" => server_id, "import_id" => import_id} = params) do
    scope = conn.assigns.current_scope
    selection = Map.get(params, "selection", %{})

    with {:ok, %{backup_id: backup_id, imported_paths: imported_paths}} <-
           Imports.execute(scope, server_id, import_id, selection) do
      json(conn, %{
        message: "Import completed successfully",
        backupId: to_string(backup_id),
        importedPaths: imported_paths
      })
    end
  end

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end

  defp fetch_filename(conn) do
    case get_req_header(conn, "x-filename") do
      [raw | _] when raw != "" -> {:ok, URI.decode(raw)}
      _ -> {:error, :no_file}
    end
  end

  defp start_session(filename) do
    Session.sweep([])
    Session.start_upload(filename)
  end

  defp stream_body(conn, dest, import_id) do
    file = File.open!(dest, [:write, :binary])

    result =
      try do
        write_chunks(conn, file)
      rescue
        e -> {:error, {:upload_failed, Exception.message(e)}}
      after
        File.close(file)
      end

    case result do
      {:ok, conn} ->
        {:ok, conn}

      {:error, reason} ->
        Session.delete(import_id)
        Logger.warning("import upload failed: #{inspect(reason)}")
        {:error, {:upload_failed, normalize_reason(reason)}}
    end
  end

  defp normalize_reason({:upload_failed, reason}), do: reason
  defp normalize_reason(reason), do: reason

  defp write_chunks(conn, file) do
    # large read_length minimizes socket recvs on multi-GB uploads
    case Plug.Conn.read_body(conn, length: @upload_chunk_bytes, read_length: @upload_chunk_bytes) do
      {:ok, chunk, conn} ->
        IO.binwrite(file, chunk)
        {:ok, conn}

      {:more, chunk, conn} ->
        IO.binwrite(file, chunk)
        write_chunks(conn, file)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp validate_extension(filename) do
    lower = String.downcase(filename)

    if Enum.any?(@allowed_extensions, &String.ends_with?(lower, &1)),
      do: :ok,
      else: {:error, :unsupported_format}
  end

  defp ensure_not_busy(server_id) do
    if Runtime.status(server_id).state in [:running, :starting],
      do: {:error, :server_busy},
      else: :ok
  end

  defp render_categories(categories) do
    %{
      world: categories.world,
      configs: categories.configs,
      plugins: categories.plugins,
      jars: categories.jars,
      logs: categories.logs,
      other: categories.other
    }
  end
end
