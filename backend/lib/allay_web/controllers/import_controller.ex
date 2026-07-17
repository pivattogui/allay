defmodule AllayWeb.ImportController do
  use AllayWeb, :controller

  alias Allay.Servers
  alias AllayWeb.UploadStream

  action_fallback AllayWeb.FallbackController

  @allowed_extensions ~w(.zip .tar.gz .tgz)
  def analyze(conn, %{"server_id" => server_id}) do
    scope = conn.assigns.current_scope

    with {:ok, filename} <- fetch_filename(conn),
         :ok <- validate_extension(filename),
         {:ok, import_id, dest} <- imports(Servers.begin_import(scope, server_id, filename)),
         {:ok, conn, _size} <- upload_archive(conn, dest, import_id),
         {:ok, analysis} <- Servers.analyze_import(import_id) do
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
           Servers.execute_import(scope, server_id, import_id, selection) do
      json(conn, %{
        message: "Import completed successfully",
        backupId: to_string(backup_id),
        importedPaths: imported_paths
      })
    end
  end

  defp fetch_filename(conn) do
    case get_req_header(conn, "x-filename") do
      [raw | _] when raw != "" -> {:ok, URI.decode(raw)}
      _ -> {:error, :no_file}
    end
  end

  defp upload_archive(conn, dest, import_id) do
    case UploadStream.write(conn, dest) do
      {:ok, _conn, _size} = success ->
        success

      error ->
        Servers.discard_import(import_id)
        error
    end
  end

  defp validate_extension(filename) do
    lower = String.downcase(filename)

    if Enum.any?(@allowed_extensions, &String.ends_with?(lower, &1)),
      do: :ok,
      else: {:error, :unsupported_format}
  end

  defp imports({:error, :not_found}), do: {:error, :server_not_found}
  defp imports(other), do: other

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
