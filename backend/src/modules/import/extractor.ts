import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as tar from 'tar'
import { config, getServerDir } from '../../config.js'
import { createLogger } from '../../logger.js'
import type { ArchiveCategories, ImportSelection, PresetName } from './types.js'

const log = createLogger('import-extractor')
const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Preset → category key mapping
// ---------------------------------------------------------------------------

const PRESET_CATEGORIES: Record<PresetName, Array<keyof ArchiveCategories>> = {
  'world-only': ['world'],
  'world-configs': ['world', 'configs'],
  'all-except-jars': ['world', 'configs', 'plugins', 'other'],
}

// ---------------------------------------------------------------------------
// resolveSelection
// ---------------------------------------------------------------------------

/**
 * Resolves a selection (preset or manual include list) into actual file paths
 * from the entry list, then applies excludes.
 *
 * Matching rules:
 * - Prefix ending with '/' → startsWith match (directory subtree)
 * - Prefix without '/' → exact match
 */
export function resolveSelection(
  selection: ImportSelection,
  categories: ArchiveCategories,
  allEntries: string[],
): string[] {
  const includePrefixes = buildIncludePrefixes(selection, categories)
  const included = allEntries.filter((entry) => matchesAnyPrefix(entry, includePrefixes))
  return applyExcludes(included, selection.exclude)
}

function buildIncludePrefixes(selection: ImportSelection, categories: ArchiveCategories): string[] {
  if (selection.preset !== null) {
    const categoryKeys = PRESET_CATEGORIES[selection.preset]
    return categoryKeys.flatMap((key) => categories[key])
  }
  return selection.include
}

function matchesAnyPrefix(entry: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix.endsWith('/')) return entry.startsWith(prefix)
    return entry === prefix
  })
}

function applyExcludes(entries: string[], excludes: string[]): string[] {
  if (excludes.length === 0) return entries
  return entries.filter((entry) => !matchesAnyPrefix(entry, excludes))
}

// ---------------------------------------------------------------------------
// extractSelection
// ---------------------------------------------------------------------------

/**
 * Extracts only the selected paths from an archive into the server directory.
 *
 * For .zip: extracts to a temp dir first, then copies selected paths.
 * For .tar.gz: streams and filters in one pass via tar.extract filter option.
 *
 * If a bare `level.dat` is present (no world/ prefix), all imported files are
 * wrapped into a `world/` subdirectory.
 */
export async function extractSelection(
  archivePath: string,
  serverId: string,
  selectedPaths: string[],
  originalEntries: string[],
): Promise<void> {
  const serverDir = getServerDir(serverId)
  const selectedSet = new Set(selectedPaths)

  const needsWorldWrap = originalEntries.includes('level.dat') && !selectedPaths.some((p) => p.startsWith('world/'))

  log.info({ serverId, archivePath, selectedCount: selectedPaths.length, needsWorldWrap }, 'Extracting selection')

  if (archivePath.toLowerCase().endsWith('.zip')) {
    await extractZipSelection(archivePath, serverDir, selectedSet, needsWorldWrap)
  } else {
    await extractTarSelection(archivePath, serverDir, selectedSet, needsWorldWrap)
  }

  log.info({ serverId }, 'Extraction complete')
}

// ---------------------------------------------------------------------------
// Tar extraction
// ---------------------------------------------------------------------------

async function extractTarSelection(
  archivePath: string,
  serverDir: string,
  selectedSet: Set<string>,
  needsWorldWrap: boolean,
): Promise<void> {
  fs.mkdirSync(serverDir, { recursive: true })

  if (!needsWorldWrap) {
    await tar.extract({
      file: archivePath,
      cwd: serverDir,
      filter: (entryPath) => selectedSet.has(entryPath),
    })
    return
  }

  // Wrap into world/ — extract to temp, then copy with prefix
  const tempDir = fs.mkdtempSync(path.join(config.paths.temp, 'tar-extract-'))
  try {
    await tar.extract({
      file: archivePath,
      cwd: tempDir,
      filter: (entryPath) => selectedSet.has(entryPath),
    })
    copyWithWorldWrap(tempDir, serverDir)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Zip extraction
// ---------------------------------------------------------------------------

async function extractZipSelection(
  archivePath: string,
  serverDir: string,
  selectedSet: Set<string>,
  needsWorldWrap: boolean,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-extract-'))

  try {
    await execFileAsync('unzip', ['-q', archivePath, '-d', tempDir])

    // Detect single-directory wrapping (e.g. server-backup/world/...)
    const sourceDir = resolveZipSourceDir(tempDir)

    fs.mkdirSync(serverDir, { recursive: true })

    for (const selectedPath of selectedSet) {
      const sourcePath = path.join(sourceDir, selectedPath)
      const destPath = path.join(serverDir, needsWorldWrap ? path.join('world', selectedPath) : selectedPath)

      validateNoPathTraversal(destPath, serverDir)

      if (!fs.existsSync(sourcePath)) continue

      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      copyRecursive(sourcePath, destPath)
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * If the extracted zip has exactly one top-level directory, treat it as the
 * actual root (strips the wrapper directory created by some zip tools).
 */
function resolveZipSourceDir(tempDir: string): string {
  const entries = fs.readdirSync(tempDir)
  if (entries.length === 1) {
    const single = path.join(tempDir, entries[0])
    if (fs.statSync(single).isDirectory()) return single
  }
  return tempDir
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateNoPathTraversal(resolvedPath: string, baseDir: string): void {
  const normalizedBase = path.resolve(baseDir)
  const normalizedTarget = path.resolve(resolvedPath)
  if (!normalizedTarget.startsWith(normalizedBase + path.sep) && normalizedTarget !== normalizedBase) {
    throw new Error(`Path traversal detected: ${resolvedPath}`)
  }
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

function copyWithWorldWrap(sourceDir: string, serverDir: string): void {
  const worldDir = path.join(serverDir, 'world')
  fs.mkdirSync(worldDir, { recursive: true })

  for (const entry of fs.readdirSync(sourceDir)) {
    copyRecursive(path.join(sourceDir, entry), path.join(worldDir, entry))
  }
}
