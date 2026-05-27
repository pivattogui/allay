import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// Load .env from project root (parent of backend/) when not already set by docker-compose
function loadRootEnv() {
  const rootEnvPath = path.resolve(import.meta.dir ?? __dirname, '../../.env')
  if (!fs.existsSync(rootEnvPath)) return
  const content = fs.readFileSync(rootEnvPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    const value = trimmed.slice(eqIndex + 1)
    if (!process.env[key]) process.env[key] = value
  }
}
loadRootEnv()

// Project root: two levels up from this file (backend/src/config.ts → project root)
const PROJECT_ROOT = path.resolve(import.meta.dir ?? __dirname, '../..')
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'data')

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const user = process.env.DB_USER || 'allay'
  const password = process.env.DB_PASSWORD ?? ''
  const host = process.env.DB_HOST || 'localhost'
  const port = process.env.DB_PORT || '5432'
  const name = process.env.DB_NAME || 'allay'
  return `postgresql://${user}:${password}@${host}:${port}/${name}`
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
  DATABASE_URL: z.string().default(buildDatabaseUrl()),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('24h'),
  MC_PORT_MIN: z.coerce.number().int().min(1024).max(65535).default(25565),
  MC_PORT_MAX: z.coerce.number().int().min(1024).max(65535).default(25575),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ALLAY_PUBLIC_ORIGIN: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // biome-ignore lint/suspicious/noConsole: logger unavailable before config is parsed
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

const env = parsed.data

export const config = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  publicOrigin: env.ALLAY_PUBLIC_ORIGIN,

  paths: {
    data: path.resolve(env.DATA_DIR),
    servers: path.resolve(env.DATA_DIR, 'servers'),
    backups: path.resolve(env.DATA_DIR, 'backups'),
    jars: path.resolve(env.DATA_DIR, 'jars'),
    temp: path.resolve(env.DATA_DIR, 'temp'),
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  minecraft: {
    defaultRamMin: 1024,
    defaultRamMax: 2048,
    defaultPort: env.MC_PORT_MIN,
    portMin: env.MC_PORT_MIN,
    portMax: env.MC_PORT_MAX,
    shutdownTimeout: 30000,
    startupTimeout: 120000,
    maxRestarts: 3,
    restartWindowMs: 600000,
  },
} as const

export type Config = typeof config

export function getServerDir(serverId: string): string {
  return path.join(config.paths.servers, serverId)
}
