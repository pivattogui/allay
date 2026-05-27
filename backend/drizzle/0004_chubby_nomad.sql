-- Bring DB schema in line with src/db/schema.ts.
--
-- 1. backups.status was added to the Drizzle schema by commit eee4c79
--    but no migration was generated for it. Existing rows default to
--    'completed' so the not-null constraint is safe to add directly.
--
-- 2. The nodes table and servers.node_id column were created by 0001
--    and later removed from schema.ts (commit e7aa410) without a drop
--    migration. They are unused and safe to drop. CASCADE handles the
--    FK constraint that referenced nodes.id.
--
-- All statements use IF (NOT) EXISTS so the migration is safe to run
-- against any prior DB state, including environments where someone
-- already patched the schema manually with pnpm db:push.

ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
DROP TABLE IF EXISTS "nodes" CASCADE;--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN IF EXISTS "node_id";
