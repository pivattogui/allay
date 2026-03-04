import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { servers, backups } from '../db/schema.js';
import { backupManager } from '../modules/backups/index.js';
import { config } from '../config.js';
import type { JwtPayload } from '../types/index.js';
import {
  CreateBackupResponse,
  UpdateBackupConfigBody,
} from '../schemas/backups.js';
import { ErrorResponse, MessageResponse } from '../schemas/common.js';

export const backupsRoutes = new Elysia({ prefix: '/api/backups', detail: { tags: ['backups'] } })
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
  .get('/:serverId', async ({ params, set }) => {
    const { serverId } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const backupsList = await backupManager.listBackups(serverId);
    const backupConfig = await backupManager.getConfig(serverId);

    return { backups: backupsList, config: backupConfig };
  }, {
    params: t.Object({
      serverId: t.String({ description: 'Server UUID' }),
    }),
    detail: {
      summary: 'List backups',
      description: 'Get all backups and backup configuration for a server',
      security: [{ bearerAuth: [] }],
    },
  })
  .post('/:serverId', async ({ params, set }) => {
    const { serverId } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    try {
      const backup = await backupManager.createBackup(serverId, 'manual');
      set.status = 201;
      return { backup };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return {
        error: (err as Error).message || 'Failed to create backup',
        code: 'BACKUP_FAILED',
      };
    }
  }, {
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
  })
  .post('/:serverId/:backupId/restore', async ({ params, set }) => {
    const { serverId, backupId } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    try {
      await backupManager.restoreBackup(backupId);
      return { message: 'Backup restored successfully' };
    } catch (err) {
      console.error(err);
      set.status = 400;
      return {
        error: (err as Error).message || 'Failed to restore backup',
        code: 'RESTORE_FAILED',
      };
    }
  }, {
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
  })
  .get('/:serverId/:backupId/download', async ({ params, set }) => {
    const { serverId, backupId } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const [backup] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
    if (!backup) {
      set.status = 404;
      return { error: 'Backup not found', code: 'BACKUP_NOT_FOUND' };
    }

    const backupPath = path.join(config.paths.backups, backup.filename);
    if (!fs.existsSync(backupPath)) {
      set.status = 404;
      return { error: 'Backup file not found', code: 'FILE_NOT_FOUND' };
    }

    set.headers['Content-Type'] = 'application/gzip';
    set.headers['Content-Disposition'] = `attachment; filename="${backup.filename}"`;
    return Bun.file(backupPath);
  }, {
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
  })
  .delete('/:serverId/:backupId', async ({ params, set }) => {
    const { serverId, backupId } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    try {
      await backupManager.deleteBackup(backupId);
      return { message: 'Backup deleted successfully' };
    } catch (err) {
      console.error(err);
      set.status = 400;
      return {
        error: (err as Error).message || 'Failed to delete backup',
        code: 'DELETE_FAILED',
      };
    }
  }, {
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
  })
  .patch('/:serverId/config', async ({ params, body, set }) => {
    const { serverId } = params;
    const { enabled, intervalMinutes, maxBackups, includeLogs } = body as {
      enabled?: boolean;
      intervalMinutes?: number;
      maxBackups?: number;
      includeLogs?: boolean;
    };

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    if (intervalMinutes !== undefined && (intervalMinutes < 5 || intervalMinutes > 1440)) {
      set.status = 400;
      return { error: 'Interval must be between 5 and 1440 minutes', code: 'INVALID_INTERVAL' };
    }

    if (maxBackups !== undefined && (maxBackups < 1 || maxBackups > 100)) {
      set.status = 400;
      return { error: 'Max backups must be between 1 and 100', code: 'INVALID_MAX_BACKUPS' };
    }

    await backupManager.updateConfig(serverId, { enabled, intervalMinutes, maxBackups, includeLogs });

    const backupConfig = await backupManager.getConfig(serverId);
    return { config: backupConfig };
  }, {
    params: t.Object({
      serverId: t.String({ description: 'Server UUID' }),
    }),
    body: UpdateBackupConfigBody,
    detail: {
      summary: 'Update backup config',
      description: 'Update automatic backup configuration for a server',
      security: [{ bearerAuth: [] }],
    },
  });
