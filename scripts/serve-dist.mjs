#!/usr/bin/env node
/**
 * Serve dist/ the way Cloudflare Pages will: the SPA fallback from
 * public/_redirects, and every response header from dist/_headers.
 *
 * `vite preview` does neither, so a Lighthouse run against it measures a site
 * with no Content-Security-Policy, no cache policy and none of the per-route
 * preload hints — three things that change the numbers. The reports under
 * docs/lighthouse/ are measured against THIS server for that reason.
 *
 * It also compresses, which is not a detail: Cloudflare gzips and brotlis
 * every text response automatically, and serving 381 KB of uncompressed entry
 * chunk where production sends 118 KB does not measure production. A first
 * run of this server without it scored 4.9s FCP against `vite preview`'s 2.1s,
 * which was entirely the missing Content-Encoding.
 *
 * Usage: node scripts/serve-dist.mjs [--port 4180]
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrotliCompress, createGzip } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootArg = process.argv.indexOf('--root')
// --root serves a COPY of dist/ instead of dist/ itself. scripts/lighthouse.mjs
// uses it so a concurrent `pnpm build` in the same working tree cannot delete
// index.html out from under a run that takes several minutes.
const DIST = rootArg === -1 ? join(ROOT, 'dist') : resolve(process.argv[rootArg + 1])

const portArg = process.argv.indexOf('--port')
const PORT = portArg === -1 ? 4180 : Number(process.argv[portArg + 1])
const NO_LINK = process.argv.includes('--no-link')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/**
 * Cloudflare Pages' `_headers` grammar. An unindented line is a path pattern
 * (`*` is the only wildcard), an indented `Name: value` line belongs to the
 * pattern above it, `#` is a comment. Rules apply in order and later ones add
 * to earlier ones, which is Cloudflare's own behaviour.
 */
function parseHeaders(file) {
  if (!existsSync(file)) return []
  const rules = []
  let current = null

  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] }
      rules.push(current)
      continue
    }
    if (!current) continue
    const separator = raw.indexOf(':')
    if (separator === -1) continue
    current.headers.push([raw.slice(0, separator).trim(), raw.slice(separator + 1).trim()])
  }
  return rules
}

const matches = (pattern, pathname) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(pathname)
}

const RULES = parseHeaders(join(DIST, '_headers'))

function resolveFile(pathname) {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const candidate = join(DIST, safe)
  if (!candidate.startsWith(DIST)) return null

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  const indexed = join(candidate, 'index.html')
  if (existsSync(indexed)) return indexed
  return null
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`)

  // public/_redirects: /*  /index.html  200 — a client route must serve the
  // shell, not a 404, or every deep link and every hard refresh breaks.
  const file = resolveFile(pathname) ?? join(DIST, 'index.html')
  const servedPath = file === join(DIST, 'index.html') ? pathname : pathname

  for (const rule of RULES) {
    if (!matches(rule.pattern, servedPath)) continue
    for (const [name, value] of rule.headers) {
      // --no-link drops the generated per-route preload hints, so their effect
      // can be measured against the same server rather than against a
      // different one (vite preview does not compress the same way).
      if (NO_LINK && name.toLowerCase() === 'link') continue
      response.setHeader(name, value)
    }
  }

  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  response.setHeader('Content-Type', type)

  // Everything Cloudflare compresses: text, and the fonts/images it leaves
  // alone because they are already compressed.
  const compressible = /^(text\/|application\/(javascript|json|xml|manifest))/.test(type)
  const accepted = String(request.headers['accept-encoding'] ?? '')
  const encoding = !compressible
    ? null
    : accepted.includes('br')
      ? 'br'
      : accepted.includes('gzip')
        ? 'gzip'
        : null

  response.statusCode = 200
  if (!encoding) {
    createReadStream(file).pipe(response)
    return
  }

  response.setHeader('Content-Encoding', encoding)
  response.setHeader('Vary', 'Accept-Encoding')
  createReadStream(file)
    .pipe(encoding === 'br' ? createBrotliCompress() : createGzip())
    .pipe(response)
})

server.listen(PORT, () => {
  console.log(`serving dist/ with dist/_headers applied on http://localhost:${PORT}`)
})
