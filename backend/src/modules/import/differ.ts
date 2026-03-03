import { createHash } from 'node:crypto';
import { readdir, stat, readFile, mkdir } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  DiffItem,
  DiffResult,
  DiffCategory,
  DiffStatus,
  BackupMetadata,
  ArchiveFormat,
} from './types.js';
import {
  IMPORT_CONSTANTS,
  TEXT_EXTENSIONS,
  CONFIG_PATTERNS,
  WORLD_PATTERNS,
  PLUGIN_PATTERN,
  ImportError,
} from './types.js';
import { config } from '../../config.js';

const execAsync = promisify(exec);

/**
 * Extract an archive to a destination directory
 */
export async function extractArchive(
  filePath: string,
  destPath: string,
  archiveFormat: ArchiveFormat
): Promise<void> {
  // Ensure destination exists
  await mkdir(destPath, { recursive: true });

  try {
    if (archiveFormat === 'tar.gz') {
      await execAsync(`tar -xzf "${filePath}" -C "${destPath}"`, {
        maxBuffer: 100 * 1024 * 1024,
      });
    } else if (archiveFormat === 'zip') {
      // Exclude __MACOSX folder (macOS artifact)
      await execAsync(`unzip -q "${filePath}" -d "${destPath}" -x "__MACOSX/*"`, {
        maxBuffer: 100 * 1024 * 1024,
      });
    } else {
      throw new ImportError(
        `Unsupported archive format: ${archiveFormat}`,
        'UNSUPPORTED_FORMAT'
      );
    }
  } catch (err: any) {
    throw new ImportError(
      `Failed to extract archive: ${err.message}`,
      'EXTRACTION_FAILED',
      err
    );
  }
}

/**
 * Recursively list all files in a directory
 */
async function listFiles(dirPath: string, basePath: string = dirPath): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip OS artifacts (macOS, Windows, Linux)
      const skipPatterns = [
        '__MACOSX',      // macOS archive folder
        '.DS_Store',     // macOS folder metadata
        'Thumbs.db',     // Windows thumbnails
        'desktop.ini',   // Windows folder settings
        '.Trash-1000',   // Linux trash
      ];
      if (
        skipPatterns.includes(entry.name) ||
        entry.name.startsWith('._') ||      // macOS resource forks
        entry.name.startsWith('.Trash-')    // Linux trash folders
      ) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const relativePath = relative(basePath, fullPath);
        files.push(relativePath);
      }
    }
  }

  await scan(dirPath);
  return files;
}

/**
 * Compute MD5 hash of a file
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('md5').update(content).digest('hex');
}

/**
 * Categorize a file path
 */
function categorizeFile(filePath: string): DiffCategory {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = basename(filePath);

  // Check plugin pattern first
  if (PLUGIN_PATTERN.test(normalizedPath)) {
    return 'plugins';
  }

  // Check world patterns
  const pathParts = normalizedPath.split('/');
  for (const part of pathParts) {
    if (WORLD_PATTERNS.some(pattern => pattern.test(part))) {
      return 'world';
    }
  }

  // Check config patterns
  if (CONFIG_PATTERNS.some(pattern => pattern.test(fileName))) {
    return 'config';
  }

  return 'other';
}

/**
 * Check if a file is a text file
 */
function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Generate preview for a text file
 */
async function generatePreview(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const stats = await stat(filePath);
  if (stats.size > IMPORT_CONSTANTS.TEXT_PREVIEW_MAX_SIZE) {
    return undefined;
  }

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const preview = lines.slice(0, IMPORT_CONSTANTS.TEXT_PREVIEW_LINES).join('\n');

  return preview;
}

/**
 * Generate diffs between backup and server
 */
export async function generateDiffs(
  tempExtractPath: string,
  serverId: string,
  metadata: BackupMetadata
): Promise<DiffResult> {
  // Determine the actual root path within the extracted archive
  const backupRoot = join(tempExtractPath, metadata.rootPath);

  if (!existsSync(backupRoot)) {
    throw new ImportError(
      `Backup root path not found: ${metadata.rootPath}`,
      'EXTRACTION_FAILED'
    );
  }

  // Get server directory from database or config
  const serverPath = join(config.paths.servers, serverId);

  if (!existsSync(serverPath)) {
    throw new ImportError(
      `Server directory not found: ${serverId}`,
      'SERVER_NOT_FOUND'
    );
  }

  // List all files in both directories
  const backupFiles = await listFiles(backupRoot);
  const serverFiles = await listFiles(serverPath);

  const backupSet = new Set(backupFiles);
  const serverSet = new Set(serverFiles);

  const items: DiffItem[] = [];
  const allFiles = new Set([...backupFiles, ...serverFiles]);

  // Process each file
  for (const filePath of allFiles) {
    const inBackup = backupSet.has(filePath);
    const inServer = serverSet.has(filePath);

    let status: DiffStatus;
    if (inBackup && !inServer) {
      status = 'only-backup';
    } else if (!inBackup && inServer) {
      status = 'only-server';
    } else {
      // Both exist, check if modified
      const backupFilePath = join(backupRoot, filePath);
      const serverFilePath = join(serverPath, filePath);

      const backupHash = await computeFileHash(backupFilePath);
      const serverHash = await computeFileHash(serverFilePath);

      if (backupHash === serverHash) {
        // Files are identical, skip
        continue;
      }

      status = 'modified';
    }

    const category = categorizeFile(filePath);
    const isText = isTextFile(filePath);
    const isJar = filePath.toLowerCase().endsWith('.jar');

    const backupFilePath = join(backupRoot, filePath);
    const serverFilePath = join(serverPath, filePath);

    let backupSize: number | undefined;
    let serverSize: number | undefined;
    let backupPreview: string | undefined;
    let serverPreview: string | undefined;

    if (inBackup) {
      const stats = await stat(backupFilePath);
      backupSize = stats.size;

      if (isText && stats.size <= IMPORT_CONSTANTS.TEXT_PREVIEW_MAX_SIZE) {
        backupPreview = await generatePreview(backupFilePath);
      }
    }

    if (inServer) {
      const stats = await stat(serverFilePath);
      serverSize = stats.size;

      if (isText && stats.size <= IMPORT_CONSTANTS.TEXT_PREVIEW_MAX_SIZE) {
        serverPreview = await generatePreview(serverFilePath);
      }
    }

    items.push({
      id: randomUUID(),
      path: filePath,
      category,
      type: 'file',
      status,
      backupSize,
      serverSize,
      isText,
      backupPreview,
      serverPreview,
      isJar,
    });
  }

  // Generate summary
  const summary = {
    totalDiffs: items.length,
    byCategory: {
      config: items.filter(i => i.category === 'config').length,
      world: items.filter(i => i.category === 'world').length,
      plugins: items.filter(i => i.category === 'plugins').length,
      other: items.filter(i => i.category === 'other').length,
    },
    byStatus: {
      'only-backup': items.filter(i => i.status === 'only-backup').length,
      'only-server': items.filter(i => i.status === 'only-server').length,
      modified: items.filter(i => i.status === 'modified').length,
    },
  };

  return {
    items,
    summary,
  };
}
