import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type', { enum: ['vanilla', 'paper'] }).notNull(),
  version: text('version').notNull(),
  port: integer('port').notNull(),
  ramMinMb: integer('ram_min_mb').notNull().default(1024),
  ramMaxMb: integer('ram_max_mb').notNull().default(2048),
  javaVersion: text('java_version'),
  directory: text('directory').notNull(),
  autoStart: boolean('auto_start').default(false).notNull(),
  autoRestart: boolean('auto_restart').default(false).notNull(),
  restartLimit: integer('restart_limit').default(3).notNull(),
  iconPath: text('icon_path'),
  jvmArgs: text('jvm_args'),
  javaPath: text('java_path'),
  restartSchedule: text('restart_schedule'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const backupConfigs = pgTable('backup_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' })
    .unique(),
  enabled: boolean('enabled').default(true).notNull(),
  intervalMinutes: integer('interval_minutes').default(60).notNull(),
  maxBackups: integer('max_backups').default(10).notNull(),
  includeLogs: boolean('include_logs').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const backups = pgTable(
  'backups',
  () => ({
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    type: text('type', { enum: ['manual', 'scheduled', 'pre-import'] }).notNull(),
    status: text('status', { enum: ['pending', 'completed', 'failed'] })
      .notNull()
      .default('completed'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  }),
  (table) => [index('idx_backups_server_id').on(table.serverId)],
)

export const events = pgTable(
  'events',
  () => ({
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    message: text('message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  }),
  (table) => [index('idx_events_server_id').on(table.serverId), index('idx_events_created_at').on(table.createdAt)],
)
