defmodule Allay.Backups.BackupConfig do
  @moduledoc """
  Per-server scheduled-backup configuration. The row is created at
  provisioning time; the API only ever updates it (legacy parity — there is
  no create-config endpoint).
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "backup_configs" do
    belongs_to :server, Allay.Servers.Server

    field :enabled, :boolean, default: true
    field :interval_minutes, :integer, default: 60
    field :max_backups, :integer, default: 10
    field :include_logs, :boolean, default: false

    timestamps(type: :utc_datetime)
  end

  @doc """
  Validates a partial config update. Ranges mirror the legacy wire contract
  (interval 5..1440 minutes, max 1..100 backups).
  """
  def changeset(config, attrs) do
    config
    |> cast(attrs, [:enabled, :interval_minutes, :max_backups, :include_logs])
    |> validate_number(:interval_minutes,
      greater_than_or_equal_to: 5,
      less_than_or_equal_to: 1440
    )
    |> validate_number(:max_backups, greater_than_or_equal_to: 1, less_than_or_equal_to: 100)
  end
end
