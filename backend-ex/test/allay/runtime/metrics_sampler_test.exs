defmodule Allay.Runtime.MetricsSamplerTest do
  use ExUnit.Case, async: true

  alias Allay.Runtime.{Event, MetricsSampler}

  setup do
    server_id = "srv-#{System.unique_integer([:positive])}"
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))
    %{server_id: server_id}
  end

  defp start_sampler!(server_id, opts \\ []) do
    defaults = [
      server_id: server_id,
      os_pid: 4242,
      ram_max_mb: 4096,
      interval_ms: 50,
      cores: 1,
      name: nil,
      ps_fun: fn 4242 -> {:ok, %{rss_kb: 1_048_576, cpu_percent: 42.36}} end
    ]

    start_supervised!({MetricsSampler, Keyword.merge(defaults, opts)})
  end

  test "samples immediately and on the interval", %{server_id: id} do
    start_sampler!(id)

    assert_receive %Event{server_id: ^id, type: :metrics, data: data}, 1_000
    assert data.ram_used_mb == 1024
    assert data.ram_max_mb == 4096
    assert data.cpu_percent == 42.4
    assert data.player_count == 0
    assert data.player_max == 20
    assert %DateTime{} = data.timestamp

    assert_receive %Event{type: :metrics}, 1_000
  end

  test "join/leave log events adjust the count and broadcast immediately", %{server_id: id} do
    start_sampler!(id, interval_ms: 60_000)
    assert_receive %Event{type: :metrics, data: %{player_count: 0}}, 1_000

    Event.broadcast(id, :log, log_line("Steve joined the game"))
    assert_receive %Event{type: :metrics, data: %{player_count: 1}}, 1_000

    Event.broadcast(id, :log, log_line("Steve left the game"))
    assert_receive %Event{type: :metrics, data: %{player_count: 0}}, 1_000

    Event.broadcast(id, :log, log_line("Alex left the game"))
    assert_receive %Event{type: :metrics, data: %{player_count: 0}}, 1_000
  end

  test "chat lines merely containing the phrases do not count", %{server_id: id} do
    start_sampler!(id, interval_ms: 60_000)
    assert_receive %Event{type: :metrics}, 1_000

    Event.broadcast(id, :log, log_line("<Steve> haha Alex joined the game lol"))
    refute_receive %Event{type: :metrics, data: %{player_count: 1}}, 200
  end

  test "list output sets both count and max", %{server_id: id} do
    start_sampler!(id, interval_ms: 60_000)
    assert_receive %Event{type: :metrics}, 1_000

    Event.broadcast(id, :log, log_line("There are 3 of a max of 50 players online: a, b, c"))
    assert_receive %Event{type: :metrics, data: %{player_count: 3, player_max: 50}}, 1_000
  end

  test "max-players config line updates player_max without an immediate broadcast", %{
    server_id: id
  } do
    start_sampler!(id, interval_ms: 60_000)
    assert_receive %Event{type: :metrics, data: %{player_max: 20}}, 1_000

    Event.broadcast(id, :log, log_line("max-players=50"))
    # max-players only updates state; it does not broadcast on its own (unlike
    # list/join/leave). The new max surfaces on the next list output.
    refute_receive %Event{type: :metrics}, 200

    Event.broadcast(id, :log, log_line("There are 1 of a max of 50 players online: a"))
    assert_receive %Event{type: :metrics, data: %{player_max: 50}}, 1_000
  end

  test "dead pid stops broadcasting", %{server_id: id} do
    start_sampler!(id, ps_fun: fn _ -> {:error, :dead} end)
    refute_receive %Event{type: :metrics}, 300
  end

  defp log_line(message) do
    %{timestamp: DateTime.utc_now(), level: :info, message: message}
  end
end
