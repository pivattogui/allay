defmodule AllayWeb.ServerChannelTest do
  use AllayWeb.ChannelCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts.Scope
  alias Allay.Runtime.Event
  alias AllayWeb.ServerChannel
  alias AllayWeb.UserSocket

  setup do
    user = user_fixture()
    scope = Scope.for_user(user)
    socket = socket(UserSocket, "user_socket:#{user.id}", %{current_scope: scope})
    %{socket: socket}
  end

  describe "join/3" do
    test "rejects an unknown server id", %{socket: socket} do
      unknown = Ecto.UUID.generate()

      assert {:error, reply} =
               subscribe_and_join(socket, ServerChannel, "server:#{unknown}")

      assert reply.code == "NOT_FOUND"
    end

    test "pushes a fresh status snapshot on join", %{socket: socket} do
      server = server_fixture()

      assert {:ok, _reply, _socket} =
               subscribe_and_join(socket, ServerChannel, "server:#{server.id}")

      # No runtime instance running → the facade returns the stopped shape.
      assert_push "status", %{state: "stopped"}
    end

    # Replay gap acknowledgement: replaying the last 50 log lines on join
    # requires a live LogWatcher buffer, which only exists when a Java process
    # is running. These tests deliberately stay OS-process-free, so with no
    # instance `Runtime.logs(id, 50)` returns `[]` and the replay loop pushes
    # nothing. The assertion below pins that the snapshot is the ONLY push on a
    # clean join (no crash, no spurious "log" frames). The replay-with-content
    # path is covered by code review + the lifecycle integration tests.
    test "does not push any log frames when there is no runtime buffer", %{socket: socket} do
      server = server_fixture()

      assert {:ok, _reply, _socket} =
               subscribe_and_join(socket, ServerChannel, "server:#{server.id}")

      assert_push "status", %{state: "stopped"}
      refute_push "log", _payload
    end
  end

  describe "event forwarding" do
    setup %{socket: socket} do
      server = server_fixture()
      {:ok, _reply, _joined} = subscribe_and_join(socket, ServerChannel, "server:#{server.id}")
      # Drain the join snapshot so per-test assertions see only their event.
      assert_push "status", %{state: "stopped"}
      %{server: server}
    end

    test "forwards a :log event as a rendered log push", %{server: server} do
      Event.broadcast(server.id, :log, %{
        timestamp: ~U[2026-06-11 12:00:00Z],
        level: :info,
        message: "hi"
      })

      assert_push "log", %{message: "hi", level: "info", timestamp: "2026-06-11T12:00:00Z"}
    end

    test "forwards a :metrics event with the camelCase wire shape", %{server: server} do
      Event.broadcast(server.id, :metrics, %{
        timestamp: ~U[2026-06-11 12:00:00Z],
        ram_used_mb: 512,
        ram_max_mb: 2048,
        cpu_percent: 12.5,
        player_count: 3,
        player_max: 20
      })

      assert_push "metrics", %{
        timestamp: "2026-06-11T12:00:00Z",
        ramUsedMb: 512,
        ramMaxMb: 2048,
        cpuPercent: 12.5,
        playerCount: 3,
        playerMax: 20
      }
    end

    test "forwards a :status event serialized like the REST shape", %{server: server} do
      Event.broadcast(server.id, :status, %{
        state: :running,
        pid: 4321,
        uptime: 99,
        last_error: nil
      })

      assert_push "status", payload
      assert payload.state == "running"
      assert payload.pid == 4321
      assert payload.uptime == 99
      refute Map.has_key?(payload, :lastError)
    end
  end
end
