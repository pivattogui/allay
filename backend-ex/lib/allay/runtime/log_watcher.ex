defmodule Allay.Runtime.LogWatcher do
  @moduledoc """
  Polling tail of `logs/latest.log`. Polling (not fs events) keeps it
  dependency-free and works through the rename-rotation Minecraft does
  at boot; a shrunken file means rotation → restart from offset 0.
  """

  use GenServer

  alias Allay.Runtime.{Event, LogLine}

  @max_lines 1_000

  def start_link(opts) do
    case Keyword.fetch(opts, :name) do
      {:ok, nil} -> GenServer.start_link(__MODULE__, opts)
      {:ok, name} -> GenServer.start_link(__MODULE__, opts, name: name)
      :error -> GenServer.start_link(__MODULE__, opts)
    end
  end

  def logs(server, count), do: GenServer.call(server, {:logs, count})

  @impl true
  def init(opts) do
    state = %{
      server_id: Keyword.fetch!(opts, :server_id),
      path: Path.join([Keyword.fetch!(opts, :directory), "logs", "latest.log"]),
      poll_ms: Keyword.get(opts, :poll_ms, 200),
      offset: 0,
      partial: "",
      lines: :queue.new(),
      count: 0
    }

    schedule_poll(state)
    {:ok, state}
  end

  @impl true
  def handle_call({:logs, count}, _from, state) do
    lines = state.lines |> :queue.to_list() |> Enum.take(-count)
    {:reply, lines, state}
  end

  @impl true
  def handle_info(:poll, state) do
    state = poll(state)
    schedule_poll(state)
    {:noreply, state}
  end

  defp schedule_poll(state), do: Process.send_after(self(), :poll, state.poll_ms)

  defp poll(state) do
    case File.stat(state.path) do
      {:ok, %{size: size}} when size < state.offset ->
        poll(%{state | offset: 0, partial: ""})

      {:ok, %{size: size}} when size > state.offset ->
        read_new_bytes(state, size)

      _ ->
        state
    end
  end

  defp read_new_bytes(state, size) do
    case File.open(state.path, [:read, :binary]) do
      {:ok, io} ->
        {:ok, _} = :file.position(io, state.offset)
        data = IO.binread(io, size - state.offset)
        File.close(io)
        ingest(%{state | offset: size}, state.partial <> data)

      {:error, _} ->
        state
    end
  end

  defp ingest(state, data) do
    parts = String.split(data, "\n")
    {complete, [partial]} = Enum.split(parts, -1)
    now = DateTime.utc_now()

    Enum.reduce(complete, %{state | partial: partial}, fn
      "", acc ->
        acc

      raw, acc ->
        line = LogLine.parse(raw, now)
        Event.broadcast(acc.server_id, :log, line)
        push_line(acc, line)
    end)
  end

  defp push_line(state, line) do
    lines = :queue.in(line, state.lines)

    if state.count >= @max_lines do
      {_, lines} = :queue.out(lines)
      %{state | lines: lines}
    else
      %{state | lines: lines, count: state.count + 1}
    end
  end
end
