import { z } from 'zod';

// Server types
export const ServerType = z.enum(['vanilla', 'paper']);
export type ServerType = z.infer<typeof ServerType>;

export const ServerState = z.enum(['stopped', 'starting', 'running', 'stopping', 'crashed']);
export type ServerState = z.infer<typeof ServerState>;

// Server schemas
export const CreateServerSchema = z.object({
  name: z.string().min(1).max(50),
  type: ServerType,
  version: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  ramMinMb: z.number().int().min(512).max(32768).default(1024),
  ramMaxMb: z.number().int().min(512).max(32768).default(2048),
  autoStart: z.boolean().default(false),
  autoRestart: z.boolean().default(false),
  nodeId: z.string().uuid().optional(),
});

export type CreateServerInput = z.infer<typeof CreateServerSchema>;

export const UpdateServerSchema = CreateServerSchema.partial().omit({ type: true, version: true });
export type UpdateServerInput = z.infer<typeof UpdateServerSchema>;

// Server Config update schema (for PATCH /api/servers/:id/config)
export const UpdateServerConfigSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  ramMinMb: z.number().int().min(512).max(32768).optional(),
  ramMaxMb: z.number().int().min(512).max(32768).optional(),
  jvmArgs: z.string().nullable().optional(),
  javaPath: z.string().nullable().optional(),
  autoStart: z.boolean().optional(),
  autoRestart: z.boolean().optional(),
  restartLimit: z.number().int().min(0).max(10).optional(),
  restartSchedule: z.string().nullable().optional(),
}).refine(
  (data) => {
    if (data.ramMinMb !== undefined && data.ramMaxMb !== undefined) {
      return data.ramMinMb <= data.ramMaxMb;
    }
    return true;
  },
  { message: 'ramMinMb must be less than or equal to ramMaxMb' }
);
export type UpdateServerConfigInput = z.infer<typeof UpdateServerConfigSchema>;

// Server entity
export interface Server {
  id: string;
  name: string;
  type: ServerType;
  version: string;
  port: number;
  ramMinMb: number;
  ramMaxMb: number;
  javaVersion: string | null;
  directory: string;
  autoStart: boolean;
  autoRestart: boolean;
  restartLimit: number;
  iconPath: string | null;
  jvmArgs: string | null;
  javaPath: string | null;
  restartSchedule: string | null;
  nodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// App Config (DB-only settings managed by Allay)
export interface ServerAppConfig {
  ramMinMb: number;
  ramMaxMb: number;
  jvmArgs: string | null;
  javaPath: string | null;
  autoStart: boolean;
  autoRestart: boolean;
  restartLimit: number;
  restartSchedule: string | null;
}

// Server Metadata (DB-only)
export interface ServerMetadata {
  name: string;
  iconPath: string | null;
}

// Server Config (combined for API response)
export interface ServerConfig extends ServerAppConfig, ServerMetadata {
  id: string;
  type: ServerType;
  version: string;
  port: number;
}

// Java Version (in-memory cache)
export interface JavaVersion {
  version: string;
  path: string;
  vendor: string | null;
}

// Version Migration
export interface VersionMigration {
  fromType: ServerType;
  fromVersion: string;
  toType: ServerType;
  toVersion: string;
  backupId: string;
}

export interface ServerWithStatus extends Server {
  status: ServerStatus;
}

export interface ServerStatus {
  state: ServerState;
  pid?: number;
  uptime?: number;
  lastError?: string;
}

// Backup schemas
export const BackupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(1440).default(60),
  maxBackups: z.number().int().min(1).max(100).default(10),
  includeLogs: z.boolean().default(false),
});

export type BackupConfigInput = z.infer<typeof BackupConfigSchema>;

export interface BackupConfig {
  id: string;
  serverId: string;
  enabled: boolean;
  intervalMinutes: number;
  maxBackups: number;
  includeLogs: boolean;
  createdAt: string;
}

export interface Backup {
  id: string;
  serverId: string;
  filename: string;
  sizeBytes: number;
  type: 'manual' | 'scheduled';
  createdAt: string;
}

// Metrics
export interface ServerMetrics {
  timestamp: string;
  ramUsedMb: number;
  ramMaxMb: number;
  cpuPercent: number;
  playerCount: number;
  playerMax: number;
  tps?: number;
}

// Log entry
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

// Events
export const EventType = z.enum([
  'start', 'stop', 'crash', 'restart',
  'backup_start', 'backup_complete', 'backup_failed',
  'restore_start', 'restore_complete', 'restore_failed',
  'player_join', 'player_leave',
]);
export type EventType = z.infer<typeof EventType>;

export interface ServerEvent {
  id: string;
  serverId: string | null;
  type: EventType;
  message: string | null;
  createdAt: string;
}

// Auth
export const LoginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
}

// API responses
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  data: T;
}

// Version info
export interface MinecraftVersion {
  id: string;
  type: 'release' | 'snapshot';
  releaseTime: string;
}

export interface SystemInfo {
  totalRamMb: number;
  freeRamMb: number;
  cpuCores: number;
  javaVersion: string | null;
  platform: string;
}
