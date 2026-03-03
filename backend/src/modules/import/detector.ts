import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import * as path from 'node:path';
import * as yauzl from 'yauzl';
import * as nbt from 'prismarine-nbt';
import {
  type BackupMetadata,
  type BackupFormat,
  type ImportServerType,
  type ArchiveEntry,
  type ArchiveFormat,
  ImportError,
} from './types.js';

const execAsync = promisify(exec);

// Minecraft version mapping for DataVersion integers
// Source: https://minecraft.wiki/w/Data_version
const DATA_VERSION_MAP: Record<number, string> = {
  // 1.13.x
  1519: '1.13',
  1628: '1.13.1',
  1631: '1.13.2',
  // 1.14.x
  1952: '1.14',
  1957: '1.14.1',
  1963: '1.14.2',
  1968: '1.14.3',
  1976: '1.14.4',
  // 1.15.x
  2225: '1.15',
  2227: '1.15.1',
  2230: '1.15.2',
  // 1.16.x
  2566: '1.16',
  2567: '1.16.1',
  2578: '1.16.2',
  2580: '1.16.3',
  2584: '1.16.4',
  2586: '1.16.5',
  // 1.17.x
  2724: '1.17',
  2730: '1.17.1',
  // 1.18.x
  2860: '1.18',
  2865: '1.18.1',
  2975: '1.18.2',
  // 1.19.x
  3105: '1.19',
  3117: '1.19.1',
  3120: '1.19.2',
  3218: '1.19.3',
  3337: '1.19.4',
  // 1.20.x
  3463: '1.20',
  3465: '1.20.1',
  3578: '1.20.2',
  3698: '1.20.3',
  3700: '1.20.4',
  3837: '1.20.5',
  3839: '1.20.6',
  // 1.21.x
  3953: '1.21',
  3955: '1.21.1',
  4082: '1.21.2',
  4189: '1.21.3',
  4190: '1.21.4',
};

/**
 * List contents of a tar.gz archive
 */
async function listTarGzContents(filePath: string): Promise<ArchiveEntry[]> {
  const { stdout } = await execAsync(`tar -tzf "${filePath}"`, {
    maxBuffer: 10 * 1024 * 1024,
  });

  const entries: ArchiveEntry[] = [];
  const lines = stdout.trim().split('\n');

  for (const line of lines) {
    if (!line) continue;

    const isDirectory = line.endsWith('/');
    const cleanPath = isDirectory ? line.slice(0, -1) : line;
    const depth = cleanPath.split('/').length - 1;

    entries.push({
      path: cleanPath,
      isDirectory,
      size: 0, // tar -t doesn't provide size info easily
      depth,
    });
  }

  return entries;
}

/**
 * List contents of a zip archive
 */
async function listZipContents(filePath: string): Promise<ArchiveEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ArchiveEntry[] = [];

    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new ImportError('Failed to open zip archive', 'INVALID_ARCHIVE', err));
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const isDirectory = entry.fileName.endsWith('/');
        const cleanPath = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName;
        const depth = cleanPath.split('/').length - 1;

        entries.push({
          path: cleanPath,
          isDirectory,
          size: entry.uncompressedSize,
          depth,
        });

        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        resolve(entries);
      });

      zipfile.on('error', (err) => {
        reject(new ImportError('Error reading zip archive', 'EXTRACTION_FAILED', err));
      });
    });
  });
}

/**
 * List archive contents based on format
 */
export async function listArchiveContents(
  filePath: string,
  archiveFormat: ArchiveFormat
): Promise<ArchiveEntry[]> {
  if (archiveFormat === 'tar.gz') {
    return listTarGzContents(filePath);
  } else {
    return listZipContents(filePath);
  }
}

/**
 * Extract a single file from tar.gz archive to memory
 */
async function extractTarGzFile(archivePath: string, targetFile: string): Promise<Buffer> {
  try {
    const { stdout } = await execAsync(
      `tar -xzf "${archivePath}" -O "${targetFile}"`,
      {
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'buffer',
      }
    );
    return stdout as Buffer;
  } catch (err) {
    throw new ImportError('Failed to extract file from tar.gz', 'EXTRACTION_FAILED', err);
  }
}

/**
 * Extract a single file from zip archive to memory
 */
async function extractZipFile(archivePath: string, targetFile: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new ImportError('Failed to open zip archive', 'INVALID_ARCHIVE', err));
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName === targetFile) {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(new ImportError('Failed to read file from zip', 'EXTRACTION_FAILED', err));
              return;
            }

            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => resolve(Buffer.concat(chunks)));
            readStream.on('error', (err) =>
              reject(new ImportError('Stream error reading zip file', 'EXTRACTION_FAILED', err))
            );
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        reject(new ImportError('File not found in archive', 'MISSING_WORLD_DATA', { targetFile }));
      });

      zipfile.on('error', (err) => {
        reject(new ImportError('Error reading zip archive', 'EXTRACTION_FAILED', err));
      });
    });
  });
}

/**
 * Parse level.dat NBT data to extract Minecraft version
 */
async function parseLevelDat(data: Buffer): Promise<string | null> {
  try {
    // level.dat is gzipped NBT
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      gunzip.on('data', (chunk) => chunks.push(chunk));
      gunzip.on('end', async () => {
        try {
          const uncompressed = Buffer.concat(chunks);
          const { parsed } = await nbt.parse(uncompressed);

          // NBT structure is parsed as a nested object with 'value' properties
          // Access the data with proper type checking
          const data = parsed.value as any;

          // Try to extract version from Data.Version.Name (1.19+)
          if (data?.Data?.value?.Version?.value?.Name?.value) {
            resolve(data.Data.value.Version.value.Name.value as string);
            return;
          }

          // Fallback to DataVersion (integer mapping)
          if (data?.Data?.value?.DataVersion?.value !== undefined) {
            const dataVersion = data.Data.value.DataVersion.value as number;
            const mappedVersion = DATA_VERSION_MAP[dataVersion];
            if (mappedVersion) {
              resolve(mappedVersion);
              return;
            }
            // Unknown DataVersion - return it as-is
            resolve(`Unknown (DataVersion: ${dataVersion})`);
            return;
          }

          resolve(null);
        } catch (err) {
          reject(new ImportError('Failed to parse level.dat NBT', 'MISSING_WORLD_DATA', err));
        }
      });
      gunzip.on('error', (err) => {
        reject(new ImportError('Failed to decompress level.dat', 'MISSING_WORLD_DATA', err));
      });

      gunzip.write(data);
      gunzip.end();
    });
  } catch (err) {
    throw new ImportError('Failed to parse level.dat', 'MISSING_WORLD_DATA', err);
  }
}

/**
 * Parse server.properties to extract port
 */
function parseServerProperties(content: string): number | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('server-port=')) {
      const portStr = trimmed.split('=')[1]?.trim();
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}

/**
 * Detect backup format and extract metadata from archive
 */
export async function detectBackupFormat(
  filePath: string,
  archiveFormat: ArchiveFormat
): Promise<BackupMetadata> {
  const entries = await listArchiveContents(filePath, archiveFormat);

  // Analyze entries to detect format
  let format: BackupFormat = 'generic';
  let rootPath = '';
  let serverType: ImportServerType = 'vanilla';
  let minecraftVersion: string | null = null;
  let serverName: string | null = null;
  let port: number | null = null;
  let worldName: string | null = null;
  const dimensions: string[] = [];
  const jarFiles: string[] = [];

  // Check for Allay backup format: {uuid}/server.properties at root
  const allayPattern = entries.find((e) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/server\.properties$/i.test(e.path)
  );

  if (allayPattern) {
    format = 'allay';
    rootPath = allayPattern.path.split('/')[0];
    serverName = rootPath; // Use UUID as default server name
  }

  // Find world folder and level.dat
  const levelDatPath = entries.find((e) => e.path.endsWith('world/level.dat'))?.path;
  const hasWorldFolder = entries.some((e) => e.path.includes('world/'));

  if (!hasWorldFolder) {
    throw new ImportError('No world data found in archive', 'MISSING_WORLD_DATA');
  }

  // Detect world-only format: only has world/ folder without server.properties
  const hasServerProperties = entries.some((e) => e.path.endsWith('server.properties'));
  if (!hasServerProperties && hasWorldFolder) {
    format = 'world-only';
    // Extract root path for world-only (everything before 'world/')
    const worldEntry = entries.find((e) => e.path.includes('world/'));
    if (worldEntry) {
      const parts = worldEntry.path.split('/');
      const worldIndex = parts.indexOf('world');
      if (worldIndex > 0) {
        rootPath = parts.slice(0, worldIndex).join('/');
      }
    }
  }

  // Detect server type: check for plugins/ folder (Paper/Spigot)
  const hasPlugins = entries.some((e) => e.path.includes('plugins/'));
  if (hasPlugins) {
    serverType = 'paper';
  }

  // Extract Minecraft version from level.dat
  if (levelDatPath) {
    try {
      const levelDatData = archiveFormat === 'tar.gz'
        ? await extractTarGzFile(filePath, levelDatPath)
        : await extractZipFile(filePath, levelDatPath);

      minecraftVersion = await parseLevelDat(levelDatData);
    } catch (err) {
      console.warn('[detector] Failed to parse level.dat:', err);
      // Continue without version info
    }
  }

  // Find JAR files
  for (const entry of entries) {
    if (entry.path.endsWith('.jar') && !entry.isDirectory) {
      jarFiles.push(entry.path);
    }
  }

  // Extract port from server.properties if present
  if (hasServerProperties) {
    const serverPropsPath = entries.find((e) => e.path.endsWith('server.properties'))?.path;
    if (serverPropsPath) {
      try {
        const propsData = archiveFormat === 'tar.gz'
          ? await extractTarGzFile(filePath, serverPropsPath)
          : await extractZipFile(filePath, serverPropsPath);

        port = parseServerProperties(propsData.toString('utf-8'));
      } catch (err) {
        console.warn('[detector] Failed to parse server.properties:', err);
      }
    }
  }

  // Detect dimensions
  const dimensionPatterns = ['world_nether', 'world_the_end', 'DIM-1', 'DIM1'];
  for (const pattern of dimensionPatterns) {
    if (entries.some((e) => e.path.includes(pattern))) {
      dimensions.push(pattern);
    }
  }

  // Generate server name from archive filename if not set
  if (!serverName) {
    const basename = path.basename(filePath, path.extname(filePath));
    // Remove .tar from .tar.gz
    serverName = basename.replace(/\.tar$/, '');
  }

  // Extract world name (usually 'world' but could be custom)
  const worldEntry = entries.find((e) => e.path.includes('/level.dat'));
  if (worldEntry) {
    const parts = worldEntry.path.split('/');
    const levelIndex = parts.indexOf('level.dat');
    if (levelIndex > 0) {
      worldName = parts[levelIndex - 1];
    }
  }

  // Calculate estimated size
  const estimatedSize = entries.reduce((sum, e) => sum + e.size, 0);

  return {
    format,
    serverType,
    minecraftVersion,
    hasJars: jarFiles.length > 0,
    jarFiles,
    serverName,
    port,
    estimatedSize,
    worldName,
    hasDimensions: dimensions.length > 0,
    dimensions,
    rootPath,
  };
}
