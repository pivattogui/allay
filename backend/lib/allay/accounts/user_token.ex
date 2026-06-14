defmodule Allay.Accounts.UserToken do
  use Ecto.Schema
  import Ecto.Query

  @hash_algorithm :sha256
  @rand_size 32
  @api_token_validity_in_days 30

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "users_tokens" do
    field :token, :binary
    field :context, :string
    belongs_to :user, Allay.Accounts.User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc """
  Builds an API token: returns the url-encoded token for the client and
  the struct to persist. Only the sha256 hash touches the database, so a
  DB leak cannot be replayed as a credential.
  """
  def build_api_token(user) do
    token = :crypto.strong_rand_bytes(@rand_size)
    hashed_token = :crypto.hash(@hash_algorithm, token)

    {Base.url_encode64(token, padding: false),
     %__MODULE__{token: hashed_token, context: "api-token", user_id: user.id}}
  end

  @doc """
  Returns `{:ok, query}` selecting the user owning a valid, unexpired
  token, or `:error` for undecodable input.
  """
  def verify_api_token_query(encoded_token) do
    case Base.url_decode64(encoded_token, padding: false) do
      {:ok, decoded_token} ->
        hashed_token = :crypto.hash(@hash_algorithm, decoded_token)
        days = @api_token_validity_in_days

        query =
          from token in __MODULE__,
            where: token.context == "api-token" and token.token == ^hashed_token,
            where: token.inserted_at > ago(^days, "day"),
            join: user in assoc(token, :user),
            select: user

        {:ok, query}

      :error ->
        :error
    end
  end
end
