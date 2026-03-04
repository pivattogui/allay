import { t } from 'elysia';
import { ServerType, ServerStatus } from './common.js';

// Create server request
export const CreateServerBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 50, description: 'Server name' }),
  type: ServerType,
  version: t.String({ minLength: 1, description: 'Minecraft version (e.g., 1.20.4)' }),
  port: t.Number({ minimum: 1024, maximum: 65535, description: 'Server port' }),
  ramMinMb: t.Optional(t.Number({ minimum: 512, maximum: 32768, default: 1024, description: 'Minimum RAM in MB' })),
  ramMaxMb: t.Optional(t.Number({ minimum: 512, maximum: 32768, default: 2048, description: 'Maximum RAM in MB' })),
  autoStart: t.Optional(t.Boolean({ default: false, description: 'Start server on system boot' })),
  autoRestart: t.Optional(t.Boolean({ default: false, description: 'Restart server on crash' })),
});

// Update server request
export const UpdateServerBody = t.Partial(t.Object({
  name: t.String({ minLength: 1, maxLength: 50, description: 'Server name' }),
  port: t.Number({ minimum: 1024, maximum: 65535, description: 'Server port' }),
  ramMinMb: t.Number({ minimum: 512, maximum: 32768, description: 'Minimum RAM in MB' }),
  ramMaxMb: t.Number({ minimum: 512, maximum: 32768, description: 'Maximum RAM in MB' }),
  autoStart: t.Boolean({ description: 'Start server on system boot' }),
  autoRestart: t.Boolean({ description: 'Restart server on crash' }),
}));

// Update server config request
export const UpdateServerConfigBody = t.Partial(t.Object({
  name: t.String({ minLength: 1, maxLength: 50, description: 'Server name' }),
  ramMinMb: t.Number({ minimum: 512, maximum: 32768, description: 'Minimum RAM in MB' }),
  ramMaxMb: t.Number({ minimum: 512, maximum: 32768, description: 'Maximum RAM in MB' }),
  jvmArgs: t.Nullable(t.String({ description: 'Custom JVM arguments' })),
  javaPath: t.Nullable(t.String({ description: 'Path to Java executable' })),
  autoStart: t.Boolean({ description: 'Start server on system boot' }),
  autoRestart: t.Boolean({ description: 'Restart server on crash' }),
  restartLimit: t.Number({ minimum: 0, maximum: 10, description: 'Max restart attempts' }),
  restartSchedule: t.Nullable(t.String({ description: 'Cron schedule for restarts' })),
}));

// Server entity
export const Server = t.Object({
  id: t.String({ description: 'Server UUID' }),
  name: t.String({ description: 'Server name' }),
  type: ServerType,
  version: t.String({ description: 'Minecraft version' }),
  port: t.Number({ description: 'Server port' }),
  ramMinMb: t.Number({ description: 'Minimum RAM in MB' }),
  ramMaxMb: t.Number({ description: 'Maximum RAM in MB' }),
  javaVersion: t.Nullable(t.String({ description: 'Java version' })),
  directory: t.String({ description: 'Server directory path' }),
  autoStart: t.Boolean({ description: 'Start on boot' }),
  autoRestart: t.Boolean({ description: 'Restart on crash' }),
  restartLimit: t.Number({ description: 'Max restart attempts' }),
  iconPath: t.Nullable(t.String({ description: 'Server icon path' })),
  jvmArgs: t.Nullable(t.String({ description: 'Custom JVM arguments' })),
  javaPath: t.Nullable(t.String({ description: 'Java executable path' })),
  restartSchedule: t.Nullable(t.String({ description: 'Cron restart schedule' })),
  createdAt: t.Date({ description: 'Creation date' }),
  updatedAt: t.Date({ description: 'Last update date' }),
});

// Server with status
export const ServerWithStatus = t.Object({
  ...Server.properties,
  status: ServerStatus,
});

// Server config response
export const ServerConfig = t.Object({
  id: t.String({ description: 'Server UUID' }),
  name: t.String({ description: 'Server name' }),
  type: ServerType,
  version: t.String({ description: 'Minecraft version' }),
  port: t.Number({ description: 'Server port' }),
  ramMinMb: t.Number({ description: 'Minimum RAM in MB' }),
  ramMaxMb: t.Number({ description: 'Maximum RAM in MB' }),
  jvmArgs: t.Nullable(t.String({ description: 'Custom JVM arguments' })),
  javaPath: t.Nullable(t.String({ description: 'Java executable path' })),
  autoStart: t.Boolean({ description: 'Start on boot' }),
  autoRestart: t.Boolean({ description: 'Restart on crash' }),
  restartLimit: t.Number({ description: 'Max restart attempts' }),
  restartSchedule: t.Nullable(t.String({ description: 'Cron restart schedule' })),
  iconPath: t.Nullable(t.String({ description: 'Server icon path' })),
});

// List servers response
export const ListServersResponse = t.Object({
  servers: t.Array(ServerWithStatus),
});

// Single server response
export const ServerResponse = t.Object({
  server: ServerWithStatus,
});

// Server status response
export const StatusResponse = t.Object({
  status: ServerStatus,
});

// Server logs response
export const LogsResponse = t.Object({
  logs: t.Array(t.String({ description: 'Log line' })),
});

// Command request
export const CommandBody = t.Object({
  command: t.String({ description: 'Minecraft console command' }),
});

// Command response
export const CommandResponse = t.Object({
  message: t.String({ description: 'Success message' }),
  command: t.String({ description: 'Executed command' }),
});

// Properties response
export const PropertiesResponse = t.Object({
  properties: t.Record(t.String(), t.String(), { description: 'Server properties key-value pairs' }),
});

// Properties request
export const PropertiesBody = t.Object({
  properties: t.Record(t.String(), t.String(), { description: 'Server properties to update' }),
});

// Raw properties response
export const RawPropertiesResponse = t.Object({
  content: t.String({ description: 'Raw server.properties content' }),
});

// Raw properties request
export const RawPropertiesBody = t.Object({
  content: t.String({ description: 'Raw server.properties content' }),
});

// Needs restart response
export const NeedsRestartResponse = t.Object({
  needsRestart: t.Boolean({ description: 'Whether server needs restart for changes to take effect' }),
});

// Config response
export const ConfigResponse = t.Object({
  config: ServerConfig,
});

// Config update response
export const ConfigUpdateResponse = t.Object({
  config: ServerConfig,
  needsRestart: t.Boolean({ description: 'Whether server needs restart' }),
});

// Icon response
export const IconResponse = t.Object({
  iconPath: t.String({ description: 'Path to server icon' }),
});

// Migrate request
export const MigrateBody = t.Object({
  type: ServerType,
  version: t.String({ description: 'Target Minecraft version' }),
});

// Migrate response
export const MigrateResponse = t.Object({
  message: t.String({ description: 'Success message' }),
  backupId: t.String({ description: 'Backup created before migration' }),
  migration: t.Object({
    fromType: ServerType,
    fromVersion: t.String({ description: 'Original version' }),
    toType: ServerType,
    toVersion: t.String({ description: 'New version' }),
  }),
});

// Start/Stop response
export const ActionResponse = t.Object({
  message: t.String({ description: 'Action result message' }),
  status: ServerStatus,
});
