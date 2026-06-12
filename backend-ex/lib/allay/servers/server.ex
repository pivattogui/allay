defmodule Allay.Servers.Server do
  use Ecto.Schema

  import Ecto.Changeset

  alias Crontab.CronExpression.Parser

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  # rcon_password is a localhost secret between the panel and the Java
  # process; keep it out of inspect/log output.
  @derive {Inspect, except: [:rcon_password]}
  schema "servers" do
    field :name, :string
    field :type, :string
    field :version, :string
    field :port, :integer
    field :ram_min_mb, :integer, default: 1024
    field :ram_max_mb, :integer, default: 2048
    field :java_version, :string
    field :directory, :string
    field :auto_start, :boolean, default: false
    field :auto_restart, :boolean, default: false
    field :restart_limit, :integer, default: 3
    field :icon_path, :string
    field :jvm_args, :string
    field :java_path, :string
    field :restart_schedule, :string
    field :rcon_port, :integer
    field :rcon_password, :string

    timestamps(type: :utc_datetime)
  end

  @valid_types ~w(vanilla paper)

  @doc """
  Changeset for server creation. Validates all required fields and business
  rules including port range from config and ram ordering.
  """
  def create_changeset(server, attrs) do
    server
    |> cast(attrs, [
      :name,
      :type,
      :version,
      :port,
      :ram_min_mb,
      :ram_max_mb,
      :auto_start,
      :auto_restart
    ])
    |> validate_required([:name, :type, :version, :port])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_inclusion(:type, @valid_types)
    |> validate_length(:version, min: 1)
    |> validate_number(:port, greater_than_or_equal_to: 1, less_than_or_equal_to: 65_535)
    |> validate_port_range()
    |> validate_number(:ram_min_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> validate_number(:ram_max_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> validate_ram_order()
    |> unique_constraint(:port)
    |> unique_constraint(:rcon_port)
  end

  @doc """
  Changeset for partial server updates (name, port, ram, flags).
  No ram cross-check — legacy PATCH /:id parity.
  """
  def update_changeset(server, attrs) do
    server
    |> cast(attrs, [:name, :port, :ram_min_mb, :ram_max_mb, :auto_start, :auto_restart])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_number(:port, greater_than_or_equal_to: 1, less_than_or_equal_to: 65_535)
    |> validate_port_range()
    |> validate_number(:ram_min_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> validate_number(:ram_max_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> unique_constraint(:port)
    |> unique_constraint(:rcon_port)
  end

  @doc """
  Changeset for server config updates. Validates ram ordering against both
  incoming values and existing row values (legacy PATCH /:id/config parity).
  """
  def config_changeset(server, attrs) do
    server
    |> cast(attrs, [
      :name,
      :ram_min_mb,
      :ram_max_mb,
      :jvm_args,
      :java_path,
      :auto_start,
      :auto_restart,
      :restart_limit,
      :restart_schedule
    ])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_number(:ram_min_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> validate_number(:ram_max_mb, greater_than_or_equal_to: 512, less_than_or_equal_to: 32_768)
    |> validate_number(:restart_limit, greater_than_or_equal_to: 0, less_than_or_equal_to: 10)
    |> validate_ram_order_with_existing(server)
    |> validate_restart_schedule()
  end

  # Cron-validates restart_schedule (delta 1): legacy stored arbitrary strings
  # that silently never fired. nil clears the schedule and skips validation.
  defp validate_restart_schedule(changeset) do
    case get_change(changeset, :restart_schedule) do
      nil ->
        changeset

      schedule ->
        case Parser.parse(schedule) do
          {:ok, _} -> changeset
          {:error, _} -> add_error(changeset, :restart_schedule, "is not a valid cron expression")
        end
    end
  end

  # Checks that the port falls within the configured MC range.
  # Reads Application.get_env/2 at runtime so tests can override via config.
  defp validate_port_range(changeset) do
    validate_change(changeset, :port, fn :port, port ->
      range = Application.get_env(:allay, :mc_port_range, 25_565..25_575)

      if port in range do
        []
      else
        [port: "out of configured range"]
      end
    end)
  end

  # Validates ram_min_mb <= ram_max_mb using only changeset values.
  defp validate_ram_order(changeset) do
    min_val = get_field(changeset, :ram_min_mb)
    max_val = get_field(changeset, :ram_max_mb)

    if min_val && max_val && min_val > max_val do
      add_error(changeset, :ram_max_mb, "must be >= ram_min_mb", validation: :ram_order)
    else
      changeset
    end
  end

  # Validates ram ordering for config_changeset, resolving the effective min
  # and max by merging changeset changes with the existing row values.
  defp validate_ram_order_with_existing(changeset, server) do
    effective_min = get_field(changeset, :ram_min_mb) || server.ram_min_mb
    effective_max = get_field(changeset, :ram_max_mb) || server.ram_max_mb

    if effective_min && effective_max && effective_min > effective_max do
      add_error(changeset, :ram_max_mb, "must be >= ram_min_mb", validation: :ram_order)
    else
      changeset
    end
  end
end
