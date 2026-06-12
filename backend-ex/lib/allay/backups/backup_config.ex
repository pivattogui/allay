defmodule Allay.Backups.BackupConfig do
  @moduledoc false

  use Ecto.Schema

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
end
