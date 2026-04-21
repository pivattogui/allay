import { describe, expect, it } from 'vitest'
import { categorizeEntries, classifyArchive } from './analyzer.js'
import type { ArchiveCategories } from './types.js'

describe('categorizeEntries', () => {
  it('categorizes world files', () => {
    const entries = ['world/level.dat', 'world/region/r.0.0.mca', 'world_nether/DIM-1/region/r.0.0.mca']
    const result = categorizeEntries(entries)
    expect(result.world).toContain('world/')
    expect(result.world).toContain('world_nether/')
  })

  it('categorizes config files', () => {
    const entries = ['server.properties', 'bukkit.yml', 'spigot.yml']
    const result = categorizeEntries(entries)
    expect(result.configs).toEqual(['server.properties', 'bukkit.yml', 'spigot.yml'])
  })

  it('categorizes plugins', () => {
    const entries = ['plugins/AuthMe.jar', 'plugins/AuthMe/config.yml']
    const result = categorizeEntries(entries)
    expect(result.plugins).toContain('plugins/AuthMe.jar')
    expect(result.plugins).toContain('plugins/AuthMe/config.yml')
  })

  it('categorizes jars at root', () => {
    const entries = ['paper-1.21.4.jar', 'world/level.dat']
    const result = categorizeEntries(entries)
    expect(result.jars).toEqual(['paper-1.21.4.jar'])
  })

  it('categorizes logs', () => {
    const entries = ['logs/latest.log', 'crash-reports/crash-2024.txt']
    const result = categorizeEntries(entries)
    expect(result.logs).toContain('logs/latest.log')
    expect(result.logs).toContain('crash-reports/crash-2024.txt')
  })

  it('puts unrecognized files in other', () => {
    const entries = ['whitelist.json', 'ops.json', 'banned-players.json']
    const result = categorizeEntries(entries)
    expect(result.other).toEqual(['whitelist.json', 'ops.json', 'banned-players.json'])
  })
})

describe('classifyArchive', () => {
  it('detects world-only when level.dat present without server.properties', () => {
    const categories: ArchiveCategories = {
      world: ['world/'],
      configs: [],
      plugins: [],
      jars: [],
      logs: [],
      other: [],
    }
    const entries = ['world/level.dat', 'world/region/r.0.0.mca']
    expect(classifyArchive(categories, entries)).toBe('world-only')
  })

  it('detects full-backup when server.properties and level.dat present', () => {
    const categories: ArchiveCategories = {
      world: ['world/'],
      configs: ['server.properties'],
      plugins: [],
      jars: ['server.jar'],
      logs: [],
      other: [],
    }
    const entries = ['server.properties', 'world/level.dat', 'server.jar']
    expect(classifyArchive(categories, entries)).toBe('full-backup')
  })

  it('detects mixed when no level.dat found', () => {
    const categories: ArchiveCategories = {
      world: [],
      configs: ['server.properties'],
      plugins: ['plugins/Essentials.jar'],
      jars: [],
      logs: [],
      other: [],
    }
    const entries = ['server.properties', 'plugins/Essentials.jar']
    expect(classifyArchive(categories, entries)).toBe('mixed')
  })
})
