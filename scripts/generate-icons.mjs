#!/usr/bin/env node
/**
 * Rasterize src/assets/pwa-icon.svg into the PNGs the web manifest and
 * index.html reference.
 *
 * The source SVG already keeps its shapes inside the maskable safe zone (a
 * circle 80% of the canvas, centred), so each size renders once and covers
 * both the "any" and "maskable" manifest icon purposes (vite.config.ts).
 *
 * Idempotent and offline: re-run whenever src/assets/pwa-icon.svg changes.
 * Output is committed, like the fonts, so a fresh clone does not need sharp.
 *
 * Usage: pnpm icons:generate
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'src', 'assets', 'pwa-icon.svg')
const OUT_DIR = join(ROOT, 'public', 'icons')

const TARGETS = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

async function main() {
  const svg = await readFile(SOURCE)
  await mkdir(OUT_DIR, { recursive: true })

  for (const { name, size } of TARGETS) {
    const png = await sharp(svg).resize(size, size).png().toBuffer()
    await writeFile(join(OUT_DIR, name), png)
    console.log(`wrote public/icons/${name} (${size}x${size})`)
  }
}

await main()
