import type { ServerType } from '../../types/index.js'

export interface BackfillDeps {
  loadServersNeedingBackfill: () => Promise<Array<{ id: string; type: ServerType; version: string }>>
  lookupJavaMajor: (type: ServerType, version: string) => Promise<number>
  applyJavaVersion: (id: string, major: number) => Promise<void>
  onError?: (id: string, err: unknown) => void
}

export async function backfillJavaVersions(deps: BackfillDeps): Promise<{ updated: number; failed: number }> {
  const rows = await deps.loadServersNeedingBackfill()
  let updated = 0
  let failed = 0
  for (const row of rows) {
    try {
      const major = await deps.lookupJavaMajor(row.type, row.version)
      await deps.applyJavaVersion(row.id, major)
      updated += 1
    } catch (err) {
      failed += 1
      deps.onError?.(row.id, err)
    }
  }
  return { updated, failed }
}
