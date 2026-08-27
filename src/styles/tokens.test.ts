import { describe, expect, it } from 'vitest'

import { readFromRoot } from '@/test/paths'

/**
 * Locks the palette to WCAG AA. The master context fixes these colours and
 * requires AA, and #5A6B8C originally failed on --paper-2 (4.35:1), so this
 * test exists to make any future palette edit prove itself.
 *
 * Read from disk rather than imported: vitest runs with `css: false`, so a
 * `?raw` CSS import resolves to an empty string. This also means the assertions
 * run against the file that actually ships.
 */
const tokensCss = readFromRoot('src/styles/tokens.css')

/** Every custom property declared in one CSS block, in source order. */
function readDeclarations(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
  if (!body) throw new Error(`No "${selector}" block found in tokens.css`)

  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*--([a-z0-9-]+):\s*([^;]+);/i.exec(line)
    if (match?.[1] && match[2]) out[match[1]] = match[2].trim()
  }
  return out
}

const isTriplet = (value: string) => /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value)

function hslToRgb(triplet: string): [number, number, number] {
  const parts = triplet.split(/\s+/)
  const h = Number(parts[0])
  const s = Number(parts[1]?.replace('%', '')) / 100
  const l = Number(parts[2]?.replace('%', '')) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[Math.floor(h / 60) % 6] ?? [0, 0, 0]
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

const root = readDeclarations(tokensCss, ':root')

const BACKGROUNDS = ['paper', 'paper-2'] as const
const FOREGROUNDS = ['ink', 'ink-2', 'thread', 'ok'] as const
const BRAND_TOKENS = [...BACKGROUNDS, ...FOREGROUNDS, 'border', 'input'] as const
const AA_NORMAL_TEXT = 4.5

/** Dark values live once on :root as --dark-*; both remap blocks point at them. */
const light = root
const dark = Object.fromEntries(BRAND_TOKENS.map((token) => [token, root[`dark-${token}`] ?? ''])) as Record<
  string,
  string
>

const THEMES = { light, dark } as const

describe('design tokens', () => {
  it('defines every brand token in both themes as an HSL triplet', () => {
    for (const [themeName, tokens] of Object.entries(THEMES)) {
      for (const token of BRAND_TOKENS) {
        const value = tokens[token]
        expect(value, `--${token} missing in the ${themeName} palette`).toBeTruthy()
        expect(isTriplet(value as string), `--${token} (${themeName}) is not "H S% L%"`).toBe(true)
      }
    }
  })

  describe.each(Object.entries(THEMES))('%s theme', (_themeName, tokens) => {
    it.each(BACKGROUNDS.flatMap((bg) => FOREGROUNDS.map((fg) => [fg, bg] as const)))(
      '--%s on --%s meets AA for normal text',
      (fg, bg) => {
        const ratio = contrast(tokens[fg] as string, tokens[bg] as string)
        expect(
          Number(ratio.toFixed(2)),
          `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA floor`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      },
    )

    it('keeps form-control boundaries at the 3:1 non-text floor', () => {
      // WCAG 1.4.11 covers the visual boundary of a UI component. --input is
      // that boundary for text fields and outline buttons, so it must clear
      // 3:1. --border is deliberately exempt: it draws dividers and card edges,
      // which identify no control and convey no state.
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(tokens.input as string, tokens[bg] as string)
        expect(
          Number(ratio.toFixed(2)),
          `--input on --${bg} is ${ratio.toFixed(2)}:1, below the 3:1 non-text floor`,
        ).toBeGreaterThanOrEqual(3)
      }
    })
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

  describe('dark palette wiring', () => {
    // The dark values are defined once and remapped by two selectors: the
    // prefers-color-scheme media query (applies before paint) and .dark (an
    // explicit choice). They must not drift apart.
    const systemDark = readDeclarations(tokensCss, ':root:not(.light)')
    const explicitDark = readDeclarations(tokensCss, '.dark')

    it('remaps the same tokens in both dark selectors', () => {
      expect(Object.keys(systemDark).sort()).toEqual(Object.keys(explicitDark).sort())
      expect(systemDark).toEqual(explicitDark)
    })

    it('covers every brand token', () => {
      expect(Object.keys(explicitDark).sort()).toEqual([...BRAND_TOKENS].sort())
    })

    it('points every remap at a --dark-* value rather than a literal', () => {
      for (const [token, value] of Object.entries(explicitDark)) {
        expect(value, `--${token} should reference the single dark definition`).toBe(`var(--dark-${token})`)
      }
    })

    it('applies the system preference before paint so dark readers see no flash', () => {
      expect(tokensCss).toMatch(/@media \(prefers-color-scheme: dark\)/)
      // `.light` must be able to opt back out, or an explicit light choice on a
      // dark system would be overridden by the media query.
      expect(tokensCss).toMatch(/:root:not\(\.light\)/)
    })
  })
})
