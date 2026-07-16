defmodule AllayWeb.ServerJSONTest do
  use Allay.DataCase, async: true

  import Allay.ServersFixtures

  alias AllayWeb.ServerJSON

  @wire_keys ~w(
    id name type version port ramMinMb ramMaxMb javaVersion directory
    autoStart autoRestart restartLimit iconPath jvmArgs javaPath
    restartSchedule rconPort status createdAt updatedAt
  )a

  describe "server/1 wire shape" do
    test "renders exactly the documented camelCase key set" do
      server = server_fixture()
      status = %{state: :stopped, pid: nil, uptime: nil, last_error: nil}

      rendered = ServerJSON.server(%{server: server, status: status})

      assert MapSet.new(Map.keys(rendered)) == MapSet.new(@wire_keys)
    end

    test "maps snake_case columns to camelCase values" do
      server = server_fixture(%{name: "Pinned", auto_start: true, jvm_args: "-XX:+UseG1GC"})
      status = %{state: :stopped, pid: nil, uptime: nil, last_error: nil}

      rendered = ServerJSON.server(%{server: server, status: status})

      assert rendered.id == server.id
      assert rendered.name == "Pinned"
      assert rendered.ramMinMb == server.ram_min_mb
      assert rendered.ramMaxMb == server.ram_max_mb
      assert rendered.autoStart == true
      assert rendered.jvmArgs == "-XX:+UseG1GC"
      assert rendered.rconPort == server.rcon_port
    end

    test "renders timestamps as ISO8601 strings" do
      server = server_fixture()
      status = %{state: :stopped, pid: nil, uptime: nil, last_error: nil}

      rendered = ServerJSON.server(%{server: server, status: status})

      assert rendered.createdAt == DateTime.to_iso8601(server.inserted_at)
      assert rendered.updatedAt == DateTime.to_iso8601(server.updated_at)
    end
  end

  describe "status serializer" do
    test "stopped status carries only the state (nil fields omitted)" do
      server = server_fixture()
      status = %{state: :stopped, pid: nil, uptime: nil, last_error: nil}

      %{status: rendered} = ServerJSON.server(%{server: server, status: status})

      assert rendered == %{state: "stopped"}
    end

    test "running status includes pid and uptime, last_error omitted when nil" do
      server = server_fixture()
      status = %{state: :running, pid: 4242, uptime: 90, last_error: nil}

      %{status: rendered} = ServerJSON.server(%{server: server, status: status})

      assert rendered == %{state: "running", pid: 4242, uptime: 90}
    end

    test "crashed status surfaces last_error as lastError" do
      server = server_fixture()
      status = %{state: :crashed, pid: nil, uptime: nil, last_error: "exit code 1"}

      %{status: rendered} = ServerJSON.server(%{server: server, status: status})

      assert rendered == %{state: "crashed", lastError: "exit code 1"}
    end
  end
end
