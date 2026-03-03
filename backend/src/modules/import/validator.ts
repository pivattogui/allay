import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as tar from 'tar';
import * as yauzl from 'yauzl';
import type {
  ValidationResult,
  ArchiveEntry,
  ArchiveFormat,
} from './types.js';
import { IMPORT_CONSTANTS } from './types.js';

/**
 * Promisified version of yauzl.open
 */
function openZipFile(filePath: string, options: yauzl.Options): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, options, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile!);
    });
  });
}

/**
 * Validate an uploaded archive file (tar.gz or zip)
 *
 * Performs the following checks:
 * - Magic bytes validation (tar.gz: 1f 8b, zip: 50 4b)
 * - Archive integrity verification
 * - File count limit (max 100,000)
 * - Directory depth limit (max 10 levels)
 * - Estimated decompressed size calculation
 * - Zip bomb detection (max 50x compression ratio)
 * - Available disk space verification (need 2x estimated size)
 */
export async function validateArchive(filePath: string): Promise<ValidationResult> {
  try {
    // Check file exists
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return {
        valid: false,
        error: 'Path is not a file',
        errorCode: 'INVALID_ARCHIVE',
      };
    }

    // Check file size limit
    if (stats.size > IMPORT_CONSTANTS.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${IMPORT_CONSTANTS.MAX_FILE_SIZE / (1024 ** 3)}GB`,
        errorCode: 'FILE_TOO_LARGE',
      };
    }

    // Read magic bytes
    const format = await detectFormat(filePath);
    if (!format) {
      return {
        valid: false,
        error: 'Unsupported archive format. Only tar.gz and zip are supported.',
        errorCode: 'UNSUPPORTED_FORMAT',
      };
    }

    // Validate archive based on format
    let entries: ArchiveEntry[];
    try {
      if (format === 'tar.gz') {
        entries = await validateTarGz(filePath);
      } else {
        entries = await validateZip(filePath);
      }
    } catch (err) {
      return {
        valid: false,
        error: `Archive integrity check failed: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: 'INVALID_ARCHIVE',
      };
    }

    // Check file count
    if (entries.length > IMPORT_CONSTANTS.MAX_FILE_COUNT) {
      return {
        valid: false,
        error: `Archive contains too many files (${entries.length} > ${IMPORT_CONSTANTS.MAX_FILE_COUNT})`,
        errorCode: 'TOO_MANY_FILES',
      };
    }

    // Check max depth
    const maxDepth = Math.max(...entries.map(e => e.depth));
    if (maxDepth > IMPORT_CONSTANTS.MAX_DEPTH) {
      return {
        valid: false,
        error: `Archive has excessive directory depth (${maxDepth} > ${IMPORT_CONSTANTS.MAX_DEPTH})`,
        errorCode: 'INVALID_ARCHIVE',
      };
    }

    // Check for path traversal attempts
    for (const entry of entries) {
      const normalized = path.normalize(entry.path);
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        return {
          valid: false,
          error: `Archive contains suspicious path: ${entry.path}`,
          errorCode: 'PATH_TRAVERSAL',
        };
      }
    }

    // Calculate estimated decompressed size
    const estimatedSize = entries.reduce((sum, entry) => sum + entry.size, 0);

    // Check for zip bomb (compression ratio)
    const compressionRatio = estimatedSize / stats.size;
    if (compressionRatio > IMPORT_CONSTANTS.MAX_DECOMPRESSION_RATIO) {
      return {
        valid: false,
        error: `Suspected zip bomb: compression ratio ${compressionRatio.toFixed(1)}x exceeds maximum of ${IMPORT_CONSTANTS.MAX_DECOMPRESSION_RATIO}x`,
        errorCode: 'ZIP_BOMB',
      };
    }

    // Check available disk space (need 2x estimated size)
    const requiredSpace = estimatedSize * 2;
    const availableSpace = await getAvailableDiskSpace(path.dirname(filePath));
    if (availableSpace !== null && availableSpace < requiredSpace) {
      return {
        valid: false,
        error: `Insufficient disk space. Required: ${(requiredSpace / (1024 ** 3)).toFixed(2)}GB, Available: ${(availableSpace / (1024 ** 3)).toFixed(2)}GB`,
        errorCode: 'DISK_FULL',
      };
    }

    return {
      valid: true,
      format,
      fileCount: entries.length,
      estimatedSize,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: 'INVALID_ARCHIVE',
    };
  }
}

/**
 * Detect archive format by reading magic bytes
 */
async function detectFormat(filePath: string): Promise<ArchiveFormat | null> {
  const buffer = Buffer.allocUnsafe(2);
  const handle = await fs.open(filePath, 'r');

  try {
    await handle.read(buffer, 0, 2, 0);

    // tar.gz: 1f 8b (gzip magic bytes)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return 'tar.gz';
    }

    // zip: 50 4b (PK signature)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return 'zip';
    }

    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Validate tar.gz archive and extract entry metadata
 */
async function validateTarGz(filePath: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);

    stream
      .pipe(tar.list({
        onentry: (entry: tar.ReadEntry) => {
          // Calculate depth by counting path separators
          const depth = entry.path.split('/').filter(Boolean).length - 1;

          entries.push({
            path: entry.path,
            isDirectory: entry.type === 'Directory',
            size: entry.size || 0,
            depth,
          });
        },
      }))
      .on('finish', () => resolve(entries))
      .on('error', (err: Error) => reject(err));
  });
}

/**
 * Validate zip archive and extract entry metadata
 */
async function validateZip(filePath: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  const zipfile = await openZipFile(filePath, { lazyEntries: true });

  return new Promise((resolve, reject) => {
    zipfile.on('entry', (entry: yauzl.Entry) => {
      // Calculate depth by counting path separators
      const depth = entry.fileName.split('/').filter(Boolean).length - 1;

      entries.push({
        path: entry.fileName,
        isDirectory: /\/$/.test(entry.fileName),
        size: entry.uncompressedSize,
        depth,
      });

      // Continue reading entries
      zipfile.readEntry();
    });

    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', (err) => reject(err));

    // Start reading entries
    zipfile.readEntry();
  });
}

/**
 * Get available disk space in bytes for a given path
 * Returns null if unable to determine
 */
async function getAvailableDiskSpace(dirPath: string): Promise<number | null> {
  try {
    // Try using statvfs if available (Unix-like systems)
    const { statfs } = await import('node:fs');
    const promisifiedStatfs = promisify(statfs);

    const stats = await promisifiedStatfs(dirPath) as any;
    // Available space = block size * available blocks
    return stats.bsize * stats.bavail;
  } catch (err) {
    // Fallback: unable to determine disk space
    // This is acceptable - validation will proceed without disk space check
    console.warn('[validator] Unable to check disk space:', err);
    return null;
  }
}
