import { describe, expect, it, vi } from 'vitest'
import { JavaRuntimeRegistry } from '../java/runtime-registry.js'
import { resolveJavaCommand } from './java-resolver.js'

function emptyRegistry(): JavaRuntimeRegistry {
  return new JavaRuntimeRegistry([], { listDir: vi.fn(() => null), versionOutput: vi.fn(() => null) }, () => null)
}

function registryWith(majors: Record<number, string>, fallback: string | null = null): JavaRuntimeRegistry {
  const probe = {
    listDir: vi.fn((dir: string) => (dir === '/opt/java' ? Object.keys(majors) : null)),
    versionOutput: vi.fn((bin: string) => {
      const entry = Object.entries(majors).find(([major]) => bin.includes(`/${major}/bin/java`))
      return entry ? `openjdk version "${entry[1]}"` : null
    }),
  }
  const registry = new JavaRuntimeRegistry(['/opt/java'], probe, () => fallback)
  registry.discover()
  return registry
}

const baseServer = {
  id: 'srv',
  name: 'srv',
  type: 'vanilla' as const,
  version: '1.21.11',
  port: 25565,
  ramMinMb: 1024,
  ramMaxMb: 2048,
  javaVersion: null as string | null,
  directory: '/data/srv',
  autoStart: false,
  autoRestart: false,
  restartLimit: 3,
  iconPath: null,
  jvmArgs: null,
  javaPath: null as string | null,
  restartSchedule: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('resolveJavaCommand', () => {
  it('uses server.javaPath when set (operator override)', () => {
    const result = resolveJavaCommand({ ...baseServer, javaPath: '/custom/java' }, { registry: emptyRegistry() })
    expect(result).toEqual({ kind: 'ok', javaCommand: '/custom/java', source: 'override' })
  })

  it('looks up by server.javaVersion in the registry', () => {
    const registry = registryWith({ 21: '21.0.11', 25: '25' })
    const result = resolveJavaCommand({ ...baseServer, javaVersion: '25' }, { registry })
    expect(result).toEqual({ kind: 'ok', javaCommand: '/opt/java/25/bin/java', source: 'registry' })
  })

  it('falls forward to a newer installed major when exact is missing (Java is backward-compatible)', () => {
    const registry = registryWith({ 21: '21.0.11', 25: '25' })
    const result = resolveJavaCommand({ ...baseServer, javaVersion: '17' }, { registry })
    expect(result).toEqual({ kind: 'ok', javaCommand: '/opt/java/21/bin/java', source: 'registry' })
  })

  it('returns unavailable error when registry lacks the required major', () => {
    const registry = registryWith({ 21: '21.0.11' })
    const result = resolveJavaCommand({ ...baseServer, javaVersion: '25' }, { registry })
    expect(result).toEqual({
      kind: 'error',
      reason: 'unavailable',
      requiredMajor: 25,
      availableMajors: [21],
    })
  })

  it('falls back to fallback path when javaVersion is null and fallback is provided', () => {
    const registry = emptyRegistry()
    const result = resolveJavaCommand(baseServer, { registry, fallbackPath: '/usr/bin/java' })
    expect(result).toEqual({ kind: 'ok', javaCommand: '/usr/bin/java', source: 'fallback' })
  })

  it('falls back when javaVersion present but registry empty AND fallback configured', () => {
    const registry = emptyRegistry()
    const result = resolveJavaCommand({ ...baseServer, javaVersion: '21' }, { registry, fallbackPath: '/usr/bin/java' })
    expect(result).toEqual({
      kind: 'error',
      reason: 'unavailable',
      requiredMajor: 21,
      availableMajors: [],
    })
  })

  it('returns no-java when nothing is set and no fallback', () => {
    const registry = emptyRegistry()
    const result = resolveJavaCommand(baseServer, { registry })
    expect(result).toEqual({ kind: 'error', reason: 'no-java' })
  })
})
