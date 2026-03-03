import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { validateArchive } from './validator.js';
import { detectBackupFormat } from './detector.js';
import { generateDiffs, extractArchive } from './differ.js';
import { applyChanges } from './applier.js';
import {
  initializeCleanupJob,
  stopCleanupJob,
  deleteTempFile,
  getTempFilePath,
  ensureTempDir,
} from './cleanup.js';
import type {
  BackupMetadata,
  DiffResult,
  DiffSelection,
  ApplyResult,
  UploadResponse,
  ArchiveFormat,
  DiffItem,
} from './types.js';
import { ImportError, IMPORT_CONSTANTS } from './types.js';
import { db } from '../../db/index.js';
import { servers } from '../../db/schema.js';

interface TempFileData {
  filePath: string;
  archiveFormat: ArchiveFormat;
  metadata: BackupMetadata;
  extractPath: string | null;
  diffItems: DiffItem[] | null;
}

const tempFileCache = new Map<string, TempFileData>();

export const importManager = {
  async initialize(): Promise<void> {
    await ensureTempDir();
    initializeCleanupJob();
    console.log('[ImportManager] Initialized');
  },

  shutdown(): void {
    stopCleanupJob();
    console.log('[ImportManager] Shutdown');
  },

  async handleUpload(
    fileStream: NodeJS.ReadableStream,
    filename: string
  ): Promise<UploadResponse> {
    const tempFileId = randomUUID();
    const tempDir = path.join(config.paths.temp, tempFileId);
    await fs.mkdir(tempDir, { recursive: true });

    const filePath = path.join(tempDir, filename);

    const writeStream = createWriteStream(filePath);
    await pipeline(fileStream, writeStream);

    const validation = await validateArchive(filePath);
    if (!validation.valid) {
      await deleteTempFile(tempFileId);
      throw new ImportError(
        validation.error || 'Invalid archive',
        validation.errorCode || 'INVALID_ARCHIVE'
      );
    }

    const metadata = await detectBackupFormat(filePath, validation.format!);

    tempFileCache.set(tempFileId, {
      filePath,
      archiveFormat: validation.format!,
      metadata,
      extractPath: null,
      diffItems: null,
    });

    return { tempFileId, metadata };
  },

  getMetadata(tempFileId: string): BackupMetadata | null {
    const data = tempFileCache.get(tempFileId);
    return data?.metadata || null;
  },

  async generateDiff(tempFileId: string, serverId: string): Promise<DiffResult> {
    const data = tempFileCache.get(tempFileId);
    if (!data) {
      throw new ImportError('Temp file not found or expired', 'BACKUP_NOT_FOUND');
    }

    const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      throw new ImportError('Server not found', 'SERVER_NOT_FOUND');
    }

    if (!data.extractPath) {
      const extractPath = path.join(config.paths.temp, tempFileId, 'extracted');
      await extractArchive(data.filePath, extractPath, data.archiveFormat);
      data.extractPath = extractPath;
    }

    const diffResult = await generateDiffs(
      data.extractPath,
      serverId,
      data.metadata
    );

    data.diffItems = diffResult.items;
    return diffResult;
  },

  async applyToServer(
    tempFileId: string,
    serverId: string,
    selections: DiffSelection[]
  ): Promise<ApplyResult> {
    const data = tempFileCache.get(tempFileId);
    if (!data) {
      throw new ImportError('Temp file not found or expired', 'BACKUP_NOT_FOUND');
    }

    if (!data.extractPath || !data.diffItems) {
      throw new ImportError(
        'Diffs must be generated before applying changes',
        'APPLY_FAILED'
      );
    }

    const [server] = await db
      .select({ id: servers.id, port: servers.port })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!server) {
      throw new ImportError('Server not found', 'SERVER_NOT_FOUND');
    }

    const backupRoot = path.join(data.extractPath, data.metadata.rootPath);

    const result = await applyChanges(
      serverId,
      backupRoot,
      selections,
      data.diffItems,
      server.port
    );

    if (result.success) {
      await this.cleanup(tempFileId);
    }

    return result;
  },

  async cleanup(tempFileId: string): Promise<void> {
    tempFileCache.delete(tempFileId);
    await deleteTempFile(tempFileId);
  },

  getTempFilePath,

  CONSTANTS: IMPORT_CONSTANTS,
};

export type {
  ValidationResult,
  BackupMetadata,
  DiffResult,
  DiffSelection,
  ApplyResult,
  UploadResponse,
  DiffItem,
} from './types.js';

export { ImportError, IMPORT_CONSTANTS } from './types.js';
