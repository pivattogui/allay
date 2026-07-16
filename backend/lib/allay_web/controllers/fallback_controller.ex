defmodule AllayWeb.FallbackController do
  @moduledoc """
  Translates context error tuples into the JSON error contract shared
  with the legacy TS backend: `{error, code, details?}`. Changeset
  errors map to 400 (not 422) for client parity.
  """

  use AllayWeb, :controller

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:bad_request)
    |> json(%{
      error: "Validation Error",
      code: "VALIDATION_ERROR",
      details: changeset_errors(changeset)
    })
  end

  def call(conn, {:error, :invalid_credentials}) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: "Invalid credentials", code: "INVALID_CREDENTIALS"})
  end

  def call(conn, {:error, :already_setup}) do
    conn
    |> put_status(:conflict)
    |> json(%{error: "Setup already completed", code: "SETUP_COMPLETED"})
  end

  def call(conn, {:error, :missing_credentials}) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Validation Error", code: "VALIDATION_ERROR"})
  end

  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "Not found", code: "NOT_FOUND"})
  end

  def call(conn, {:error, :server_not_found}) do
    error(conn, :not_found, "Server not found", "SERVER_NOT_FOUND")
  end

  def call(conn, {:error, :icon_not_found}) do
    error(conn, :not_found, "Icon not found", "ICON_NOT_FOUND")
  end

  def call(conn, {:error, :properties_not_found}) do
    error(conn, :not_found, "server.properties not found", "PROPERTIES_NOT_FOUND")
  end

  def call(conn, {:error, :port_in_use}) do
    error(conn, :conflict, "Port already in use by another server", "PORT_IN_USE")
  end

  def call(conn, {:error, {:java_lookup_failed, message}}) do
    error(conn, :bad_gateway, message, "JAVA_LOOKUP_FAILED")
  end

  def call(conn, {:error, {:java_runtime_unavailable, message}}) do
    error(conn, :bad_request, message, "JAVA_RUNTIME_UNAVAILABLE")
  end

  def call(conn, {:error, {:provision_failed, message}}) do
    error(conn, :internal_server_error, message, "PROVISION_FAILED")
  end

  def call(conn, {:error, :already_running}) do
    error(conn, :conflict, "Server is already running", "SERVER_ALREADY_RUNNING")
  end

  def call(conn, {:error, :not_running}) do
    error(conn, :conflict, "Server is not running", "SERVER_NOT_RUNNING")
  end

  def call(conn, {:error, :invalid_command}) do
    error(conn, :bad_request, "Command is required", "INVALID_COMMAND")
  end

  def call(conn, {:error, :command_failed}) do
    error(conn, :internal_server_error, "Failed to send command", "COMMAND_FAILED")
  end

  def call(conn, {:error, :server_jar_not_found}) do
    error(conn, :internal_server_error, "server.jar not found", "SERVER_JAR_NOT_FOUND")
  end

  def call(conn, {:error, :server_dir_not_found}) do
    error(conn, :internal_server_error, "Server directory not found", "SERVER_DIR_NOT_FOUND")
  end

  def call(conn, {:error, :no_file}) do
    error(conn, :bad_request, "No file uploaded", "NO_FILE")
  end

  def call(conn, {:error, :invalid_file_type}) do
    error(conn, :bad_request, "File must be an image", "INVALID_FILE_TYPE")
  end

  def call(conn, {:error, :file_too_large}) do
    error(conn, :bad_request, "File size must be less than 5MB", "FILE_TOO_LARGE")
  end

  def call(conn, {:error, :image_processing_failed}) do
    error(conn, :internal_server_error, "Failed to process image", "IMAGE_PROCESSING_FAILED")
  end

  def call(conn, {:error, :invalid_server_type}) do
    error(conn, :bad_request, "Invalid server type", "VALIDATION_ERROR")
  end

  # Migration's type guard carries its own legacy code (INVALID_SERVER_TYPE),
  # distinct from the system /versions endpoint's VALIDATION_ERROR above.
  def call(conn, {:error, :invalid_migration_type}) do
    error(conn, :bad_request, "Invalid server type", "INVALID_SERVER_TYPE")
  end

  def call(conn, {:error, :invalid_input}) do
    error(conn, :bad_request, "Type and version are required", "INVALID_INPUT")
  end

  def call(conn, {:error, :backup_not_found}) do
    error(conn, :not_found, "Backup not found", "BACKUP_NOT_FOUND")
  end

  def call(conn, {:error, :backup_file_not_found}) do
    error(conn, :not_found, "Backup file not found", "BACKUP_FILE_NOT_FOUND")
  end

  def call(conn, {:error, :config_not_found}) do
    error(conn, :not_found, "Backup config not found", "CONFIG_NOT_FOUND")
  end

  def call(conn, {:error, :server_running}) do
    error(
      conn,
      :conflict,
      "Cannot restore while server is running. Stop the server first.",
      "SERVER_RUNNING"
    )
  end

  # Migration shares the SERVER_RUNNING code but carries its own legacy message.
  def call(conn, {:error, :migration_server_running}) do
    error(
      conn,
      :conflict,
      "Server must be stopped before migration",
      "SERVER_RUNNING"
    )
  end

  def call(conn, {:error, {:backup_failed, output}}) do
    conn
    |> put_status(:internal_server_error)
    |> json(%{
      error: "Failed to create backup",
      code: "BACKUP_FAILED",
      details: to_string(output)
    })
  end

  def call(conn, {:error, {:restore_failed, _reason}}) do
    error(conn, :internal_server_error, "Failed to restore backup", "RESTORE_FAILED")
  end

  def call(conn, {:error, {:jar_download_failed, _message}}) do
    error(
      conn,
      :internal_server_error,
      "Failed to download new server JAR",
      "JAR_DOWNLOAD_FAILED"
    )
  end

  def call(conn, {:error, :fetch_versions_failed}) do
    error(conn, :internal_server_error, "Failed to fetch versions", "FETCH_VERSIONS_FAILED")
  end

  # ── Import errors ───────────────────────────────────────────────────────────

  def call(conn, {:error, :unsupported_format}) do
    error(
      conn,
      :bad_request,
      "Unsupported archive format. Use .zip, .tar.gz, or .tgz.",
      "UNSUPPORTED_FORMAT"
    )
  end

  def call(conn, {:error, :server_busy}) do
    error(conn, :conflict, "Server must be stopped before import", "SERVER_BUSY")
  end

  def call(conn, {:error, :import_not_found}) do
    error(conn, :not_found, "Import session not found or expired", "IMPORT_NOT_FOUND")
  end

  def call(conn, {:error, :empty_selection}) do
    error(conn, :bad_request, "No files selected for import", "EMPTY_SELECTION")
  end

  def call(conn, {:error, {:import_failed, _reason}}) do
    error(conn, :internal_server_error, "Failed to import archive", "IMPORT_FAILED")
  end

  def call(conn, {:error, {:upload_failed, _reason}}) do
    error(conn, :bad_request, "Upload failed", "UPLOAD_FAILED")
  end

  # ── File browser / editor errors (legacy code vocabulary) ───────────────────

  def call(conn, {:error, :invalid_path}) do
    error(conn, :bad_request, "Path traversal attempt detected", "INVALID_PATH")
  end

  def call(conn, {:error, :invalid_old_path}) do
    error(conn, :bad_request, "Path traversal attempt detected", "INVALID_PATH")
  end

  def call(conn, {:error, :invalid_new_path}) do
    error(conn, :bad_request, "Path traversal attempt detected", "INVALID_PATH")
  end

  def call(conn, {:error, :directory_not_found}) do
    error(conn, :not_found, "Directory not found", "DIRECTORY_NOT_FOUND")
  end

  def call(conn, {:error, :not_a_directory}) do
    error(conn, :bad_request, "Path is not a directory", "NOT_A_DIRECTORY")
  end

  def call(conn, {:error, :file_not_found}) do
    error(conn, :not_found, "File not found", "FILE_NOT_FOUND")
  end

  def call(conn, {:error, :is_directory}) do
    error(conn, :bad_request, "Path is a directory", "IS_DIRECTORY")
  end

  def call(conn, {:error, :name_required}) do
    error(conn, :bad_request, "Name is required", "NAME_REQUIRED")
  end

  def call(conn, {:error, :already_exists}) do
    error(conn, :bad_request, "Path already exists", "ALREADY_EXISTS")
  end

  def call(conn, {:error, :cannot_delete_root}) do
    error(conn, :bad_request, "Cannot delete root directory", "CANNOT_DELETE_ROOT")
  end

  def call(conn, {:error, :path_not_found}) do
    error(conn, :not_found, "Path not found", "NOT_FOUND")
  end

  def call(conn, {:error, :source_not_found}) do
    error(conn, :not_found, "Source path not found", "SOURCE_NOT_FOUND")
  end

  def call(conn, {:error, :destination_exists}) do
    error(conn, :bad_request, "Destination already exists", "DESTINATION_EXISTS")
  end

  def call(conn, {:error, :is_directory_download}) do
    error(
      conn,
      :bad_request,
      "Directory download not yet implemented. Use backup feature.",
      "DIR_DOWNLOAD_NOT_IMPLEMENTED"
    )
  end

  def call(conn, {:error, :content_required}) do
    error(conn, :bad_request, "Content is required", "CONTENT_REQUIRED")
  end

  def call(conn, {:error, :paths_required}) do
    error(conn, :bad_request, "oldPath and newPath are required", "PATHS_REQUIRED")
  end

  def call(conn, {:error, :write_error}) do
    error(conn, :internal_server_error, "Failed to write file", "WRITE_ERROR")
  end

  def call(conn, {:error, :mkdir_error}) do
    error(conn, :internal_server_error, "Failed to create directory", "MKDIR_ERROR")
  end

  def call(conn, {:error, :delete_error}) do
    error(conn, :internal_server_error, "Failed to delete path", "DELETE_ERROR")
  end

  def call(conn, {:error, :rename_error}) do
    error(conn, :internal_server_error, "Failed to rename path", "RENAME_ERROR")
  end

  def call(conn, {:error, :upload_error}) do
    error(conn, :internal_server_error, "Failed to upload file(s)", "UPLOAD_ERROR")
  end

  defp error(conn, status, message, code) do
    conn
    |> put_status(status)
    |> json(%{error: message, code: code})
  end

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
