defmodule Allay.Runtime.MetricsSampler do
  @moduledoc """
  CPU/RAM via `ps` (portable, no NIF) plus player counting from the
  log stream. Join/leave matching requires the message to be exactly
  `Name joined|left the game` — the legacy substring match counted
  chat messages quoting the phrase.
  """

  use GenServer

  alias Allay.Runtime.Event

  @join_leave ~r/^\S+ (?<verb>joined|left) the game$/
  @list_output ~r/There are (?<count>\d+) of a max of (?<max>\d+) players online/
  @max_players ~r/max-players[=:]?\s*(?<max>\d+)/i

  def start_link(opts) do
    case Keyword.get(opts, :name) do
      nil -> GenServer.start_link(__MODULE__, opts)
      name -> GenServer.start_link(__MODULE__, opts, name: name)
    end
  end

  @doc "Returns the current player count tracked by this sampler."
  @spec current_players(GenServer.server()) :: non_neg_integer()
  def current_players(server), do: GenServer.call(server, :current_players)

  @impl true
  def init(opts) do
    server_id = Keyword.fetch!(opts, :server_id)
    Phoenix.PubSub.subscribe(Allay.PubSub, Event.topic(server_id))

    state = %{
      server_id: server_id,
      os_pid: Keyword.fetch!(opts, :os_pid),
      ram_max_mb: Keyword.fetch!(opts, :ram_max_mb),
      interval_ms: Keyword.get(opts, :interval_ms, 5_000),
      cores: Keyword.get(opts, :cores, System.schedulers_online()),
      ps_fun: Keyword.get(opts, :ps_fun, &default_ps/1),
      player_count: 0,
      player_max: 20,
      last_sample: nil
    }

    send(self(), :sample)
    {:ok, state}
  end

  @impl true
  def handle_call(:current_players, _from, state) do
    {:reply, state.player_count, state}
  end

  @impl true
  def handle_info(:sample, state) do
    state =
      case state.ps_fun.(state.os_pid) do
        {:ok, %{rss_kb: rss_kb, cpu_percent: cpu}} ->
          # Legacy parity: pidusage cpu was divided by os.cpus().length;
          # ps pcpu is the same per-single-core percentage scale.
          sample = %{
            ram_used_mb: round(rss_kb / 1024),
            cpu_percent: Float.round(cpu / state.cores, 1)
          }

          broadcast(%{state | last_sample: sample})

        {:error, _} ->
          state
      end

    Process.send_after(self(), :sample, state.interval_ms)
    {:noreply, state}
  end

  def handle_info(%Event{type: :log, data: %{message: message}}, state) do
    {:noreply, track_players(state, message)}
  end

  def handle_info(%Event{}, state), do: {:noreply, state}

  defp track_players(state, message) do
    cond do
      captures = Regex.named_captures(@join_leave, message) ->
        delta = if captures["verb"] == "joined", do: 1, else: -1
        state = %{state | player_count: max(state.player_count + delta, 0)}
        broadcast_if_sampled(state)

      captures = Regex.named_captures(@list_output, message) ->
        state = %{
          state
          | player_count: String.to_integer(captures["count"]),
            player_max: String.to_integer(captures["max"])
        }

        broadcast_if_sampled(state)

      captures = Regex.named_captures(@max_players, message) ->
        %{state | player_max: String.to_integer(captures["max"])}

      true ->
        state
    end
  end

  defp broadcast_if_sampled(%{last_sample: nil} = state), do: state
  defp broadcast_if_sampled(state), do: broadcast(state)

  defp broadcast(state) do
    Event.broadcast(state.server_id, :metrics, %{
      timestamp: DateTime.utc_now(),
      ram_used_mb: state.last_sample.ram_used_mb,
      ram_max_mb: state.ram_max_mb,
      cpu_percent: state.last_sample.cpu_percent,
      player_count: state.player_count,
      player_max: state.player_max
    })

    state
  end

  defp default_ps(os_pid) do
    case System.cmd("ps", ["-o", "rss=,pcpu=", "-p", Integer.to_string(os_pid)]) do
      {output, 0} ->
        [rss, cpu] = output |> String.trim() |> String.split(~r/\s+/, parts: 2)
        {:ok, %{rss_kb: String.to_integer(rss), cpu_percent: parse_float(cpu)}}

      _ ->
        {:error, :dead}
    end
  end

  defp parse_float(string) do
    case Float.parse(string) do
      {float, _} -> float
      :error -> 0.0
    end
  end
end
