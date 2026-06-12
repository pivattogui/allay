defmodule AllayWeb.BackupJSON do
  @moduledoc """
  Wire serializer for backup resources, byte-compatible with the legacy TS
  backend's camelCase shape. `null` config renders as JSON null.
  """

  alias Allay.Backups.Backup
  alias Allay.Backups.BackupConfig

  @doc "One backup row in wire shape."
  def backup(%Backup{} = backup) do
    %{
      id: backup.id,
      serverId: backup.server_id,
      filename: backup.filename,
      sizeBytes: backup.size_bytes,
      type: backup.type,
      status: backup.status,
      createdAt: DateTime.to_iso8601(backup.inserted_at)
    }
  end

  @doc "Config in wire shape, or `nil` passed through as JSON null."
  def config(nil), do: nil

  def config(%BackupConfig{} = config) do
    %{
      id: config.id,
      serverId: config.server_id,
      enabled: config.enabled,
      intervalMinutes: config.interval_minutes,
      maxBackups: config.max_backups,
      includeLogs: config.include_logs
    }
  end
end
