defmodule Allay.Servers.RestartWorker do
  @moduledoc """
  Oban worker that performs one scheduled restart. Enqueued by
  `Allay.Servers.RestartTick`, dedupe-guarded per server.

  `max_attempts: 1`: a scheduled restart must never retry-loop. A server gone
  → `{:cancel, :server_deleted}`; a server that isn't running → `:ok` (skip,
  legacy parity — only running servers are restarted); otherwise stop, re-fetch
  the row, and start under the system scope. A failed start returns an error
  but, with no retries, simply stops there (legacy logged and moved on).
  """

  use Oban.Worker, queue: :restarts, unique: [period: 55, keys: [:server_id]], max_attempts: 1

  alias Allay.Accounts.Scope
  alias Allay.Runtime
  alias Allay.Servers

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"server_id" => server_id}}) do
    scope = Scope.system()

    case Servers.get_server(scope, server_id) do
      {:error, :not_found} ->
        {:cancel, :server_deleted}

      {:ok, _server} ->
        if Runtime.status(server_id).state == :running do
          restart(scope, server_id)
        else
          :ok
        end
    end
  end

  defp restart(scope, server_id) do
    with {:ok, _} <- Servers.stop_server_process(scope, server_id),
         {:ok, _} <- Servers.start_server(scope, server_id) do
      :ok
    else
      {:error, reason} -> {:error, inspect(reason)}
    end
  end
end
