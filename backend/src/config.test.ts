import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('./data'),
  DATABASE_URL: z.string().default('postgresql://allay:allay@localhost:5432/allay'),
  JWT_SECRET: z.string().min(16).default('development-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  MC_PORT_MIN: z.coerce.number().int().min(1024).max(65535).default(25565),
  MC_PORT_MAX: z.coerce.number().int().min(1024).max(65535).default(25575),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

describe('env config validation', () => {
  it('applies defaults for empty env', () => {
    const result = envSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe(3000)
      expect(result.data.NODE_ENV).toBe('development')
      expect(result.data.LOG_LEVEL).toBe('info')
    }
  })

  it('rejects JWT_SECRET shorter than 16 chars', () => {
    const result = envSchema.safeParse({ JWT_SECRET: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid NODE_ENV', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'staging' })
    expect(result.success).toBe(false)
  })

  it('coerces PORT from string', () => {
    const result = envSchema.safeParse({ PORT: '8080' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe(8080)
    }
  })

  it('rejects MC_PORT_MIN below 1024', () => {
    const result = envSchema.safeParse({ MC_PORT_MIN: '80' })
    expect(result.success).toBe(false)
  })

  it('rejects MC_PORT_MAX above 65535', () => {
    const result = envSchema.safeParse({ MC_PORT_MAX: '70000' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid LOG_LEVEL', () => {
    const result = envSchema.safeParse({ LOG_LEVEL: 'verbose' })
    expect(result.success).toBe(false)
  })
})
