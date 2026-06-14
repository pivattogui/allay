defmodule AllayWeb.UserSocket do
  @moduledoc """
  Authenticated WebSocket entrypoint. Unlike the legacy `/ws`, which accepted
  any client that could reach the port (diagnosis issue #2), this socket
  rejects the connection at `connect/3` unless it carries a valid API token.
  The verified scope is assigned for downstream channel authorization.
  """

  use Phoenix.Socket

  alias Allay.Accounts
  alias Allay.Accounts.Scope

  channel "server:*", AllayWeb.ServerChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Accounts.fetch_user_by_api_token(token) do
      {:ok, user} -> {:ok, assign(socket, :current_scope, Scope.for_user(user))}
      _ -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_scope.user.id}"
end
