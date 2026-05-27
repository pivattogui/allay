import fs from 'node:fs'
import path from 'node:path'
import { staticPlugin } from '@elysiajs/static'
import { Elysia } from 'elysia'

const PUBLIC_DIR = path.resolve(import.meta.dir ?? __dirname, '../public')
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html')

function serveIndexHtml(): Response {
  const html = fs.readFileSync(INDEX_HTML)
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

// staticPlugin is async — top-level await resolves the Elysia instance before this module
// finishes loading, so buildApp() receives an already-resolved plugin and registers all
// static routes in declaration order (before the /* SPA fallback below).
const resolvedStaticPlugin = await staticPlugin({
  assets: PUBLIC_DIR,
  prefix: '/',
  indexHTML: false,
  // alwaysStatic: true registers one explicit route per file instead of a wildcard,
  // so unmatched SPA routes reach the /* handler below rather than getting a 404.
  alwaysStatic: true,
  ignorePatterns: [/index\.html$/],
  directive: 'immutable',
  maxAge: 31536000,
  silent: true,
})

export const staticRoutes = new Elysia({ name: 'static' })
  .use(resolvedStaticPlugin)
  .get('/', () => serveIndexHtml())
  .get('/*', ({ request }) => {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api') || pathname.startsWith('/ws') || pathname === '/health') {
      return new Response('Not Found', { status: 404 })
    }
    return serveIndexHtml()
  })
