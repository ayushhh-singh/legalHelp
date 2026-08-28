#!/usr/bin/env node
/**
 * Lighthouse over every route the session brief names, mobile and desktop,
 * against a server that applies the production headers.
 *
 * Hand-run and on no CI step, for the same reason `pnpm icons:generate` is:
 * it needs a Chrome, it takes minutes, and its numbers depend on the machine
 * it runs on. The committed reports under docs/lighthouse/ are the record of
 * what was measured, and each names the host it was measured on.
 *
 * `pnpm dlx` rather than a devDependency: Lighthouse pulls ~200 packages for
 * something run a few times per release.
 *
 * Usage:
 *   pnpm build && node scripts/lighthouse.mjs
 *   node scripts/lighthouse.mjs --preset desktop
 */
import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'lighthouse')
const PORT = 4190

const presetArg = process.argv.indexOf('--preset')
const PRESET = presetArg === -1 ? 'mobile' : process.argv[presetArg + 1]

/** The six routes the brief names, plus /settings for completeness. */
const ROUTES = ['/', '/law', '/pay', '/draft', '/learn', '/utils', '/settings']

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']

const slug = (route) => (route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-'))

/**
 * A raw TCP probe rather than a fetch: this runs inside a sandbox that permits
 * a socket to a local port but not always an HTTP client's own DNS/agent
 * setup, and "is the port accepting connections" is the whole question.
 */
const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })

async function waitForServer(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await canConnect(port)) return
    if (Date.now() > deadline) throw new Error(`server never came up on port ${port}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/*
  Measure a COPY of dist/, not dist/ itself.

  A full run is seven routes and several minutes. This project has had more
  than one session working in the same tree at once, and a `pnpm build` from
  any of them replaces dist/ mid-run — which showed up first as a report that
  scored /law at seo 92 because index.html did not exist for a moment.
*/
const SNAPSHOT = mkdtempSync(join(tmpdir(), 'sahayak-lighthouse-'))
cpSync(join(ROOT, 'dist'), SNAPSHOT, { recursive: true })

const server = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'serve-dist.mjs'), '--port', String(PORT), '--root', SNAPSHOT],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
  },
)
server.on('error', (error) => {
  console.error('could not start scripts/serve-dist.mjs:', error)
})

try {
  await waitForServer(PORT)
  mkdirSync(OUT, { recursive: true })

  const summary = []
  for (const route of ROUTES) {
    const file = join(OUT, `${PRESET}-${slug(route)}.json`)
    const args = [
      'lighthouse@12',
      `http://127.0.0.1:${PORT}${route}`,
      '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
      '--output=json',
      `--output-path=${file}`,
      ...(PRESET === 'desktop' ? ['--preset=desktop'] : []),
    ]
    const run = spawnSync('pnpm', ['dlx', ...args], { cwd: ROOT, stdio: 'ignore' })
    if (run.status !== 0) throw new Error(`lighthouse failed on ${route}`)

    const report = JSON.parse(readFileSync(file, 'utf8'))

    /*
      Strip the screenshots before committing.

      Lighthouse embeds the filmstrip and the full-page capture as base64 PNGs,
      which is ~155 KB of the ~420 KB report and 60% of the directory. Every
      score, every metric and every audit result is kept — what goes is a
      picture of a page this repository can rebuild. `pnpm lighthouse`
      regenerates the untrimmed report locally for anyone who wants the
      filmstrip.
    */
    delete report.fullPageScreenshot
    for (const audit of ['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot']) {
      if (report.audits?.[audit]) delete report.audits[audit].details
    }
    writeFileSync(file, `${JSON.stringify(report)}\n`)

    const scores = Object.fromEntries(
      CATEGORIES.map((key) => [key, Math.round((report.categories[key]?.score ?? 0) * 100)]),
    )
    summary.push({ route, ...scores })

    const cells = CATEGORIES.map((key) => `${key.slice(0, 4)} ${String(scores[key]).padStart(3)}`)
    console.log(`${route.padEnd(10)} ${cells.join('  ')}`)
  }

  writeFileSync(
    join(OUT, `${PRESET}-summary.json`),
    `${JSON.stringify({ preset: PRESET, routes: summary }, null, 2)}\n`,
  )
  console.log(`\nwrote ${ROUTES.length + 1} files to docs/lighthouse/`)
} finally {
  server.kill()
  rmSync(SNAPSHOT, { recursive: true, force: true })
}
