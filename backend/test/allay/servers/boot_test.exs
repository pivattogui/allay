defmodule Allay.Servers.BootTest do
  use Allay.DataCase, async: false

  import Allay.ServersFixtures

  alias Allay.Runtime
  alias Allay.Runtime.{Event, FakeRcon}
  alias Allay.Servers.Boot

  @fake_java Path.expand("../../support/fake_java.sh", __DIR__)

  setup do
    {:ok, _} = FakeRcon.start_registry()
    :ok
  end

  defp runnable_row(attrs) do
    dir = Path.join(System.tmp_dir!(), "boot-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "fake")
    on_exit(fn -> File.rm_rf!(dir) end)

    rcon_port = System.unique_integer([:positive])

    srv =
      server_fixture(
        Map.merge(
          %{
            directory: dir,
            java_path: @fake_java,
            java_version: "21",
            rcon_port: rcon_port,
            rcon_password: "pw"
          },
          attrs
        )
      )

    on_exit(fn -> Runtime.remove_instance(srv.id) end)
    %{server: srv, rcon_port: rcon_port}
  end

  test "starts only auto_start rows, leaves the rest without an instance" do
    %{server: auto, rcon_port: rcon_port} = runnable_row(%{auto_start: true})
    %{server: manual} = runnable_row(%{auto_start: false})

    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(auto.id))

    Boot.run(spec_overrides: [rcon_mod: FakeRcon, startup_timeout_ms: 2_000])

    FakeRcon.set(rcon_port, %{ready?: true})
    assert_receive %Event{type: :status, data: %{state: :running}}, 3_000

    assert %{state: :running} = Runtime.status(auto.id)
    assert %{state: :stopped, pid: nil} = Runtime.status(manual.id)
  end

  test "a per-server failure does not crash the boot run" do
    # auto_start row with a missing java_path resolution and no registry entry:
    # build_spec fails typed; Boot must log and continue.
    dir = Path.join(System.tmp_dir!(), "boot-bad-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    bad =
      server_fixture(%{
        directory: dir,
        java_path: nil,
        java_version: nil,
        auto_start: true,
        rcon_port: System.unique_integer([:positive])
      })

    on_exit(fn -> Runtime.remove_instance(bad.id) end)

    assert :ok = Boot.run([])
    assert %{state: :stopped, pid: nil} = Runtime.status(bad.id)
  end
end
