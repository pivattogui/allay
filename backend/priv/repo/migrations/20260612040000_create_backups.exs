defmodule Allay.Repo.Migrations.CreateBackups do
  use Ecto.Migration

  def change do
    create table(:backups, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :server_id,
          references(:servers, type: :binary_id, on_delete: :delete_all),
          null: false

      add :filename, :string, null: false
      add :size_bytes, :bigint, default: 0, null: false
      add :type, :string, null: false
      add :status, :string, default: "completed", null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:backups, [:server_id])
  end
end
