import { describe, expect, it } from 'vitest'

import { readFromRoot } from '@/test/paths'

// Read from disk rather than importing: vitest runs with `css: false`, so a
// `?raw` CSS import resolves to an empty string. This also means the assertions
// run against the file that actually ships.
const tokensCss = readFromRoot('src/styles/tokens.css')

/**
 * Locks the palette to WCAG AA. The master context fixes these colours and
 * requires AA, and #5A6B8C originally failed on --paper-2 (4.35:1), so this
 * test exists to make any future palette edit prove itself.
 */

/** Pull the bare HSL triplets out of one CSS block. */
function readBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
  if (!body) throw new Error(`No ${selector} block found in tokens.css`)

  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*--([a-z0-9-]+):\s*([^;]+);/i.exec(line)
    if (!match) continue
    const [, name, value] = match
    // Keep only bare HSL triplets: "H S% L%". Aliases like var(...) are skipped.
    if (name && value && /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value.trim())) {
      out[name] = value.trim()
    }
  }
  return out
}

function hslToRgb(triplet: string): [number, number, number] {
  const parts = triplet.split(/\s+/)
  const h = Number(parts[0])
  const s = Number(parts[1]?.replace('%', '')) / 100
  const l = Number(parts[2]?.replace('%', '')) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const sector = Math.floor(h / 60) % 6
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[sector] ?? [0, 0, 0]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function luminance(triplet: string): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hslToRgb(triplet)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const light = readBlock(tokensCss, ':root')
const dark = { ...light, ...readBlock(tokensCss, '.dark') }

const THEMES = { light, dark } as const
const BACKGROUNDS = ['paper', 'paper-2'] as const
const FOREGROUNDS = ['ink', 'ink-2', 'thread', 'ok'] as const
const AA_NORMAL_TEXT = 4.5

describe('design tokens', () => {
  it('defines every brand token in both themes', () => {
    for (const [name, tokens] of Object.entries(THEMES)) {
      for (const token of [...BACKGROUNDS, ...FOREGROUNDS]) {
        expect(tokens[token], `--${token} missing in ${name}`).toBeDefined()
      }
    }
  })

  describe.each(Object.entries(THEMES))('%s theme', (_themeName, tokens) => {
    it.each(BACKGROUNDS.flatMap((bg) => FOREGROUNDS.map((fg) => [fg, bg] as const)))(
      '--%s on --%s meets AA for normal text',
      (fg, bg) => {
        const fgValue = tokens[fg]
        const bgValue = tokens[bg]
        expect(fgValue).toBeDefined()
        expect(bgValue).toBeDefined()

        const ratio = contrast(fgValue as string, bgValue as string)
        expect(
          Number(ratio.toFixed(2)),
          `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA floor`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      },
    )
  })

  it('keeps solid accent fills readable with paper-coloured text', () => {
    for (const [themeName, tokens] of Object.entries(THEMES)) {
      for (const fill of ['ink', 'thread', 'ok'] as const) {
        const ratio = contrast(tokens.paper as string, tokens[fill] as string)
        expect(
          Number(ratio.toFixed(2)),
          `${themeName}: --paper text on a --${fill} fill is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      }
    }
  })
})
