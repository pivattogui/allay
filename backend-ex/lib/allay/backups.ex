defmodule Allay.Backups do
  @moduledoc """
  Context for server backups: create (tar.gz of the server directory),
  list, retention, restore, delete, and download support, plus the
  per-server backup config. All public functions take `%Allay.Accounts.Scope{}`
  first (Phoenix 1.8 convention).

  Archive mechanics mirror the legacy manager exactly: the row is inserted
  `pending`/0 bytes BEFORE tar runs (the UI polls in-flight backups), jars are
  always excluded and logs excluded unless `include_logs`, tar exit 0 or 1 is
  treated as success (1 = "file changed while reading", routine on a live
  server), and `save-on` is guaranteed by `try/after` even when the archive
  fails.
  """

  import Ecto.Query

  require Logger

  alias Allay.Accounts.Scope
  alias Allay.Backups.Backup
  alias Allay.Backups.BackupConfig
  alias Allay.Repo
  alias Allay.Runtime
  alias Allay.Servers

  @default_save_wait_ms 3_000
  @default_max_backups 10

  @doc """
  Creates a backup archive of the server's directory.

  `type` is "manual" | "scheduled" | "pre-import". `opts`:

    * `:data_dir` — overrides the configured data directory (tests).
    * `:runtime` — module implementing `status/1` and `send_command/2`
      (default `Allay.Runtime`); test seam for the running-server branch.
    * `:save_wait_ms` — milliseconds to sleep after `save-all` (default 3000),
      compressible in tests.

  Returns `{:ok, %Backup{}}`, `{:error, :not_found}` for an unknown server, or
  `{:error, {:backup_failed, output}}` when tar fails.
  """
  def create_backup(%Scope{} = scope, server_id, type \\ "manual", opts \\ []) do
    with {:ok, server} <- Servers.get_server(scope, server_id) do
      runtime = Keyword.get(opts, :runtime, Runtime)
      running? = runtime.status(server_id).state == :running

      if running? do
        # Errors here are ignored on purpose: a flaky console must not block the
        # archive. The save-on counterpart is guaranteed by the try/after below.
        runtime.send_command(server_id, "save-off")
        runtime.send_command(server_id, "save-all")
        Process.sleep(Keyword.get(opts, :save_wait_ms, @default_save_wait_ms))
      end

      try do
        run_backup(server, type, opts)
      after
        if running?, do: runtime.send_command(server_id, "save-on")
      end
    end
  end

  defp run_backup(server, type, opts) do
    data_dir = data_dir(opts)
    backups_dir = Path.join(data_dir, "backups")
    File.mkdir_p!(backups_dir)

    filename = "#{server.id}_#{timestamp()}.tar.gz"
    archive_path = Path.join(backups_dir, filename)

    backup =
      Repo.insert!(%Backup{
        server_id: server.id,
        filename: filename,
        size_bytes: 0,
        type: type,
        status: "pending"
      })

    case run_tar(server, archive_path, opts) do
      :ok ->
        size = file_size(archive_path)

        completed =
          Repo.update!(Ecto.Changeset.change(backup, status: "completed", size_bytes: size))

        apply_retention(server.id, data_dir)
        {:ok, completed}

      {:error, output} ->
        File.rm(archive_path)
        Repo.update!(Ecto.Changeset.change(backup, status: "failed"))
        {:error, {:backup_failed, output}}
    end
  end

  # tar argv: excludes MUST precede -C/paths — bsdtar (macOS) otherwise treats
  # them as file operands and errors. Exit 0 or 1 = success (1 is a benign
  # "file changed while reading" on a live server); >1 is a real failure.
  # `opts[:tar_cmd]` (default "tar") is a test seam to force the >1 branch —
  # bsdtar collapses almost every error class to exit 1, so a real failure is
  # not reproducible from the filesystem on macOS.
  defp run_tar(server, archive_path, opts) do
    parent = Path.dirname(server.directory)
    base = Path.basename(server.directory)

    args =
      ["-czf", archive_path] ++
        exclude_args(server.id) ++
        ["-C", parent, base]

    case System.cmd(Keyword.get(opts, :tar_cmd, "tar"), args, stderr_to_stdout: true) do
      {_output, code} when code in [0, 1] -> :ok
      {output, _code} -> {:error, output}
    end
  end

  defp exclude_args(server_id) do
    base = ["--exclude=*.jar"]
    if include_logs?(server_id), do: base, else: base ++ ["--exclude=logs"]
  end

  # No config row → logs excluded (legacy `backupConfig?.includeLogs` is falsy).
  defp include_logs?(server_id) do
    case Repo.get_by(BackupConfig, server_id: server_id) do
      nil -> false
      config -> config.include_logs
    end
  end

  @doc """
  Lists a server's backups, newest first.
  """
  def list_backups(%Scope{}, server_id) do
    Repo.all(from b in Backup, where: b.server_id == ^server_id, order_by: [desc: b.inserted_at])
  end

  @doc """
  Fetches a single backup row scoped to `server_id`.

  Returns `{:ok, %Backup{}}` or `{:error, :backup_not_found}` (also for an
  invalid UUID, no crash on malformed input).
  """
  def get_backup(%Scope{}, server_id, backup_id) do
    case Ecto.UUID.cast(backup_id) do
      {:ok, uuid} ->
        case Repo.get_by(Backup, id: uuid, server_id: server_id) do
          nil -> {:error, :backup_not_found}
          backup -> {:ok, backup}
        end

      :error ->
        {:error, :backup_not_found}
    end
  end

  # Retention runs after a successful create. No config row → skip entirely
  # (legacy parity). Otherwise keep `max_backups` (||10) newest rows of ANY
  # status/type; per-item failures are swallowed so one bad unlink can't strand
  # the rest.
  defp apply_retention(server_id, data_dir) do
    case Repo.get_by(BackupConfig, server_id: server_id) do
      nil ->
        :ok

      config ->
        max = config.max_backups || @default_max_backups

        from(b in Backup, where: b.server_id == ^server_id, order_by: [desc: b.inserted_at])
        |> Repo.all()
        |> Enum.drop(max)
        |> Enum.each(&prune_backup(&1, data_dir))
    end
  end

  defp prune_backup(%Backup{} = backup, data_dir) do
    path = Path.join([data_dir, "backups", backup.filename])
    File.rm(path)
    Repo.delete(backup)
  rescue
    error ->
      Logger.warning("backup retention prune failed for #{backup.id}: #{inspect(error)}")
      :ok
  end

  @doc """
  Returns the server's backup config or `nil` when absent.
  """
  def get_config(%Scope{}, server_id) do
    Repo.get_by(BackupConfig, server_id: server_id)
  end

  @doc """
  Applies a partial update to the server's backup config. The row must already
  exist (legacy never created one via the API).

  Returns `{:ok, %BackupConfig{}}`, `{:error, %Ecto.Changeset{}}`, or
  `{:error, :not_found}` when no config row exists.
  """
  def update_config(%Scope{}, server_id, attrs) do
    case Repo.get_by(BackupConfig, server_id: server_id) do
      nil ->
        {:error, :not_found}

      config ->
        config
        |> BackupConfig.changeset(attrs)
        |> Repo.update()
    end
  end

  defp timestamp do
    DateTime.utc_now()
    |> DateTime.to_iso8601()
    |> String.replace(~r/[:.]/, "-")
  end

  defp file_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} -> size
      {:error, _} -> 0
    end
  end

  defp data_dir(opts) do
    Keyword.get(opts, :data_dir) || Application.fetch_env!(:allay, :data_dir)
  end
end
