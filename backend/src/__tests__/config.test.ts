import { describe, expect, it } from 'vitest'

describe('config — ALLAY_PUBLIC_ORIGIN', () => {
  it('parses a valid origin URL', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
    process.env.ALLAY_PUBLIC_ORIGIN = 'https://allay.example.com'
    const { config } = await import('../config.js')
    expect(config.publicOrigin).toBe('https://allay.example.com')
  })

  it('is undefined when env var is missing', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
    delete process.env.ALLAY_PUBLIC_ORIGIN
    // dynamic re-import after env change
    const mod = await import('../config.js?reimport-1')
    expect(mod.config.publicOrigin).toBeUndefined()
  })
})
