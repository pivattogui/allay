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

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
