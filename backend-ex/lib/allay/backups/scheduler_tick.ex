defmodule Allay.Backups.SchedulerTick do
  @moduledoc """
  Per-minute Oban worker enqueued by Oban.Plugins.Cron. Reads enabled
  backup configs from the DB and enqueues BackupWorker for each server
  that is due AND has at least one player online.

  # Plan 5 Task 4
  """

  use Oban.Worker, queue: :backups

  @impl Oban.Worker
  def perform(_job) do
    # Plan 5 Task 4: enqueue BackupWorker for each due, player-populated server.
    :ok
  end
end
