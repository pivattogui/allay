defmodule AllayWeb.ServerChannel do
  @moduledoc """
  Per-server channel. On join it authorizes the server against the connection's
  scope, then pushes a FRESH status snapshot (a supervision cascade may have
  replaced the instance between events, so joiners cannot rely on the event
  trail), replays the last 50 log lines for parity, and subscribes to the
  runtime event stream. Runtime events are serialized to the wire shapes the
  React client expects at the channel boundary.
  """

  use AllayWeb, :channel

  alias Allay.Runtime
  alias Allay.Runtime.Event
  alias Allay.Runtime.LogLine
  alias AllayWeb.ServerJSON

  @log_replay_count 50

  @impl true
  def join("server:" <> server_id, _payload, socket) do
    scope = socket.assigns.current_scope

    case Allay.Servers.get_server(scope, server_id) do
      {:ok, _server} ->
        Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))
        send(self(), :after_join)
        {:ok, assign(socket, :server_id, server_id)}

      {:error, :not_found} ->
        {:error, %{error: "Not found", code: "NOT_FOUND"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    id = socket.assigns.server_id

    push(socket, "status", ServerJSON.status(Runtime.status(id)))

    id
    |> Runtime.logs(@log_replay_count)
    |> Enum.each(fn line -> push(socket, "log", LogLine.render(line)) end)

    {:noreply, socket}
  end

  def handle_info(%Event{type: :log, data: line}, socket) do
    push(socket, "log", LogLine.render(line))
    {:noreply, socket}
  end

  def handle_info(%Event{type: :metrics, data: m}, socket) do
    push(socket, "metrics", %{
      timestamp: DateTime.to_iso8601(m.timestamp),
      ramUsedMb: m.ram_used_mb,
      ramMaxMb: m.ram_max_mb,
      cpuPercent: m.cpu_percent,
      playerCount: m.player_count,
      playerMax: m.player_max
    })

    {:noreply, socket}
  end

  def handle_info(%Event{type: :status, data: status}, socket) do
    push(socket, "status", ServerJSON.status(status))
    {:noreply, socket}
  end
end
