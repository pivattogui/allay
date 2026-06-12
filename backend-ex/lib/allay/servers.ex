defmodule Allay.Servers do
  @moduledoc """
  Context for Minecraft server management. All public functions take
  `%Allay.Accounts.Scope{}` as the first argument (Phoenix 1.8 convention).
  """

  import Ecto.Query

  alias Allay.Accounts.Scope
  alias Allay.Repo
  alias Allay.Servers.Provisioner
  alias Allay.Servers.Server

  @doc """
  Returns all servers ordered by insertion time, newest first.
  """
  def list_servers(%Scope{}) do
    Repo.all(from s in Server, order_by: [desc: s.inserted_at])
  end

  @doc """
  Fetches a single server by id.

  Returns `{:ok, server}` on success, `{:error, :not_found}` for unknown ids
  or invalid UUID strings (no crash on malformed input).
  """
  def get_server(%Scope{}, id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} ->
        case Repo.get(Server, uuid) do
          nil -> {:error, :not_found}
          server -> {:ok, server}
        end

      :error ->
        {:error, :not_found}
    end
  end

  @doc """
  Provisions a new server. Delegates to `Allay.Servers.Provisioner`.

  `opts` accepts `:data_dir` to override the configured data directory (tests).
  """
  def create_server(%Scope{} = scope, attrs, opts \\ []) do
    Provisioner.provision(scope, attrs, opts)
  end
end
