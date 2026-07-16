defmodule Allay.Accounts do
  @moduledoc """
  Single-admin identity: initial setup, login, API tokens.
  """

  alias Allay.Accounts.{User, UserToken}
  alias Allay.Repo

  def setup_required? do
    Repo.aggregate(User, :count) == 0
  end

  @doc """
  Registers the first (and only) user. Concurrent setups with distinct
  usernames are not guarded at the DB level (check-then-insert race) —
  acceptable for a single-admin homelab flow.
  """
  def register_initial_admin(attrs) do
    if setup_required?() do
      %User{}
      |> User.registration_changeset(attrs)
      |> Repo.insert()
    else
      {:error, :already_setup}
    end
  end

  def authenticate_user(username, password)
      when is_binary(username) and is_binary(password) do
    user = Repo.get_by(User, username: username)

    if User.valid_password?(user, password) do
      {:ok, user}
    else
      {:error, :invalid_credentials}
    end
  end

  def create_user_api_token(%User{} = user) do
    {encoded_token, user_token} = UserToken.build_api_token(user)
    Repo.insert!(user_token)
    encoded_token
  end

  def fetch_user_by_api_token(token) when is_binary(token) do
    with {:ok, query} <- UserToken.verify_api_token_query(token),
         %User{} = user <- Repo.one(query) do
      {:ok, user}
    else
      _ -> :error
    end
  end
end
