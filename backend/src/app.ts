import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { swagger } from '@elysiajs/swagger'
import { eq, isNull } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { config } from './config.js'
import { db } from './db/index.js'
import { servers } from './db/schema.js'
import { AppError } from './errors.js'
import { createLogger } from './logger.js'
import { backupManager } from './modules/backups/index.js'
import { backfillJavaVersions } from './modules/java/backfill.js'
import { javaRuntimeRegistry } from './modules/java/runtime-registry.js'
import { processManager } from './modules/process/index.js'
import { restartScheduler } from './modules/scheduler/restart-scheduler.js'
import { jarManager } from './modules/servers/jar-manager.js'
import { authRoutes } from './routes/auth.js'
import { backupsRoutes } from './routes/backups.js'
import { filesRoutes } from './routes/files.js'
import { serversRoutes } from './routes/servers.js'
import { systemRoutes } from './routes/system.js'
import { staticRoutes } from './static.js'
import { setupWebSocket } from './websocket/handler.js'

const log = createLogger('app')
export function buildApp() {
  // normalize: 'typebox' avoids the [exact-mirror] Union warnings — exact-mirror
  // falls back to TypeCompiler when it sees a Union, which isn't initialized here.
  const app = new Elysia({ normalize: 'typebox' })
    .use(
      swagger({
        path: '/docs',
        documentation: {
          info: {
            title: 'Allay API',
            version: '1.0.0',
            description:
              'Minecraft Server Management API - Manage server lifecycle, backups, files, and real-time monitoring.',
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
      }),
    )
    .use(
      cors({
        origin: config.isDev ? true : config.publicOrigin ? [config.publicOrigin] : false,
        credentials: true,
      }),
    )
    .use(
      jwt({
        name: 'jwt',
        secret: config.jwt.secret,
        exp: config.jwt.expiresIn,
      }),
    )
    .get('/health', () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }))
    .onError({ as: 'global' }, ({ code, error, set, request }) => {
      if (code === 'VALIDATION') {
        set.status = 400
        return {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          details: error.message,
        }
      }

      if (error instanceof AppError) {
        set.status = error.statusCode
        return {
          error: error.message,
          code: error.code,
          ...('details' in error && error.details ? { details: error.details } : {}),
        }
      }

      log.error({ method: request.method, url: request.url, err: error }, 'Unhandled error')
      set.status = 500
      return {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      }
    })
    .use(authRoutes)
    .use(serversRoutes)
    .use(systemRoutes)
    .use(backupsRoutes)
    .use(filesRoutes)
    .use(setupWebSocket)
    .use(staticRoutes) // must come last — wildcard catches anything unmatched above

  return app
}

export async function initializeServices() {
  const restartAttempts = new Map<string, { count: number; firstAttemptAt: number }>()

  javaRuntimeRegistry.discover()
  log.info(
    { majors: javaRuntimeRegistry.availableMajors(), fallback: javaRuntimeRegistry.getFallback() },
    'Java runtimes discovered',
  )

  try {
    const backfillResult = await backfillJavaVersions({
      loadServersNeedingBackfill: () =>
        db
          .select({ id: servers.id, type: servers.type, version: servers.version })
          .from(servers)
          .where(isNull(servers.javaVersion)),
      lookupJavaMajor: (type, version) => jarManager.getRequiredJavaMajor(type, version),
      applyJavaVersion: async (id, major) => {
        await db
          .update(servers)
          .set({ javaVersion: String(major) })
          .where(eq(servers.id, id))
      },
      onError: (id, err) => log.warn({ serverId: id, err }, 'Java version backfill failed for server'),
    })
    if (backfillResult.updated || backfillResult.failed) {
      log.info(backfillResult, 'Java version backfill completed')
    }
  } catch (err) {
    log.error({ err }, 'Java version backfill task crashed')
  }

  await backupManager.initializeSchedules()
  await restartScheduler.initialize()

  const autoStartServers = await db.select().from(servers).where(eq(servers.autoStart, true))
  for (const server of autoStartServers) {
    try {
      log.info({ serverId: server.id, name: server.name }, 'Auto-starting server')
      await processManager.start(server as any)
    } catch (err) {
      log.error({ serverId: server.id, err }, 'Auto-start failed')
    }
  }

  restartScheduler.on('server:restart-scheduled', async (serverId: string) => {
    const status = processManager.getStatus(serverId)
    if (status.state === 'running') {
      try {
        log.info({ serverId }, 'Scheduled restart triggered')
        await processManager.stop(serverId)
        const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
        if (server) {
          await processManager.start(server as any)
        }
      } catch (err) {
        log.error({ serverId, err }, 'Scheduled restart failed')
      }
    } else {
      log.debug({ serverId, state: status.state }, 'Scheduled restart skipped — server not running')
    }
  })

  processManager.on(
    'exit',
    async (serverId: string, code: number | null, signal: string | null, wasRunning: boolean) => {
      if (!wasRunning) return
      if (code === 0) return

      log.warn({ serverId, exitCode: code, signal }, 'Server process exited unexpectedly')

      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      if (!server?.autoRestart) return

      const now = Date.now()
      const windowMs = config.minecraft.restartWindowMs
      let attempts = restartAttempts.get(serverId)

      if (!attempts || now - attempts.firstAttemptAt > windowMs) {
        attempts = { count: 0, firstAttemptAt: now }
      }

      attempts.count++
      restartAttempts.set(serverId, attempts)

      if (attempts.count > server.restartLimit) {
        log.warn({ serverId, attempts: attempts.count, limit: server.restartLimit }, 'Auto-restart limit reached')
        return
      }

      try {
        log.info({ serverId, attempt: attempts.count }, 'Auto-restarting crashed server')
        await new Promise((resolve) => setTimeout(resolve, 2000))
        await processManager.start(server as any)
      } catch (err) {
        log.error({ serverId, err }, 'Auto-restart failed')
      }
    },
  )
}

export type App = ReturnType<typeof buildApp>
