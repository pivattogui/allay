export type DetectedType = 'world-only' | 'full-backup' | 'mixed'
export type PresetName = 'world-only' | 'world-configs' | 'all-except-jars'

export interface ArchiveCategories {
  world: string[]
  configs: string[]
  plugins: string[]
  jars: string[]
  logs: string[]
  other: string[]
}

export interface AnalysisResult {
  importId: string
  detectedType: DetectedType
  categories: ArchiveCategories
  suggestedPreset: PresetName | null
  totalSize: number
}

export interface ImportSelection {
  preset: PresetName | null
  include: string[]
  exclude: string[]
}

export const WORLD_PATTERNS = ['world/', 'world_nether/', 'world_the_end/']

// Root-level entries that belong to a Minecraft world when there is no `world/`
// wrapper directory (e.g. archives exported directly from `world/`).
export const WORLD_COMPONENT_FILES = [
  'level.dat',
  'level.dat_old',
  'session.lock',
  'raids.dat',
  'scoreboard.dat',
  'forcedchunks.dat',
  'icon.png',
]

export const WORLD_COMPONENT_DIRS = [
  'region/',
  'entities/',
  'poi/',
  'data/',
  'playerdata/',
  'advancements/',
  'stats/',
  'datapacks/',
  'serverconfig/',
  'DIM-1/',
  'DIM1/',
]

export const CONFIG_PATTERNS = [
  'server.properties',
  'bukkit.yml',
  'spigot.yml',
  'config/paper-global.yml',
  'config/paper-world-defaults.yml',
]
export const CONFIG_EXTENSIONS = ['.yml', '.yaml', '.toml', '.properties']

export const LOG_PATTERNS = ['logs/', 'crash-reports/']
export const PLUGIN_PATTERN = 'plugins/'
