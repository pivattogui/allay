import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { buildApp } from '../../app.js'
import { cleanTestDb, setupTestDb, teardownTestDb } from './setup.js'

describe('Auth API', () => {
  let app: ReturnType<typeof buildApp>

  beforeAll(async () => {
    await setupTestDb()
    app = buildApp()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('GET /api/auth/status', () => {
    it('returns setupRequired true when no users exist', async () => {
      const res = await app.handle(new Request('http://localhost/api/auth/status'))
      const body = (await res.json()) as Record<string, unknown>
      expect(res.status).toBe(200)
      expect(body.setupRequired).toBe(true)
    })
  })

  describe('POST /api/auth/setup', () => {
    it('creates admin user', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
      const body = (await res.json()) as Record<string, unknown>
      expect(res.status).toBe(200)
      expect(body.message).toBe('Setup completed successfully')
    })

    it('rejects second setup attempt', async () => {
      await app.handle(
        new Request('http://localhost/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
      const res = await app.handle(
        new Request('http://localhost/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin2', password: 'testpassword456' }),
        }),
      )
      expect(res.status).toBe(409)
    })
  })

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await app.handle(
        new Request('http://localhost/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
    })

    it('returns token for valid credentials', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
      const body = (await res.json()) as Record<string, unknown>
      expect(res.status).toBe(200)
      expect(body.token).toBeDefined()
      expect((body.user as Record<string, unknown>).username).toBe('admin')
    })

    it('rejects invalid password', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
        }),
      )
      expect(res.status).toBe(401)
    })

    it('rejects nonexistent user', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'nobody', password: 'testpassword123' }),
        }),
      )
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/auth/me', () => {
    it('rejects request without token', async () => {
      const res = await app.handle(new Request('http://localhost/api/auth/me'))
      expect(res.status).toBe(401)
    })

    it('returns user for valid token', async () => {
      await app.handle(
        new Request('http://localhost/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
      const loginRes = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
        }),
      )
      const { token } = (await loginRes.json()) as Record<string, unknown>

      const res = await app.handle(
        new Request('http://localhost/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      const body = (await res.json()) as Record<string, unknown>
      expect(res.status).toBe(200)
      expect((body.user as Record<string, unknown>).username).toBe('admin')
    })
  })
})
