defmodule Allay.Servers do
  @moduledoc """
  Context for Minecraft server management. All public functions take
  `%Allay.Accounts.Scope{}` as the first argument (Phoenix 1.8 convention).
  """

  import Ecto.Query

  alias Allay.Accounts.Scope
  alias Allay.Minecraft.Properties
  alias Allay.Repo
  alias Allay.Runtime
  alias Allay.Servers.Provisioner
  alias Allay.Servers.RuntimeBridge
  alias Allay.Servers.Server

  @active_states [:running, :starting]
  @unstoppable_states [:stopped, :stopping]

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

  @doc """
  Updates a server's editable fields (name, port, ram, flags). On a port
  change, syncs `server-port` in the on-disk `server.properties` file (legacy
  PATCH /:id parity).

  Returns `{:ok, server}`, `{:error, :not_found}`, `{:error, :port_in_use}` for
  a duplicate port, or `{:error, changeset}` for validation failures.
  """
  def update_server(%Scope{} = scope, id, attrs) do
    with {:ok, server} <- get_server(scope, id),
         changeset = Server.update_changeset(server, attrs),
         {:ok, updated} <- persist(changeset) do
      sync_port_properties(server, updated)
      {:ok, updated}
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

  defp sync_port_properties(_old, %Server{directory: directory, port: new_port}) do
    path = Path.join(directory, "server.properties")

    case File.read(path) do
      {:ok, raw} -> File.write(path, Properties.put_key(raw, "server-port", new_port))
      {:error, _} -> :ok
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

  defp validate_command(command) when is_binary(command) do
    if String.trim(command) == "", do: {:error, :invalid_command}, else: :ok
  end

  defp validate_command(_), do: {:error, :invalid_command}
end
