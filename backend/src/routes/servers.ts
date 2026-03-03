import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { eq, ne, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { servers, backupConfigs, events } from '../db/schema.js';
import { config } from '../config.js';
import { processManager } from '../modules/process/index.js';
import { jarManager } from '../modules/servers/jar-manager.js';
import {
  CreateServerSchema,
  UpdateServerSchema,
  UpdateServerConfigSchema,
  type ServerWithStatus,
  type ServerConfig,
  type Server,
} from '../types/index.js';
import type { JwtPayload } from '../types/index.js';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

export const serversRoutes = new Elysia({ prefix: '/api/servers' })
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
  .get('/', async () => {
    const rows = await db.select().from(servers).orderBy(desc(servers.createdAt));

    const serversWithStatus: ServerWithStatus[] = rows.map((server) => ({
      ...server,
      status: processManager.getStatus(server.id),
    }));

    return { servers: serversWithStatus };
  })
  .get('/:id', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);

    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    return {
      server: {
        ...server,
        status: processManager.getStatus(server.id),
      },
    };
  })
  .post('/', async ({ body, set }) => {
    const result = CreateServerSchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return {
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: result.error.flatten(),
      };
    }

    const input = result.data;

    const [existingPort] = await db.select({ id: servers.id }).from(servers).where(eq(servers.port, input.port)).limit(1);
    if (existingPort) {
      set.status = 400;
      return { error: 'Port already in use by another server', code: 'PORT_IN_USE' };
    }

    if (input.ramMinMb > input.ramMaxMb) {
      set.status = 400;
      return { error: 'Minimum RAM cannot exceed maximum RAM', code: 'INVALID_RAM_CONFIG' };
    }

    const id = uuidv4();
    const directory = path.join(config.paths.servers, id);

    fs.mkdirSync(directory, { recursive: true });

    try {
      console.info(`Downloading ${input.type} server JAR version ${input.version}...`);
      const jarPath = await jarManager.download(input.type, input.version);
      fs.copyFileSync(jarPath, path.join(directory, 'server.jar'));
    } catch (err) {
      fs.rmSync(directory, { recursive: true, force: true });
      console.error(err);
      set.status = 500;
      return { error: 'Failed to download server JAR', code: 'JAR_DOWNLOAD_FAILED' };
    }

    fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n');

    const serverProperties = `
server-port=${input.port}
motd=MC Manager Server
max-players=20
online-mode=true
`.trim();
    fs.writeFileSync(path.join(directory, 'server.properties'), serverProperties);

    await db.insert(servers).values({
      id,
      name: input.name,
      type: input.type,
      version: input.version,
      port: input.port,
      ramMinMb: input.ramMinMb,
      ramMaxMb: input.ramMaxMb,
      directory,
      autoStart: input.autoStart,
      autoRestart: input.autoRestart,
    });

    await db.insert(backupConfigs).values({
      serverId: id,
      enabled: true,
      intervalMinutes: 60,
      maxBackups: 10,
      includeLogs: false,
    });

    await db.insert(events).values({
      serverId: id,
      type: 'create',
      message: `Server "${input.name}" created`,
    });

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);

    set.status = 201;
    return {
      server: {
        ...server!,
        status: processManager.getStatus(id),
      },
    };
  })
  .patch('/:id', async ({ params, body, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const result = UpdateServerSchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return { error: 'Validation Error', code: 'VALIDATION_ERROR', details: result.error.flatten() };
    }

    const input = result.data;

    if (input.port && input.port !== server.port) {
      const [existingPort] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.port, input.port), ne(servers.id, id))).limit(1);
      if (existingPort) {
        set.status = 400;
        return { error: 'Port already in use by another server', code: 'PORT_IN_USE' };
      }

      const propsPath = path.join(server.directory, 'server.properties');
      if (fs.existsSync(propsPath)) {
        let props = fs.readFileSync(propsPath, 'utf-8');
        props = props.replace(/server-port=\d+/, `server-port=${input.port}`);
        fs.writeFileSync(propsPath, props);
      }
    }

    const updateData: Partial<typeof servers.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.port !== undefined) updateData.port = input.port;
    if (input.ramMinMb !== undefined) updateData.ramMinMb = input.ramMinMb;
    if (input.ramMaxMb !== undefined) updateData.ramMaxMb = input.ramMaxMb;
    if (input.autoStart !== undefined) updateData.autoStart = input.autoStart;
    if (input.autoRestart !== undefined) updateData.autoRestart = input.autoRestart;

    if (Object.keys(updateData).length > 1) {
      await db.update(servers).set(updateData).where(eq(servers.id, id));
    }

    const [updatedServer] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);

    return {
      server: {
        ...updatedServer!,
        status: processManager.getStatus(id),
      },
    };
  })
  .delete('/:id', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    if (status.state === 'running' || status.state === 'starting') {
      await processManager.stop(id);
    }

    if (fs.existsSync(server.directory)) {
      fs.rmSync(server.directory, { recursive: true, force: true });
    }

    await db.delete(servers).where(eq(servers.id, id));

    return { message: 'Server deleted successfully' };
  })
  .post('/:id/start', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    if (status.state === 'running' || status.state === 'starting') {
      set.status = 400;
      return { error: 'Server is already running', code: 'SERVER_ALREADY_RUNNING' };
    }

    try {
      await processManager.start(server as Server);
      await db.insert(events).values({ serverId: id, type: 'start', message: 'Server started' });
      return { message: 'Server starting', status: processManager.getStatus(id) };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Failed to start server', code: 'START_FAILED' };
    }
  })
  .post('/:id/stop', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    if (status.state === 'stopped' || status.state === 'stopping') {
      set.status = 400;
      return { error: 'Server is not running', code: 'SERVER_NOT_RUNNING' };
    }

    try {
      await processManager.stop(id);
      await db.insert(events).values({ serverId: id, type: 'stop', message: 'Server stopped' });
      return { message: 'Server stopped', status: processManager.getStatus(id) };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Failed to stop server', code: 'STOP_FAILED' };
    }
  })
  .post('/:id/kill', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    processManager.kill(id);
    return { message: 'Server killed', status: processManager.getStatus(id) };
  })
  .get('/:id/status', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    return { status: processManager.getStatus(id) };
  })
  .get('/:id/logs', async ({ params, query, set }) => {
    const { id } = params;
    const lines = query.lines ? Number(query.lines) : 100;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const logs = processManager.getLogs(id, lines);
    return { logs };
  })
  .post('/:id/command', async ({ params, body, set }) => {
    const { id } = params;
    const { command } = body as { command: string };

    if (!command || typeof command !== 'string') {
      set.status = 400;
      return { error: 'Command is required', code: 'INVALID_COMMAND' };
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    if (status.state !== 'running') {
      set.status = 400;
      return { error: 'Server is not running', code: 'SERVER_NOT_RUNNING' };
    }

    const sent = processManager.sendCommand(id, command);
    if (!sent) {
      set.status = 500;
      return { error: 'Failed to send command', code: 'COMMAND_FAILED' };
    }

    return { message: 'Command sent', command };
  })
  .get('/:id/properties', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const propsPath = path.join(server.directory, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      return { properties: {} };
    }

    const content = fs.readFileSync(propsPath, 'utf-8');
    const properties: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          properties[trimmed.substring(0, eqIndex)] = trimmed.substring(eqIndex + 1);
        }
      }
    }

    return { properties };
  })
  .put('/:id/properties', async ({ params, body, set }) => {
    const { id } = params;
    const { properties } = body as { properties: Record<string, string> };

    if (!properties || typeof properties !== 'object') {
      set.status = 400;
      return { error: 'Properties object is required', code: 'INVALID_PROPERTIES' };
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const propsPath = path.join(server.directory, 'server.properties');
    const content = Object.entries(properties).map(([key, value]) => `${key}=${value}`).join('\n');
    fs.writeFileSync(propsPath, content);

    if (properties['server-port']) {
      const newPort = parseInt(properties['server-port'], 10);
      if (!isNaN(newPort) && newPort !== server.port) {
        const [existingPort] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.port, newPort), ne(servers.id, id))).limit(1);
        if (!existingPort) {
          await db.update(servers).set({ port: newPort, updatedAt: new Date() }).where(eq(servers.id, id));
        }
      }
    }

    const status = processManager.getStatus(id);
    return { needsRestart: status.state === 'running' };
  })
  .get('/:id/properties/raw', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const propsPath = path.join(server.directory, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      set.status = 404;
      return { error: 'server.properties not found', code: 'PROPERTIES_NOT_FOUND' };
    }

    return { content: fs.readFileSync(propsPath, 'utf-8') };
  })
  .put('/:id/properties/raw', async ({ params, body, set }) => {
    const { id } = params;
    const { content } = body as { content: string };

    if (typeof content !== 'string') {
      set.status = 400;
      return { error: 'Content is required', code: 'INVALID_CONTENT' };
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    const needsRestart = status.state === 'running';

    const propsPath = path.join(server.directory, 'server.properties');
    fs.writeFileSync(propsPath, content);

    const portMatch = content.match(/server-port=(\d+)/);
    if (portMatch) {
      const newPort = parseInt(portMatch[1], 10);
      if (!isNaN(newPort) && newPort !== server.port) {
        const [existingPort] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.port, newPort), ne(servers.id, id))).limit(1);
        if (!existingPort) {
          await db.update(servers).set({ port: newPort, updatedAt: new Date() }).where(eq(servers.id, id));
        }
      }
    }

    return { needsRestart };
  })
  .get('/:id/config', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
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
    };

    return { config: serverConfig };
  })
  .patch('/:id/config', async ({ params, body, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const result = UpdateServerConfigSchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return { error: 'Validation Error', code: 'VALIDATION_ERROR', details: result.error.flatten() };
    }

    const input = result.data;

    if (input.ramMinMb !== undefined || input.ramMaxMb !== undefined) {
      const newMin = input.ramMinMb ?? server.ramMinMb;
      const newMax = input.ramMaxMb ?? server.ramMaxMb;
      if (newMin > newMax) {
        set.status = 400;
        return { error: 'Minimum RAM cannot exceed maximum RAM', code: 'INVALID_RAM_CONFIG' };
      }
    }

    const updateData: Partial<typeof servers.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.ramMinMb !== undefined) updateData.ramMinMb = input.ramMinMb;
    if (input.ramMaxMb !== undefined) updateData.ramMaxMb = input.ramMaxMb;
    if (input.jvmArgs !== undefined) updateData.jvmArgs = input.jvmArgs;
    if (input.javaPath !== undefined) updateData.javaPath = input.javaPath;
    if (input.autoStart !== undefined) updateData.autoStart = input.autoStart;
    if (input.autoRestart !== undefined) updateData.autoRestart = input.autoRestart;
    if (input.restartLimit !== undefined) updateData.restartLimit = input.restartLimit;
    if (input.restartSchedule !== undefined) updateData.restartSchedule = input.restartSchedule;

    if (Object.keys(updateData).length > 1) {
      await db.update(servers).set(updateData).where(eq(servers.id, id));
    }

    if (input.restartSchedule !== undefined) {
      const { restartScheduler } = await import('../modules/scheduler/restart-scheduler.js');
      restartScheduler.setSchedule(id, input.restartSchedule);
    }

    const [updatedServer] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    const s = updatedServer!;

    const status = processManager.getStatus(id);
    const needsRestart = status.state === 'running' && (
      input.ramMinMb !== undefined ||
      input.ramMaxMb !== undefined ||
      input.jvmArgs !== undefined ||
      input.javaPath !== undefined
    );

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
    };
  })
  .post('/:id/icon', async ({ params, request, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      set.status = 400;
      return { error: 'No file uploaded', code: 'NO_FILE' };
    }

    if (!file.type.startsWith('image/')) {
      set.status = 400;
      return { error: 'File must be an image', code: 'INVALID_FILE_TYPE' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length > 5 * 1024 * 1024) {
      set.status = 400;
      return { error: 'File size must be less than 5MB', code: 'FILE_TOO_LARGE' };
    }

    const iconPath = path.join(server.directory, 'server-icon.png');
    try {
      await sharp(buffer).resize(64, 64, { fit: 'cover' }).png().toFile(iconPath);
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Failed to process image', code: 'IMAGE_PROCESSING_FAILED' };
    }

    await db.update(servers).set({ iconPath: 'server-icon.png', updatedAt: new Date() }).where(eq(servers.id, id));

    return { iconPath: 'server-icon.png' };
  })
  .get('/:id/icon', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Icon not found', code: 'ICON_NOT_FOUND' };
    }

    const iconPath = path.join(server.directory, 'server-icon.png');
    if (!fs.existsSync(iconPath)) {
      set.status = 404;
      return { error: 'Icon not found', code: 'ICON_NOT_FOUND' };
    }

    set.headers['Content-Type'] = 'image/png';
    set.headers['Cache-Control'] = 'public, max-age=3600';
    return Bun.file(iconPath);
  })
  .delete('/:id/icon', async ({ params, set }) => {
    const { id } = params;

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const iconPath = path.join(server.directory, 'server-icon.png');
    if (fs.existsSync(iconPath)) {
      fs.unlinkSync(iconPath);
    }

    await db.update(servers).set({ iconPath: null, updatedAt: new Date() }).where(eq(servers.id, id));

    return { message: 'Icon deleted successfully' };
  })
  .post('/:id/migrate', async ({ params, body, set }) => {
    const { id } = params;
    const { type, version } = body as { type: string; version: string };

    if (!type || !version) {
      set.status = 400;
      return { error: 'Type and version are required', code: 'INVALID_INPUT' };
    }

    if (type !== 'vanilla' && type !== 'paper') {
      set.status = 400;
      return { error: 'Invalid server type', code: 'INVALID_SERVER_TYPE' };
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found', code: 'SERVER_NOT_FOUND' };
    }

    const status = processManager.getStatus(id);
    if (status.state === 'running' || status.state === 'starting') {
      set.status = 400;
      return { error: 'Server must be stopped before migration', code: 'SERVER_RUNNING' };
    }

    const { backupManager } = await import('../modules/backups/index.js');

    let backupId: string;
    try {
      const backup = await backupManager.createBackup(id, 'manual');
      backupId = backup.id.toString();
      console.info(`Created backup ${backupId} before migration`);
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Failed to create backup before migration', code: 'BACKUP_FAILED' };
    }

    try {
      console.info(`Downloading ${type} server JAR version ${version}...`);
      const jarPath = await jarManager.download(type as 'vanilla' | 'paper', version);

      const serverJarPath = path.join(server.directory, 'server.jar');
      if (fs.existsSync(serverJarPath)) {
        fs.unlinkSync(serverJarPath);
      }
      fs.copyFileSync(jarPath, serverJarPath);
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Failed to download new server JAR', code: 'JAR_DOWNLOAD_FAILED', backupId };
    }

    await db.update(servers).set({ type: type as 'vanilla' | 'paper', version, updatedAt: new Date() }).where(eq(servers.id, id));

    await db.insert(events).values({
      serverId: id,
      type: 'migrate',
      message: `Migrated from ${server.type}/${server.version} to ${type}/${version}`,
    });

    return {
      message: 'Migration successful',
      backupId,
      migration: {
        fromType: server.type,
        fromVersion: server.version,
        toType: type,
        toVersion: version,
      },
    };
  });
