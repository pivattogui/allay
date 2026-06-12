defmodule Allay.Servers.RestartTickTest do
  use Allay.DataCase, async: false
  use Oban.Testing, repo: Allay.Repo

  import Allay.ServersFixtures

  alias Allay.Servers.RestartTick
  alias Allay.Servers.RestartWorker

  # 2026-06-12 10:00 UTC — a Friday. "0 10 * * *" matches; "0 11 * * *" doesn't.
  @now ~U[2026-06-12 10:00:00Z]

  defp now_iso, do: DateTime.to_iso8601(@now)

  test "enqueues RestartWorker for a server whose cron matches the frozen minute" do
    server = server_fixture(%{restart_schedule: "0 10 * * *"})

    assert :ok = perform_job(RestartTick, %{"now" => now_iso()})

    assert_enqueued(worker: RestartWorker, args: %{"server_id" => server.id})
  end

  test "does not enqueue when the cron does not match" do
    server = server_fixture(%{restart_schedule: "0 11 * * *"})

    assert :ok = perform_job(RestartTick, %{"now" => now_iso()})

    refute_enqueued(worker: RestartWorker, args: %{"server_id" => server.id})
  end

  test "skips servers without a restart_schedule" do
    server = server_fixture()

    assert :ok = perform_job(RestartTick, %{"now" => now_iso()})

    refute_enqueued(worker: RestartWorker, args: %{"server_id" => server.id})
  end

  test "tolerates a row with an unparseable schedule (legacy garbage)" do
    server = server_fixture(%{restart_schedule: "not a cron"})
    ok_server = server_fixture(%{restart_schedule: "0 10 * * *"})

    assert :ok = perform_job(RestartTick, %{"now" => now_iso()})

    refute_enqueued(worker: RestartWorker, args: %{"server_id" => server.id})
    assert_enqueued(worker: RestartWorker, args: %{"server_id" => ok_server.id})
  end
end
