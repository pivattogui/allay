defmodule Allay.Servers do
  @moduledoc """
  Context for Minecraft server management, including lifecycle, configuration,
  sandboxed files, and archive imports. Public functions that operate on a
  server take `%Allay.Accounts.Scope{}` as the first argument.
  """

  import Ecto.Query

  alias Allay.Accounts.Scope
  alias Allay.Backups
  alias Allay.Minecraft.JarCache
  alias Allay.Minecraft.Properties
  alias Allay.Minecraft.Versions
  alias Allay.Repo
  alias Allay.Runtime
  alias Allay.Servers.Files
  alias Allay.Servers.Import
  alias Allay.Servers.JavaGate
  alias Allay.Servers.Provisioner
  alias Allay.Servers.RuntimeBridge
  alias Allay.Servers.Server

  @active_states [:running, :starting]
  @migratable_types ["vanilla", "paper"]
  @unstoppable_states [:stopped, :stopping]
  @rcon_port_offset 10_000

  @doc """
  Returns all servers ordered by insertion time, newest first.
  """
  def list_servers(%Scope{}) do
    Repo.all(from s in Server, order_by: [desc: s.inserted_at])
  end

  @doc """
  Fetches a single server by id.

  Returns `{:ok, server}` on success, `{:error, :not_found}` for unknown ids
  or invalid UUID strings (no crash on malformed input).
  """
  def get_server(%Scope{}, id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} ->
        case Repo.get(Server, uuid) do
          nil -> {:error, :not_found}
          server -> {:ok, server}
        end

      :error ->
        {:error, :not_found}
    end
  end

  @doc """
  Provisions a new server. Delegates to `Allay.Servers.Provisioner`.

  `opts` accepts `:data_dir` to override the configured data directory (tests).
  """
  def create_server(%Scope{} = scope, attrs, opts \\ []) do
    Provisioner.provision(scope, attrs, opts)
  end

  @doc "Lists entries in a directory within a server's sandboxed filesystem."
  def list_entries(%Scope{} = scope, server_id, relative_path \\ "") do
    Files.list_entries(scope, server_id, relative_path)
  end

  @doc "Reads a file within a server's sandboxed filesystem."
  def read_file(%Scope{} = scope, server_id, relative_path, encoding) do
    Files.read_file(scope, server_id, relative_path, encoding)
  end

  @doc "Writes a file within a server's sandboxed filesystem."
  def write_file(%Scope{} = scope, server_id, relative_path, content) do
    Files.write_file(scope, server_id, relative_path, content)
  end

  @doc "Creates a directory within a server's sandboxed filesystem."
  def mkdir(%Scope{} = scope, server_id, relative_path) do
    Files.mkdir(scope, server_id, relative_path)
  end

  @doc "Deletes a file or directory within a server's sandboxed filesystem."
  def delete_path(%Scope{} = scope, server_id, relative_path) do
    Files.delete_path(scope, server_id, relative_path)
  end

  @doc "Moves a file or directory within a server's sandboxed filesystem."
  def rename_path(%Scope{} = scope, server_id, old_path, new_path) do
    Files.rename_path(scope, server_id, old_path, new_path)
  end

  @doc "Resolves a sandboxed server file for download."
  def download_path(%Scope{} = scope, server_id, relative_path) do
    Files.download_path(scope, server_id, relative_path)
  end

  @doc "Stores uploaded files within a server's sandboxed filesystem."
  def save_uploads(%Scope{} = scope, server_id, relative_path, uploads) do
    Files.save_uploads(scope, server_id, relative_path, uploads)
  end

  @doc "Starts a staged archive import for a stopped server."
  def begin_import(%Scope{} = scope, server_id, filename, opts \\ []) do
    Import.begin(scope, server_id, filename, opts)
  end

  @doc "Analyzes a staged server archive."
  def analyze_import(import_id, opts \\ []) do
    Import.analyze(import_id, opts)
  end

  @doc "Discards a staged server archive."
  def discard_import(import_id, opts \\ []) do
    Import.discard(import_id, opts)
  end

  @doc "Imports selected archive contents into a stopped server."
  def execute_import(%Scope{} = scope, server_id, import_id, selection, opts \\ []) do
    Import.execute(scope, server_id, import_id, selection, opts)
  end

  @doc """
  Updates a server's editable fields (name, port, ram, flags). On a port
  change, syncs `server-port` in the on-disk `server.properties` file (legacy
  PATCH /:id parity).

  Returns `{:ok, server}`, `{:error, :not_found}`, `{:error, :port_in_use}` for
  a duplicate port, or `{:error, changeset}` for validation failures.
  """
  def update_server(%Scope{} = scope, id, attrs) do
    with {:ok, server} <- get_server(scope, id),
         changeset = server |> Server.update_changeset(attrs) |> put_rcon_port_change(),
         {:ok, updated} <- persist(changeset) do
      sync_port_properties(server, updated)
      {:ok, updated}
    end
  end

  # When the game port moves, the derived RCON port moves with it (port +
  # offset) so a freed game port doesn't strand its RCON port and block a
  # later server from claiming it. No-op when the port isn't changing.
  defp put_rcon_port_change(%Ecto.Changeset{} = changeset) do
    case Ecto.Changeset.get_change(changeset, :port) do
      nil -> changeset
      new_port -> Ecto.Changeset.put_change(changeset, :rcon_port, new_port + @rcon_port_offset)
    end
  end

  @doc """
  Updates a server's config fields (name, ram, jvm_args, java_path, flags,
  restart_limit, restart_schedule). Returns `{:ok, server, needs_restart}`.

  `needs_restart` is true only when the server is running AND one of ram,
  jvm_args, or java_path changed (legacy PATCH /:id/config parity).
  """
  def update_server_config(%Scope{} = scope, id, attrs) do
    with {:ok, server} <- get_server(scope, id),
         changeset = Server.config_changeset(server, attrs),
         {:ok, updated} <- persist(changeset) do
      # Plan 5: restart_scheduler live re-registration on restart_schedule change.
      {:ok, updated, needs_restart?(id, changeset)}
    end
  end

  @doc """
  Persists the server's `icon_path` column. Pass `nil` to clear it. The
  on-disk icon file is managed by the caller (controller). Returns `:ok`.
  """
  def set_icon_path(%Scope{} = scope, id, icon_path) do
    with {:ok, server} <- get_server(scope, id) do
      server
      |> Ecto.Changeset.change(icon_path: icon_path)
      |> Repo.update()
      |> case do
        {:ok, _} -> :ok
        {:error, changeset} -> {:error, changeset}
      end
    end
  end

  @doc """
  Returns the server's parsed `server.properties` as a `{key => value}` map.
  An absent file yields `{:ok, %{}}` (legacy GET /:id/properties parity).
  """
  def get_properties(%Scope{} = scope, id) do
    with {:ok, server} <- get_server(scope, id) do
      path = Path.join(server.directory, "server.properties")

      case File.read(path) do
        {:ok, raw} -> {:ok, Properties.parse(raw)}
        {:error, _} -> {:ok, %{}}
      end
    end
  end

  @doc """
  Serializes `props` (a full key-value map) to the server's `server.properties`,
  replacing the file. If the map carries a differing `server-port`, the DB port
  follows it (and `rcon_port`); a port already held by another server is surfaced
  as `port_conflict: true` and the DB is left untouched (legacy silently skipped
  the update — here the conflict is reported).

  Returns `{:ok, %{needs_restart: bool, port_conflict: bool}}`.
  """
  def put_properties(%Scope{} = scope, id, props) when is_map(props) do
    with {:ok, server} <- get_server(scope, id) do
      needs_restart = Runtime.status(id).state == :running
      File.write!(properties_path(server), Properties.serialize(props))
      port_conflict = sync_db_port(server, props["server-port"])
      {:ok, %{needs_restart: needs_restart, port_conflict: port_conflict}}
    end
  end

  @doc """
  Returns the raw `server.properties` content verbatim (comment-preserving).
  `{:error, :properties_not_found}` when the file is absent.
  """
  def get_properties_raw(%Scope{} = scope, id) do
    with {:ok, server} <- get_server(scope, id) do
      case File.read(properties_path(server)) do
        {:ok, raw} -> {:ok, raw}
        {:error, _} -> {:error, :properties_not_found}
      end
    end
  end

  @doc """
  Writes `content` verbatim to `server.properties`. Port-sync semantics match
  `put_properties/3`, with the new port parsed from the raw content.

  `needs_restart` is captured BEFORE the write (legacy raw-endpoint parity).
  Returns `{:ok, %{needs_restart: bool, port_conflict: bool}}`.
  """
  def put_properties_raw(%Scope{} = scope, id, content) when is_binary(content) do
    with {:ok, server} <- get_server(scope, id) do
      needs_restart = Runtime.status(id).state == :running
      File.write!(properties_path(server), content)

      port_conflict =
        sync_db_port(server, content |> Properties.parse() |> Map.get("server-port"))

      {:ok, %{needs_restart: needs_restart, port_conflict: port_conflict}}
    end
  end

  defp properties_path(%Server{directory: directory}) do
    Path.join(directory, "server.properties")
  end

  # Reconciles the DB port with a `server-port` value supplied via properties.
  # Returns true only when the requested port is held by another server (the
  # caller surfaces this as port_conflict); the on-disk file already carries
  # the user's value regardless. No DB write happens on no-change or conflict.
  defp sync_db_port(_server, nil), do: false

  defp sync_db_port(%Server{} = server, raw_port) do
    case Integer.parse(raw_port) do
      {new_port, ""} when new_port != server.port ->
        if port_held_by_other?(new_port, server.id) do
          true
        else
          server
          |> Ecto.Changeset.change(
            port: new_port,
            rcon_port: new_port + @rcon_port_offset
          )
          |> Repo.update!()

          false
        end

      _ ->
        false
    end
  end

  defp port_held_by_other?(port, server_id) do
    Repo.exists?(from s in Server, where: s.port == ^port and s.id != ^server_id)
  end

  defp persist(changeset) do
    case Repo.update(changeset) do
      {:ok, server} -> {:ok, server}
      {:error, changeset} -> map_changeset_error(changeset)
    end
  end

  # A unique_constraint violation on port surfaces as a changeset error keyed
  # :port; translate it to the typed :port_in_use the FallbackController maps
  # to 409 PORT_IN_USE (distinct from a 400 VALIDATION_ERROR).
  defp map_changeset_error(%Ecto.Changeset{errors: errors} = changeset) do
    case errors[:port] do
      {_msg, opts} ->
        if Keyword.get(opts, :constraint) == :unique,
          do: {:error, :port_in_use},
          else: {:error, changeset}

      _ ->
        {:error, changeset}
    end
  end

  defp sync_port_properties(%Server{port: old_port}, %Server{port: new_port})
       when old_port == new_port,
       do: :ok

  defp sync_port_properties(_old, %Server{
         directory: directory,
         port: new_port,
         rcon_port: new_rcon_port
       }) do
    path = Path.join(directory, "server.properties")

    case File.read(path) do
      {:ok, raw} ->
        updated =
          raw
          |> Properties.put_key("server-port", new_port)
          |> Properties.put_key("rcon.port", new_rcon_port)

        File.write(path, updated)

      {:error, _} ->
        :ok
    end
  end

  @restart_keys [:ram_min_mb, :ram_max_mb, :jvm_args, :java_path]

  defp needs_restart?(id, changeset) do
    running? = Runtime.status(id).state == :running
    touched_runtime? = Enum.any?(@restart_keys, &Map.has_key?(changeset.changes, &1))
    running? and touched_runtime?
  end

  @doc """
  Resolves a runtime spec for the server and starts its process.

  `opts` accepts `:env` (passed to the runtime) and `:spec_overrides` (a
  keyword merged into the built `%Runtime.Spec{}`, test seam). Runtime preflight
  errors (`:server_jar_not_found`, `:server_dir_not_found`) pass through;
  `:already_running` maps to `{:error, :already_running}`.

  Returns `{:ok, status_map}` once the instance is started.
  """
  def start_server(%Scope{} = scope, id, opts \\ []) do
    with {:ok, server} <- get_server(scope, id),
         {:ok, spec} <- RuntimeBridge.build_spec(server, opts),
         {:ok, _pid} <- Runtime.start_server(spec, opts[:env] || []) do
      {:ok, Runtime.status(id)}
    end
  end

  @doc """
  Stops the server's running process gracefully.

  Returns `{:error, :not_running}` when the instance is already stopped or
  stopping (legacy guard parity: a crashed instance IS stoppable). Otherwise
  returns `{:ok, status_map}`.

  Named `stop_server_process` to avoid clashing with delete semantics; the
  controller maps it to the stop route.
  """
  def stop_server_process(%Scope{} = scope, id) do
    with {:ok, _server} <- get_server(scope, id) do
      if Runtime.status(id).state in @unstoppable_states do
        {:error, :not_running}
      else
        :ok = Runtime.stop_server(id)
        {:ok, Runtime.status(id)}
      end
    end
  end

  @doc """
  Force-kills the server's process (SIGKILL). No state guard (legacy parity:
  killing a never-started server is a no-op that reports stopped). Returns
  `{:ok, status_map}`.
  """
  def kill_server(%Scope{} = scope, id) do
    with {:ok, _server} <- get_server(scope, id) do
      case Runtime.kill_server(id) do
        :ok -> {:ok, Runtime.status(id)}
        {:error, :not_found} -> {:ok, Runtime.status(id)}
      end
    end
  end

  @doc """
  Sends a console command to the running server over RCON.

  A blank or non-string command returns `{:error, :invalid_command}`. A missing
  instance maps to `{:error, :not_running}` (no instance = not running for
  command purposes). Returns `{:ok, output}` on success.
  """
  def send_command(%Scope{} = scope, id, command) do
    with :ok <- validate_command(command),
         {:ok, _server} <- get_server(scope, id) do
      case Runtime.send_command(id, command) do
        {:ok, output} -> {:ok, output}
        {:error, :not_running} -> {:error, :not_running}
        {:error, :not_found} -> {:error, :not_running}
      end
    end
  end

  @doc """
  Returns the server's recent log lines rendered as `"[<ISO>] <message>"`
  strings (legacy REST parity). Returns `{:ok, [string]}`.
  """
  def server_logs(%Scope{} = scope, id, lines \\ 100) do
    with {:ok, _server} <- get_server(scope, id) do
      rendered =
        id
        |> Runtime.logs(lines)
        |> Enum.map(fn %{timestamp: ts, message: message} ->
          "[#{DateTime.to_iso8601(ts)}] #{message}"
        end)

      {:ok, rendered}
    end
  end

  @doc """
  Returns the server's current runtime status map. `{:ok, status_map}`.
  """
  def server_status(%Scope{} = scope, id) do
    with {:ok, _server} <- get_server(scope, id) do
      {:ok, Runtime.status(id)}
    end
  end

  @doc """
  Deletes a server: stops any active instance, tears down its runtime entry,
  removes the on-disk directory, and deletes the row (cascading backup config).
  Returns `:ok`.
  """
  def delete_server(%Scope{} = scope, id) do
    with {:ok, server} <- get_server(scope, id) do
      if Runtime.status(id).state in @active_states do
        Runtime.stop_server(id)
      end

      Runtime.remove_instance(id)
      File.rm_rf(server.directory)
      # Plan 5: cancel Oban jobs for this server in the same transaction.
      {:ok, _} = Repo.delete(server)
      :ok
    end
  end

  @doc """
  Migrates a server to a new type/version. Mirrors the legacy ordering exactly:
  type guard → server 404 → running/starting guard → java gate → manual backup
  → jar download + swap → row update. There is NO rollback on a failed jar swap;
  the pre-migration backup is the recovery path (legacy parity — jars are
  excluded from backups by design and re-downloaded on re-migrate).

  `type` must be "vanilla" | "paper". `opts` accepts `:data_dir`, `:runtime`,
  and `:tar_cmd` (test seams forwarded to `Allay.Backups` / `JarCache`).

  Returns `{:ok, %{backup_id, migration: %{from_type, from_version, to_type,
  to_version}}}` with the PRE-update values, or one of `{:error,
  :invalid_server_type}`, `{:error, :not_found}`,
  `{:error, :migration_server_running}`, the java-gate error tuples, `{:error,
  {:backup_failed, _}}`, or `{:error, {:jar_download_failed, message}}`.
  """
  def migrate_server(%Scope{} = scope, id, type, version, opts \\ []) do
    runtime = Keyword.get(opts, :runtime, Runtime)

    with :ok <- validate_migration_type(type),
         {:ok, server} <- get_server(scope, id),
         :ok <- ensure_migratable(runtime, server.id),
         {:ok, major} <- JavaGate.assert_available(type, version),
         {:ok, backup} <- create_migration_backup(scope, server.id, opts),
         {:ok, jar_path} <- fetch_migration_jar(type, version, opts),
         :ok <- swap_server_jar(server.directory, jar_path) do
      {:ok, _updated} = update_migrated_row(server, type, version, major)

      {:ok,
       %{
         backup_id: backup.id,
         migration: %{
           from_type: server.type,
           from_version: server.version,
           to_type: type,
           to_version: version
         }
       }}
    end
  end

  defp validate_migration_type(type) when type in @migratable_types, do: :ok
  defp validate_migration_type(_type), do: {:error, :invalid_server_type}

  defp ensure_migratable(runtime, id) do
    if runtime.status(id).state in @active_states,
      do: {:error, :migration_server_running},
      else: :ok
  end

  defp create_migration_backup(scope, server_id, opts) do
    backup_opts = Keyword.take(opts, [:data_dir, :runtime, :tar_cmd, :save_wait_ms])
    Backups.create_backup(scope, server_id, "manual", backup_opts)
  end

  defp fetch_migration_jar(type, version, opts) do
    type_atom = migration_type_atom(type)
    jar_opts = Keyword.take(opts, [:data_dir])

    with {:ok, spec} <- Versions.download_spec(type_atom, version),
         {:ok, path} <- JarCache.fetch(type_atom, version, spec, jar_opts) do
      {:ok, path}
    else
      {:error, message} -> {:error, {:jar_download_failed, message}}
    end
  end

  # No rollback (legacy parity): unlink the old jar, then copy the new one in.
  # rm/cp failures surface as the same typed tuple as a failed download — the
  # pre-migration backup is the recovery path either way.
  defp swap_server_jar(directory, jar_path) do
    server_jar = Path.join(directory, "server.jar")

    with :ok <- remove_existing_jar(server_jar),
         :ok <- File.cp(jar_path, server_jar) do
      :ok
    else
      {:error, reason} ->
        {:error, {:jar_download_failed, "Failed to swap server.jar: #{inspect(reason)}"}}
    end
  end

  defp remove_existing_jar(server_jar) do
    if File.exists?(server_jar), do: File.rm(server_jar), else: :ok
  end

  defp update_migrated_row(server, type, version, major) do
    server
    |> Ecto.Changeset.change(type: type, version: version, java_version: to_string(major))
    |> Repo.update()
  end

  defp migration_type_atom("vanilla"), do: :vanilla
  defp migration_type_atom("paper"), do: :paper

  defp validate_command(command) when is_binary(command) do
    if String.trim(command) == "", do: {:error, :invalid_command}, else: :ok
  end

  defp validate_command(_), do: {:error, :invalid_command}
end
