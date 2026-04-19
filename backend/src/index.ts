import fs from 'node:fs'
import { buildApp, initializeServices } from './app.js'
import { config } from './config.js'
import { closeDb } from './db/index.js'
import { createLogger } from './logger.js'
import { processManager } from './modules/process/index.js'

const log = createLogger('main')

const dirs = [config.paths.data, config.paths.servers, config.paths.backups, config.paths.jars, config.paths.temp]
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const app = buildApp()

await initializeServices()

app.listen({
  port: config.port,
  hostname: '0.0.0.0',
  maxRequestBodySize: 10 * 1024 * 1024 * 1024,
})

log.info({ port: config.port, env: config.env }, 'Server listening')

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down')
  await processManager.stopAll()
  await closeDb()
  app.stop()

  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
