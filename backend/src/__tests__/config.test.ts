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

  it('treats empty string as unset (compose passes "" when var is undefined)', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
    process.env.ALLAY_PUBLIC_ORIGIN = ''
    const { config } = await import('../config.js')
    expect(config.publicOrigin).toBeUndefined()
  })
})

describe('config — required secrets', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects missing JWT_SECRET (no insecure default)', async () => {
    // Mock fs module before importing config to prevent loading .env
    vi.doMock('node:fs', () => ({
      default: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
      },
    }))

    const orig = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)

    await expect(import('../config.js')).rejects.toThrow(/process\.exit/)

    exitSpy.mockRestore()
    vi.doUnmock('node:fs')
    if (orig) process.env.JWT_SECRET = orig
  })
})
