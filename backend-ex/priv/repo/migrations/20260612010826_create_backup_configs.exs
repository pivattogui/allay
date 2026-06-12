defmodule Allay.Repo.Migrations.CreateBackupConfigs do
  use Ecto.Migration

  def change do
    create table(:backup_configs, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :server_id,
          references(:servers, type: :binary_id, on_delete: :delete_all),
          null: false

      add :enabled, :boolean, default: true, null: false
      add :interval_minutes, :integer, default: 60, null: false
      add :max_backups, :integer, default: 10, null: false
      add :include_logs, :boolean, default: false, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:backup_configs, [:server_id])
  end
end
