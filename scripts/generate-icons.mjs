#!/usr/bin/env node
/**
 * Rasterize src/assets/pwa-icon.svg into the PNGs the web manifest and
 * index.html reference, plus the Open Graph card at public/og.png.
 *
 * The source SVG already keeps its shapes inside the maskable safe zone (a
 * circle 80% of the canvas, centred), so each size renders once and covers
 * both the "any" and "maskable" manifest icon purposes (vite.config.ts).
 *
 * og.png is built FROM the same icon — the master context allows no external
 * image host, so a social preview has to be a file this repository ships.
 * It composites the icon onto the app's own navy with the marigold file tab
 * and the bilingual wordmark; the Devanagari line is real text rendered by
 * librsvg, so this script depends on a Devanagari face being installed on the
 * machine that runs it. That is why the OUTPUT is committed and this script is
 * hand-run and on no CI step, exactly like the icons above: a CI box with no
 * Devanagari font would silently regenerate the card with tofu boxes.
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

/**
 * 1200x630 is the size every social card reader crops to; anything smaller is
 * upscaled. Colours are the light theme's own tokens (src/styles/tokens.css) —
 * --brand-navy behind, --marigold for the file tab, --card for the panel — so
 * the preview and the app agree with each other.
 */
const OG = { width: 1200, height: 630 }

function ogCard(iconDataUri) {
  const { width, height } = OG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0B1D3B"/>
  <rect x="0" y="0" width="${width}" height="10" fill="#F7C873"/>
  <rect x="96" y="171" width="288" height="288" rx="24" fill="#FFFFFF"/>
  <image x="120" y="195" width="240" height="240" href="${iconDataUri}"/>
  <text x="448" y="284" font-family="Poppins, Inter, Helvetica, Arial, sans-serif" font-size="86" font-weight="700" fill="#FFFFFF">Sahayak</text>
  <text x="448" y="360" font-family="Noto Sans Devanagari, Kohinoor Devanagari, Devanagari Sangam MN, sans-serif" font-size="58" fill="#F7C873">\u0938\u0930\u0915\u093e\u0930\u0940 \u0938\u0939\u093e\u092f\u0915</text>
  <rect x="448" y="396" width="72" height="6" rx="3" fill="#F7C873"/>
  <text x="448" y="462" font-family="Inter, Helvetica, Arial, sans-serif" font-size="34" fill="#DFE5EF">Law \u00b7 Rules \u00b7 Drafting \u00b7 Pay \u00b7 Utilities</text>
  <text x="448" y="512" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" fill="#A9B7CC">Offline-first \u00b7 no account \u00b7 public data only</text>
</svg>`
}

async function main() {
  const svg = await readFile(SOURCE)
  await mkdir(OUT_DIR, { recursive: true })

  for (const { name, size } of TARGETS) {
    const png = await sharp(svg).resize(size, size).png().toBuffer()
    await writeFile(join(OUT_DIR, name), png)
    console.log(`wrote public/icons/${name} (${size}x${size})`)
  }

  // Inlined as a data URI rather than referenced by path: librsvg resolves a
  // relative href against its own base, which sharp does not set for a buffer.
  const iconDataUri = `data:image/svg+xml;base64,${svg.toString('base64')}`
  const og = await sharp(Buffer.from(ogCard(iconDataUri)))
    .png()
    .toBuffer()
  await writeFile(join(ROOT, 'public', 'og.png'), og)
  console.log(`wrote public/og.png (${OG.width}x${OG.height})`)
}

await main()
