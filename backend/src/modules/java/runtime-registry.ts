import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function parseJavaMajor(output: string): number | null {
  const match = output.match(/version "([^"]+)"/)
  if (!match) return null
  const raw = match[1]

  if (raw.startsWith('1.')) {
    const legacy = raw.split('.')[1]
    const major = legacy ? Number(legacy) : Number.NaN
    return Number.isFinite(major) ? major : null
  }

  const head = raw.match(/^(\d+)/)
  if (!head) return null
  const major = Number(head[1])
  return Number.isFinite(major) ? major : null
}

export interface RuntimeProbe {
  listDir(dir: string): string[] | null
  versionOutput(javaBinPath: string): string | null
}

export class JavaRuntimeRegistry {
  private readonly runtimes = new Map<number, string>()
  private fallback: string | null = null

  constructor(
    private readonly scanDirs: string[],
    private readonly probe: RuntimeProbe,
    private readonly fallbackResolver: () => string | null = () => null,
  ) {}

  discover(): void {
    this.runtimes.clear()
    for (const dir of this.scanDirs) {
      const entries = this.probe.listDir(dir)
      if (!entries) continue
      for (const entry of entries) {
        const binPath = path.join(dir, entry, 'bin', 'java')
        const output = this.probe.versionOutput(binPath)
        if (!output) continue
        const major = parseJavaMajor(output)
        if (major === null) continue
        if (!this.runtimes.has(major)) {
          this.runtimes.set(major, binPath)
        }
      }
    }

    const fallbackPath = this.fallbackResolver()
    this.fallback = fallbackPath
    if (fallbackPath) {
      const fallbackOutput = this.probe.versionOutput(fallbackPath)
      if (fallbackOutput) {
        const fallbackMajor = parseJavaMajor(fallbackOutput)
        if (fallbackMajor !== null && !this.runtimes.has(fallbackMajor)) {
          this.runtimes.set(fallbackMajor, fallbackPath)
        }
      }
    }
  }

  getPath(major: number): string | null {
    return this.runtimes.get(major) ?? null
  }

  findCompatible(requiredMajor: number): string | null {
    const exact = this.runtimes.get(requiredMajor)
    if (exact) return exact
    const higher = [...this.runtimes.keys()].filter((m) => m > requiredMajor).sort((a, b) => a - b)
    if (higher.length === 0) return null
    return this.runtimes.get(higher[0]) ?? null
  }

  availableMajors(): number[] {
    return [...this.runtimes.keys()].sort((a, b) => a - b)
  }

  getFallback(): string | null {
    return this.fallback
  }

  isEmpty(): boolean {
    return this.runtimes.size === 0
  }
}

const DEFAULT_SCAN_DIRS = ['/opt/java', '/usr/lib/jvm']

const defaultProbe: RuntimeProbe = {
  listDir(dir) {
    try {
      return fs.readdirSync(dir)
    } catch {
      return null
    }
  },
  versionOutput(javaBinPath) {
    try {
      if (!fs.existsSync(javaBinPath)) return null
      return execFileSync(javaBinPath, ['-version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      const stderr = (err as { stderr?: Buffer | string }).stderr
      if (typeof stderr === 'string') return stderr
      if (stderr instanceof Buffer) return stderr.toString('utf-8')
      return null
    }
  },
}

export const javaRuntimeRegistry = new JavaRuntimeRegistry(DEFAULT_SCAN_DIRS, defaultProbe)
