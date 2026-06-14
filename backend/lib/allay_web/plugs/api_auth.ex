defmodule AllayWeb.Plugs.ApiAuth do
  @moduledoc """
  Validates `Authorization: Bearer <token>` and assigns
  `conn.assigns.current_scope`. Halts with 401 otherwise.
  """

  import Plug.Conn

  alias Allay.Accounts
  alias Allay.Accounts.Scope

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Accounts.fetch_user_by_api_token(token) do
      assign(conn, :current_scope, Scope.for_user(user))
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{error: "Unauthorized", code: "UNAUTHORIZED"})
        |> halt()
    end
  end
end
