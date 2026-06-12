defmodule Allay.Servers.RestartWorkerTest do
  use Allay.DataCase, async: false
  use Oban.Testing, repo: Allay.Repo

  import Allay.ServersFixtures

  alias Allay.Accounts.Scope
  alias Allay.Runtime
  alias Allay.Runtime.Event
  alias Allay.Runtime.FakeRcon
  alias Allay.Servers
  alias Allay.Servers.RestartWorker

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  test "cancels when the server row is gone" do
    assert {:cancel, :server_deleted} =
             perform_job(RestartWorker, %{"server_id" => Ecto.UUID.generate()})
  end

  test "skips (returns :ok) when the server is not running" do
    # No runtime instance exists for this id, so Runtime.status reports stopped.
    server = server_fixture()

    assert :ok = perform_job(RestartWorker, %{"server_id" => server.id})
  end

  test "running server: stops fully, then starts again" do
    {:ok, _} = FakeRcon.start_registry()
    rcon_port = System.unique_integer([:positive])

    dir = Path.join(System.tmp_dir!(), "restart-wrk-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "fake")
    on_exit(fn -> File.rm_rf!(dir) end)

    server =
      server_fixture(%{
        directory: dir,
        java_path: @fake_java,
        java_version: "21",
        rcon_port: rcon_port,
        rcon_password: "pw"
      })

    on_exit(fn -> Runtime.remove_instance(server.id) end)

    start_opts = [
      env: [{"FAKE_BEHAVIOR", "ok"}],
      spec_overrides: [
        rcon_mod: FakeRcon,
        startup_timeout_ms: 2_000,
        stop_timeout_ms: 300,
        term_timeout_ms: 300,
        respawn_delay_ms: 50
      ]
    ]

    Application.put_env(:allay, :lifecycle_start_opts, start_opts)
    on_exit(fn -> Application.delete_env(:allay, :lifecycle_start_opts) end)

    Application.put_env(:allay, :restart_deadline_ms, 5_000)
    on_exit(fn -> Application.delete_env(:allay, :restart_deadline_ms) end)

    Runtime.subscribe(server.id)

    {:ok, status} =
      Servers.start_server(Scope.system(), server.id, start_opts)

    os_pid = status.pid
    FakeRcon.set(rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    # RCON "stop" must actually terminate the OS process so the runtime can
    # observe the exit and transition stopping → stopped (real-server fidelity).
    FakeRcon.set(rcon_port, %{
      ready?: true,
      on_exec: fn
        "stop" -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)]) && {:ok, "Stopping"}
        _ -> {:ok, ""}
      end
    })

    assert :ok = perform_job(RestartWorker, %{"server_id" => server.id})

    # The worker must observe the full stop before restarting: stopping → stopped,
    # then starting → running again.
    assert_receive %Event{type: :status, data: %{state: :stopping}}, 3_000
    assert_receive %Event{type: :status, data: %{state: :stopped}}, 3_000
    assert_receive %Event{type: :status, data: %{state: :starting}}, 5_000

    FakeRcon.set(rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 5_000

    assert Runtime.status(server.id).state == :running
  end
end
