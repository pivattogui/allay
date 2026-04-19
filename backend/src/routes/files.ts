import fs from 'node:fs'
import path from 'node:path'
import { jwt } from '@elysiajs/jwt'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { servers } from '../db/schema.js'
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js'
import { ErrorResponse } from '../schemas/common.js'
import { ListDirBody, ListDirResponse, RenameBody, RenameResponse, WriteFileBody } from '../schemas/files.js'
import type { JwtPayload } from '../types/index.js'
import {
  getFileType,
  isEditableFile,
  isSensitiveFile,
  MAX_EDITABLE_SIZE,
  resolveServerPath,
} from '../utils/file-security.js'

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modified: string
  extension?: string
  editable?: boolean
  sensitive?: boolean
  fileType?: 'text' | 'config' | 'image' | 'archive' | 'binary'
}

const getServer = async (id: string) => {
  const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
  return server ?? null
}

export const filesRoutes = new Elysia({ prefix: '/api/servers', detail: { tags: ['files'] } })
  .use(jwt({ name: 'jwt', secret: config.jwt.secret, exp: config.jwt.expiresIn }))
  .resolve(async ({ jwt: jwtPlugin, headers }) => {
    const auth = headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedError()
    }
    const payload = await jwtPlugin.verify(auth.slice(7))
    if (!payload) {
      throw new UnauthorizedError()
    }
    return { user: payload as unknown as JwtPayload }
  })
  .post(
    '/:id/files/list',
    async ({ params, body }) => {
      const { id } = params
      const { path: relativePath = '' } = (body || {}) as { path?: string }

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      const { fullPath } = resolved

      if (!fs.existsSync(fullPath)) {
        throw new NotFoundError('Directory not found', 'DIRECTORY_NOT_FOUND')
      }

      const stat = fs.statSync(fullPath)
      if (!stat.isDirectory()) {
        throw new ValidationError('Path is not a directory', 'NOT_A_DIRECTORY')
      }

      const items = fs.readdirSync(fullPath)
      const entries: FileEntry[] = []

      for (const item of items) {
        try {
          const itemPath = path.join(fullPath, item)
          const itemStat = fs.statSync(itemPath)
          const isDir = itemStat.isDirectory()
          const ext = isDir ? undefined : path.extname(item).toLowerCase()

          entries.push({
            name: item,
            type: isDir ? 'directory' : 'file',
            size: isDir ? 0 : itemStat.size,
            modified: itemStat.mtime.toISOString(),
            extension: ext || undefined,
            editable: isDir ? undefined : isEditableFile(item),
            sensitive: isDir ? undefined : isSensitiveFile(item),
            fileType: isDir ? undefined : getFileType(item),
          })
        } catch {
          // Skip items we can't stat
        }
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return { path: resolved.relativePath || '/', entries }
    },
    {
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
    },
  )
  .get(
    '/:id/files/read/*',
    async ({ params, query }) => {
      const { id } = params as { id: string; '*': string }
      const relativePath = (params as { id: string; '*': string })['*'] || ''
      const encoding = (query as Record<string, string>).encoding === 'base64' ? 'base64' : 'utf8'

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      const { fullPath } = resolved

      if (!fs.existsSync(fullPath)) {
        throw new NotFoundError('File not found', 'FILE_NOT_FOUND')
      }

      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        throw new ValidationError('Path is a directory, use list endpoint', 'IS_DIRECTORY')
      }

      const filename = path.basename(fullPath)
      const editable = isEditableFile(filename)
      const sensitive = isSensitiveFile(filename)
      const fileType = getFileType(filename)

      if (stat.size > MAX_EDITABLE_SIZE) {
        return {
          path: resolved.relativePath,
          name: filename,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          editable: false,
          sensitive,
          fileType,
          tooLarge: true,
          content: null,
          encoding: null,
        }
      }

      if (!editable && encoding === 'utf8') {
        return {
          path: resolved.relativePath,
          name: filename,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          editable: false,
          sensitive,
          fileType,
          content: null,
          encoding: null,
          message: 'File is not editable. Use download endpoint.',
        }
      }

      try {
        const content = fs.readFileSync(fullPath, encoding === 'base64' ? 'base64' : 'utf8')
        return {
          path: resolved.relativePath,
          name: filename,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          editable,
          sensitive,
          fileType,
          content,
          encoding,
        }
      } catch {
        throw new AppError('Failed to read file', 500, 'READ_ERROR')
      }
    },
    {
      query: t.Object({
        encoding: t.Optional(
          t.Union([t.Literal('utf8'), t.Literal('base64')], { description: 'File encoding (default: utf8)' }),
        ),
      }),
      detail: {
        summary: 'Read file contents',
        description: 'Read the contents of a file from the server. Path after /read/ is the file path.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .put(
    '/:id/files/write/*',
    async ({ params, body }) => {
      const { id } = params as { id: string; '*': string }
      const relativePath = (params as { id: string; '*': string })['*'] || ''
      const { content } = (body || {}) as { content: string }

      if (typeof content !== 'string') {
        throw new ValidationError('Content is required', 'CONTENT_REQUIRED')
      }

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      const { fullPath } = resolved
      const filename = path.basename(fullPath)
      const sensitive = isSensitiveFile(filename)

      const parentDir = path.dirname(fullPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      try {
        fs.writeFileSync(fullPath, content, 'utf8')
        const stat = fs.statSync(fullPath)
        return { success: true, path: resolved.relativePath, size: stat.size, sensitive }
      } catch {
        throw new AppError('Failed to write file', 500, 'WRITE_ERROR')
      }
    },
    {
      body: WriteFileBody,
      detail: {
        summary: 'Write file contents',
        description: 'Create or overwrite a file with new content. Path after /write/ is the file path.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/files/mkdir/*',
    async ({ params }) => {
      const { id } = params as { id: string; '*': string }
      const relativePath = (params as { id: string; '*': string })['*'] || ''

      if (!relativePath) {
        throw new ValidationError('Directory name is required', 'NAME_REQUIRED')
      }

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      if (fs.existsSync(resolved.fullPath)) {
        throw new ValidationError('Path already exists', 'ALREADY_EXISTS')
      }

      try {
        fs.mkdirSync(resolved.fullPath, { recursive: true })
        return { success: true, path: resolved.relativePath }
      } catch {
        throw new AppError('Failed to create directory', 500, 'MKDIR_ERROR')
      }
    },
    {
      detail: {
        summary: 'Create directory',
        description: 'Create a new directory in the server file system. Path after /mkdir/ is the directory path.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id/files/*',
    async ({ params }) => {
      const { id } = params as { id: string; '*': string }
      const relativePath = (params as { id: string; '*': string })['*'] || ''

      if (!relativePath) {
        throw new ValidationError('Cannot delete root directory', 'CANNOT_DELETE_ROOT')
      }

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      if (!fs.existsSync(resolved.fullPath)) {
        throw new NotFoundError('File or directory not found', 'NOT_FOUND')
      }

      try {
        const stat = fs.statSync(resolved.fullPath)
        fs.rmSync(resolved.fullPath, { recursive: true, force: true })
        return { success: true, path: resolved.relativePath, type: stat.isDirectory() ? 'directory' : 'file' }
      } catch {
        throw new AppError('Failed to delete', 500, 'DELETE_ERROR')
      }
    },
    {
      detail: {
        summary: 'Delete file or directory',
        description: 'Delete a file or directory from the server file system. Path after /files/ is the target path.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/files/rename',
    async ({ params, body }) => {
      const { id } = params
      const { oldPath, newPath } = (body || {}) as { oldPath: string; newPath: string }

      if (!oldPath || !newPath) {
        throw new ValidationError('Both oldPath and newPath are required', 'PATHS_REQUIRED')
      }

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolvedOld = resolveServerPath(id, oldPath, config.paths.servers)
      if (!resolvedOld.valid) {
        throw new ValidationError(resolvedOld.error ?? 'Invalid path', 'INVALID_OLD_PATH')
      }

      const resolvedNew = resolveServerPath(id, newPath, config.paths.servers)
      if (!resolvedNew.valid) {
        throw new ValidationError(resolvedNew.error ?? 'Invalid path', 'INVALID_NEW_PATH')
      }

      if (!fs.existsSync(resolvedOld.fullPath)) {
        throw new NotFoundError('Source file or directory not found', 'SOURCE_NOT_FOUND')
      }

      if (fs.existsSync(resolvedNew.fullPath)) {
        throw new ValidationError('Destination already exists', 'DESTINATION_EXISTS')
      }

      try {
        const parentDir = path.dirname(resolvedNew.fullPath)
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true })
        }
        fs.renameSync(resolvedOld.fullPath, resolvedNew.fullPath)
        return { success: true, oldPath: resolvedOld.relativePath, newPath: resolvedNew.relativePath }
      } catch {
        throw new AppError('Failed to rename', 500, 'RENAME_ERROR')
      }
    },
    {
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
    },
  )
  .get(
    '/:id/files/download/*',
    async ({ params, set }) => {
      const { id } = params as { id: string; '*': string }
      const relativePath = (params as { id: string; '*': string })['*'] || ''

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, relativePath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      if (!fs.existsSync(resolved.fullPath)) {
        throw new NotFoundError('File not found', 'FILE_NOT_FOUND')
      }

      const stat = fs.statSync(resolved.fullPath)
      if (stat.isDirectory()) {
        throw new ValidationError(
          'Directory download not yet implemented. Use backup feature.',
          'DIR_DOWNLOAD_NOT_IMPLEMENTED',
        )
      }

      const filename = path.basename(resolved.fullPath)
      set.headers['Content-Type'] = 'application/octet-stream'
      set.headers['Content-Disposition'] = `attachment; filename="${filename}"`
      set.headers['Content-Length'] = String(stat.size)
      return Bun.file(resolved.fullPath)
    },
    {
      detail: {
        summary: 'Download file',
        description: 'Download a file from the server as binary data. Path after /download/ is the file path.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/files/upload',
    async ({ params, query, request }) => {
      const { id } = params as { id: string }
      const targetPath = (query as Record<string, string>).path || ''

      const server = await getServer(id)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const resolved = resolveServerPath(id, targetPath, config.paths.servers)
      if (!resolved.valid) {
        throw new ValidationError(resolved.error ?? 'Invalid path', 'INVALID_PATH')
      }

      const { fullPath: targetDir } = resolved

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }

      const stat = fs.statSync(targetDir)
      if (!stat.isDirectory()) {
        throw new ValidationError('Target path is not a directory', 'NOT_A_DIRECTORY')
      }

      const uploadedFiles: { name: string; size: number }[] = []

      try {
        const formData = await request.formData()

        for (const [, value] of formData) {
          if (value instanceof File) {
            const safeName = path.basename(value.name)
            const filePath = path.join(targetDir, safeName)

            await Bun.write(filePath, value)

            const fileStat = fs.statSync(filePath)
            uploadedFiles.push({ name: safeName, size: fileStat.size })
          }
        }

        return { success: true, uploaded: uploadedFiles, count: uploadedFiles.length }
      } catch (_err) {
        throw new AppError('Failed to upload files', 500, 'UPLOAD_ERROR')
      }
    },
    {
      query: t.Object({
        path: t.Optional(t.String({ description: 'Target directory path (default: root)' })),
      }),
      detail: {
        summary: 'Upload files',
        description: 'Upload one or more files to a server directory',
        security: [{ bearerAuth: [] }],
      },
    },
  )
