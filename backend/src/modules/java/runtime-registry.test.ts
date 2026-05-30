import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JavaRuntimeRegistry, nodeJavaProbe, parseJavaMajor } from './runtime-registry.js'

describe('parseJavaMajor', () => {
  it.each([
    ['openjdk version "21.0.11" 2024-04-16\nOpenJDK Runtime Environment Temurin-21.0.11+9', 21],
    ['openjdk version "25" 2025-09-16\nOpenJDK Runtime Environment Temurin-25+9', 25],
    ['openjdk version "25.0.1+9" 2025-10-21\nOpenJDK Runtime Environment Temurin-25.0.1+9', 25],
    ['openjdk version "25-ea" 2025-01-23\nOpenJDK Runtime Environment Temurin-25-ea+12', 25],
    ['java version "1.8.0_402"\nJava(TM) SE Runtime Environment', 8],
    ['openjdk version "11.0.20" 2023-07-18 LTS', 11],
  ])('extracts major from %j', (output, expected) => {
    expect(parseJavaMajor(output)).toBe(expected)
  })

  it.each([
    '',
    'garbage',
    'something else "21.0.11" else',
    'version "foo"',
  ])('returns null for unrecognized output %j', (output) => {
    expect(parseJavaMajor(output)).toBe(null)
  })
})

describe('JavaRuntimeRegistry', () => {
  it('discovers runtimes from scanned directories', () => {
    const probe = {
      listDir: vi.fn((dir: string) => {
        if (dir === '/opt/java') return ['temurin-21', 'temurin-25']
        return null
      }),
      versionOutput: vi.fn((bin: string) => {
        if (bin === '/opt/java/temurin-21/bin/java') return 'openjdk version "21.0.11"'
        if (bin === '/opt/java/temurin-25/bin/java') return 'openjdk version "25"'
        return null
      }),
    }

    const registry = new JavaRuntimeRegistry(['/opt/java'], probe)
    registry.discover()

    expect(registry.getPath(21)).toBe('/opt/java/temurin-21/bin/java')
    expect(registry.getPath(25)).toBe('/opt/java/temurin-25/bin/java')
    expect(registry.availableMajors()).toEqual([21, 25])
  })

  it('returns null for unknown major', () => {
    const probe = {
      listDir: vi.fn(() => null),
      versionOutput: vi.fn(() => null),
    }
    const registry = new JavaRuntimeRegistry(['/nowhere'], probe)
    registry.discover()

    expect(registry.getPath(21)).toBe(null)
    expect(registry.availableMajors()).toEqual([])
  })

  it('ignores entries with unreadable java -version output', () => {
    const probe = {
      listDir: vi.fn(() => ['broken', 'ok-21']),
      versionOutput: vi.fn((bin: string) => {
        if (bin.endsWith('broken/bin/java')) return null
        if (bin.endsWith('ok-21/bin/java')) return 'openjdk version "21.0.11"'
        return null
      }),
    }
    const registry = new JavaRuntimeRegistry(['/opt/java'], probe)
    registry.discover()

    expect(registry.availableMajors()).toEqual([21])
  })

  it('keeps first occurrence when same major appears in multiple dirs', () => {
    const probe = {
      listDir: vi.fn((dir: string) => {
        if (dir === '/opt/java') return ['temurin-21']
        if (dir === '/usr/lib/jvm') return ['adoptopenjdk-21']
        return null
      }),
      versionOutput: vi.fn(() => 'openjdk version "21.0.11"'),
    }
    const registry = new JavaRuntimeRegistry(['/opt/java', '/usr/lib/jvm'], probe)
    registry.discover()

    expect(registry.getPath(21)).toBe('/opt/java/temurin-21/bin/java')
  })

  it('adds the fallback to the major map when its version can be read', () => {
    const probe = {
      listDir: vi.fn(() => null),
      versionOutput: vi.fn((bin: string) =>
        bin === '/Users/dev/.asdf/installs/java/21/bin/java' ? 'openjdk version "21.0.11"' : null,
      ),
    }
    const registry = new JavaRuntimeRegistry(['/nowhere'], probe, () => '/Users/dev/.asdf/installs/java/21/bin/java')
    registry.discover()

    expect(registry.getPath(21)).toBe('/Users/dev/.asdf/installs/java/21/bin/java')
    expect(registry.availableMajors()).toEqual([21])
    expect(registry.getFallback()).toBe('/Users/dev/.asdf/installs/java/21/bin/java')
  })

  it('does not let the fallback shadow a scanned runtime of the same major', () => {
    const probe = {
      listDir: vi.fn((dir: string) => (dir === '/opt/java' ? ['temurin-21'] : null)),
      versionOutput: vi.fn((bin: string) => {
        if (bin === '/opt/java/temurin-21/bin/java') return 'openjdk version "21.0.11"'
        if (bin === '/fallback/java') return 'openjdk version "21.0.11"'
        return null
      }),
    }
    const registry = new JavaRuntimeRegistry(['/opt/java'], probe, () => '/fallback/java')
    registry.discover()

    expect(registry.getPath(21)).toBe('/opt/java/temurin-21/bin/java')
  })

  it('returns isEmpty when nothing discovered and no fallback', () => {
    const probe = {
      listDir: vi.fn(() => null),
      versionOutput: vi.fn(() => null),
    }
    const registry = new JavaRuntimeRegistry(['/nowhere'], probe)
    registry.discover()

    expect(registry.isEmpty()).toBe(true)
  })

  describe('nodeJavaProbe (integration with a shell stub that writes to stderr like real java)', () => {
    let tmpRoot: string

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-runtime-registry-'))
    })

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    })

    function makeJavaStub(name: string, versionLine: string, target: 'stdout' | 'stderr'): void {
      const binDir = path.join(tmpRoot, name, 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      const redirect = target === 'stderr' ? '>&2' : ''
      fs.writeFileSync(path.join(binDir, 'java'), `#!/bin/sh\necho '${versionLine}' ${redirect}\n`, { mode: 0o755 })
    }

    it('discovers a runtime whose -version output comes from stderr (matches real java behavior)', () => {
      makeJavaStub('temurin-21', 'openjdk version "21.0.11" 2024-04-16', 'stderr')
      makeJavaStub('temurin-25', 'openjdk version "25" 2025-09-16', 'stderr')

      const registry = new JavaRuntimeRegistry([tmpRoot], nodeJavaProbe)
      registry.discover()

      expect(registry.availableMajors()).toEqual([21, 25])
      expect(registry.getPath(21)).toBe(path.join(tmpRoot, 'temurin-21', 'bin', 'java'))
      expect(registry.getPath(25)).toBe(path.join(tmpRoot, 'temurin-25', 'bin', 'java'))
    })

    it('also handles stubs that write -version to stdout', () => {
      makeJavaStub('temurin-21', 'openjdk version "21.0.11" 2024-04-16', 'stdout')

      const registry = new JavaRuntimeRegistry([tmpRoot], nodeJavaProbe)
      registry.discover()

      expect(registry.availableMajors()).toEqual([21])
    })
  })

  describe('findCompatible', () => {
    function buildRegistry(majors: number[]): JavaRuntimeRegistry {
      const probe = {
        listDir: vi.fn(() => majors.map((m) => `temurin-${m}`)),
        versionOutput: vi.fn((bin: string) => {
          const m = bin.match(/temurin-(\d+)/)
          return m ? `openjdk version "${m[1]}.0.0"` : null
        }),
      }
      const registry = new JavaRuntimeRegistry(['/opt/java'], probe)
      registry.discover()
      return registry
    }

    it('returns the exact major when installed', () => {
      const registry = buildRegistry([21, 25])
      expect(registry.findCompatible(21)).toBe('/opt/java/temurin-21/bin/java')
      expect(registry.findCompatible(25)).toBe('/opt/java/temurin-25/bin/java')
    })

    it('falls forward to the smallest installed major greater than required (Java is backward-compatible)', () => {
      const registry = buildRegistry([21, 25])
      expect(registry.findCompatible(8)).toBe('/opt/java/temurin-21/bin/java')
      expect(registry.findCompatible(17)).toBe('/opt/java/temurin-21/bin/java')
      expect(registry.findCompatible(22)).toBe('/opt/java/temurin-25/bin/java')
    })

    it('returns null when no installed major is greater than or equal to required', () => {
      const registry = buildRegistry([21])
      expect(registry.findCompatible(25)).toBe(null)
    })

    it('returns null when registry is empty', () => {
      const registry = buildRegistry([])
      expect(registry.findCompatible(21)).toBe(null)
    })
  })
})
