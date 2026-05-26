import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('config — ALLAY_PUBLIC_ORIGIN', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('parses a valid origin URL', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
    process.env.ALLAY_PUBLIC_ORIGIN = 'https://allay.example.com'
    const { config } = await import('../config.js')
    expect(config.publicOrigin).toBe('https://allay.example.com')
  })

  it('is undefined when env var is missing', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
    delete process.env.ALLAY_PUBLIC_ORIGIN
    const { config } = await import('../config.js')
    expect(config.publicOrigin).toBeUndefined()
  })
})
