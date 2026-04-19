import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createLogger } from '../logger.js'
import { db } from './index.js'

const log = createLogger('migrate')

await migrate(db, { migrationsFolder: './drizzle' })
log.info('Database migrations completed')
process.exit(0)
