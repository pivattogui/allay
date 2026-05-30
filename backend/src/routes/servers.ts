import fs from 'node:fs'
import path from 'node:path'
import { jwt } from '@elysiajs/jwt'
import { and, desc, eq, ne } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'
import { config, getServerDir } from '../config.js'
import { db } from '../db/index.js'
import { backupConfigs, events, servers } from '../db/schema.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js'
import { assertJavaAvailable } from '../modules/java/gate.js'
import { processManager } from '../modules/process/index.js'
import { jarManager } from '../modules/servers/jar-manager.js'
import { ErrorResponse, IdParam, MessageResponse } from '../schemas/common.js'
import {
  ActionResponse,
  CommandBody,
  CommandResponse,
  ConfigResponse,
  ConfigUpdateResponse,
  CreateServerBody,
  IconResponse,
  ListServersResponse,
  LogsResponse,
  MigrateBody,
  MigrateResponse,
  NeedsRestartResponse,
  PropertiesBody,
  PropertiesResponse,
  RawPropertiesBody,
  RawPropertiesResponse,
  ServerResponse,
  StatusResponse,
  UpdateServerBody,
  UpdateServerConfigBody,
} from '../schemas/servers.js'
import type { JwtPayload } from '../types/index.js'
import {
  CreateServerSchema,
  type ServerConfig,
  type ServerWithStatus,
  UpdateServerConfigSchema,
  UpdateServerSchema,
} from '../types/index.js'

export const serversRoutes = new Elysia({ prefix: '/api/servers', detail: { tags: ['servers'] } })
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
    '/',
    async () => {
      const rows = await db.select().from(servers).orderBy(desc(servers.createdAt))

      const serversWithStatus: ServerWithStatus[] = rows.map((server) => ({
        ...server,
        status: processManager.getStatus(server.id),
      }))

      return { servers: serversWithStatus }
    },
    {
      response: {
        200: ListServersResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'List all servers',
        description: 'Get a list of all Minecraft servers with their current status',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)

      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      return {
        server: {
          ...server,
          status: processManager.getStatus(server.id),
        },
      }
    },
    {
      params: IdParam,
      response: {
        200: ServerResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server details',
        description: 'Get detailed information about a specific server including its current status',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const result = CreateServerSchema.safeParse(body)
      if (!result.success) {
        throw new ValidationError('Validation Error', 'VALIDATION_ERROR', result.error.flatten())
      }

      const input = result.data

      if (input.port < config.minecraft.portMin || input.port > config.minecraft.portMax) {
        throw new ValidationError(
          `Port must be between ${config.minecraft.portMin} and ${config.minecraft.portMax}`,
          'PORT_OUT_OF_RANGE',
        )
      }

      const [existingPort] = await db
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.port, input.port))
        .limit(1)
      if (existingPort) {
        throw new ConflictError('Port already in use by another server', 'PORT_IN_USE')
      }

      if (input.ramMinMb > input.ramMaxMb) {
        throw new ValidationError('Minimum RAM cannot exceed maximum RAM', 'INVALID_RAM_CONFIG')
      }

      const requiredJavaMajor = await assertJavaAvailable(input.type, input.version)

      const id = uuidv4()
      const directory = path.join(config.paths.servers, id)

      try {
        const jarPath = await jarManager.download(input.type, input.version)
        fs.mkdirSync(directory, { recursive: true })
        fs.copyFileSync(jarPath, path.join(directory, 'server.jar'))
        fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n')
        fs.writeFileSync(path.join(directory, 'server.properties'), `server-port=${input.port}\n`)
      } catch (err: any) {
        if (err instanceof AppError) throw err
        throw new AppError(`Server provisioning failed: ${err.message}`, 500, 'PROVISION_FAILED')
      }

      await db.insert(servers).values({
        id,
        name: input.name,
        type: input.type,
        version: input.version,
        port: input.port,
        ramMinMb: input.ramMinMb,
        ramMaxMb: input.ramMaxMb,
        javaVersion: String(requiredJavaMajor),
        directory,
        autoStart: input.autoStart,
        autoRestart: input.autoRestart,
      })

      await db.insert(backupConfigs).values({
        serverId: id,
        enabled: true,
        intervalMinutes: 60,
        maxBackups: 10,
        includeLogs: false,
      })

      await db.insert(events).values({
        serverId: id,
        type: 'create',
        message: `Server "${input.name}" created`,
      })

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)

      set.status = 201
      return {
        server: {
          ...server!,
          status: processManager.getStatus(server?.id),
        },
      }
    },
    {
      body: CreateServerBody,
      response: {
        201: ServerResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Create a new server',
        description:
          'Create a new Minecraft server with the specified configuration. Downloads the server JAR and sets up the directory structure.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const result = UpdateServerSchema.safeParse(body)
      if (!result.success) {
        throw new ValidationError('Validation Error', 'VALIDATION_ERROR', result.error.flatten())
      }

      const input = result.data

      if (input.port && input.port !== server.port) {
        if (input.port < config.minecraft.portMin || input.port > config.minecraft.portMax) {
          throw new ValidationError(
            `Port must be between ${config.minecraft.portMin} and ${config.minecraft.portMax}`,
            'PORT_OUT_OF_RANGE',
          )
        }

        const [existingPort] = await db
          .select({ id: servers.id })
          .from(servers)
          .where(and(eq(servers.port, input.port), ne(servers.id, id)))
          .limit(1)
        if (existingPort) {
          throw new ConflictError('Port already in use by another server', 'PORT_IN_USE')
        }

        const propsPath = path.join(getServerDir(server.id), 'server.properties')
        if (fs.existsSync(propsPath)) {
          let props = fs.readFileSync(propsPath, 'utf-8')
          props = props.replace(/server-port=\d+/, `server-port=${input.port}`)
          fs.writeFileSync(propsPath, props)
        }
      }

      const updateData: Partial<typeof servers.$inferInsert> = { updatedAt: new Date() }
      if (input.name !== undefined) updateData.name = input.name
      if (input.port !== undefined) updateData.port = input.port
      if (input.ramMinMb !== undefined) updateData.ramMinMb = input.ramMinMb
      if (input.ramMaxMb !== undefined) updateData.ramMaxMb = input.ramMaxMb
      if (input.autoStart !== undefined) updateData.autoStart = input.autoStart
      if (input.autoRestart !== undefined) updateData.autoRestart = input.autoRestart

      if (Object.keys(updateData).length > 1) {
        await db.update(servers).set(updateData).where(eq(servers.id, id))
      }

      const [updatedServer] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)

      return {
        server: {
          ...updatedServer!,
          status: processManager.getStatus(updatedServer?.id),
        },
      }
    },
    {
      params: IdParam,
      body: UpdateServerBody,
      response: {
        200: ServerResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update server',
        description: 'Update basic server settings like name, port, and RAM allocation',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      if (status.state === 'running' || status.state === 'starting') {
        await processManager.stop(server.id)
      }

      if (fs.existsSync(getServerDir(server.id))) {
        fs.rmSync(getServerDir(server.id), { recursive: true, force: true })
      }

      await db.delete(servers).where(eq(servers.id, id))

      return { message: 'Server deleted successfully' }
    },
    {
      params: IdParam,
      response: {
        200: MessageResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete server',
        description: 'Delete a server and all its files. Server will be stopped if running.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/start',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      if (status.state === 'running' || status.state === 'starting') {
        throw new ConflictError('Server is already running', 'SERVER_ALREADY_RUNNING')
      }

      try {
        await processManager.start(server as any)
        await db.insert(events).values({ serverId: id, type: 'start', message: 'Server started' })
        return { message: 'Server starting', status: processManager.getStatus(server.id) }
      } catch (_err) {
        throw new AppError('Failed to start server', 500, 'START_FAILED')
      }
    },
    {
      params: IdParam,
      response: {
        200: ActionResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Start server',
        description: 'Start a stopped Minecraft server',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/stop',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      if (status.state === 'stopped' || status.state === 'stopping') {
        throw new ConflictError('Server is not running', 'SERVER_NOT_RUNNING')
      }

      try {
        await processManager.stop(server.id)
        await db.insert(events).values({ serverId: id, type: 'stop', message: 'Server stopped' })
        return { message: 'Server stopped', status: processManager.getStatus(server.id) }
      } catch (_err) {
        throw new AppError('Failed to stop server', 500, 'STOP_FAILED')
      }
    },
    {
      params: IdParam,
      response: {
        200: ActionResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Stop server',
        description: 'Gracefully stop a running Minecraft server using the stop command',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/kill',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      processManager.kill(server.id)
      return { message: 'Server killed', status: processManager.getStatus(server.id) }
    },
    {
      params: IdParam,
      response: {
        200: ActionResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Force kill server',
        description: 'Forcefully terminate a server process with SIGKILL. Use only if graceful stop fails.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/status',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      return { status: processManager.getStatus(server.id) }
    },
    {
      params: IdParam,
      response: {
        200: StatusResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server status',
        description: 'Get the current runtime status of a server (state, PID, uptime)',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/logs',
    async ({ params, query }) => {
      const { id } = params
      const lines = query.lines ? Number(query.lines) : 100

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const logs = processManager.getLogs(server.id, lines)
      return { logs }
    },
    {
      params: IdParam,
      query: t.Object({
        lines: t.Optional(t.Number({ description: 'Number of log lines to return', default: 100 })),
      }),
      response: {
        200: LogsResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server logs',
        description: 'Retrieve recent console output from a server',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/command',
    async ({ params, body }) => {
      const { id } = params
      const { command } = body as { command: string }

      if (!command || typeof command !== 'string') {
        throw new ValidationError('Command is required', 'INVALID_COMMAND')
      }

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      if (status.state !== 'running') {
        throw new ConflictError('Server is not running', 'SERVER_NOT_RUNNING')
      }

      const sent = processManager.sendCommand(server.id, command)
      if (!sent) {
        throw new AppError('Failed to send command', 500, 'COMMAND_FAILED')
      }

      return { message: 'Command sent', command }
    },
    {
      params: IdParam,
      body: CommandBody,
      response: {
        200: CommandResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Send console command',
        description: 'Send a command to the running Minecraft server console',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/properties',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const propsPath = path.join(getServerDir(server.id), 'server.properties')
      if (!fs.existsSync(propsPath)) {
        return { properties: {} }
      }
      const content = fs.readFileSync(propsPath, 'utf-8')

      const properties: Record<string, string> = {}
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=')
          if (eqIndex > 0) {
            properties[trimmed.substring(0, eqIndex)] = trimmed.substring(eqIndex + 1)
          }
        }
      }

      return { properties }
    },
    {
      params: IdParam,
      response: {
        200: PropertiesResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server properties',
        description: 'Get parsed server.properties as key-value pairs',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .put(
    '/:id/properties',
    async ({ params, body }) => {
      const { id } = params
      const { properties } = body as { properties: Record<string, string> }

      if (!properties || typeof properties !== 'object') {
        throw new ValidationError('Properties object is required', 'INVALID_PROPERTIES')
      }

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const content = Object.entries(properties)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
      const propsPath = path.join(getServerDir(server.id), 'server.properties')
      fs.writeFileSync(propsPath, content)

      if (properties['server-port']) {
        const newPort = parseInt(properties['server-port'], 10)
        if (!Number.isNaN(newPort) && newPort !== server.port) {
          const [existingPort] = await db
            .select({ id: servers.id })
            .from(servers)
            .where(and(eq(servers.port, newPort), ne(servers.id, id)))
            .limit(1)
          if (!existingPort) {
            await db.update(servers).set({ port: newPort, updatedAt: new Date() }).where(eq(servers.id, id))
          }
        }
      }

      const status = processManager.getStatus(server.id)
      return { needsRestart: status.state === 'running' }
    },
    {
      params: IdParam,
      body: PropertiesBody,
      response: {
        200: NeedsRestartResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update server properties',
        description: 'Update server.properties from key-value pairs. Returns whether server needs restart.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/properties/raw',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const propsPath = path.join(getServerDir(server.id), 'server.properties')
      if (!fs.existsSync(propsPath)) {
        throw new NotFoundError('server.properties not found', 'PROPERTIES_NOT_FOUND')
      }

      return { content: fs.readFileSync(propsPath, 'utf-8') }
    },
    {
      params: IdParam,
      response: {
        200: RawPropertiesResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get raw server properties',
        description: 'Get the raw server.properties file content as text',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .put(
    '/:id/properties/raw',
    async ({ params, body }) => {
      const { id } = params
      const { content } = body as { content: string }

      if (typeof content !== 'string') {
        throw new ValidationError('Content is required', 'INVALID_CONTENT')
      }

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      const needsRestart = status.state === 'running'

      const propsPath = path.join(getServerDir(server.id), 'server.properties')
      fs.writeFileSync(propsPath, content)

      const portMatch = content.match(/server-port=(\d+)/)
      if (portMatch) {
        const newPort = parseInt(portMatch[1], 10)
        if (!Number.isNaN(newPort) && newPort !== server.port) {
          const [existingPort] = await db
            .select({ id: servers.id })
            .from(servers)
            .where(and(eq(servers.port, newPort), ne(servers.id, id)))
            .limit(1)
          if (!existingPort) {
            await db.update(servers).set({ port: newPort, updatedAt: new Date() }).where(eq(servers.id, id))
          }
        }
      }

      return { needsRestart }
    },
    {
      params: IdParam,
      body: RawPropertiesBody,
      response: {
        200: NeedsRestartResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update raw server properties',
        description: 'Replace server.properties with raw text content. Returns whether server needs restart.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/config',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const serverConfig: ServerConfig = {
        id: server.id,
        name: server.name,
        type: server.type,
        version: server.version,
        port: server.port,
        ramMinMb: server.ramMinMb,
        ramMaxMb: server.ramMaxMb,
        jvmArgs: server.jvmArgs,
        javaPath: server.javaPath,
        autoStart: server.autoStart,
        autoRestart: server.autoRestart,
        restartLimit: server.restartLimit,
        restartSchedule: server.restartSchedule,
        iconPath: server.iconPath,
      }

      return { config: serverConfig }
    },
    {
      params: IdParam,
      response: {
        200: ConfigResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server configuration',
        description: 'Get the full server configuration including JVM settings and automation options',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id/config',
    async ({ params, body }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const result = UpdateServerConfigSchema.safeParse(body)
      if (!result.success) {
        throw new ValidationError('Validation Error', 'VALIDATION_ERROR', result.error.flatten())
      }

      const input = result.data

      if (input.ramMinMb !== undefined || input.ramMaxMb !== undefined) {
        const newMin = input.ramMinMb ?? server.ramMinMb
        const newMax = input.ramMaxMb ?? server.ramMaxMb
        if (newMin > newMax) {
          throw new ValidationError('Minimum RAM cannot exceed maximum RAM', 'INVALID_RAM_CONFIG')
        }
      }

      const updateData: Partial<typeof servers.$inferInsert> = { updatedAt: new Date() }
      if (input.name !== undefined) updateData.name = input.name
      if (input.ramMinMb !== undefined) updateData.ramMinMb = input.ramMinMb
      if (input.ramMaxMb !== undefined) updateData.ramMaxMb = input.ramMaxMb
      if (input.jvmArgs !== undefined) updateData.jvmArgs = input.jvmArgs
      if (input.javaPath !== undefined) updateData.javaPath = input.javaPath
      if (input.autoStart !== undefined) updateData.autoStart = input.autoStart
      if (input.autoRestart !== undefined) updateData.autoRestart = input.autoRestart
      if (input.restartLimit !== undefined) updateData.restartLimit = input.restartLimit
      if (input.restartSchedule !== undefined) updateData.restartSchedule = input.restartSchedule

      if (Object.keys(updateData).length > 1) {
        await db.update(servers).set(updateData).where(eq(servers.id, id))
      }

      if (input.restartSchedule !== undefined) {
        const { restartScheduler } = await import('../modules/scheduler/restart-scheduler.js')
        restartScheduler.setSchedule(id, input.restartSchedule)
      }

      const [updatedServer] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      const s = updatedServer!

      const status = processManager.getStatus(updatedServer?.id)
      const needsRestart =
        status.state === 'running' &&
        (input.ramMinMb !== undefined ||
          input.ramMaxMb !== undefined ||
          input.jvmArgs !== undefined ||
          input.javaPath !== undefined)

      return {
        config: {
          id: s.id,
          name: s.name,
          type: s.type,
          version: s.version,
          port: s.port,
          ramMinMb: s.ramMinMb,
          ramMaxMb: s.ramMaxMb,
          jvmArgs: s.jvmArgs,
          javaPath: s.javaPath,
          autoStart: s.autoStart,
          autoRestart: s.autoRestart,
          restartLimit: s.restartLimit,
          restartSchedule: s.restartSchedule,
          iconPath: s.iconPath,
        } as ServerConfig,
        needsRestart,
      }
    },
    {
      params: IdParam,
      body: UpdateServerConfigBody,
      response: {
        200: ConfigUpdateResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update server configuration',
        description:
          'Update advanced server configuration. Returns whether server needs restart for changes to take effect.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/icon',
    async ({ params, request }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        throw new ValidationError('No file uploaded', 'NO_FILE')
      }

      if (!file.type.startsWith('image/')) {
        throw new ValidationError('File must be an image', 'INVALID_FILE_TYPE')
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      if (buffer.length > 5 * 1024 * 1024) {
        throw new ValidationError('File size must be less than 5MB', 'FILE_TOO_LARGE')
      }

      try {
        const processed = await sharp(buffer).resize(64, 64, { fit: 'cover' }).png().toBuffer()
        const iconPath = path.join(getServerDir(server.id), 'server-icon.png')
        fs.writeFileSync(iconPath, processed)
      } catch (_err) {
        throw new AppError('Failed to process image', 500, 'IMAGE_PROCESSING_FAILED')
      }

      await db.update(servers).set({ iconPath: 'server-icon.png', updatedAt: new Date() }).where(eq(servers.id, id))

      return { iconPath: 'server-icon.png' }
    },
    {
      params: IdParam,
      response: {
        200: IconResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Upload server icon',
        description: 'Upload a custom server icon image. Will be resized to 64x64 PNG. Max size 5MB.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/icon',
    async ({ params, set }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Icon not found', 'ICON_NOT_FOUND')
      }

      const iconPath = path.join(getServerDir(server.id), 'server-icon.png')
      if (!fs.existsSync(iconPath)) {
        throw new NotFoundError('Icon not found', 'ICON_NOT_FOUND')
      }

      set.headers['Content-Type'] = 'image/png'
      set.headers['Cache-Control'] = 'public, max-age=3600'
      return Bun.file(iconPath)
    },
    {
      params: IdParam,
      response: {
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get server icon',
        description: 'Download the server icon image file',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id/icon',
    async ({ params }) => {
      const { id } = params

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const iconPath = path.join(getServerDir(server.id), 'server-icon.png')
      if (fs.existsSync(iconPath)) {
        fs.unlinkSync(iconPath)
      }

      await db.update(servers).set({ iconPath: null, updatedAt: new Date() }).where(eq(servers.id, id))

      return { message: 'Icon deleted successfully' }
    },
    {
      params: IdParam,
      response: {
        200: MessageResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete server icon',
        description: 'Remove the custom server icon',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/migrate',
    async ({ params, body }) => {
      const { id } = params
      const { type, version } = body as { type: string; version: string }

      if (!type || !version) {
        throw new ValidationError('Type and version are required', 'INVALID_INPUT')
      }

      if (type !== 'vanilla' && type !== 'paper') {
        throw new ValidationError('Invalid server type', 'INVALID_SERVER_TYPE')
      }

      const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1)
      if (!server) {
        throw new NotFoundError('Server not found', 'SERVER_NOT_FOUND')
      }

      const status = processManager.getStatus(server.id)
      if (status.state === 'running' || status.state === 'starting') {
        throw new ConflictError('Server must be stopped before migration', 'SERVER_RUNNING')
      }

      const requiredJavaMajor = await assertJavaAvailable(type as 'vanilla' | 'paper', version)

      const { backupManager } = await import('../modules/backups/index.js')

      let backupId: string
      try {
        const backup = await backupManager.createBackup(id, 'manual')
        backupId = backup.id.toString()
      } catch (_err) {
        throw new AppError('Failed to create backup before migration', 500, 'BACKUP_FAILED')
      }

      try {
        const jarPath = await jarManager.download(type as 'vanilla' | 'paper', version)
        const serverJarPath = path.join(getServerDir(server.id), 'server.jar')
        if (fs.existsSync(serverJarPath)) {
          fs.unlinkSync(serverJarPath)
        }
        fs.copyFileSync(jarPath, serverJarPath)
      } catch (_err) {
        throw new AppError('Failed to download new server JAR', 500, 'JAR_DOWNLOAD_FAILED')
      }

      await db
        .update(servers)
        .set({
          type: type as 'vanilla' | 'paper',
          version,
          javaVersion: String(requiredJavaMajor),
          updatedAt: new Date(),
        })
        .where(eq(servers.id, id))

      await db.insert(events).values({
        serverId: id,
        type: 'migrate',
        message: `Migrated from ${server.type}/${server.version} to ${type}/${version}`,
      })

      return {
        message: 'Migration successful',
        backupId,
        migration: {
          fromType: server.type,
          fromVersion: server.version,
          toType: type,
          toVersion: version,
        },
      }
    },
    {
      params: IdParam,
      body: MigrateBody,
      response: {
        200: MigrateResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
      detail: {
        summary: 'Migrate server version',
        description: 'Migrate server to a different type or version. Creates a backup first. Server must be stopped.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
