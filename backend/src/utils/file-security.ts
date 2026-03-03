import path from 'node:path';
import fs from 'node:fs';

/**
 * Sanitizes a file path by removing dangerous components.
 * Prevents path traversal attacks.
 */
export function sanitizePath(inputPath: string): string {
  // Remove null bytes
  let clean = inputPath.replace(/\0/g, '');

  // Normalize path separators to forward slashes
  clean = clean.replace(/\\/g, '/');

  // Remove leading slashes
  clean = clean.replace(/^\/+/, '');

  // Split and filter segments
  const segments = clean.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '..') {
      // Don't allow going above root - just ignore
      if (resolved.length > 0) {
        resolved.pop();
      }
    } else if (segment !== '.') {
      resolved.push(segment);
    }
  }

  return resolved.join('/');
}

/**
 * Checks if a child path is within a parent directory.
 */
export function isWithinDirectory(childPath: string, parentPath: string): boolean {
  const normalizedChild = path.resolve(childPath);
  const normalizedParent = path.resolve(parentPath);

  // Ensure parent ends with separator for accurate comparison
  const parentWithSep = normalizedParent.endsWith(path.sep)
    ? normalizedParent
    : normalizedParent + path.sep;

  return normalizedChild === normalizedParent || normalizedChild.startsWith(parentWithSep);
}

export type ResolvePathResult =
  | {
      valid: true;
      fullPath: string;
      relativePath: string;
    }
  | {
      valid: false;
      error: string;
    };

/**
 * Resolves a relative path within a server directory.
 * Returns the full path if valid, or an error if path traversal is detected.
 */
export function resolveServerPath(
  serverId: string,
  relativePath: string,
  serversDir: string
): ResolvePathResult {
  const serverDir = path.join(serversDir, serverId);

  // Check if server directory exists
  if (!fs.existsSync(serverDir)) {
    return { valid: false, error: 'Server directory not found' };
  }

  const sanitized = sanitizePath(relativePath);
  const fullPath = path.resolve(serverDir, sanitized);

  if (!isWithinDirectory(fullPath, serverDir)) {
    return { valid: false, error: 'Path traversal attempt detected' };
  }

  return {
    valid: true,
    fullPath,
    relativePath: sanitized
  };
}

/**
 * File extensions that can be edited as text.
 */
export const EDITABLE_EXTENSIONS = new Set([
  '.properties',
  '.yml',
  '.yaml',
  '.json',
  '.txt',
  '.cfg',
  '.conf',
  '.toml',
  '.xml',
  '.log',
  '.md',
  '.sk',      // Skript files
  '.sh',
  '.bat',
  '.cmd',
  '.csv',
  '.ini',
  '.htaccess',
]);

/**
 * Checks if a file can be edited as text based on extension.
 */
export function isEditableFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

/**
 * Files that should show a warning before editing.
 */
export const SENSITIVE_FILES = new Set([
  'server.jar',
  'eula.txt',
  'banned-ips.json',
  'banned-players.json',
  'ops.json',
  'whitelist.json',
]);

/**
 * Checks if a file is sensitive and should show a warning.
 */
export function isSensitiveFile(filename: string): boolean {
  return SENSITIVE_FILES.has(filename.toLowerCase());
}

/**
 * Maximum file size for text editing (1MB).
 */
export const MAX_EDITABLE_SIZE = 1024 * 1024;

/**
 * Default maximum upload size (100MB).
 */
export const DEFAULT_MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

/**
 * Gets file type category based on extension.
 */
export function getFileType(filename: string): 'text' | 'config' | 'image' | 'archive' | 'binary' {
  const ext = path.extname(filename).toLowerCase();

  const configExts = new Set(['.properties', '.yml', '.yaml', '.json', '.toml', '.xml', '.cfg', '.conf', '.ini']);
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);
  const archiveExts = new Set(['.zip', '.tar', '.gz', '.7z', '.rar']);
  const textExts = new Set(['.txt', '.md', '.log', '.sh', '.bat', '.cmd', '.sk', '.csv']);

  if (configExts.has(ext)) return 'config';
  if (imageExts.has(ext)) return 'image';
  if (archiveExts.has(ext)) return 'archive';
  if (textExts.has(ext)) return 'text';

  return 'binary';
}
