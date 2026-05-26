import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../db/schema.js'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://allay_test:allay_test@localhost:5433/allay_test'

let client: ReturnType<typeof postgres>
let testDb: ReturnType<typeof drizzle>

export async function setupTestDb() {
  client = postgres(TEST_DATABASE_URL, { max: 1 })
  testDb = drizzle(client, { schema })

  // Create tables from schema directly (avoids incremental migration issues on fresh DB)
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "username" text NOT NULL UNIQUE,
      "password_hash" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "servers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "type" text NOT NULL,
      "version" text NOT NULL,
      "port" integer NOT NULL,
      "ram_min_mb" integer NOT NULL DEFAULT 1024,
      "ram_max_mb" integer NOT NULL DEFAULT 2048,
      "java_version" text,
      "directory" text NOT NULL,
      "auto_start" boolean NOT NULL DEFAULT false,
      "auto_restart" boolean NOT NULL DEFAULT false,
      "restart_limit" integer NOT NULL DEFAULT 3,
      "icon_path" text,
      "jvm_args" text,
      "java_path" text,
      "restart_schedule" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "backup_configs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "server_id" uuid NOT NULL UNIQUE REFERENCES "servers"("id") ON DELETE CASCADE,
      "enabled" boolean NOT NULL DEFAULT true,
      "interval_minutes" integer NOT NULL DEFAULT 60,
      "max_backups" integer NOT NULL DEFAULT 10,
      "include_logs" boolean NOT NULL DEFAULT false,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "backups" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
      "filename" text NOT NULL,
      "size_bytes" bigint NOT NULL DEFAULT 0,
      "type" text NOT NULL,
      "status" text NOT NULL DEFAULT 'completed',
      "created_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "idx_backups_server_id" ON "backups" ("server_id");
    CREATE TABLE IF NOT EXISTS "events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "server_id" uuid REFERENCES "servers"("id") ON DELETE CASCADE,
      "type" text NOT NULL,
      "message" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "idx_events_server_id" ON "events" ("server_id");
    CREATE INDEX IF NOT EXISTS "idx_events_created_at" ON "events" ("created_at");
  `)

  return testDb
}

export async function cleanTestDb() {
  if (!testDb) return
  await testDb.execute(sql`TRUNCATE users, servers, backup_configs, backups, events CASCADE`)
}

export async function teardownTestDb() {
  if (client) {
    await client.end()
  }
}

export function getTestDb() {
  return testDb
}
