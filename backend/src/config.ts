import { z } from 'zod';
import path from 'node:path';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('./data'),
  DATABASE_URL: z.string().default('postgresql://allay:allay@localhost:5432/allay'),
  JWT_SECRET: z.string().min(16).default('development-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  AGENT_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,

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

  agent: {
    token: env.AGENT_TOKEN || env.JWT_SECRET,
  },

  minecraft: {
    defaultRamMin: 1024,
    defaultRamMax: 2048,
    defaultPort: 25565,
    shutdownTimeout: 30000,
    startupTimeout: 120000,
    maxRestarts: 3,
    restartWindowMs: 600000,
  },
} as const;

export type Config = typeof config;
