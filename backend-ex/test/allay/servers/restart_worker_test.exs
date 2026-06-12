defmodule Allay.Servers.RestartWorkerTest do
  use Allay.DataCase, async: false
  use Oban.Testing, repo: Allay.Repo

  import Allay.ServersFixtures

  alias Allay.Servers.RestartWorker

  test "cancels when the server row is gone" do
    assert {:cancel, :server_deleted} =
             perform_job(RestartWorker, %{"server_id" => Ecto.UUID.generate()})
  end

  test "skips (returns :ok) when the server is not running" do
    # No runtime instance exists for this id, so Runtime.status reports stopped.
    server = server_fixture()

    assert :ok = perform_job(RestartWorker, %{"server_id" => server.id})
  end
end
