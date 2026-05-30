import { describe, expect, it, vi } from 'vitest'
import type { ServerType } from '../../types/index.js'
import { backfillJavaVersions } from './backfill.js'

type Row = { id: string; type: ServerType; version: string }

function setup(rows: Row[], lookup: Record<string, number | Error>) {
  const applied: Array<{ id: string; major: number }> = []
  const errors: Array<{ id: string; err: unknown }> = []
  const deps = {
    loadServersNeedingBackfill: vi.fn(async () => rows),
    lookupJavaMajor: vi.fn(async (type: ServerType, version: string) => {
      const result = lookup[`${type}/${version}`]
      if (result instanceof Error) throw result
      if (typeof result === 'number') return result
      throw new Error(`no lookup for ${type}/${version}`)
    }),
    applyJavaVersion: vi.fn(async (id: string, major: number) => {
      applied.push({ id, major })
    }),
    onError: (id: string, err: unknown) => errors.push({ id, err }),
  }
  return { deps, applied, errors }
}

describe('backfillJavaVersions', () => {
  it('updates each server with the resolved Java major', async () => {
    const { deps, applied } = setup(
      [
        { id: 'a', type: 'vanilla', version: '1.21.11' },
        { id: 'b', type: 'paper', version: '1.20.4' },
      ],
      { 'vanilla/1.21.11': 21, 'paper/1.20.4': 17 },
    )
    const result = await backfillJavaVersions(deps)

    expect(result).toEqual({ updated: 2, failed: 0 })
    expect(applied).toEqual([
      { id: 'a', major: 21 },
      { id: 'b', major: 17 },
    ])
  })

  it('does nothing when no servers need backfill', async () => {
    const { deps, applied } = setup([], {})
    const result = await backfillJavaVersions(deps)

    expect(result).toEqual({ updated: 0, failed: 0 })
    expect(applied).toEqual([])
  })

  it('continues past individual lookup failures and reports them', async () => {
    const { deps, applied, errors } = setup(
      [
        { id: 'a', type: 'vanilla', version: '1.21.11' },
        { id: 'b', type: 'vanilla', version: 'unknown' },
        { id: 'c', type: 'vanilla', version: '1.20.4' },
      ],
      {
        'vanilla/1.21.11': 21,
        'vanilla/unknown': new Error('manifest miss'),
        'vanilla/1.20.4': 17,
      },
    )
    const result = await backfillJavaVersions(deps)

    expect(result).toEqual({ updated: 2, failed: 1 })
    expect(applied).toEqual([
      { id: 'a', major: 21 },
      { id: 'c', major: 17 },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0].id).toBe('b')
  })
})
