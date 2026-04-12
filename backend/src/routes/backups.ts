import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import * as tar from 'tar';
import { db } from '../db/index.js';
import { servers, backups } from '../db/schema.js';
import { backupManager } from '../modules/backups/index.js';
import { processManager } from '../modules/process/index.js';
import { jarManager } from '../modules/servers/jar-manager.js';

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
  })
  .post('/:serverId/import', async ({ params, request, set }) => {
    const { serverId } = params as { serverId: string };

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(serverId);
    if (status.state === 'running' || status.state === 'starting') {
      set.status = 409;
      return { error: 'Server must be stopped before importing', code: 'SERVER_BUSY' };
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      set.status = 400;
      return { error: 'No file uploaded', code: 'NO_FILE' };
    }

    const filename = file.name.toLowerCase();
    const isTarGz = filename.endsWith('.tar.gz') || filename.endsWith('.tgz');
    const isZip = filename.endsWith('.zip');
    if (!isTarGz && !isZip) {
      set.status = 400;
      return { error: 'Only .tar.gz, .tgz, and .zip files are supported', code: 'UNSUPPORTED_FORMAT' };
    }

    const tempId = randomUUID();
    const tempDir = path.join(config.paths.temp, tempId);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, file.name);

    try {
      await Bun.write(tempPath, file);

      let backupId: string;
      try {
        const backup = await backupManager.createBackup(serverId, 'manual');
        backupId = backup.id;
        console.info(`[Import] Created safety-net backup ${backupId} for server ${serverId}`);
      } catch (err) {
        console.error('[Import] Failed to create safety-net backup:', err);
        set.status = 500;
        return { error: 'Failed to create safety-net backup before import', code: 'BACKUP_FAILED' };
      }

      const serverDir = server.directory;
      const entries = fs.readdirSync(serverDir);
      for (const entry of entries) {
        fs.rmSync(path.join(serverDir, entry), { recursive: true, force: true });
      }

      if (isTarGz) {
        await tar.extract({ cwd: serverDir, file: tempPath });
      } else {
        const proc = Bun.spawn(['unzip', '-o', '-q', tempPath, '-d', serverDir], {
          stdout: 'ignore',
          stderr: 'pipe',
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text();
          throw new Error(`unzip failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
        }
      }

      const extracted = fs.readdirSync(serverDir);
      if (extracted.length === 1) {
        const singleEntry = path.join(serverDir, extracted[0]);
        if (fs.statSync(singleEntry).isDirectory()) {
          const innerFiles = fs.readdirSync(singleEntry);
          for (const innerFile of innerFiles) {
            fs.renameSync(
              path.join(singleEntry, innerFile),
              path.join(serverDir, innerFile)
            );
          }
          fs.rmdirSync(singleEntry);
          console.info(`[Import] Unwrapped nested directory: ${extracted[0]}`);
        }
      }

      // Cleanup macOS artifacts
      const macosDir = path.join(serverDir, '__MACOSX');
      if (fs.existsSync(macosDir)) {
        fs.rmSync(macosDir, { recursive: true, force: true });
      }

      // Detect if import is a world-only backup (no server files)
      const extractedFiles = fs.readdirSync(serverDir);
      const hasJar = extractedFiles.some(f => f.endsWith('.jar'));
      const hasServerProperties = extractedFiles.includes('server.properties');
      const hasWorldData = extractedFiles.includes('level.dat') || extractedFiles.includes('region') || extractedFiles.includes('world');

      if (!hasJar && !hasServerProperties && hasWorldData) {
        // World-only backup — move everything into world/ and restore server files from safety backup
        console.info('[Import] Detected world-only backup, restructuring...');
        const worldDir = path.join(serverDir, 'world');
        fs.mkdirSync(worldDir, { recursive: true });
        for (const file of fs.readdirSync(serverDir)) {
          if (file === 'world' || file === 'eula.txt') continue;
          fs.renameSync(path.join(serverDir, file), path.join(worldDir, file));
        }

        // Restore server.jar and server.properties from safety backup
        const [safetyBackup] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
        if (safetyBackup) {
          const safetyPath = path.join(config.paths.backups, safetyBackup.filename);
          if (fs.existsSync(safetyPath)) {
            const extractDir = path.join(config.paths.temp, `restore-${randomUUID()}`);
            fs.mkdirSync(extractDir, { recursive: true });
            await tar.extract({ cwd: extractDir, file: safetyPath });

            // Find the server dir inside the extracted backup
            const extractedDirs = fs.readdirSync(extractDir);
            const backupServerDir = extractedDirs.length === 1
              ? path.join(extractDir, extractedDirs[0])
              : extractDir;

            for (const essential of ['server.jar', 'server.properties']) {
              const src = path.join(backupServerDir, essential);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(serverDir, essential));
                console.info(`[Import] Restored ${essential} from safety backup`);
              }
            }
            fs.rmSync(extractDir, { recursive: true, force: true });
          }
        }
      } else {
        // Full server backup — rename JAR to server.jar if needed
        if (!fs.existsSync(path.join(serverDir, 'server.jar'))) {
          const files = fs.readdirSync(serverDir);
          const jarFile = files.find(f => f.endsWith('.jar'));
          if (jarFile) {
            fs.renameSync(path.join(serverDir, jarFile), path.join(serverDir, 'server.jar'));
            console.info(`[Import] Renamed ${jarFile} to server.jar`);
          }
        }
      }

      // Final validation — server.jar must exist
      if (!fs.existsSync(path.join(serverDir, 'server.jar'))) {
        console.error('[Import] server.jar missing after import — server will not start');
        // Try to download from jarManager as last resort
        try {
          const jarPath = await jarManager.download(server.type as 'vanilla' | 'paper', server.version);
          fs.copyFileSync(jarPath, path.join(serverDir, 'server.jar'));
          console.info(`[Import] Downloaded fresh server.jar (${server.type} ${server.version})`);
        } catch (jarErr) {
          console.error('[Import] Failed to download server.jar:', jarErr);
        }
      }

      // Ensure eula.txt
      const eulaPath = path.join(serverDir, 'eula.txt');
      fs.writeFileSync(eulaPath, 'eula=true\n');

      // Ensure server.properties exists
      if (!fs.existsSync(path.join(serverDir, 'server.properties'))) {
        fs.writeFileSync(path.join(serverDir, 'server.properties'), `server-port=${server.port}\n`);
        console.info('[Import] Created default server.properties');
      }

      fs.rmSync(tempDir, { recursive: true, force: true });

      return { message: 'Backup imported successfully', backupId };
    } catch (err) {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      console.error('[Import] Failed:', err);
      set.status = 500;
      return {
        error: (err as Error).message || 'Import failed',
        code: 'IMPORT_FAILED',
      };
    }
  }, {
    params: t.Object({
      serverId: t.String({ description: 'Server UUID' }),
    }),
    detail: {
      summary: 'Import backup',
      description: 'Import an external backup archive (.tar.gz, .tgz, .zip) into a stopped server. Creates a safety-net backup first, then replaces all server content with the archive contents.',
      security: [{ bearerAuth: [] }],
    },
  });
