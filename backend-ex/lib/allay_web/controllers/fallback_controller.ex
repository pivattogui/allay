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

  def call(conn, {:error, :fetch_versions_failed}) do
    error(conn, :internal_server_error, "Failed to fetch versions", "FETCH_VERSIONS_FAILED")
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
