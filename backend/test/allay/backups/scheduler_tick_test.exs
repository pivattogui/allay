defmodule Allay.Backups.SchedulerTickTest do
  use Allay.DataCase, async: false
  use Oban.Testing, repo: Allay.Repo

  import Allay.ServersFixtures

  alias Allay.Backups.BackupConfig
  alias Allay.Backups.BackupWorker
  alias Allay.Backups.SchedulerTick
  alias Allay.Repo

  describe "due?/2 — interval < 60 (minutes divisible)" do
    test "15-minute interval matches :00/:15/:30/:45" do
      for minute <- [0, 15, 30, 45] do
        assert SchedulerTick.due?(15, ~U[2026-06-12 10:00:00Z] |> Map.put(:minute, minute))
      end
    end

    test "15-minute interval does not match :07" do
      refute SchedulerTick.due?(15, ~U[2026-06-12 10:07:00Z])
    end
  end

  describe "due?/2 — interval >= 60 (hours divisible at minute 0)" do
    test "90-minute interval (div=1) matches any hour at minute 0" do
      assert SchedulerTick.due?(90, ~U[2026-06-12 03:00:00Z])
      assert SchedulerTick.due?(90, ~U[2026-06-12 17:00:00Z])
    end

    test "90-minute interval does not match minute 30" do
      refute SchedulerTick.due?(90, ~U[2026-06-12 03:30:00Z])
    end

    test "60-minute interval matches :00 of every hour" do
      assert SchedulerTick.due?(60, ~U[2026-06-12 03:00:00Z])
    end

    test "60-minute interval does not match :30" do
      refute SchedulerTick.due?(60, ~U[2026-06-12 03:30:00Z])
    end

    test "120-minute interval (div=2) matches even hours at minute 0" do
      assert SchedulerTick.due?(120, ~U[2026-06-12 02:00:00Z])
    end

    test "120-minute interval does not match odd hour 3" do
      refute SchedulerTick.due?(120, ~U[2026-06-12 03:00:00Z])
    end
  end

  describe "due?/2 — non-positive intervals" do
    test "0 never matches" do
      refute SchedulerTick.due?(0, ~U[2026-06-12 00:00:00Z])
    end

    test "negative never matches" do
      refute SchedulerTick.due?(-5, ~U[2026-06-12 00:00:00Z])
    end
  end

  # Seeds an enabled backup config row for a server with the given interval.
  defp config_fixture(server_id, interval) do
    %BackupConfig{}
    |> Ecto.Changeset.cast(
      %{
        server_id: server_id,
        enabled: true,
        interval_minutes: interval,
        max_backups: 10,
        include_logs: false
      },
      [:server_id, :enabled, :interval_minutes, :max_backups, :include_logs]
    )
    |> Repo.insert!()
  end

  describe "perform/1 — enqueues BackupWorker for due, populated servers" do
    setup do
      # Freeze "now" at minute 0 so a 60-minute interval is due.
      now = ~U[2026-06-12 10:00:00Z]

      due_with_players = server_fixture()
      due_no_players = server_fixture()
      not_due = server_fixture()

      # now = 10:00 UTC. 60-min → due; 180-min (div 3, rem(10,3)=1) → not due.
      config_fixture(due_with_players.id, 60)
      config_fixture(due_no_players.id, 60)
      config_fixture(not_due.id, 180)

      # Seam: per-id player counts. not_due also has players but isn't due.
      players = %{
        due_with_players.id => 3,
        due_no_players.id => 0,
        not_due.id => 5
      }

      previous = Application.get_env(:allay, :player_count_fun)
      Application.put_env(:allay, :player_count_fun, fn id -> Map.get(players, id, 0) end)
      on_exit(fn -> restore_env(:player_count_fun, previous) end)

      %{
        now: now,
        due_with_players: due_with_players,
        due_no_players: due_no_players,
        not_due: not_due
      }
    end

    test "enqueues for due server with players", ctx do
      assert :ok = perform_job(SchedulerTick, %{"now" => DateTime.to_iso8601(ctx.now)})

      assert_enqueued(
        worker: BackupWorker,
        args: %{"server_id" => ctx.due_with_players.id, "type" => "scheduled"}
      )
    end

    test "does not enqueue for due server with zero players", ctx do
      assert :ok = perform_job(SchedulerTick, %{"now" => DateTime.to_iso8601(ctx.now)})

      refute_enqueued(
        worker: BackupWorker,
        args: %{"server_id" => ctx.due_no_players.id}
      )
    end

    test "does not enqueue for not-due server", ctx do
      assert :ok = perform_job(SchedulerTick, %{"now" => DateTime.to_iso8601(ctx.now)})

      refute_enqueued(
        worker: BackupWorker,
        args: %{"server_id" => ctx.not_due.id}
      )
    end
  end

  defp restore_env(key, nil), do: Application.delete_env(:allay, key)
  defp restore_env(key, value), do: Application.put_env(:allay, key, value)
end
