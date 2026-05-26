import { describe, expect, it } from 'vitest'
import { resolveSelection } from './extractor.js'
import type { ArchiveCategories, ImportSelection } from './types.js'

describe('resolveSelection', () => {
  const categories: ArchiveCategories = {
    world: ['world/', 'world_nether/'],
    configs: ['server.properties', 'bukkit.yml'],
    plugins: ['plugins/AuthMe.jar', 'plugins/AuthMe/config.yml'],
    jars: ['paper-1.21.4.jar'],
    logs: ['logs/latest.log'],
    other: ['whitelist.json', 'ops.json'],
  }

  const allEntries = [
    'world/level.dat',
    'world/region/r.0.0.mca',
    'world_nether/DIM-1/region/r.0.0.mca',
    'server.properties',
    'bukkit.yml',
    'plugins/AuthMe.jar',
    'plugins/AuthMe/config.yml',
    'paper-1.21.4.jar',
    'logs/latest.log',
    'whitelist.json',
    'ops.json',
  ]

  it('resolves world-only preset', () => {
    const selection: ImportSelection = { preset: 'world-only', include: [], exclude: [] }
    const paths = resolveSelection(selection, categories, allEntries)
    expect(paths).toContain('world/level.dat')
    expect(paths).toContain('world_nether/DIM-1/region/r.0.0.mca')
    expect(paths).not.toContain('server.properties')
    expect(paths).not.toContain('plugins/AuthMe.jar')
  })

  it('resolves world-configs preset', () => {
    const selection: ImportSelection = { preset: 'world-configs', include: [], exclude: [] }
    const paths = resolveSelection(selection, categories, allEntries)
    expect(paths).toContain('world/level.dat')
    expect(paths).toContain('server.properties')
    expect(paths).toContain('bukkit.yml')
    expect(paths).not.toContain('plugins/AuthMe.jar')
    expect(paths).not.toContain('paper-1.21.4.jar')
  })

  it('resolves all-except-jars preset', () => {
    const selection: ImportSelection = { preset: 'all-except-jars', include: [], exclude: [] }
    const paths = resolveSelection(selection, categories, allEntries)
    expect(paths).toContain('world/level.dat')
    expect(paths).toContain('server.properties')
    expect(paths).toContain('plugins/AuthMe.jar')
    expect(paths).toContain('whitelist.json')
    expect(paths).not.toContain('paper-1.21.4.jar')
    expect(paths).not.toContain('logs/latest.log')
  })

  it('resolves manual include list', () => {
    const selection: ImportSelection = { preset: null, include: ['world/', 'whitelist.json'], exclude: [] }
    const paths = resolveSelection(selection, categories, allEntries)
    expect(paths).toContain('world/level.dat')
    expect(paths).toContain('whitelist.json')
    expect(paths).not.toContain('server.properties')
  })

  it('applies exclude on top of preset', () => {
    const selection: ImportSelection = { preset: 'world-only', include: [], exclude: ['world_nether/'] }
    const paths = resolveSelection(selection, categories, allEntries)
    expect(paths).toContain('world/level.dat')
    expect(paths).not.toContain('world_nether/DIM-1/region/r.0.0.mca')
  })
})
