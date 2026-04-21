import { t } from 'elysia'

// Backup entity
export const Backup = t.Object({
  id: t.String({ description: 'Backup UUID' }),
  serverId: t.String({ description: 'Server UUID' }),
  filename: t.String({ description: 'Backup filename' }),
  sizeBytes: t.Number({ description: 'Backup size in bytes' }),
  type: t.Union([t.Literal('manual'), t.Literal('scheduled'), t.Literal('pre-import')], { description: 'Backup type' }),
  createdAt: t.String({ description: 'Creation timestamp' }),
})

// Backup config
export const BackupConfig = t.Nullable(
  t.Object({
    id: t.String({ description: 'Config UUID' }),
    serverId: t.String({ description: 'Server UUID' }),
    enabled: t.Boolean({ description: 'Whether automatic backups are enabled' }),
    intervalMinutes: t.Number({ description: 'Backup interval in minutes' }),
    maxBackups: t.Number({ description: 'Maximum number of backups to keep' }),
    includeLogs: t.Boolean({ description: 'Include logs in backup' }),
    createdAt: t.String({ description: 'Config creation date' }),
  }),
)

// List backups response
export const ListBackupsResponse = t.Object({
  backups: t.Array(Backup),
  config: BackupConfig,
})

// Create backup response
export const CreateBackupResponse = t.Object({
  backup: Backup,
})

// Update backup config request
export const UpdateBackupConfigBody = t.Partial(
  t.Object({
    enabled: t.Boolean({ description: 'Enable automatic backups' }),
    intervalMinutes: t.Number({ minimum: 5, maximum: 1440, description: 'Backup interval (5-1440 minutes)' }),
    maxBackups: t.Number({ minimum: 1, maximum: 100, description: 'Max backups to keep (1-100)' }),
    includeLogs: t.Boolean({ description: 'Include logs in backup' }),
  }),
)

// Update backup config response (config can be null)
export const UpdateBackupConfigResponse = t.Object({
  config: BackupConfig,
})

// Non-nullable backup config for internal use
export const BackupConfigRequired = t.Object({
  id: t.String({ description: 'Config UUID' }),
  serverId: t.String({ description: 'Server UUID' }),
  enabled: t.Boolean({ description: 'Whether automatic backups are enabled' }),
  intervalMinutes: t.Number({ description: 'Backup interval in minutes' }),
  maxBackups: t.Number({ description: 'Maximum number of backups to keep' }),
  includeLogs: t.Boolean({ description: 'Include logs in backup' }),
  createdAt: t.String({ description: 'Config creation date' }),
})

// Backup ID params
export const BackupIdParams = t.Object({
  serverId: t.String({ description: 'Server UUID' }),
  backupId: t.String({ description: 'Backup UUID' }),
})

// Import analysis response
export const ImportAnalyzeResponse = t.Object({
  importId: t.String({ description: 'Temporary import session ID' }),
  detectedType: t.Union([t.Literal('world-only'), t.Literal('full-backup'), t.Literal('mixed')], {
    description: 'Detected archive type',
  }),
  categories: t.Object({
    world: t.Array(t.String()),
    configs: t.Array(t.String()),
    plugins: t.Array(t.String()),
    jars: t.Array(t.String()),
    logs: t.Array(t.String()),
    other: t.Array(t.String()),
  }),
  suggestedPreset: t.Union(
    [t.Literal('world-only'), t.Literal('world-configs'), t.Literal('all-except-jars'), t.Null()],
    { description: 'Recommended preset' },
  ),
  totalSize: t.Number({ description: 'Archive total size in bytes' }),
})

// Import execute request
export const ImportExecuteBody = t.Object({
  selection: t.Object({
    preset: t.Union([t.Literal('world-only'), t.Literal('world-configs'), t.Literal('all-except-jars'), t.Null()]),
    include: t.Array(t.String()),
    exclude: t.Array(t.String()),
  }),
})

// Import execute response
export const ImportExecuteResponse = t.Object({
  message: t.String(),
  backupId: t.String({ description: 'Pre-import backup ID' }),
  importedPaths: t.Number({ description: 'Number of paths imported' }),
})
