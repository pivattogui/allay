import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'drizzle-kit'

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1)
  }
}

loadEnvFile()

const url =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'allay'}:${process.env.DB_PASSWORD || 'allay'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'allay'}`

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
