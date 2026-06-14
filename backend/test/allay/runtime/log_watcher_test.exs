defmodule Allay.Runtime.LogWatcherTest do
  use ExUnit.Case, async: true

  alias Allay.Runtime.{Event, LogWatcher}

  setup do
    dir = Path.join(System.tmp_dir!(), "logwatch-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "logs"))
    log_path = Path.join([dir, "logs", "latest.log"])
    server_id = "srv-#{System.unique_integer([:positive])}"
    on_exit(fn -> File.rm_rf!(dir) end)

    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))

    start_supervised!({LogWatcher, server_id: server_id, directory: dir, poll_ms: 20, name: nil})
    |> then(&%{watcher: &1, log_path: log_path, server_id: server_id, dir: dir})
  end

  test "tails appended lines and broadcasts parsed events", %{log_path: path, server_id: id} do
    File.write!(path, "[12:00:00 INFO]: first\n")
    assert_receive %Event{server_id: ^id, type: :log, data: %{message: "first"}}, 1_000

    File.write!(path, "[12:00:01 INFO]: second\n", [:append])
    assert_receive %Event{type: :log, data: %{message: "second"}}, 1_000
  end

  test "buffers partial lines until the newline arrives", %{log_path: path} do
    File.write!(path, "[12:00:00 INFO]: par")
    refute_receive %Event{type: :log}, 100

    File.write!(path, "tial\n", [:append])
    assert_receive %Event{type: :log, data: %{message: "partial"}}, 1_000
  end

  test "handles truncation (log rotation) by re-reading from zero", %{log_path: path} do
    File.write!(path, "[12:00:00 INFO]: before-rotation\n")
    assert_receive %Event{data: %{message: "before-rotation"}}, 1_000

    File.write!(path, "[12:00:05 INFO]: after-rotation\n")
    assert_receive %Event{data: %{message: "after-rotation"}}, 1_000
  end

  test "logs/2 returns the last N lines, capped at 1000", %{watcher: watcher, log_path: path} do
    lines = for i <- 1..1_050, do: "[12:00:00 INFO]: line-#{i}"
    File.write!(path, Enum.join(lines, "\n") <> "\n")

    assert eventually(fn -> length(LogWatcher.logs(watcher, 2_000)) == 1_000 end)

    last_two = LogWatcher.logs(watcher, 2)
    assert [%{message: "line-1049"}, %{message: "line-1050"}] = last_two
  end

  test "survives aggressive truncation races without crashing", %{
    watcher: watcher,
    log_path: path
  } do
    for _ <- 1..10 do
      File.write!(path, String.duplicate("[12:00:00 INFO]: noise\n", 50))
      File.write!(path, "")
    end

    File.write!(path, "[12:00:00 INFO]: survived\n", [:append])

    assert Process.alive?(watcher)
    assert_receive %Event{data: %{message: "survived"}}, 1_000
  end

  test "starts reading from the current file size, not replaying prior content" do
    # Isolated dir/id: the setup watcher tails its own latest.log, so this must
    # not share a directory with it.
    own_dir = Path.join(System.tmp_dir!(), "logwatch-fresh-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(own_dir, "logs"))
    on_exit(fn -> File.rm_rf!(own_dir) end)

    own_log = Path.join([own_dir, "logs", "latest.log"])
    File.write!(own_log, "[12:00:00 INFO]: previous-session\n")

    own_id = "srv-#{System.unique_integer([:positive])}"
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(own_id))

    start_supervised!(
      {LogWatcher, server_id: own_id, directory: own_dir, poll_ms: 20, name: nil},
      id: :fresh_watcher
    )

    refute_receive %Event{type: :log, data: %{message: "previous-session"}}, 200

    File.write!(own_log, "[12:00:01 INFO]: new-session\n", [:append])
    assert_receive %Event{server_id: ^own_id, type: :log, data: %{message: "new-session"}}, 1_000
  end

  test "missing file is tolerated until it appears", %{log_path: path} do
    refute_receive %Event{type: :log}, 100
    File.write!(path, "[12:00:00 INFO]: born\n")
    assert_receive %Event{data: %{message: "born"}}, 1_000
  end

  defp eventually(fun, attempts \\ 50) do
    cond do
      fun.() -> true
      attempts == 0 -> false
      true -> Process.sleep(20) && eventually(fun, attempts - 1)
    end
  end
end
