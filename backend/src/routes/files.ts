import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { servers } from '../db/schema.js';
import { config } from '../config.js';
import {
  resolveServerPath,
  isEditableFile,
  isSensitiveFile,
  getFileType,
  MAX_EDITABLE_SIZE,
} from '../utils/file-security.js';
import path from 'node:path';
import fs from 'node:fs';
import { importManager, ImportError } from '../modules/import/index.js';
import { ApplyChangesSchema } from '../modules/import/types.js';
import * as serverProxy from '../modules/agent/server-proxy.js';
import type { JwtPayload } from '../types/index.js';
import {
  ListDirBody,
  ListDirResponse,
  WriteFileBody,
  RenameBody,
  RenameResponse,
  ImportDiffBody,
  ImportApplyBody,
} from '../schemas/files.js';
import { ErrorResponse } from '../schemas/common.js';

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  extension?: string;
  editable?: boolean;
  sensitive?: boolean;
  fileType?: 'text' | 'config' | 'image' | 'archive' | 'binary';
}

const getServer = async (id: string) => {
  const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  return server ?? null;
};

export const filesRoutes = new Elysia({ prefix: '/api/servers', detail: { tags: ['files'] } })
  .use(jwt({ name: 'jwt', secret: config.jwt.secret, exp: config.jwt.expiresIn }))
  .resolve(async ({ jwt: jwtPlugin, headers, set }) => {
    const auth = headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Unauthorized');
    }
    const payload = await jwtPlugin.verify(auth.slice(7));
    if (!payload) {
      set.status = 401;
      throw new Error('Unauthorized');
    }
    return { user: payload as unknown as JwtPayload };
  })
  .post('/:id/files/list', async ({ params, body, set }) => {
    const { id } = params;
    const { path: relativePath = '' } = (body || {}) as { path?: string };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    // Proxy to agent for remote servers
    if (server.nodeId) {
      try {
        const agentEntries = await serverProxy.listFiles(server, relativePath);
        const entries: FileEntry[] = (agentEntries || []).map((e: any) => ({
          name: e.name,
          type: e.isDir ? 'directory' : 'file',
          size: e.isDir ? 0 : (e.size || 0),
          modified: e.modTime || new Date().toISOString(),
          extension: e.isDir ? undefined : path.extname(e.name).toLowerCase() || undefined,
          editable: e.isDir ? undefined : isEditableFile(e.name),
          sensitive: e.isDir ? undefined : isSensitiveFile(e.name),
          fileType: e.isDir ? undefined : getFileType(e.name),
        }));
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return { path: relativePath || '/', entries };
      } catch (err) {
        set.status = 500;
        return { error: 'Failed to list files on agent', code: 'AGENT_ERROR' };
      }
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    const { fullPath } = resolved;

    if (!fs.existsSync(fullPath)) {
      set.status = 404;
      return { error: 'Directory not found', code: 'DIRECTORY_NOT_FOUND' };
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      set.status = 400;
      return { error: 'Path is not a directory', code: 'NOT_A_DIRECTORY' };
    }

    const items = fs.readdirSync(fullPath);
    const entries: FileEntry[] = [];

    for (const item of items) {
      try {
        const itemPath = path.join(fullPath, item);
        const itemStat = fs.statSync(itemPath);
        const isDir = itemStat.isDirectory();
        const ext = isDir ? undefined : path.extname(item).toLowerCase();

        entries.push({
          name: item,
          type: isDir ? 'directory' : 'file',
          size: isDir ? 0 : itemStat.size,
          modified: itemStat.mtime.toISOString(),
          extension: ext || undefined,
          editable: isDir ? undefined : isEditableFile(item),
          sensitive: isDir ? undefined : isSensitiveFile(item),
          fileType: isDir ? undefined : getFileType(item),
        });
      } catch {
        // Skip items we can't stat
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { path: resolved.relativePath || '/', entries };
  }, {
    params: t.Object({
      id: t.String({ description: 'Server ID' }),
    }),
    body: ListDirBody,
    response: {
      200: ListDirResponse,
      400: ErrorResponse,
      404: ErrorResponse,
    },
    detail: {
      summary: 'List directory contents',
      description: 'List files and directories in a server directory',
      security: [{ bearerAuth: [] }],
    },
  })
  .get('/:id/files/read/*', async ({ params, query, set }) => {
    const { id } = params as { id: string; '*': string };
    const relativePath = (params as { id: string; '*': string })['*'] || '';
    const encoding = (query as Record<string, string>).encoding === 'base64' ? 'base64' : 'utf8';

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    const { fullPath } = resolved;

    if (!fs.existsSync(fullPath)) {
      set.status = 404;
      return { error: 'File not found', code: 'FILE_NOT_FOUND' };
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      set.status = 400;
      return { error: 'Path is a directory, use list endpoint', code: 'IS_DIRECTORY' };
    }

    const filename = path.basename(fullPath);
    const editable = isEditableFile(filename);
    const sensitive = isSensitiveFile(filename);
    const fileType = getFileType(filename);

    if (stat.size > MAX_EDITABLE_SIZE) {
      return {
        path: resolved.relativePath, name: filename, size: stat.size,
        modified: stat.mtime.toISOString(), editable: false, sensitive, fileType,
        tooLarge: true, content: null, encoding: null,
      };
    }

    if (!editable && encoding === 'utf8') {
      return {
        path: resolved.relativePath, name: filename, size: stat.size,
        modified: stat.mtime.toISOString(), editable: false, sensitive, fileType,
        content: null, encoding: null, message: 'File is not editable. Use download endpoint.',
      };
    }

    try {
      const content = fs.readFileSync(fullPath, encoding === 'base64' ? 'base64' : 'utf8');
      return {
        path: resolved.relativePath, name: filename, size: stat.size,
        modified: stat.mtime.toISOString(), editable, sensitive, fileType, content, encoding,
      };
    } catch {
      set.status = 500;
      return { error: 'Failed to read file', code: 'READ_ERROR' };
    }
  }, {
    query: t.Object({
      encoding: t.Optional(t.Union([t.Literal('utf8'), t.Literal('base64')], { description: 'File encoding (default: utf8)' })),
    }),
    detail: {
      summary: 'Read file contents',
      description: 'Read the contents of a file from the server. Path after /read/ is the file path.',
      security: [{ bearerAuth: [] }],
    },
  })
  .put('/:id/files/write/*', async ({ params, body, set }) => {
    const { id } = params as { id: string; '*': string };
    const relativePath = (params as { id: string; '*': string })['*'] || '';
    const { content } = (body || {}) as { content: string };

    if (typeof content !== 'string') {
      set.status = 400;
      return { error: 'Content is required', code: 'CONTENT_REQUIRED' };
    }

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    const { fullPath } = resolved;
    const filename = path.basename(fullPath);
    const sensitive = isSensitiveFile(filename);

    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      fs.writeFileSync(fullPath, content, 'utf8');
      const stat = fs.statSync(fullPath);
      return { success: true, path: resolved.relativePath, size: stat.size, sensitive };
    } catch {
      set.status = 500;
      return { error: 'Failed to write file', code: 'WRITE_ERROR' };
    }
  }, {
    body: WriteFileBody,
    detail: {
      summary: 'Write file contents',
      description: 'Create or overwrite a file with new content. Path after /write/ is the file path.',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/mkdir/*', async ({ params, set }) => {
    const { id } = params as { id: string; '*': string };
    const relativePath = (params as { id: string; '*': string })['*'] || '';

    if (!relativePath) {
      set.status = 400;
      return { error: 'Directory name is required', code: 'NAME_REQUIRED' };
    }

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    if (fs.existsSync(resolved.fullPath)) {
      set.status = 400;
      return { error: 'Path already exists', code: 'ALREADY_EXISTS' };
    }

    try {
      fs.mkdirSync(resolved.fullPath, { recursive: true });
      return { success: true, path: resolved.relativePath };
    } catch {
      set.status = 500;
      return { error: 'Failed to create directory', code: 'MKDIR_ERROR' };
    }
  }, {
    detail: {
      summary: 'Create directory',
      description: 'Create a new directory in the server file system. Path after /mkdir/ is the directory path.',
      security: [{ bearerAuth: [] }],
    },
  })
  .delete('/:id/files/*', async ({ params, set }) => {
    const { id } = params as { id: string; '*': string };
    const relativePath = (params as { id: string; '*': string })['*'] || '';

    if (!relativePath) {
      set.status = 400;
      return { error: 'Cannot delete root directory', code: 'CANNOT_DELETE_ROOT' };
    }

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    if (!fs.existsSync(resolved.fullPath)) {
      set.status = 404;
      return { error: 'File or directory not found', code: 'NOT_FOUND' };
    }

    try {
      const stat = fs.statSync(resolved.fullPath);
      fs.rmSync(resolved.fullPath, { recursive: true, force: true });
      return { success: true, path: resolved.relativePath, type: stat.isDirectory() ? 'directory' : 'file' };
    } catch {
      set.status = 500;
      return { error: 'Failed to delete', code: 'DELETE_ERROR' };
    }
  }, {
    detail: {
      summary: 'Delete file or directory',
      description: 'Delete a file or directory from the server file system. Path after /files/ is the target path.',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/rename', async ({ params, body, set }) => {
    const { id } = params;
    const { oldPath, newPath } = (body || {}) as { oldPath: string; newPath: string };

    if (!oldPath || !newPath) {
      set.status = 400;
      return { error: 'Both oldPath and newPath are required', code: 'PATHS_REQUIRED' };
    }

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolvedOld = resolveServerPath(id, oldPath, config.paths.servers);
    if (!resolvedOld.valid) {
      set.status = 400;
      return { error: resolvedOld.error, code: 'INVALID_OLD_PATH' };
    }

    const resolvedNew = resolveServerPath(id, newPath, config.paths.servers);
    if (!resolvedNew.valid) {
      set.status = 400;
      return { error: resolvedNew.error, code: 'INVALID_NEW_PATH' };
    }

    if (!fs.existsSync(resolvedOld.fullPath)) {
      set.status = 404;
      return { error: 'Source file or directory not found', code: 'SOURCE_NOT_FOUND' };
    }

    if (fs.existsSync(resolvedNew.fullPath)) {
      set.status = 400;
      return { error: 'Destination already exists', code: 'DESTINATION_EXISTS' };
    }

    try {
      const parentDir = path.dirname(resolvedNew.fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.renameSync(resolvedOld.fullPath, resolvedNew.fullPath);
      return { success: true, oldPath: resolvedOld.relativePath, newPath: resolvedNew.relativePath };
    } catch {
      set.status = 500;
      return { error: 'Failed to rename', code: 'RENAME_ERROR' };
    }
  }, {
    params: t.Object({
      id: t.String({ description: 'Server ID' }),
    }),
    body: RenameBody,
    response: {
      200: RenameResponse,
      400: ErrorResponse,
      404: ErrorResponse,
      500: ErrorResponse,
    },
    detail: {
      summary: 'Rename file or directory',
      description: 'Rename or move a file or directory within the server file system',
      security: [{ bearerAuth: [] }],
    },
  })
  .get('/:id/files/download/*', async ({ params, set }) => {
    const { id } = params as { id: string; '*': string };
    const relativePath = (params as { id: string; '*': string })['*'] || '';

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, relativePath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    if (!fs.existsSync(resolved.fullPath)) {
      set.status = 404;
      return { error: 'File not found', code: 'FILE_NOT_FOUND' };
    }

    const stat = fs.statSync(resolved.fullPath);
    if (stat.isDirectory()) {
      set.status = 400;
      return { error: 'Directory download not yet implemented. Use backup feature.', code: 'DIR_DOWNLOAD_NOT_IMPLEMENTED' };
    }

    const filename = path.basename(resolved.fullPath);
    set.headers['Content-Type'] = 'application/octet-stream';
    set.headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    set.headers['Content-Length'] = String(stat.size);
    return Bun.file(resolved.fullPath);
  }, {
    detail: {
      summary: 'Download file',
      description: 'Download a file from the server as binary data. Path after /download/ is the file path.',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/upload', async ({ params, query, request, set }) => {
    const { id } = params as { id: string };
    const targetPath = (query as Record<string, string>).path || '';

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const resolved = resolveServerPath(id, targetPath, config.paths.servers);
    if (!resolved.valid) {
      set.status = 400;
      return { error: resolved.error, code: 'INVALID_PATH' };
    }

    const { fullPath: targetDir } = resolved;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      set.status = 400;
      return { error: 'Target path is not a directory', code: 'NOT_A_DIRECTORY' };
    }

    const uploadedFiles: { name: string; size: number }[] = [];

    try {
      const formData = await request.formData();

      for (const [, value] of formData) {
        if (value instanceof File) {
          const safeName = path.basename(value.name);
          const filePath = path.join(targetDir, safeName);

          await Bun.write(filePath, value);

          const fileStat = fs.statSync(filePath);
          uploadedFiles.push({ name: safeName, size: fileStat.size });
        }
      }

      return { success: true, uploaded: uploadedFiles, count: uploadedFiles.length };
    } catch (err) {
      console.error('Upload error:', err);
      set.status = 500;
      return { error: 'Failed to upload files', code: 'UPLOAD_ERROR' };
    }
  }, {
    query: t.Object({
      path: t.Optional(t.String({ description: 'Target directory path (default: root)' })),
    }),
    detail: {
      summary: 'Upload files',
      description: 'Upload one or more files to a server directory',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/import/upload', async ({ params, request, set }) => {
    const { id } = params as { id: string };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        set.status = 400;
        return { error: 'No file uploaded', code: 'INVALID_ARCHIVE' };
      }

      const filename = file.name.toLowerCase();
      if (!filename.endsWith('.tar.gz') && !filename.endsWith('.tgz') && !filename.endsWith('.zip')) {
        set.status = 400;
        return { error: 'Invalid file type. Only .tar.gz and .zip are supported.', code: 'UNSUPPORTED_FORMAT' };
      }

      const nodeStream = Readable.fromWeb(file.stream() as ReadableStream<Uint8Array>);
      const result = await importManager.handleUpload(nodeStream, file.name);
      return result;
    } catch (err) {
      if (err instanceof ImportError) {
        set.status = 400;
        return { error: err.message, code: err.code, details: err.details };
      }
      throw err;
    }
  }, {
    detail: {
      summary: 'Upload backup for import',
      description: 'Upload a backup archive (.tar.gz or .zip) for importing into a server',
      security: [{ bearerAuth: [] }],
    },
  })
  .get('/:id/files/import/:tempFileId/metadata', async ({ params, set }) => {
    const { id, tempFileId } = params as { id: string; tempFileId: string };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const metadata = importManager.getMetadata(tempFileId);
    if (!metadata) {
      set.status = 404;
      return { error: 'Backup not found or expired', code: 'BACKUP_NOT_FOUND' };
    }

    return { metadata };
  }, {
    detail: {
      summary: 'Get import metadata',
      description: 'Get detected metadata from an uploaded backup archive',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/import/diff', async ({ params, body, set }) => {
    const { id } = params as { id: string };
    const { tempFileId } = (body || {}) as { tempFileId: string };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    if (!tempFileId) {
      set.status = 400;
      return { error: 'tempFileId is required', code: 'VALIDATION_ERROR' };
    }

    try {
      const diffResult = await importManager.generateDiff(tempFileId, id);
      return diffResult;
    } catch (err) {
      if (err instanceof ImportError) {
        set.status = err.code === 'BACKUP_NOT_FOUND' ? 404 : 400;
        return { error: err.message, code: err.code, details: err.details };
      }
      throw err;
    }
  }, {
    body: ImportDiffBody,
    detail: {
      summary: 'Generate import diff',
      description: 'Compare uploaded backup with current server files to show differences',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:id/files/import/apply', async ({ params, body, set }) => {
    const { id } = params as { id: string };
    const { tempFileId, selections } = (body || {}) as {
      tempFileId: string;
      selections: Array<{ id: string; action: 'keep' | 'use-backup' }>;
    };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const serverStatus = await serverProxy.getStatus(server);
    if (serverStatus?.state === 'running' || serverStatus?.state === 'starting') {
      set.status = 409;
      return { error: 'Server must be stopped before importing backup', code: 'SERVER_BUSY' };
    }

    if (!tempFileId || !selections) {
      set.status = 400;
      return { error: 'tempFileId and selections are required', code: 'VALIDATION_ERROR' };
    }

    try {
      const parsed = ApplyChangesSchema.safeParse({ tempFileId, serverId: id, selections });
      if (!parsed.success) {
        set.status = 400;
        return { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() };
      }

      const result = await importManager.applyToServer(tempFileId, id, selections);

      if (!result.success) {
        set.status = 400;
        return { error: result.error, code: result.errorCode };
      }

      return result;
    } catch (err) {
      if (err instanceof ImportError) {
        set.status = err.code === 'BACKUP_NOT_FOUND' ? 404 : err.code === 'SERVER_BUSY' ? 409 : 400;
        return { error: err.message, code: err.code, details: err.details };
      }
      throw err;
    }
  }, {
    body: ImportApplyBody,
    detail: {
      summary: 'Apply import changes',
      description: 'Apply selected changes from backup import to the server (server must be stopped)',
      security: [{ bearerAuth: [] }],
    },
  })
  .delete('/:id/files/import/:tempFileId', async ({ params, set }) => {
    const { id, tempFileId } = params as { id: string; tempFileId: string };

    const server = await getServer(id);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    await importManager.cleanup(tempFileId);
    return { success: true };
  }, {
    detail: {
      summary: 'Cleanup import files',
      description: 'Delete temporary import files and cleanup resources',
      security: [{ bearerAuth: [] }],
    },
  });
