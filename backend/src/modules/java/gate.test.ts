import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../errors.js'
import type { ServerType } from '../../types/index.js'
import { assertJavaAvailable } from './gate.js'

function deps(registryAvail: Record<number, string>, required: number) {
  const installed = Object.keys(registryAvail)
    .map(Number)
    .sort((a, b) => a - b)
  return {
    jarManager: { getRequiredJavaMajor: vi.fn(async (_t: ServerType, _v: string) => required) },
    registry: {
      findCompatible: vi.fn((major: number) => {
        if (registryAvail[major]) return registryAvail[major]
        const higher = installed.find((m) => m > major)
        return higher !== undefined ? registryAvail[higher] : null
      }),
      availableMajors: vi.fn(() => installed),
    },
  }
}

describe('assertJavaAvailable', () => {
  it('returns the required major when the JRE is available', async () => {
    const d = deps({ 21: '/opt/java/21/bin/java', 25: '/opt/java/25/bin/java' }, 25)
    await expect(assertJavaAvailable('vanilla', '26.1.2', d)).resolves.toBe(25)
  })

  it('returns the required major when a higher compatible JRE exists (Java is backward-compatible)', async () => {
    const d = deps({ 21: '/opt/java/21/bin/java', 25: '/opt/java/25/bin/java' }, 17)
    await expect(assertJavaAvailable('vanilla', '1.20.4', d)).resolves.toBe(17)
  })

  it('throws AppError 400 JAVA_RUNTIME_UNAVAILABLE listing available majors', async () => {
    const d = deps({ 21: '/opt/java/21/bin/java' }, 25)
    await expect(assertJavaAvailable('vanilla', '26.1.2', d)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
      code: 'JAVA_RUNTIME_UNAVAILABLE',
      message: expect.stringMatching(/requires Java 25.*21/),
    })
  })

  it('propagates jarManager errors as 502 JAVA_LOOKUP_FAILED', async () => {
    const d = {
      jarManager: {
        getRequiredJavaMajor: vi.fn(async () => {
          throw new Error('Mojang manifest fetch failed')
        }),
      },
      registry: { findCompatible: vi.fn(), availableMajors: vi.fn(() => [21]) },
    }
    await expect(assertJavaAvailable('vanilla', 'whatever', d)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 502,
      code: 'JAVA_LOOKUP_FAILED',
    })
    expect(d.registry.findCompatible).not.toHaveBeenCalled()
  })
})

// Sanity: ensure the AppError import in production code aligns
describe('AppError import sanity', () => {
  it('exposes the expected fields', () => {
    const err = new AppError('x', 400, 'Y')
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('Y')
  })
})
