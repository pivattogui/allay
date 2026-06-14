defmodule Allay.Backups.BackupWorker do
  @moduledoc """
  Oban worker that produces a single backup archive. Enqueued by
  `Allay.Backups.SchedulerTick` (scheduled backups) and dedupe-guarded per
  server: a 55-second uniqueness window collapses a burst of tick-triggered
  jobs for the same server into one.

  `max_attempts: 3` caps retries — a failing backup usually means a broken
  disk, and unbounded retries would hammer it.
  """

  use Oban.Worker, queue: :backups, unique: [period: 55, keys: [:server_id]], max_attempts: 3

  alias Allay.Accounts.Scope
  alias Allay.Backups
  alias Allay.Servers

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"server_id" => server_id} = args}) do
    type = Map.get(args, "type", "scheduled")
    scope = Scope.system()

    case Servers.get_server(scope, server_id) do
      {:error, :not_found} ->
        {:cancel, :server_deleted}

      {:ok, _server} ->
        case Backups.create_backup(scope, server_id, type) do
          {:ok, _backup} -> :ok
          {:error, reason} -> {:error, inspect(reason)}
        end
    end
  end
end
