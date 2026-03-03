import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import type { ApplyResult, DiffSelection, DiffItem } from './types.js';

/**
 * Apply selected changes from a backup to a server.
 * Creates a snapshot before applying, rolls back on failure.
 * Preserves critical server settings (like port) after applying.
 */
export async function applyChanges(
  serverId: string,
  tempExtractPath: string,
  selections: DiffSelection[],
  diffItems: DiffItem[],
  serverPort?: number
): Promise<ApplyResult> {
  const serverPath = path.join(config.paths.servers, serverId);
  const snapshotPath = path.join(config.paths.temp, `${serverId}_snapshot_${Date.now()}`);

  // Verify server exists
  try {
    await fs.access(serverPath);
  } catch {
    return {
      success: false,
      applied: 0,
      error: 'Server not found',
      errorCode: 'SERVER_NOT_FOUND',
    };
  }

  // Create selection map for quick lookup
  const selectionMap = new Map(selections.map(s => [s.id, s.action]));

  // Filter diff items to only those with 'use-backup' action
  const itemsToApply = diffItems.filter(item => selectionMap.get(item.id) === 'use-backup');

  if (itemsToApply.length === 0) {
    return {
      success: true,
      applied: 0,
    };
  }

  // Check if server.properties will be modified - if so, read original ports first
  const serverPropertiesModified = itemsToApply.some(
    item => item.path === 'server.properties'
  );

  let originalPorts = new Map<string, string>();
  if (serverPropertiesModified && serverPort !== undefined) {
    const propsPath = path.join(serverPath, 'server.properties');
    originalPorts = await readNetworkPorts(propsPath);
  }

  try {
    // Step 1: Create snapshot of current server state
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.cp(serverPath, snapshotPath, { recursive: true });

    let appliedCount = 0;

    // Step 2: Apply each change
    for (const item of itemsToApply) {
      const serverItemPath = path.join(serverPath, item.path);
      const backupItemPath = path.join(tempExtractPath, item.path);

      try {
        switch (item.status) {
          case 'only-backup':
            // File/folder exists only in backup - copy to server
            await applyOnlyBackup(backupItemPath, serverItemPath, item.type);
            break;

          case 'only-server':
            // File/folder exists only on server - delete from server
            await applyOnlyServer(serverItemPath);
            break;

          case 'modified':
            // File exists in both but differs - replace server with backup
            await applyModified(backupItemPath, serverItemPath, item.type);
            break;
        }

        appliedCount++;
      } catch (err) {
        // Operation failed - rollback and return error
        await rollback(serverPath, snapshotPath);
        return {
          success: false,
          applied: 0,
          error: `Failed to apply change to ${item.path}: ${err instanceof Error ? err.message : String(err)}`,
          errorCode: 'APPLY_FAILED',
        };
      }
    }

    // Step 3: Preserve critical server settings (like ports) in server.properties
    if (serverPropertiesModified && serverPort !== undefined) {
      await preserveNetworkPorts(serverPath, serverPort, originalPorts);
    }

    // Step 4: Success - delete snapshot
    await fs.rm(snapshotPath, { recursive: true, force: true });

    return {
      success: true,
      applied: appliedCount,
    };
  } catch (err) {
    // Unexpected error - attempt rollback
    try {
      await rollback(serverPath, snapshotPath);
    } catch (rollbackErr) {
      // Rollback failed - critical error
      return {
        success: false,
        applied: 0,
        error: `Apply failed and rollback failed: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: 'APPLY_FAILED',
      };
    }

    return {
      success: false,
      applied: 0,
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'APPLY_FAILED',
    };
  }
}

/**
 * Apply a change for an item that exists only in backup (copy to server)
 */
async function applyOnlyBackup(backupPath: string, serverPath: string, type: 'file' | 'directory'): Promise<void> {
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(serverPath), { recursive: true });

  if (type === 'file') {
    await fs.copyFile(backupPath, serverPath);
  } else {
    await fs.cp(backupPath, serverPath, { recursive: true });
  }
}

/**
 * Apply a change for an item that exists only on server (delete from server)
 */
async function applyOnlyServer(serverPath: string): Promise<void> {
  await fs.rm(serverPath, { recursive: true, force: true });
}

/**
 * Apply a modified item (replace server with backup)
 */
async function applyModified(backupPath: string, serverPath: string, type: 'file' | 'directory'): Promise<void> {
  // Remove existing server item
  await fs.rm(serverPath, { recursive: true, force: true });

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(serverPath), { recursive: true });

  // Copy from backup
  if (type === 'file') {
    await fs.copyFile(backupPath, serverPath);
  } else {
    await fs.cp(backupPath, serverPath, { recursive: true });
  }
}

/**
 * Rollback by restoring snapshot
 */
async function rollback(serverPath: string, snapshotPath: string): Promise<void> {
  // Remove corrupted server directory
  await fs.rm(serverPath, { recursive: true, force: true });

  // Restore from snapshot
  await fs.cp(snapshotPath, serverPath, { recursive: true });

  // Clean up snapshot
  await fs.rm(snapshotPath, { recursive: true, force: true });
}

/**
 * Network properties that should be preserved from the current server when importing.
 * These ports are configured per-server and should not be overwritten by backup values.
 */
const PRESERVED_NETWORK_PROPERTIES = ['server-port', 'query.port'];

/**
 * Read network port properties from server.properties
 */
async function readNetworkPorts(propsPath: string): Promise<Map<string, string>> {
  const ports = new Map<string, string>();

  try {
    const content = await fs.readFile(propsPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      for (const prop of PRESERVED_NETWORK_PROPERTIES) {
        if (trimmed.startsWith(`${prop}=`)) {
          const value = trimmed.substring(prop.length + 1);
          ports.set(prop, value);
        }
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return ports;
}

/**
 * Preserve network ports in server.properties after importing from backup.
 * This ensures the configured ports aren't overwritten by the backup's ports.
 */
async function preserveNetworkPorts(
  serverPath: string,
  serverPort: number,
  originalPorts: Map<string, string>
): Promise<void> {
  const propsPath = path.join(serverPath, 'server.properties');

  try {
    const content = await fs.readFile(propsPath, 'utf-8');
    const lines = content.split('\n');
    const portsToSet = new Map<string, string>();

    // server-port always comes from database
    portsToSet.set('server-port', String(serverPort));

    // query.port comes from original file (if it existed)
    const originalQueryPort = originalPorts.get('query.port');
    if (originalQueryPort) {
      portsToSet.set('query.port', originalQueryPort);
    }

    const foundProps = new Set<string>();

    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      for (const [prop, value] of portsToSet) {
        if (trimmed.startsWith(`${prop}=`)) {
          foundProps.add(prop);
          return `${prop}=${value}`;
        }
      }
      return line;
    });

    // Add any properties that weren't found
    for (const [prop, value] of portsToSet) {
      if (!foundProps.has(prop)) {
        updatedLines.push(`${prop}=${value}`);
      }
    }

    await fs.writeFile(propsPath, updatedLines.join('\n'), 'utf-8');
  } catch (err) {
    console.warn(`[ImportApplier] Could not preserve network ports: ${err instanceof Error ? err.message : String(err)}`);
  }
}
