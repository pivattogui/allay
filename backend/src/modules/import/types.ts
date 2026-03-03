import { z } from 'zod';

// Archive format types
export type ArchiveFormat = 'tar.gz' | 'zip';
export type BackupFormat = 'allay' | 'generic' | 'world-only';
export type ImportServerType = 'vanilla' | 'paper' | 'unsupported';

// Validation result
export interface ValidationResult {
  valid: boolean;
  format?: ArchiveFormat;
  error?: string;
  errorCode?: ImportErrorCode;
  fileCount?: number;
  estimatedSize?: number;
}

// Backup metadata detected from archive
export interface BackupMetadata {
  format: BackupFormat;
  serverType: ImportServerType;
  minecraftVersion: string | null;
  hasJars: boolean;
  jarFiles: string[];
  serverName: string | null;
  port: number | null;
  estimatedSize: number;
  worldName: string | null;
  hasDimensions: boolean;
  dimensions: string[];
  rootPath: string; // The root path inside the archive (e.g., UUID folder for Allay backups)
}

// Diff item representing a difference between backup and server
export interface DiffItem {
  id: string;
  path: string;
  category: DiffCategory;
  type: 'file' | 'directory';
  status: DiffStatus;
  backupSize?: number;
  serverSize?: number;
  isText: boolean;
  backupPreview?: string;
  serverPreview?: string;
  isJar: boolean;
}

export type DiffCategory = 'config' | 'world' | 'plugins' | 'other';
export type DiffStatus = 'only-backup' | 'only-server' | 'modified';

// Diff result containing all differences
export interface DiffResult {
  items: DiffItem[];
  summary: {
    totalDiffs: number;
    byCategory: Record<DiffCategory, number>;
    byStatus: Record<DiffStatus, number>;
  };
}

// User selection for what to apply
export interface DiffSelection {
  id: string;
  action: 'keep' | 'use-backup';
}

// Result of applying changes
export interface ApplyResult {
  success: boolean;
  applied: number;
  error?: string;
  errorCode?: ImportErrorCode;
}

// Import error codes
export type ImportErrorCode =
  | 'INVALID_ARCHIVE'
  | 'UNSUPPORTED_FORMAT'
  | 'MISSING_WORLD_DATA'
  | 'DISK_FULL'
  | 'EXTRACTION_FAILED'
  | 'SERVER_BUSY'
  | 'APPLY_FAILED'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'PATH_TRAVERSAL'
  | 'ZIP_BOMB'
  | 'SERVER_NOT_FOUND'
  | 'BACKUP_NOT_FOUND';

// Import error class
export class ImportError extends Error {
  constructor(
    message: string,
    public code: ImportErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

// Archive entry for listing contents
export interface ArchiveEntry {
  path: string;
  isDirectory: boolean;
  size: number;
  depth: number;
}

// Upload response
export interface UploadResponse {
  tempFileId: string;
  metadata: BackupMetadata;
}

// Zod schemas for API validation
export const DiffSelectionSchema = z.object({
  id: z.string(),
  action: z.enum(['keep', 'use-backup']),
});

export const GenerateDiffSchema = z.object({
  tempFileId: z.string(),
  serverId: z.string(),
});

export const ApplyChangesSchema = z.object({
  tempFileId: z.string(),
  serverId: z.string(),
  selections: z.array(DiffSelectionSchema),
});

// Constants
export const IMPORT_CONSTANTS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
  MAX_FILE_COUNT: 100000,
  MAX_DEPTH: 10,
  MAX_DECOMPRESSION_RATIO: 50, // 50x compressed size
  TEXT_PREVIEW_MAX_SIZE: 10 * 1024, // 10KB
  TEXT_PREVIEW_LINES: 20,
  CLEANUP_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
  ABANDONED_FILE_AGE_MS: 60 * 60 * 1000, // 1 hour
} as const;

// Text file extensions for preview
export const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.yml', '.yaml', '.json', '.properties',
  '.cfg', '.conf', '.config', '.ini', '.toml', '.md',
  '.sh', '.bat', '.cmd', '.ps1',
]);

// Config file patterns for categorization
export const CONFIG_PATTERNS = [
  /^server\.properties$/,
  /^bukkit\.yml$/,
  /^spigot\.yml$/,
  /^paper\.yml$/,
  /^paper-global\.yml$/,
  /^paper-world.*\.yml$/,
  /^config\.yml$/,
  /\.yml$/,
  /\.yaml$/,
  /\.json$/,
  /\.properties$/,
  /\.toml$/,
];

// World folder patterns
export const WORLD_PATTERNS = [
  /^world$/,
  /^world_nether$/,
  /^world_the_end$/,
  /^DIM-1$/,
  /^DIM1$/,
];

// Plugin folder pattern
export const PLUGIN_PATTERN = /^plugins\//;
