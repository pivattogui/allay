defmodule Allay.Servers.Import do
  @moduledoc """
  Internal orchestration for the archive-import flow: analyze an uploaded
  archive, then extract a selected subset into a live server directory behind
  a pre-import backup that doubles as the rollback.

  `execute/5` is the transactional entry point. Its ordering mirrors the legacy
  import route:

    1. Refuse while the server is running/starting (`:server_busy`).
    2. Resolve the staged archive and re-analyze (entries + categories).
    3. Resolve the selection; an empty result is `:empty_selection`.
    4. Take a `"pre-import"` backup; a backup failure aborts before any change.
    5. Delete the selected world directories from the live server dir, then
       extract the selection. Any extract failure restores the pre-import
       backup (rollback) and surfaces `{:import_failed, reason}`.
    6. On success, if `server.properties` was imported, re-inject the RCON keys
       from the DB row (delta below), delete the session, and report.

  RCON re-injection (delta vs legacy): the Elixir runtime drives servers over
  RCON, so an imported `server.properties` that disables RCON or carries a
  foreign port/password would break console access. After a successful import
  that includes `server.properties`, `enable-rcon`, `rcon.port` and
  `rcon.password` are rewritten from the server row. The legacy backend had no
  RCON dependency and therefore no such step.
  """

  require Logger

  alias Allay.Accounts.Scope
  alias Allay.Backups
  alias Allay.Minecraft.Properties
  alias Allay.Runtime
  alias Allay.Servers
  alias Allay.Servers.Files.PathSandbox
  alias Allay.Servers.Import.Analyzer
  alias Allay.Servers.Import.Extractor
  alias Allay.Servers.Import.Session
  alias Allay.Servers.OperationLock

  @doc false
  def begin(%Scope{} = scope, server_id, filename, opts \\ []) do
    runtime = Keyword.get(opts, :runtime, Runtime)

    with {:ok, _server} <- Servers.get_server(scope, server_id),
         :ok <- ensure_not_busy(runtime, server_id),
         :ok <- Session.sweep(opts) do
      Session.start_upload(filename, opts)
    end
  end

  @doc false
  def analyze(import_id, opts \\ []) do
    with {:ok, archive_path} <- Session.archive_path(import_id, opts) do
      Analyzer.analyze(archive_path)
    end
  end

  @doc false
  def discard(import_id, opts \\ []) do
    Session.delete(import_id, opts)
  end

  @doc """
  Runs the import for `import_id` against `server_id` with `selection`.

  `opts` accepts `:data_dir` and `:runtime` (test seams, threaded to the
  Session, Backups and busy guard). Returns
  `{:ok, %{backup_id: id, imported_paths: [...]}}` or one of
  `{:error, :server_busy | :import_not_found | :empty_selection | :not_found}`,
  `{:error, {:backup_failed, output}}`, `{:error, {:import_failed, reason}}`.
  """
  def execute(%Scope{} = scope, server_id, import_id, selection, opts \\ []) do
    OperationLock.run(server_id, :import, fn ->
      execute_locked(scope, server_id, import_id, selection, opts)
    end)
  end

  defp execute_locked(scope, server_id, import_id, selection, opts) do
    runtime = Keyword.get(opts, :runtime, Runtime)

    with {:ok, server} <- Servers.get_server(scope, server_id),
         :ok <- ensure_not_busy(runtime, server_id),
         {:ok, archive_path} <- Session.archive_path(import_id, opts),
         {:ok, analysis} <- Analyzer.analyze(archive_path),
         {:ok, selected} <- resolve(analysis, selection),
         {:ok, backup} <- pre_import_backup(scope, server_id, opts) do
      run_import(%{
        scope: scope,
        server: server,
        server_id: server_id,
        backup: backup,
        archive_path: archive_path,
        analysis: analysis,
        selected: selected,
        import_id: import_id,
        opts: opts
      })
    end
  end

  defp ensure_not_busy(runtime, server_id) do
    if runtime.status(server_id).state in [:running, :starting],
      do: {:error, :server_busy},
      else: :ok
  end

  defp resolve(analysis, selection) do
    case Extractor.select_paths(analysis.categories, selection, analysis.entries) do
      [] -> {:error, :empty_selection}
      paths -> {:ok, paths}
    end
  end

  defp pre_import_backup(scope, server_id, opts) do
    backup_opts = Keyword.take(opts, [:data_dir, :runtime, :tar_cmd, :save_wait_ms])

    case Backups.create_backup(scope, server_id, "pre-import", backup_opts) do
      {:ok, backup} -> {:ok, backup}
      {:error, {:backup_failed, output}} -> {:error, {:backup_failed, output}}
      {:error, reason} -> {:error, {:backup_failed, reason}}
    end
  end

  defp run_import(ctx) do
    %{server: server, analysis: analysis, selected: selected, backup: backup} = ctx
    needs_wrap = Extractor.needs_world_wrap?(analysis.entries, selected)
    delete_selected_world_dirs(server.directory, analysis.categories.world, selected, needs_wrap)

    case Extractor.extract_selection(
           ctx.archive_path,
           analysis.entries,
           selected,
           server.directory,
           analysis.root
         ) do
      {:ok, imported_paths} ->
        reinject_rcon(server, imported_paths)
        Session.delete(ctx.import_id, ctx.opts)
        {:ok, %{backup_id: backup.id, imported_paths: imported_paths}}

      {:error, reason} ->
        rollback(ctx.scope, ctx.server_id, backup.id, ctx.opts)
        {:error, {:import_failed, reason}}
    end
  end

  # Importing world content must REPLACE the destination world, not merge into
  # it — otherwise stale files the new archive lacks (player data, old region
  # chunks) survive and the player still sees the old map. So we remove the
  # whole destination world directory (e.g. `world/`) before extracting, not
  # just the sub-paths the new archive happens to contain. Only world dirs that
  # are part of this selection are cleared, so a selective re-import of one
  # dimension never wipes the others.
  defp delete_selected_world_dirs(server_dir, world_prefixes, selected, needs_wrap) do
    server_dir
    |> destination_world_dirs(world_prefixes, selected, needs_wrap)
    |> Enum.each(fn dir ->
      case PathSandbox.resolve(server_dir, dir) do
        {:ok, full, _rel} -> File.rm_rf(full)
        {:error, _} -> :ok
      end
    end)
  end

  # A bare/rooted-world layout (needs_wrap) lands everything under `world/`, so
  # the single destination dir is `world` when any world content is selected.
  # Otherwise each selected top-level world dir (`world/`, `world_nether/`, …)
  # is its own destination.
  defp destination_world_dirs(_server_dir, world_prefixes, selected, true) do
    if Enum.any?(world_prefixes, fn p -> Enum.any?(selected, &String.starts_with?(&1, p)) end),
      do: ["world"],
      else: []
  end

  defp destination_world_dirs(_server_dir, world_prefixes, selected, false) do
    world_prefixes
    |> Enum.filter(fn prefix ->
      String.ends_with?(prefix, "/") and Enum.any?(selected, &String.starts_with?(&1, prefix))
    end)
    |> Enum.map(&(&1 |> String.split("/") |> hd()))
    |> Enum.uniq()
  end

  defp rollback(scope, server_id, backup_id, opts) do
    restore_opts = Keyword.take(opts, [:data_dir, :runtime])

    case Backups.restore_backup(scope, server_id, backup_id, restore_opts) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.error("import rollback failed for #{server_id}: #{inspect(reason)}")
    end
  end

  defp reinject_rcon(server, imported_paths) do
    if "server.properties" in imported_paths do
      path = Path.join(server.directory, "server.properties")
      raw = if File.exists?(path), do: File.read!(path), else: ""

      updated =
        raw
        |> Properties.put_key("enable-rcon", "true")
        |> Properties.put_key("rcon.port", to_string(server.rcon_port))
        |> Properties.put_key("rcon.password", server.rcon_password)

      File.write!(path, updated)
    end
  end
end
