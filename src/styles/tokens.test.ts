import { describe, expect, it } from 'vitest'

import { readFromRoot } from '@/test/paths'

/**
 * Locks the Neev palette to WCAG AA, in both themes.
 *
 * Colours are resolved NUMERICALLY from the token values in tokens.css — the
 * file is parsed, `var()` references are followed, and `/15` tints are
 * composited over their surface. Nothing here reads a computed CSS string:
 * jsdom does not resolve `var()` in getComputedStyle and never sees Tailwind's
 * generated utilities, so a string-parsing version of this test would assert
 * against something the browser never renders.
 *
 * Read from disk rather than imported: vitest runs with `css: false`, so a
 * `?raw` CSS import resolves to an empty string. This also means the assertions
 * run against the file that actually ships.
 *
 * Three values deviate from the palette as specified in CLAUDE.md; each failed
 * one of the floors below and each is recorded in ADR-010. This test is what
 * caught them, and what stops the next edit reintroducing them.
 */
const tokensCss = readFromRoot('src/styles/tokens.css')
/** Comments explain the rules; only declarations are evidence of them. */
const tokensRules = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')

const AA_TEXT = 4.5
/** WCAG 1.4.11: the visual boundary of a UI component. */
const NON_TEXT = 3

/* ------------------------------------------------------------------ parsing */

/** Every custom property declared in one CSS block, in source order. */
function readDeclarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(tokensCss)?.[2]
  if (!body) throw new Error(`No "${selector}" block found in tokens.css`)

  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*--([a-z0-9-]+):\s*([^;]+);/i.exec(line)
    if (match?.[1] && match[2]) out[match[1]] = match[2].trim()
  }
  return out
}

const lightTokens = readDeclarations(':root')
const darkOverrides = readDeclarations('.dark')
const brandTokens = readDeclarations(':root,\n.dark')

type Rgb = readonly [number, number, number]

/** Follow `var(--x)` chains, then parse `#rgb` / `#rrggbb`. */
function resolve(name: string, tokens: Record<string, string>): Rgb {
  let value = tokens[name]
  const seen = new Set<string>()
  while (value !== undefined && value.startsWith('var(')) {
    const ref = /^var\(--([a-z0-9-]+)\)$/i.exec(value)?.[1]
    if (!ref || seen.has(ref)) throw new Error(`--${name} does not resolve to a colour`)
    seen.add(ref)
    value = tokens[ref]
  }
  if (value === undefined) throw new Error(`--${name} is not declared`)

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1]
  if (!hex) throw new Error(`--${name} is "${value}", which is not a plain hex colour`)
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * What `bg-marigold/15` actually paints: Tailwind emits a 15%-alpha colour, and
 * the browser composites it over whatever is behind it. Compositing is in sRGB,
 * which is what the WCAG formula then reads.
 */
function tint(fg: Rgb, bg: Rgb, alpha = 0.15): Rgb {
  return [0, 1, 2].map((i) => alpha * (fg[i] ?? 0) + (1 - alpha) * (bg[i] ?? 0)) as unknown as Rgb
}

/* ------------------------------------------------------------------- themes */

const THEMES = {
  light: { ...brandTokens, ...lightTokens },
  dark: { ...brandTokens, ...lightTokens, ...darkOverrides },
} as const

const get = (theme: keyof typeof THEMES, token: string) => resolve(token, THEMES[theme])

/**
 * The surfaces that page text actually sits on. Deliberately NOT every token:
 * --primary, --secondary, --destructive and --action are fills that carry their
 * own paired foreground, asserted separately, and muted text is never placed
 * on them.
 */
const TEXT_SURFACES = ['background', 'card', 'muted'] as const

/** Surface / foreground pairs the design declares. Both must be readable. */
const DECLARED_PAIRS = [
  ['background', 'foreground'],
  ['card', 'card-foreground'],
  ['popover', 'popover-foreground'],
  ['primary', 'primary-foreground'],
  ['secondary', 'secondary-foreground'],
  ['muted', 'muted-foreground'],
  ['accent', 'accent-foreground'],
  ['destructive', 'destructive-foreground'],
  ['action', 'action-foreground'],
  ['sidebar', 'sidebar-foreground'],
  ['sidebar-primary', 'sidebar-primary-foreground'],
  ['sidebar-accent', 'sidebar-accent-foreground'],
] as const

/** Colours used as body text over a page surface rather than as a fill. */
const TEXT_TOKENS = ['foreground', 'muted-foreground', 'primary', 'destructive'] as const

/** The tint-only accents. Each pairs its /15 tint with its own -foreground. */
const ACCENTS = ['marigold', 'tulsi', 'coral', 'violet'] as const

const THEME_NAMES = ['light', 'dark'] as const

/* -------------------------------------------------------------------- tests */

describe('design tokens', () => {
  it('declares light on :root and dark only on .dark — never from the OS', () => {
    // ADR-010 reverses ADR-006. A prefers-color-scheme remap here would mean a
    // reader on a dark system gets dark before ever touching the toggle.
    expect(tokensRules).not.toMatch(/prefers-color-scheme/)
    expect(tokensRules).toMatch(/@custom-variant dark \(&:is\(\.dark \*\)\);/)
  })

  it('gives every light token a dark counterpart, and vice versa', () => {
    // Anything theme-dependent must be defined in both, or one theme silently
    // inherits the other's value.
    const light = Object.keys(lightTokens).filter((t) => t !== 'radius')
    expect(Object.keys(darkOverrides).sort()).toEqual(light.sort())
  })

  it('states every colour as a plain hex, so it can be read and re-checked', () => {
    for (const theme of THEME_NAMES) {
      for (const token of Object.keys(THEMES[theme])) {
        if (token === 'radius') continue
        expect(() => get(theme, token), `--${token} (${theme})`).not.toThrow()
      }
    }
  })

  describe.each(THEME_NAMES)('%s theme', (theme) => {
    it.each(DECLARED_PAIRS)('--%s carries --%s at AA', (surface, foreground) => {
      const ratio = contrast(get(theme, foreground), get(theme, surface))
      expect(
        Number(ratio.toFixed(2)),
        `--${foreground} on --${surface} is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    })

    it.each(TEXT_SURFACES.flatMap((s) => TEXT_TOKENS.map((f) => [f, s] as const)))(
      '--%s reads as text on --%s',
      (foreground, surface) => {
        const ratio = contrast(get(theme, foreground), get(theme, surface))
        expect(
          Number(ratio.toFixed(2)),
          `--${foreground} on --${surface} is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      },
    )

    it.each(ACCENTS.flatMap((a) => TEXT_SURFACES.map((s) => [a, s] as const)))(
      '--%s-foreground reads on the --%s/15 tint over --%s',
      (accent, surface) => {
        const composited = tint(get(theme, accent), get(theme, surface))
        const ratio = contrast(get(theme, `${accent}-foreground`), composited)
        expect(
          Number(ratio.toFixed(2)),
          `--${accent}-foreground on --${accent}/15 over --${surface} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      },
    )

    it('puts --brand-navy on solid gold, never white', () => {
      // The stated rule. White on --brand-gold measures 1.6:1 and is forbidden.
      const navy = contrast(get(theme, 'brand-navy'), get(theme, 'brand-gold'))
      const white = contrast([255, 255, 255], get(theme, 'brand-gold'))
      expect(Number(navy.toFixed(2))).toBeGreaterThanOrEqual(AA_TEXT)
      expect(Number(white.toFixed(2))).toBeLessThan(AA_TEXT)
    })

    it.each(TEXT_SURFACES)('keeps --input and --ring at the 3:1 control floor on --%s', (surface) => {
      // --border is deliberately exempt: it draws dividers and card edges, which
      // identify no control and convey no state (ADR-007).
      for (const token of ['input', 'ring'] as const) {
        const ratio = contrast(get(theme, token), get(theme, surface))
        expect(
          Number(ratio.toFixed(2)),
          `--${token} on --${surface} is ${ratio.toFixed(2)}:1, below ${NON_TEXT}:1`,
        ).toBeGreaterThanOrEqual(NON_TEXT)
      }
    })
  })

  it('keeps --marigold identical in both themes, as one brand gold', () => {
    expect(get('light', 'marigold')).toEqual(get('dark', 'marigold'))
    expect(get('light', 'marigold')).toEqual(get('light', 'brand-gold'))
  })

  it('inverts --action between themes — the one token that flips', () => {
    // Navy on white in light, gold on navy in dark: navy on a navy page would
    // be invisible.
    expect(get('light', 'action')).toEqual(get('light', 'brand-navy'))
    expect(get('dark', 'action')).toEqual(get('dark', 'brand-gold'))
  })
})
