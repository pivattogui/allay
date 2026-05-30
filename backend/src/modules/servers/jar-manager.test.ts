import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jarManager } from './jar-manager.js'

type FetchMockEntry = { ok?: boolean; status?: number; statusText?: string; json: () => unknown }

function mockFetch(routes: Record<string, FetchMockEntry>) {
  return vi.fn(async (url: string | URL | Request) => {
    const key = typeof url === 'string' ? url : url.toString()
    const route = routes[key]
    if (!route) {
      return { ok: false, status: 404, statusText: 'Not Found (test mock)', json: async () => ({}) } as Response
    }
    return {
      ok: route.ok ?? true,
      status: route.status ?? 200,
      statusText: route.statusText ?? 'OK',
      json: async () => route.json(),
    } as Response
  })
}

const VANILLA_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json'

describe('JarManager.getRequiredJavaMajor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads majorVersion from the Mojang version metadata for vanilla', async () => {
    const versionMetaUrl = 'https://piston-meta.mojang.com/v1/packages/abc/26.1.2.json'
    const fetchMock = mockFetch({
      [VANILLA_MANIFEST_URL]: {
        json: () => ({
          latest: { release: '26.1.2', snapshot: '26.1.2' },
          versions: [{ id: '26.1.2', type: 'release', url: versionMetaUrl, releaseTime: '2026-04-01T00:00:00Z' }],
        }),
      },
      [versionMetaUrl]: {
        json: () => ({
          javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 },
          downloads: { server: { url: 'https://example.com/server.jar', sha1: 'deadbeef' } },
        }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(jarManager.getRequiredJavaMajor('vanilla', '26.1.2')).resolves.toBe(25)
  })

  it('resolves Paper Java requirement via the matching vanilla manifest entry', async () => {
    const versionMetaUrl = 'https://piston-meta.mojang.com/v1/packages/xyz/1.21.11.json'
    const fetchMock = mockFetch({
      [VANILLA_MANIFEST_URL]: {
        json: () => ({
          latest: { release: '1.21.11', snapshot: '1.21.11' },
          versions: [{ id: '1.21.11', type: 'release', url: versionMetaUrl, releaseTime: '2025-12-01T00:00:00Z' }],
        }),
      },
      [versionMetaUrl]: {
        json: () => ({ javaVersion: { component: 'java-runtime-delta', majorVersion: 21 } }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(jarManager.getRequiredJavaMajor('paper', '1.21.11')).resolves.toBe(21)
  })

  it('strips pre/rc suffix for Paper versions when looking up Mojang manifest', async () => {
    const versionMetaUrl = 'https://piston-meta.mojang.com/v1/packages/xyz/1.21.11.json'
    const fetchMock = mockFetch({
      [VANILLA_MANIFEST_URL]: {
        json: () => ({
          latest: { release: '1.21.11', snapshot: '1.21.11' },
          versions: [{ id: '1.21.11', type: 'release', url: versionMetaUrl, releaseTime: '2025-12-01T00:00:00Z' }],
        }),
      },
      [versionMetaUrl]: {
        json: () => ({ javaVersion: { majorVersion: 21 } }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(jarManager.getRequiredJavaMajor('paper', '1.21.11-rc2')).resolves.toBe(21)
  })

  it('throws a descriptive error when the version is unknown to the manifest', async () => {
    const fetchMock = mockFetch({
      [VANILLA_MANIFEST_URL]: {
        json: () => ({ latest: { release: '1.21.11', snapshot: '1.21.11' }, versions: [] }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(jarManager.getRequiredJavaMajor('vanilla', 'bogus')).rejects.toThrow(/bogus/)
  })

  it('throws when manifest entry lacks javaVersion', async () => {
    const versionMetaUrl = 'https://piston-meta.mojang.com/v1/packages/xyz/1.0.json'
    const fetchMock = mockFetch({
      [VANILLA_MANIFEST_URL]: {
        json: () => ({
          latest: { release: '1.0', snapshot: '1.0' },
          versions: [{ id: '1.0', type: 'release', url: versionMetaUrl, releaseTime: '2011-11-18T00:00:00Z' }],
        }),
      },
      [versionMetaUrl]: {
        json: () => ({ downloads: {} }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(jarManager.getRequiredJavaMajor('vanilla', '1.0')).rejects.toThrow(/javaVersion/i)
  })
})
