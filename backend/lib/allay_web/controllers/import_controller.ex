defmodule AllayWeb.ImportController do
  use AllayWeb, :controller

  alias Allay.Imports
  alias Allay.Imports.Analyzer
  alias Allay.Imports.Session
  alias Allay.Runtime
  alias Allay.Servers

  action_fallback AllayWeb.FallbackController

  @allowed_extensions ~w(.zip .tar.gz .tgz)

  def analyze(conn, %{"server_id" => server_id} = params) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, server_id),
         {:ok, upload} <- fetch_upload(params),
         :ok <- validate_extension(upload.filename),
         :ok <- ensure_not_busy(server_id) do
      Session.sweep([])
      {:ok, import_id} = Session.create({:file, upload.path}, upload.filename)
      {:ok, archive_path} = Session.archive_path(import_id)
      {:ok, analysis} = Analyzer.analyze(archive_path)

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

  defp fetch_upload(%{"file" => %Plug.Upload{} = upload}), do: {:ok, upload}
  defp fetch_upload(_params), do: {:error, :no_file}

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
