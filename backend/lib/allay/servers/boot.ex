defmodule Allay.Servers.Boot do
  @moduledoc """
  Boot-time runtime warmup: discovers installed Java runtimes, then starts
  every server flagged `auto_start` (legacy parity). Runs as a temporary Task
  in the supervision tree AFTER `Runtime.Supervisor` and `JavaRegistry`.

  Per-server failures are logged and skipped — one broken server must never
  prevent the rest from starting or crash the application boot.

  Skipped entirely in test (`:boot_autostart` false) so the Ecto sandbox is not
  touched at app boot; `run/1` is exercised directly by the test suite.
  """

  require Logger

  alias Allay.Accounts.Scope
  alias Allay.Repo
  alias Allay.Servers
  alias Allay.Servers.JavaRegistry
  alias Allay.Servers.Server

  import Ecto.Query

  def child_spec(_opts) do
    %{
      id: __MODULE__,
      start: {Task, :start_link, [&boot/0]},
      restart: :temporary,
      type: :worker
    }
  end

  defp boot do
    if Application.get_env(:allay, :boot_autostart, true) do
      run([])
    else
      :ok
    end
  end

  @doc """
  Discovers Java runtimes, then starts all `auto_start` servers sequentially.

  `opts` are forwarded to `Servers.start_server/3` (e.g. `:spec_overrides` for
  tests). Always returns `:ok`; per-server errors are logged.
  """
  @spec run(keyword()) :: :ok
  def run(opts \\ []) do
    JavaRegistry.discover()

    auto_start_servers()
    |> Enum.each(&start_one(&1, opts))

    :ok
  end

  # The DB may be unreachable at boot (e.g. Postgres still coming up). The panel
  # must still boot — auto-start is skipped and the user starts servers manually
  # once the DB recovers. No retry: a retry loop here would block the boot Task.
  defp auto_start_servers do
    Repo.all(from s in Server, where: s.auto_start == true)
  rescue
    e ->
      Logger.error(
        "Auto-start skipped: could not load servers (#{Exception.message(e)}). " <>
          "Panel boots; start servers manually once the database is reachable."
      )

      []
  end

  defp start_one(%Server{} = server, opts) do
    case Servers.start_server(Scope.system(), server.id, opts) do
      {:ok, _status} ->
        Logger.info("Auto-started server #{server.id} (#{server.name})")

      {:error, reason} ->
        Logger.error("Auto-start failed for server #{server.id}: #{inspect(reason)}")
    end
  rescue
    e ->
      Logger.error("Auto-start crashed for server #{server.id}: #{Exception.message(e)}")
  end
end
