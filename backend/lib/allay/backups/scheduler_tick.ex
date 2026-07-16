defmodule Allay.Backups.SchedulerTick do
  @moduledoc """
  Per-minute Oban worker enqueued by Oban.Plugins.Cron. Reads enabled backup
  configs from the DB and enqueues `Allay.Backups.BackupWorker` for each server
  that is due (per `due?/2`) AND has at least one player online. Stateless: the
  schedule lives in the DB and is re-read every minute, so config edits apply
  without re-registration and deleted servers simply stop matching.

  The player count is resolved through a configurable seam
  (`:player_count_fun`, default `&Allay.Runtime.player_count/1`) so tests can
  inject per-server counts without live JVMs. The current minute is taken from
  `args["now"]` when present (test time seam), otherwise `DateTime.utc_now/0`.
  """

  use Oban.Worker, queue: :backups

  import Ecto.Query

  alias Allay.Backups.BackupConfig
  alias Allay.Backups.BackupWorker
  alias Allay.Repo

  @impl Oban.Worker
  def perform(%Oban.Job{args: args}) do
    now = parse_now(args)
    player_count = player_count_fun()

    BackupConfig
    |> where([c], c.enabled == true)
    |> Repo.all()
    |> Enum.filter(fn config ->
      due?(config.interval_minutes, now) and player_count.(config.server_id) > 0
    end)
    |> Enum.each(fn config ->
      %{server_id: config.server_id, type: "scheduled"}
      |> BackupWorker.new()
      |> Oban.insert()
    end)

    :ok
  end

  @doc """
  Pure scheduling predicate over a UTC `DateTime`. Mirrors the legacy interval
  semantics exactly:

    * `interval <= 0` → never
    * `interval < 60` → minute divisible by the interval (`rem(minute, n) == 0`)
    * `interval >= 60` → minute 0 and hour divisible by `floor(interval / 60)`
      (sub-hour remainder dropped)
  """
  @spec due?(integer(), DateTime.t()) :: boolean()
  def due?(interval, _now) when interval <= 0, do: false

  def due?(interval, %DateTime{minute: minute}) when interval < 60 do
    rem(minute, interval) == 0
  end

  def due?(interval, %DateTime{minute: minute, hour: hour}) do
    minute == 0 and rem(hour, div(interval, 60)) == 0
  end

  defp parse_now(%{"now" => iso}) when is_binary(iso) do
    {:ok, dt, _} = DateTime.from_iso8601(iso)
    dt
  end

  defp parse_now(_), do: DateTime.utc_now()

  defp player_count_fun do
    Application.get_env(:allay, :player_count_fun, &Allay.Runtime.player_count/1)
  end
end
