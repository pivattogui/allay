import * as cron from 'node-cron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { IMPORT_CONSTANTS } from './types.js';

let cleanupJob: cron.ScheduledTask | null = null;

/**
 * Clean up abandoned import files older than 1 hour
 */
async function cleanupAbandonedFiles(): Promise<void> {
  try {
    const tempDir = config.paths.temp;

    // Ensure temp directory exists
    try {
      await fs.access(tempDir);
    } catch {
      // Directory doesn't exist, nothing to clean
      return;
    }

    const files = await fs.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
      try {
        const filePath = path.join(tempDir, file);
        const stat = await fs.stat(filePath);

        // File older than 1 hour is considered abandoned
        if (now - stat.mtimeMs > IMPORT_CONSTANTS.ABANDONED_FILE_AGE_MS) {
          await fs.rm(filePath, { recursive: true, force: true });
          console.log(`[ImportCleanup] Cleaned up abandoned file: ${file}`);
        }
      } catch (err) {
        console.error(`[ImportCleanup] Failed to process file ${file}:`, err);
      }
    }
  } catch (err) {
    console.error('[ImportCleanup] Cleanup job failed:', err);
  }
}

/**
 * Initialize the cleanup job - runs every 15 minutes
 */
export function initializeCleanupJob(): void {
  if (cleanupJob) {
    cleanupJob.stop();
  }

  // Run every 15 minutes
  cleanupJob = cron.schedule('*/15 * * * *', cleanupAbandonedFiles);
  console.log('[ImportCleanup] Initialized cleanup job (every 15 minutes)');
}

/**
 * Stop the cleanup job
 */
export function stopCleanupJob(): void {
  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
    console.log('[ImportCleanup] Stopped cleanup job');
  }
}

/**
 * Manually trigger cleanup (useful for testing or immediate cleanup)
 */
export async function runCleanup(): Promise<void> {
  await cleanupAbandonedFiles();
}

/**
 * Delete a specific temp file by ID
 */
export async function deleteTempFile(tempFileId: string): Promise<void> {
  const filePath = path.join(config.paths.temp, tempFileId);

  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch (err) {
    // Ignore if file doesn't exist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Get the full path for a temp file ID
 */
export function getTempFilePath(tempFileId: string): string {
  // Prevent path traversal
  const sanitized = path.basename(tempFileId);
  return path.join(config.paths.temp, sanitized);
}

/**
 * Ensure temp directory exists
 */
export async function ensureTempDir(): Promise<void> {
  await fs.mkdir(config.paths.temp, { recursive: true });
}
