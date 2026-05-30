import type { Server } from '../../types/index.js'
import type { JavaRuntimeRegistry } from '../java/runtime-registry.js'

export interface JavaResolverOptions {
  registry: Pick<JavaRuntimeRegistry, 'findCompatible' | 'availableMajors'>
  fallbackPath?: string | null
}

export type JavaResolverResult =
  | { kind: 'ok'; javaCommand: string; source: 'override' | 'registry' | 'fallback' }
  | { kind: 'error'; reason: 'unavailable'; requiredMajor: number; availableMajors: number[] }
  | { kind: 'error'; reason: 'no-java' }

export function resolveJavaCommand(server: Server, opts: JavaResolverOptions): JavaResolverResult {
  if (server.javaPath) {
    return { kind: 'ok', javaCommand: server.javaPath, source: 'override' }
  }

  if (server.javaVersion) {
    const major = Number.parseInt(server.javaVersion, 10)
    if (Number.isFinite(major)) {
      const compatible = opts.registry.findCompatible(major)
      if (compatible) {
        return { kind: 'ok', javaCommand: compatible, source: 'registry' }
      }
      return {
        kind: 'error',
        reason: 'unavailable',
        requiredMajor: major,
        availableMajors: opts.registry.availableMajors(),
      }
    }
  }

  if (opts.fallbackPath) {
    return { kind: 'ok', javaCommand: opts.fallbackPath, source: 'fallback' }
  }

  return { kind: 'error', reason: 'no-java' }
}
