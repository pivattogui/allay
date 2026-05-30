import { AppError } from '../../errors.js'
import type { ServerType } from '../../types/index.js'
import { jarManager } from '../servers/jar-manager.js'
import { javaRuntimeRegistry } from './runtime-registry.js'

export interface JavaGateDeps {
  jarManager: { getRequiredJavaMajor: (type: ServerType, version: string) => Promise<number> }
  registry: { findCompatible: (major: number) => string | null; availableMajors: () => number[] }
}

const defaultDeps: JavaGateDeps = {
  jarManager,
  registry: javaRuntimeRegistry,
}

export async function assertJavaAvailable(
  type: ServerType,
  version: string,
  deps: JavaGateDeps = defaultDeps,
): Promise<number> {
  let required: number
  try {
    required = await deps.jarManager.getRequiredJavaMajor(type, version)
  } catch (err) {
    throw new AppError(
      `Could not determine Java requirement for ${type}/${version}: ${err instanceof Error ? err.message : String(err)}`,
      502,
      'JAVA_LOOKUP_FAILED',
    )
  }

  if (deps.registry.findCompatible(required)) return required

  const available = deps.registry.availableMajors()
  const list = available.length ? available.join(', ') : 'none'
  throw new AppError(
    `Server ${type}/${version} requires Java ${required}, but only [${list}] are installed in this runtime`,
    400,
    'JAVA_RUNTIME_UNAVAILABLE',
  )
}
