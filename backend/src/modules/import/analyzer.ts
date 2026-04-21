import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import * as tar from 'tar'
import { config } from '../../config.js'
import { createLogger } from '../../logger.js'
import {
  type ArchiveCategories,
  CONFIG_EXTENSIONS,
  CONFIG_PATTERNS,
  type DetectedType,
  LOG_PATTERNS,
  PLUGIN_PATTERN,
  type PresetName,
  WORLD_PATTERNS,
} from './types.js'

const log = createLogger('import-analyzer')
const execFileAsync = promisify(execFile)

const IMPORT_PREFIX = 'import-'
const IMPORT_TTL_MS = 30 * 60 * 1000 // 30 minutes

// ---------------------------------------------------------------------------
// Entry listing
// ---------------------------------------------------------------------------

async function listTarEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = []
  await tar.list({
    file: archivePath,
    onReadEntry(entry) {
      entries.push(entry.path)
    },
  })
  return entries
}

async function listZipEntries(archivePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('unzip', ['-l', archivePath])
  const entries: string[] = []
  // unzip -l output format: "  <size>  <date> <time>  <name>"
  // Lines with actual entries have 4 fields; header/footer lines don't match.
  const linePattern = /^\s+\d+\s+\S+\s+\S+\s+(.+)$/
  for (const line of stdout.split('\n')) {
    const match = linePattern.exec(line)
    if (match) {
      entries.push(match[1].trim())
    }
  }
  return entries
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const lower = archivePath.toLowerCase()
  if (lower.endsWith('.zip')) {
    return listZipEntries(archivePath)
  }
  // .tar.gz, .tgz, .tar.bz2, etc.
  return listTarEntries(archivePath)
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * If every entry shares a single root directory component, strip it.
 * This handles archives exported as `server-backup/world/...` etc.
 */
function stripSingleRootDir(entries: string[]): string[] {
  const nonEmpty = entries.filter((e) => e !== '' && e !== './')
  if (nonEmpty.length === 0) return entries

  const firstComponent = (entry: string) => entry.split('/')[0]
  const root = firstComponent(nonEmpty[0])

  const allShareRoot = nonEmpty.every((e) => firstComponent(e) === root)
  if (!allShareRoot) return entries

  return nonEmpty.map((e) => {
    const withoutRoot = e.slice(root.length)
    return withoutRoot.startsWith('/') ? withoutRoot.slice(1) : withoutRoot
  })
}

function stripMacOsxArtifacts(entries: string[]): string[] {
  return entries.filter((e) => !e.startsWith('__MACOSX'))
}

function normalizeEntries(raw: string[]): string[] {
  return stripSingleRootDir(stripMacOsxArtifacts(raw))
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

function isRootLevel(entry: string): boolean {
  // Root-level: no path separator, or ends with "/" (directory marker at root)
  const withoutTrailing = entry.endsWith('/') ? entry.slice(0, -1) : entry
  return !withoutTrailing.includes('/')
}

export function categorizeEntries(entries: string[]): ArchiveCategories {
  const worldSet = new Set<string>()
  const configs: string[] = []
  const plugins: string[] = []
  const jars: string[] = []
  const logs: string[] = []
  const other: string[] = []

  // Track which world directory prefixes we've seen to deduplicate
  const seenWorldDirs = new Set<string>()

  for (const entry of entries) {
    // World patterns — collect directory prefix, not individual files
    const worldPattern = WORLD_PATTERNS.find((p) => entry.startsWith(p))
    if (worldPattern) {
      if (!seenWorldDirs.has(worldPattern)) {
        seenWorldDirs.add(worldPattern)
        worldSet.add(worldPattern)
      }
      continue
    }

    // Bare level.dat at root means there's an implicit world/ here
    if (entry === 'level.dat') {
      if (!seenWorldDirs.has('world/')) {
        seenWorldDirs.add('world/')
        worldSet.add('world/')
      }
      continue
    }

    // Plugins
    if (entry.startsWith(PLUGIN_PATTERN)) {
      plugins.push(entry)
      continue
    }

    // Logs / crash-reports
    if (LOG_PATTERNS.some((p) => entry.startsWith(p))) {
      logs.push(entry)
      continue
    }

    // JARs at root
    if (isRootLevel(entry) && entry.endsWith('.jar')) {
      jars.push(entry)
      continue
    }

    // Config files: exact CONFIG_PATTERNS match OR root-level files with config extension
    if (CONFIG_PATTERNS.includes(entry)) {
      configs.push(entry)
      continue
    }

    if (isRootLevel(entry) && CONFIG_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      configs.push(entry)
      continue
    }

    // config/ sub-directory entries
    if (entry.startsWith('config/') && CONFIG_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      configs.push(entry)
      continue
    }

    // Root-level files that don't match anything else
    if (isRootLevel(entry)) {
      other.push(entry)
    }
    // Non-root, unrecognized entries are intentionally ignored (directories, deep files)
  }

  return {
    world: Array.from(worldSet),
    configs,
    plugins,
    jars,
    logs,
    other,
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyArchive(categories: ArchiveCategories, entries: string[]): DetectedType {
  const hasLevelDat = entries.some((e) => e === 'level.dat' || e.endsWith('/level.dat'))
  const hasWorldDirs = categories.world.length > 0
  const hasServerProperties = categories.configs.includes('server.properties')

  if (hasLevelDat || hasWorldDirs) {
    if (hasServerProperties) return 'full-backup'
    return 'world-only'
  }

  return 'mixed'
}

function suggestPreset(detectedType: DetectedType): PresetName | null {
  if (detectedType === 'world-only') return 'world-only'
  if (detectedType === 'full-backup') return 'world-configs'
  return null
}

// ---------------------------------------------------------------------------
// Full archive analysis
// ---------------------------------------------------------------------------

export async function analyzeArchive(archivePath: string): Promise<{
  entries: string[]
  categories: ArchiveCategories
  detectedType: DetectedType
  suggestedPreset: PresetName | null
}> {
  log.info({ archivePath }, 'Analyzing archive')

  const rawEntries = await listArchiveEntries(archivePath)
  const entries = normalizeEntries(rawEntries)
  const categories = categorizeEntries(entries)
  const detectedType = classifyArchive(categories, entries)
  const suggestedPreset = suggestPreset(detectedType)

  log.info({ detectedType, suggestedPreset }, 'Archive analysis complete')

  return { entries, categories, detectedType, suggestedPreset }
}

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------

export async function saveUploadedFile(file: File): Promise<{ importId: string; archivePath: string }> {
  const importId = crypto.randomUUID()
  const importDir = path.join(config.paths.temp, `${IMPORT_PREFIX}${importId}`)
  fs.mkdirSync(importDir, { recursive: true })

  const archivePath = path.join(importDir, file.name)
  const buffer = await file.arrayBuffer()
  fs.writeFileSync(archivePath, Buffer.from(buffer))

  log.info({ importId, archivePath }, 'Saved uploaded archive')
  return { importId, archivePath }
}

export function getImportPath(importId: string): string | null {
  const importDir = path.join(config.paths.temp, `${IMPORT_PREFIX}${importId}`)
  if (!fs.existsSync(importDir)) return null

  // Check if expired
  const stat = fs.statSync(importDir)
  if (Date.now() - stat.mtimeMs > IMPORT_TTL_MS) {
    fs.rmSync(importDir, { recursive: true, force: true })
    return null
  }

  const files = fs.readdirSync(importDir)
  if (files.length === 0) return null

  return path.join(importDir, files[0])
}

export function cleanImport(importId: string): void {
  const importDir = path.join(config.paths.temp, `${IMPORT_PREFIX}${importId}`)
  if (fs.existsSync(importDir)) {
    fs.rmSync(importDir, { recursive: true, force: true })
    log.info({ importId }, 'Cleaned import temp files')
  }
}

export function cleanExpiredImports(): void {
  const tempDir = config.paths.temp
  if (!fs.existsSync(tempDir)) return

  const now = Date.now()
  for (const entry of fs.readdirSync(tempDir)) {
    if (!entry.startsWith(IMPORT_PREFIX)) continue
    const fullPath = path.join(tempDir, entry)
    const stat = fs.statSync(fullPath)
    if (now - stat.mtimeMs > IMPORT_TTL_MS) {
      fs.rmSync(fullPath, { recursive: true, force: true })
      log.info({ dir: entry }, 'Removed expired import temp dir')
    }
  }
}
