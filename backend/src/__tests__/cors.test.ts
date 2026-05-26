import { beforeEach, describe, expect, it, vi } from 'vitest'

async function buildAppWithEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  // Prevent loadRootEnv() from reading the actual .env (which may set values we want unset)
  vi.doMock('node:fs', () => ({
    default: {
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  }))
  const { buildApp } = await import('../app.js')
  return buildApp()
}

describe('CORS', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('node:fs')
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
  })

  it('rejects cross-origin requests when ALLAY_PUBLIC_ORIGIN is unset', async () => {
    const app = await buildAppWithEnv({ ALLAY_PUBLIC_ORIGIN: undefined })
    const res = await app.handle(
      new Request('http://localhost:3000/health', {
        headers: { Origin: 'https://attacker.example' },
      }),
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows configured origin when ALLAY_PUBLIC_ORIGIN is set', async () => {
    const app = await buildAppWithEnv({ ALLAY_PUBLIC_ORIGIN: 'https://allay.example.com' })
    const res = await app.handle(
      new Request('http://localhost:3000/health', {
        headers: { Origin: 'https://allay.example.com' },
      }),
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allay.example.com')
  })
})
