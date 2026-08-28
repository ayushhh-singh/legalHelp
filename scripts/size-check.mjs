#!/usr/bin/env node
/**
 * The initial route's weight, gated in CI.
 *
 * "Initial route" means exactly what index.html pulls in before any user
 * action: the entry chunk, the rolldown runtime, every modulepreload and the
 * stylesheet. Everything else in dist/assets is behind a lazy route import or
 * a ?raw dataset import and costs a first-time reader nothing.
 *
 * Budgets live in scripts/size-budget.json, which tests/bundle-budget.test.ts
 * reads too — one number, two enforcers (ADR-030).
 *
 * Usage:
 *   pnpm size            after pnpm build
 *   pnpm size --json     machine-readable, for a CI summary
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const BUDGET = JSON.parse(readFileSync(join(ROOT, 'scripts', 'size-budget.json'), 'utf8'))

const KB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const gzip = (path) => gzipSync(readFileSync(path), { level: 9 }).length

function initialAssets() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  // src=, href= on <script>, <link rel=modulepreload> and <link rel=stylesheet>.
  // rel="preload" as="font" is deliberately NOT counted: a font is not script,
  // and the budget the brief sets is a JavaScript one.
  const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1])
  return [...new Set(refs)].filter((asset) => asset.endsWith('.js') || asset.endsWith('.css'))
}

/** The chunk name rolldown derived from the module — `bns` in `bns-6xlW7Y99.js`. */
const chunkName = (fileName) => fileName.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, '')

function main() {
  let failures = 0
  const report = { initial: [], oversizedChunks: [], budget: BUDGET, ok: true }

  const assets = initialAssets()
  if (assets.length === 0) {
    console.error('size-check: dist/index.html references no assets. Run `pnpm build` first.')
    process.exit(1)
  }

  let js = 0
  let css = 0
  for (const asset of assets) {
    const bytes = gzip(join(DIST, asset))
    const raw = statSync(join(DIST, asset)).size
    if (asset.endsWith('.js')) js += bytes
    else css += bytes
    report.initial.push({ asset, gzip: bytes, raw })
  }

  console.log('Initial route (what index.html loads before any user action)\n')
  for (const entry of report.initial) {
    console.log(`  ${entry.asset.padEnd(52)} ${KB(entry.gzip).padStart(10)} gzip`)
  }
  console.log()

  const line = (label, actual, budget) => {
    const pass = actual <= budget
    if (!pass) failures++
    const pct = ((actual / budget) * 100).toFixed(0)
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} ${KB(actual).padStart(10)} / ${KB(budget).padStart(10)} gzip  (${pct}%)`,
    )
    return pass
  }

  report.ok = line('initial JS', js, BUDGET.initialJs) && report.ok
  report.ok = line('initial CSS', css, BUDGET.initialCss) && report.ok
  report.initialJs = js
  report.initialCss = css

  // Every other chunk, so weight cannot be hidden behind a lazy import that
  // is still a several-hundred-kilobyte download the first time it is needed.
  console.log('\nLazy chunks over budget (excluding the ?raw datasets in size-budget.json)\n')
  const exemptions = { ...BUDGET.chunkExemptions }
  delete exemptions._comment

  const initial = new Set(assets)
  for (const fileName of readdirSync(join(DIST, 'assets'))) {
    const asset = `assets/${fileName}`
    if (!fileName.endsWith('.js') || initial.has(asset)) continue

    const bytes = gzip(join(DIST, asset))
    if (bytes <= BUDGET.largestChunk) continue

    const name = chunkName(asset)
    const reason = exemptions[name]
    report.oversizedChunks.push({ asset, gzip: bytes, exempt: Boolean(reason), reason: reason ?? null })

    if (reason) {
      console.log(`  exempt  ${name.padEnd(22)} ${KB(bytes).padStart(10)} gzip  — ${reason}`)
    } else {
      failures++
      report.ok = false
      console.log(
        `  FAIL    ${name.padEnd(22)} ${KB(bytes).padStart(10)} gzip  — over ${KB(BUDGET.largestChunk)}` +
          ' and not listed in scripts/size-budget.json#chunkExemptions',
      )
    }
  }
  if (report.oversizedChunks.length === 0) console.log('  none')

  if (process.argv.includes('--json')) {
    console.log(`\n${JSON.stringify(report, null, 2)}`)
  }

  console.log()
  if (failures > 0) {
    console.error(`size-check: ${failures} budget${failures === 1 ? '' : 's'} exceeded.`)
    process.exit(1)
  }
  console.log('size-check: every budget met.')
}

main()
