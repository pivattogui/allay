import { buildApp, initializeServices } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/index.js';
import { processManager } from './modules/process/index.js';
import fs from 'node:fs';

const dirs = [config.paths.data, config.paths.servers, config.paths.backups, config.paths.jars, config.paths.temp];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const app = buildApp();

await initializeServices();

app.listen({
  port: config.port,
  hostname: '0.0.0.0',
  maxRequestBodySize: 10 * 1024 * 1024 * 1024,
});

console.log(`Allay API running on port ${config.port}`);

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await processManager.stopAll();
  await closeDb();
  app.stop();
  console.log('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
