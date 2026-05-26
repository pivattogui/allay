import fs from 'node:fs'
import path from 'node:path'
import { jwt } from '@elysiajs/jwt'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { config, getServerDir } from '../config.js'
import { db } from '../db/index.js'
import { backups, servers } from '../db/schema.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js'
import { createLogger } from '../logger.js'
import { backupManager } from '../modules/backups/index.js'
import {
  analyzeArchive,
  cleanExpiredImports,
  cleanImport,
  getImportPath,
  saveUploadedFile,
} from '../modules/import/analyzer.js'
import { extractSelection, resolveSelection } from '../modules/import/extractor.js'
import { processManager } from '../modules/process/index.js'
import {
  CreateBackupResponse,
  ImportAnalyzeResponse,
  ImportExecuteBody,
  ImportExecuteResponse,
  UpdateBackupConfigBody,
} from '../schemas/backups.js'
import { ErrorResponse, MessageResponse } from '../schemas/common.js'
import type { JwtPayload } from '../types/index.js'

const log = createLogger('backups-route')

export const backupsRoutes = new Elysia({ prefix: '/api/backups', detail: { tags: ['backups'] } })
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
  .get(
    '/:serverId',
    async ({ params }) => {
      const { serverId } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const backupsList = await backupManager.listBackups(serverId)
      const backupConfig = await backupManager.getConfig(serverId)

      return { backups: backupsList, config: backupConfig }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
      }),
      detail: {
        summary: 'List backups',
        description: 'Get all backups and backup configuration for a server',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:serverId',
    async ({ params, set }) => {
      const { serverId } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      try {
        const backup = await backupManager.createBackup(serverId, 'manual')
        set.status = 201
        return { backup }
      } catch (err) {
        throw new AppError((err as Error).message || 'Failed to create backup', 500, 'BACKUP_FAILED')
      }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
      }),
      response: {
        201: CreateBackupResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Create backup',
        description: 'Create a manual backup of the server',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:serverId/:backupId/restore',
    async ({ params }) => {
      const { serverId, backupId } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      await backupManager.restoreBackup(backupId)
      return { message: 'Backup restored successfully' }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
        backupId: t.String({ description: 'Backup UUID' }),
      }),
      response: {
        200: MessageResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Restore backup',
        description: 'Restore a server from a backup. Server must be stopped.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:serverId/:backupId/download',
    async ({ params, set }) => {
      const { serverId, backupId } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const [backup] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1)
      if (!backup) {
        throw new NotFoundError('Backup not found', 'BACKUP_NOT_FOUND')
      }

      const backupPath = path.join(config.paths.backups, backup.filename)
      if (!fs.existsSync(backupPath)) {
        throw new NotFoundError('Backup file not found', 'FILE_NOT_FOUND')
      }

      set.headers['Content-Type'] = 'application/gzip'
      set.headers['Content-Disposition'] = `attachment; filename="${backup.filename}"`
      return Bun.file(backupPath)
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
        backupId: t.String({ description: 'Backup UUID' }),
      }),
      response: {
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Download backup',
        description: 'Download a backup file as tar.gz',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:serverId/:backupId',
    async ({ params }) => {
      const { serverId, backupId } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      await backupManager.deleteBackup(backupId)
      return { message: 'Backup deleted successfully' }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
        backupId: t.String({ description: 'Backup UUID' }),
      }),
      response: {
        200: MessageResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete backup',
        description: 'Delete a backup file',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:serverId/config',
    async ({ params, body }) => {
      const { serverId } = params
      const { enabled, intervalMinutes, maxBackups, includeLogs } = body as {
        enabled?: boolean
        intervalMinutes?: number
        maxBackups?: number
        includeLogs?: boolean
      }

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      if (intervalMinutes !== undefined && (intervalMinutes < 5 || intervalMinutes > 1440)) {
        throw new ValidationError('Interval must be between 5 and 1440 minutes', 'INVALID_INTERVAL')
      }

      if (maxBackups !== undefined && (maxBackups < 1 || maxBackups > 100)) {
        throw new ValidationError('Max backups must be between 1 and 100', 'INVALID_MAX_BACKUPS')
      }

      await backupManager.updateConfig(serverId, { enabled, intervalMinutes, maxBackups, includeLogs })

      const backupConfig = await backupManager.getConfig(serverId)
      return { config: backupConfig }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
      }),
      body: UpdateBackupConfigBody,
      detail: {
        summary: 'Update backup config',
        description: 'Update automatic backup configuration for a server',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:serverId/import/analyze',
    async ({ params, request }) => {
      const { serverId } = params as { serverId: string }

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')

      const status = processManager.getStatus(serverId)
      if (status.state === 'running' || status.state === 'starting') {
        throw new ConflictError('Server must be stopped before importing', 'SERVER_BUSY')
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) throw new ValidationError('No file uploaded', 'NO_FILE')

      const filename = file.name.toLowerCase()
      const isTarGz = filename.endsWith('.tar.gz') || filename.endsWith('.tgz')
      const isZip = filename.endsWith('.zip')
      if (!isTarGz && !isZip) {
        throw new ValidationError('Only .tar.gz, .tgz, and .zip files are supported', 'UNSUPPORTED_FORMAT')
      }

      cleanExpiredImports()

      const { importId, archivePath } = await saveUploadedFile(file)
      const { categories, detectedType, suggestedPreset } = await analyzeArchive(archivePath)

      const stat = fs.statSync(archivePath)

      return {
        importId,
        detectedType,
        categories,
        suggestedPreset,
        totalSize: stat.size,
      }
    },
    {
      params: t.Object({ serverId: t.String({ description: 'Server UUID' }) }),
      response: ImportAnalyzeResponse,
      detail: {
        summary: 'Analyze import archive',
        description: 'Upload and analyze an archive file, returning detected content categories and suggested preset.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:serverId/import/:importId/execute',
    async ({ params, body }) => {
      const { serverId, importId } = params as { serverId: string; importId: string }

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server) throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')

      const status = processManager.getStatus(serverId)
      if (status.state === 'running' || status.state === 'starting') {
        throw new ConflictError('Server must be stopped before importing', 'SERVER_BUSY')
      }

      const archivePath = getImportPath(importId)
      if (!archivePath) {
        throw new NotFoundError('Import session expired or not found', 'IMPORT_NOT_FOUND')
      }

      const { entries, categories } = await analyzeArchive(archivePath)

      const selectedPaths = resolveSelection(body.selection, categories, entries)
      if (selectedPaths.length === 0) {
        throw new ValidationError('No files selected for import', 'EMPTY_SELECTION')
      }

      let backupId: string
      try {
        const backup = await backupManager.createBackup(serverId, 'pre-import')
        backupId = backup.id
      } catch (_err) {
        throw new AppError('Failed to create pre-import backup', 500, 'BACKUP_FAILED')
      }

      try {
        const serverDir = getServerDir(serverId)
        const worldDirsToReplace = categories.world.filter((w) => selectedPaths.some((p) => p.startsWith(w)))
        for (const worldDir of worldDirsToReplace) {
          const fullPath = path.join(serverDir, worldDir)
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true })
          }
        }

        await extractSelection(archivePath, serverId, selectedPaths, entries)

        return {
          message: 'Import completed successfully',
          backupId,
          importedPaths: selectedPaths.length,
        }
      } catch (err) {
        // Restore the pre-import backup so the server isn't left half-extracted.
        try {
          await backupManager.restoreBackup(backupId)
        } catch (restoreErr) {
          log.error({ serverId, backupId, err: restoreErr }, 'Pre-import rollback failed')
        }
        throw err
      } finally {
        cleanImport(importId)
      }
    },
    {
      params: t.Object({
        serverId: t.String({ description: 'Server UUID' }),
        importId: t.String({ description: 'Import session ID from analyze' }),
      }),
      body: ImportExecuteBody,
      response: ImportExecuteResponse,
      detail: {
        summary: 'Execute import',
        description:
          'Execute a previously analyzed import with the given selection. Creates a pre-import backup of the current world before proceeding.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
