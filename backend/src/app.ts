import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { swagger } from '@elysiajs/swagger';
import { eq } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/index.js';
import { servers } from './db/schema.js';
import { authRoutes } from './routes/auth.js';
import { serversRoutes } from './routes/servers.js';
import { systemRoutes } from './routes/system.js';
import { backupsRoutes } from './routes/backups.js';
import { filesRoutes } from './routes/files.js';
import { setupWebSocket } from './websocket/handler.js';
import { backupManager } from './modules/backups/index.js';
import { restartScheduler } from './modules/scheduler/restart-scheduler.js';
import { processManager } from './modules/process/index.js';
export function buildApp() {
  const app = new Elysia()
    .use(swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'Allay API',
          version: '1.0.0',
          description: 'Minecraft Server Management API - Manage server lifecycle, backups, files, and real-time monitoring.',
        },
        tags: [
          { name: 'auth', description: 'Authentication and user management' },
          { name: 'servers', description: 'Server CRUD and control operations' },
          { name: 'backups', description: 'Backup management and restore' },
          { name: 'files', description: 'Server file browser and editor' },
          { name: 'system', description: 'System information and versions' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'JWT token obtained from /api/auth/login',
            },
          },
        },
      },
      exclude: ['/health', '/ws'],
    }))
    .use(cors({
      origin: config.isDev ? true : ['http://localhost:8080'],
      credentials: true,
    }))
    .use(jwt({
      name: 'jwt',
      secret: config.jwt.secret,
      exp: config.jwt.expiresIn,
    }))
    .onAfterResponse({ as: 'global' }, ({ request, path, set }) => {
      if (config.isDev) {
        console.log(`${request.method} ${path} ${set.status || 200}`);
      }
    })
    .get('/health', () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }))
    .onError({ as: 'global' }, ({ code, error, set, request }) => {
      if (code === 'VALIDATION') {
        set.status = 400;
        return {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          details: error.message,
        };
      }

      console.error(`[Error] ${request.method} ${request.url}:`, error);
      const statusCode = set.status && typeof set.status === 'number' && set.status >= 400
        ? set.status
        : 500;
      set.status = statusCode;
      return {
        error: 'message' in error ? error.message : 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      };
    })
    .use(authRoutes)
    .use(serversRoutes)
    .use(systemRoutes)
    .use(backupsRoutes)
    .use(filesRoutes)
    .use(setupWebSocket);

  return app;
}

export async function initializeServices() {
  await backupManager.initializeSchedules();
  await restartScheduler.initialize();

  // Auto-start servers
  const autoStartServers = await db.select().from(servers).where(eq(servers.autoStart, true));
  for (const server of autoStartServers) {
    try {
      console.info(`[AutoStart] Starting server ${server.name} (${server.id})`);
      await processManager.start(server as any);
      console.info(`[AutoStart] Server ${server.name} started successfully`);
    } catch (err) {
      console.error(`[AutoStart] Failed to start server ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  restartScheduler.on('server:restart-scheduled', async (serverId: string) => {
    const status = processManager.getStatus(serverId);
    if (status.state === 'running') {
      console.info(`[RestartScheduler] Restarting server ${serverId}`);
      try {
        await processManager.stop(serverId);
        const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
        if (server) {
          await processManager.start(server as any);
          console.info(`[RestartScheduler] Server ${serverId} restarted successfully`);
        }
      } catch (err) {
        console.error(`[RestartScheduler] Failed to restart server ${serverId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.info(`[RestartScheduler] Server ${serverId} not running, skipping restart`);
    }
  });
}

export type App = ReturnType<typeof buildApp>;
