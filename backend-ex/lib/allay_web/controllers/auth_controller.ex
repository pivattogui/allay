defmodule AllayWeb.AuthController do
  use AllayWeb, :controller

  alias Allay.Accounts

  action_fallback AllayWeb.FallbackController

  def status(conn, _params) do
    json(conn, %{setupRequired: Accounts.setup_required?()})
  end

  def setup(conn, params) do
    with {:ok, _user} <- Accounts.register_initial_admin(params) do
      json(conn, %{message: "Setup completed successfully"})
    end
  end

  def login(conn, %{"username" => username, "password" => password})
      when is_binary(username) and is_binary(password) do
    with {:ok, user} <- Accounts.authenticate_user(username, password) do
      token = Accounts.create_user_api_token(user)
      json(conn, %{token: token, user: %{id: user.id, username: user.username}})
    end
  end

  # credo:disable-for-next-line Credo.Check.Design.AliasUsage
  def login(_conn, _params) do
    {:error, :missing_credentials}
  end

  def me(conn, _params) do
    user = conn.assigns.current_scope.user
    json(conn, %{user: %{id: user.id, username: user.username, createdAt: user.inserted_at}})
  end
end
