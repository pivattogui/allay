defmodule Allay.Servers.RestartTick do
  @moduledoc """
  Per-minute Oban worker enqueued by Oban.Plugins.Cron. Reads servers with a
  `restart_schedule` from the DB and enqueues `Allay.Servers.RestartWorker` for
  each whose cron expression matches the current minute. Stateless: schedules
  are re-read every minute, so edits apply without re-registration and deleted
  servers stop matching.

  Unparseable schedules are tolerated (the changeset now rejects new garbage,
  but old rows may carry it) — they are skipped and logged once at debug. The
  current minute comes from `args["now"]` when present (test time seam),
  otherwise `NaiveDateTime.utc_now/0` truncated to the minute.
  """

  use Oban.Worker, queue: :restarts

  import Ecto.Query

  require Logger

  alias Allay.Repo
  alias Allay.Servers.RestartWorker
  alias Allay.Servers.Server
  alias Crontab.CronExpression.Parser
  alias Crontab.DateChecker

  @impl Oban.Worker
  def perform(%Oban.Job{args: args}) do
    now = parse_now(args)

    Server
    |> where([s], not is_nil(s.restart_schedule))
    |> Repo.all()
    |> Enum.filter(&matches?(&1, now))
    |> Enum.each(fn server ->
      %{server_id: server.id}
      |> RestartWorker.new()
      |> Oban.insert()
    end)

    :ok
  end

  defp matches?(%Server{id: id, restart_schedule: schedule}, now) do
    case Parser.parse(schedule) do
      {:ok, cron} ->
        DateChecker.matches_date?(cron, now)

      {:error, reason} ->
        Logger.debug("skipping server #{id}: invalid restart_schedule #{inspect(reason)}")
        false
    end
  end

  defp parse_now(%{"now" => iso}) when is_binary(iso) do
    {:ok, dt, _} = DateTime.from_iso8601(iso)

    dt
    |> DateTime.to_naive()
    |> NaiveDateTime.truncate(:second)
    |> Map.put(:second, 0)
  end

  defp parse_now(_) do
    NaiveDateTime.utc_now()
    |> NaiveDateTime.truncate(:second)
    |> Map.put(:second, 0)
  end
end
