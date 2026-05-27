import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PUBLIC_DIR = path.resolve(__dirname, '../../public')
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html')
const ASSET_JS = path.join(PUBLIC_DIR, 'assets', 'app.abc123.js')

beforeAll(() => {
  fs.mkdirSync(path.join(PUBLIC_DIR, 'assets'), { recursive: true })
  fs.writeFileSync(INDEX_HTML, '<!doctype html><title>test</title>')
  fs.writeFileSync(ASSET_JS, 'console.log("hi")')
})

afterAll(() => {
  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true })
})

async function freshApp() {
  vi.resetModules()
  const { buildApp } = await import('../app.js')
  return buildApp()
}

describe('static & SPA fallback', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars'
  })

  it('serves index.html at /', async () => {
    const app = await freshApp()
    const res = await app.handle(new Request('http://localhost:3000/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>test</title>')
  })

  it('serves hashed assets with immutable cache header', async () => {
    const app = await freshApp()
    const res = await app.handle(new Request('http://localhost:3000/assets/app.abc123.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control') ?? '').toMatch(/immutable|max-age=31536000/)
  })

  it('falls back to index.html for unknown SPA routes', async () => {
    const app = await freshApp()
    const res = await app.handle(new Request('http://localhost:3000/servers/abc/console'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>test</title>')
  })

  it('does NOT intercept /api routes', async () => {
    const app = await freshApp()
    const res = await app.handle(new Request('http://localhost:3000/api/auth/status'))
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
  })

  it('does NOT intercept /health', async () => {
    const app = await freshApp()
    const res = await app.handle(new Request('http://localhost:3000/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })
})
