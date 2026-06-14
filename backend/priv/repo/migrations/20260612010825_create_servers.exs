defmodule Allay.Repo.Migrations.CreateServers do
  use Ecto.Migration

  def change do
    create table(:servers, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :type, :string, null: false
      add :version, :string, null: false
      add :port, :integer, null: false
      add :ram_min_mb, :integer, default: 1024, null: false
      add :ram_max_mb, :integer, default: 2048, null: false
      add :java_version, :string
      add :directory, :string, null: false
      add :auto_start, :boolean, default: false, null: false
      add :auto_restart, :boolean, default: false, null: false
      add :restart_limit, :integer, default: 3, null: false
      add :icon_path, :string
      add :jvm_args, :text
      add :java_path, :string
      add :restart_schedule, :string
      add :rcon_port, :integer, null: false
      add :rcon_password, :string, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:servers, [:port])
    create unique_index(:servers, [:rcon_port])
  end
end
