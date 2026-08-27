#!/usr/bin/env node
/**
 * Download the app's webfonts from the Google Fonts CSS API and self-host them.
 *
 * Runtime must make ZERO third-party requests (master context, hard rule), so
 * this runs at setup time only: it pulls the woff2 files into public/fonts and
 * emits public/fonts/fonts.css with local /fonts/... URLs, preserving each
 * face's unicode-range so the browser still only downloads the subset it needs.
 *
 * Idempotent: re-running overwrites files in place. Safe to run offline once
 * the files exist (it will fail loudly rather than half-write).
 *
 * Usage: pnpm fonts:fetch
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'fonts')

// A modern UA is required or the API serves ttf instead of woff2.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Only these subsets ship. Cyrillic/Greek/Vietnamese are dead weight here. */
const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'devanagari'])

const FAMILIES = [
  'Tiro+Devanagari+Hindi:ital@0;1',
  'IBM+Plex+Sans:wght@400;500;600',
  'IBM+Plex+Mono:wght@400',
]

const CSS_URL =
  'https://fonts.googleapis.com/css2?' + FAMILIES.map((f) => `family=${f}`).join('&') + '&display=swap'

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Parse the Google CSS into face descriptors. Each face is preceded by a
 * `/* subset *\/` comment, which is the only place the subset name appears.
 */
function parseFaces(css) {
  const faces = []
  // Split on the subset comment so each chunk owns exactly one @font-face.
  const parts = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//i)
  for (let i = 1; i < parts.length; i += 2) {
    const subset = parts[i]
    const block = parts[i + 1] ?? ''
    const pick = (prop) => block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim()
    const url = block.match(/src:\s*url\(([^)]+)\)/)?.[1]
    if (!url) continue
    const family = pick('font-family')?.replace(/^['"]|['"]$/g, '')
    if (!family) continue
    faces.push({
      subset,
      family,
      style: pick('font-style') ?? 'normal',
      weight: pick('font-weight') ?? '400',
      stretch: pick('font-stretch'),
      unicodeRange: pick('unicode-range'),
      url,
    })
  }
  return faces
}

/**
 * Google serves variable fonts as one file covering several weights, repeated
 * once per requested weight. Collapse those into a single face with a weight
 * range so we download one file instead of three identical ones.
 */
function dedupe(faces) {
  const byKey = new Map()
  for (const f of faces) {
    const key = `${f.family}|${f.style}|${f.subset}|${f.url}`
    const existing = byKey.get(key)
    if (existing) {
      existing.weights.push(Number(f.weight))
    } else {
      byKey.set(key, { ...f, weights: [Number(f.weight)] })
    }
  }
  return [...byKey.values()].map((f) => {
    const min = Math.min(...f.weights)
    const max = Math.max(...f.weights)
    return {
      ...f,
      weight: min === max ? String(min) : `${min} ${max}`,
      weightLabel: min === max ? String(min) : `${min}-${max}`,
    }
  })
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  process.stdout.write(`Fetching font CSS…\n  ${CSS_URL}\n`)
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Google Fonts CSS API returned ${res.status}`)
  const css = await res.text()

  const all = parseFaces(css)
  const kept = dedupe(all.filter((f) => KEEP_SUBSETS.has(f.subset)))
  const dropped = new Set(all.filter((f) => !KEEP_SUBSETS.has(f.subset)).map((f) => f.subset))

  if (kept.length === 0) throw new Error('Parsed zero usable faces — the CSS API format may have changed.')

  process.stdout.write(
    `Parsed ${all.length} faces; keeping ${kept.length} ` +
      `(dropped subsets: ${[...dropped].sort().join(', ') || 'none'})\n`,
  )

  const rules = []
  let bytes = 0

  for (const f of kept) {
    const file = `${slug(f.family)}-${f.subset}-${f.style}-${f.weightLabel}.woff2`
    const dest = join(OUT_DIR, file)

    const fontRes = await fetch(f.url, { headers: { 'User-Agent': UA } })
    if (!fontRes.ok) throw new Error(`Failed to download ${f.url}: ${fontRes.status}`)
    const buf = Buffer.from(await fontRes.arrayBuffer())
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
      throw new Error(`${file} is not a woff2 file — got ${buf.subarray(0, 4).toString('hex')}`)
    }
    await writeFile(dest, buf)
    bytes += buf.byteLength

    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8)
    process.stdout.write(`  ${file}  ${(buf.byteLength / 1024).toFixed(1)} KiB  sha256:${hash}\n`)

    rules.push(
      [
        `/* ${f.family} · ${f.subset} · ${f.style} · ${f.weight} */`,
        `@font-face {`,
        `  font-family: '${f.family}';`,
        `  font-style: ${f.style};`,
        `  font-weight: ${f.weight};`,
        f.stretch ? `  font-stretch: ${f.stretch};` : null,
        `  font-display: swap;`,
        `  src: url('/fonts/${file}') format('woff2');`,
        f.unicodeRange ? `  unicode-range: ${f.unicodeRange};` : null,
        `}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const header = `/*
 * GENERATED by scripts/fetch-fonts.mjs — do not edit by hand.
 * Run \`pnpm fonts:fetch\` to regenerate.
 *
 * Self-hosted so the app makes no third-party requests at runtime.
 * Fonts are licensed under the SIL Open Font License 1.1 — see OFL.txt.
 */\n\n`

  await writeFile(join(OUT_DIR, 'fonts.css'), header + rules.join('\n\n') + '\n', 'utf8')

  await writeFile(
    join(OUT_DIR, 'OFL.txt'),
    [
      'Fonts bundled with Sahayak',
      '==========================',
      '',
      'The following fonts are used under the SIL Open Font License, Version 1.1.',
      'The licence permits bundling and self-hosting. Full text:',
      'https://openfontlicense.org/open-font-license-official-text/',
      '',
      '  Tiro Devanagari Hindi — Copyright (c) Tiro Typeworks Ltd.',
      '    https://fonts.google.com/specimen/Tiro+Devanagari+Hindi',
      '',
      '  IBM Plex Sans — Copyright (c) IBM Corp.',
      '    https://fonts.google.com/specimen/IBM+Plex+Sans',
      '',
      '  IBM Plex Mono — Copyright (c) IBM Corp.',
      '    https://fonts.google.com/specimen/IBM+Plex+Mono',
      '',
      'Files retrieved from the Google Fonts CSS API at build-setup time by',
      'scripts/fetch-fonts.mjs. No font is requested from a third party at runtime.',
      '',
    ].join('\n'),
    'utf8',
  )

  // Guard the hard rule at the source: the generated CSS must be URL-free.
  const generated = await readFile(join(OUT_DIR, 'fonts.css'), 'utf8')
  const leaked = generated.match(/https?:\/\/[^\s'")]+/g)?.filter((u) => !u.includes('openfontlicense.org'))
  if (leaked?.length) throw new Error(`fonts.css still references external URLs: ${leaked.join(', ')}`)

  process.stdout.write(
    `\nWrote ${kept.length} woff2 files (${(bytes / 1024).toFixed(1)} KiB total) + fonts.css + OFL.txt\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`\nfetch-fonts failed: ${err.message}\n`)
  process.exit(1)
})
