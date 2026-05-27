import fs from 'node:fs'
import path from 'node:path'
import { staticPlugin } from '@elysiajs/static'
import { Elysia } from 'elysia'

const PUBLIC_DIR = path.resolve(import.meta.dir ?? __dirname, '../public')
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html')
const publicDirExists = fs.existsSync(PUBLIC_DIR)

function serveIndexHtml(): Response {
  const html = fs.readFileSync(INDEX_HTML)
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

// In dev and tests `public/` does not exist (Vite serves the frontend separately).
// In production the Docker image copies the frontend build into /app/public.
// Skip the static plugin entirely when the directory is missing — frontend assets
// are not the backend's responsibility in that mode.
const resolvedStaticPlugin = publicDirExists
  ? // alwaysStatic: true registers one explicit route per file instead of a wildcard,
    // so unmatched SPA routes reach the /* handler below rather than getting a 404.
    await staticPlugin({
      assets: PUBLIC_DIR,
      prefix: '/',
      indexHTML: false,
      alwaysStatic: true,
      ignorePatterns: [/index\.html$/],
      directive: 'immutable',
      maxAge: 31536000,
      silent: true,
    })
  : null

const base = new Elysia({ name: 'static' })

export const staticRoutes = (resolvedStaticPlugin ? base.use(resolvedStaticPlugin) : base)
  .get('/', () => (publicDirExists ? serveIndexHtml() : new Response('Not Found', { status: 404 })))
  .get('/*', ({ request }) => {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api') || pathname.startsWith('/ws') || pathname === '/health') {
      return new Response('Not Found', { status: 404 })
    }
    if (!publicDirExists) {
      return new Response('Not Found', { status: 404 })
    }
    return serveIndexHtml()
  })
