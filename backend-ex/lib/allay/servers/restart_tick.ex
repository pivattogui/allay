defmodule Allay.Servers.RestartTick do
  @moduledoc """
  Per-minute Oban worker enqueued by Oban.Plugins.Cron. Reads servers
  with a restart_schedule from the DB and enqueues RestartWorker for
  each server whose cron expression matches the current minute.

  # Plan 5 Task 4
  """

  use Oban.Worker, queue: :restarts

  @impl Oban.Worker
  def perform(_job) do
    # Plan 5 Task 4: enqueue RestartWorker for each server due for restart.
    :ok
  end
end
