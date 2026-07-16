defmodule Allay.Servers.RestartWorker do
  @moduledoc """
  Oban worker that performs one scheduled restart. Enqueued by
  `Allay.Servers.RestartTick`, dedupe-guarded per server.

  `max_attempts: 1`: a scheduled restart must never retry-loop. A server gone
  → `{:cancel, :server_deleted}`; a server that isn't running → `:ok` (skip,
  legacy parity — only running servers are restarted); otherwise stop, wait for
  the runtime to reach a terminal state, re-fetch the row, and start under the
  system scope. A failed start returns an error but, with no retries, simply
  stops there (legacy logged and moved on).

  The stop is asynchronous (RCON `stop`, then SIGTERM/SIGKILL); the runtime
  stays `:stopping` until the OS process exits. Starting immediately would hit
  Runtime's live-state guard (`:stopping` is live) and return
  `{:error, :already_running}`. So we poll for `:stopped`/`:crashed` before
  starting, bounded by a deadline.
  """

  use Oban.Worker, queue: :restarts, unique: [period: 55, keys: [:server_id]], max_attempts: 1

  require Logger

  alias Allay.Accounts.Scope
  alias Allay.Runtime
  alias Allay.Servers

  @default_deadline_ms 45_000
  @poll_interval_ms 100
  @terminal_states [:stopped, :crashed]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"server_id" => server_id}}) do
    scope = Scope.system()

    case Servers.get_server(scope, server_id) do
      {:error, :not_found} ->
        {:cancel, :server_deleted}

      {:ok, _server} ->
        if Runtime.status(server_id).state == :running do
          restart(scope, server_id)
        else
          :ok
        end
    end
  end

  defp restart(scope, server_id) do
    with {:ok, _} <- Servers.stop_server_process(scope, server_id),
         :ok <- await_stopped(server_id),
         {:ok, _} <- Servers.start_server(scope, server_id, start_opts()) do
      :ok
    else
      {:error, :stop_timeout} ->
        Logger.error(
          "RestartWorker: server #{server_id} did not stop within the deadline; not restarting"
        )

        {:error, :stop_timeout}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp await_stopped(server_id) do
    deadline = System.monotonic_time(:millisecond) + deadline_ms()
    poll_until_stopped(server_id, deadline)
  end

  defp poll_until_stopped(server_id, deadline) do
    if Runtime.status(server_id).state in @terminal_states do
      :ok
    else
      if System.monotonic_time(:millisecond) >= deadline do
        {:error, :stop_timeout}
      else
        Process.sleep(@poll_interval_ms)
        poll_until_stopped(server_id, deadline)
      end
    end
  end

  defp deadline_ms do
    Application.get_env(:allay, :restart_deadline_ms, @default_deadline_ms)
  end

  # Same seam the lifecycle controller uses: `[]` in production, test overrides
  # (FakeRcon, compressed timeouts) injected via app env.
  defp start_opts, do: Application.get_env(:allay, :lifecycle_start_opts, [])
end
