import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index.js';

await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations completed');
process.exit(0);
