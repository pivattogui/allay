defmodule Allay.Servers.Provisioner do
  @moduledoc """
  Explicit server provisioning pipeline: validate → java gate → jar fetch →
  filesystem setup → DB insert, with on-failure disk cleanup.

  Deliberate deltas from the legacy backend: the Java gate runs before any
  filesystem work, RCON is provisioned at create time (the legacy backend
  drove commands over stdin and never enabled RCON), and a mid-pipeline
  failure removes the half-created directory instead of leaving garbage.
  """

  alias Allay.Accounts.Scope
  alias Allay.Backups.BackupConfig
  alias Allay.Minecraft.JarCache
  alias Allay.Minecraft.Properties
  alias Allay.Minecraft.Versions
  alias Allay.Repo
  alias Allay.Servers.JavaGate
  alias Allay.Servers.Server

  alias Ecto.Multi

  @rcon_port_offset 10_000

  @doc """
  Provisions a new server from `attrs`.

  Returns `{:ok, server}` on success, `{:error, changeset}` for validation or
  DB-constraint failures, or a tagged tuple (`:java_lookup_failed`,
  `:java_runtime_unavailable`, `:provision_failed`) for pipeline failures.

  `opts` accepts `:data_dir` to override the configured data directory (tests).
  """
  def provision(%Scope{}, attrs, opts \\ []) do
    changeset = Server.create_changeset(%Server{}, attrs)

    with {:ok, _} <- validate(changeset),
         type = Map.fetch!(changeset.changes, :type),
         version = Map.fetch!(changeset.changes, :version),
         port = Map.fetch!(changeset.changes, :port),
         {:ok, major} <- JavaGate.assert_available(type, version),
         data_dir = data_dir(opts),
         {:ok, jar_path} <- fetch_jar(type, version, data_dir) do
      build(changeset, port, major, jar_path, data_dir)
    end
  end

  defp validate(%Ecto.Changeset{valid?: true} = changeset), do: {:ok, changeset}
  defp validate(%Ecto.Changeset{} = changeset), do: {:error, changeset}

  defp fetch_jar(type, version, data_dir) do
    with {:ok, spec} <- Versions.download_spec(String.to_existing_atom(type), version),
         {:ok, jar_path} <- JarCache.fetch(type, version, spec, data_dir: data_dir) do
      {:ok, jar_path}
    else
      {:error, message} -> {:error, {:provision_failed, message}}
    end
  end

  defp build(changeset, port, major, jar_path, data_dir) do
    id = Ecto.UUID.generate()
    directory = Path.join([data_dir, "servers", id])
    rcon_port = port + @rcon_port_offset
    rcon_password = :crypto.strong_rand_bytes(18) |> Base.url_encode64()

    try do
      write_filesystem!(directory, jar_path, port, rcon_port, rcon_password)
      insert(changeset, id, major, directory, rcon_port, rcon_password)
    rescue
      e ->
        File.rm_rf(directory)
        {:error, {:provision_failed, Exception.message(e)}}
    end
  end

  defp write_filesystem!(directory, jar_path, port, rcon_port, rcon_password) do
    File.mkdir_p!(directory)
    File.cp!(jar_path, Path.join(directory, "server.jar"))
    File.write!(Path.join(directory, "eula.txt"), "eula=true\n")

    properties =
      Properties.serialize(%{
        "server-port" => to_string(port),
        "enable-rcon" => "true",
        "rcon.port" => to_string(rcon_port),
        "rcon.password" => rcon_password
      })

    File.write!(Path.join(directory, "server.properties"), properties)
  end

  defp insert(changeset, id, major, directory, rcon_port, rcon_password) do
    server_changeset =
      changeset
      |> Ecto.Changeset.put_change(:id, id)
      |> Ecto.Changeset.put_change(:java_version, to_string(major))
      |> Ecto.Changeset.put_change(:directory, directory)
      |> Ecto.Changeset.put_change(:rcon_port, rcon_port)
      |> Ecto.Changeset.put_change(:rcon_password, rcon_password)

    multi =
      Multi.new()
      |> Multi.insert(:server, server_changeset)
      |> Multi.insert(:backup_config, fn %{server: server} ->
        backup_config_changeset(server.id)
      end)

    case Repo.transaction(multi) do
      {:ok, %{server: server}} ->
        {:ok, server}

      {:error, :server, changeset, _changes} ->
        File.rm_rf(directory)
        {:error, changeset}

      {:error, _step, reason, _changes} ->
        File.rm_rf(directory)
        {:error, {:provision_failed, inspect(reason)}}
    end
  end

  defp backup_config_changeset(server_id) do
    Ecto.Changeset.cast(%BackupConfig{}, %{server_id: server_id}, [:server_id])
  end

  defp data_dir(opts) do
    Keyword.get(opts, :data_dir) || Application.fetch_env!(:allay, :data_dir)
  end
end
