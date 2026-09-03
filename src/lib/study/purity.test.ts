import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * `src/lib/study` is pure, and it is TESTED for it rather than trusted for it.
 *
 * The same test `src/lib/srs/purity.test.ts` runs over the scheduler, for the
 * same reason it gives: the first thing anyone builds over a library like this
 * is a hook, and a hook is easiest to put beside the thing it wraps. This
 * directory has more surfaces above it than the scheduler does — a reader page,
 * a trainer page, a settings screen and an agent tool all call into it — so the
 * pull is stronger, not weaker.
 *
 * The file list is exhaustive on purpose: a new file here fails until it is
 * added deliberately.
 */

const DIR = 'src/lib/study'

const sources = readdirSync(fromRoot(DIR))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()

const read = (name: string) => readFromRoot(DIR, name)

/**
 * The file with its comments removed.
 *
 * Every "this file never does X" assertion below is about CODE, and every one
 * of them is also a thing these files name in prose to explain why they do not
 * do it. `src/lib/srs/purity.test.ts` hit the same edge and handled it by
 * choosing a pattern the prose happened not to match (`.localeCompare(` rather
 * than `localeCompare`) — which works until somebody writes the call form in a
 * comment. Stripping the comments is the version that keeps working, and it is
 * the difference between a test about the code and a test about the file.
 */
const code = (name: string) =>
  read(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

/**
 * Every module specifier the file imports from at RUNTIME.
 *
 * `import type` is excluded, and that is not a loophole: a type import is
 * erased by the compiler, so it puts nothing in any chunk and reaches no
 * database. What the rules below are about is what the built bundle actually
 * does. `src/lib/srs/types.ts` already type-imports `@/modules/trainer/schema`
 * for exactly this reason.
 */
function importsOf(source: string): string[] {
  return [
    ...[...source.matchAll(/^\s*(?:import|export)(?!\s+type\b)[\s\S]*?from\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? '')
      .filter((specifier) => !specifier.startsWith('type ')),
    ...[...source.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1] ?? ''),
  ].filter(Boolean)
}

describe('src/lib/study is pure', () => {
  it('has the files this session was asked for, and no component', () => {
    expect(sources).toEqual([
      'analytics.ts',
      'chapters.ts',
      'feynman.ts',
      'index.ts',
      'quiz.ts',
      'sessions.ts',
      'sheet.ts',
      'store.ts',
      'types.ts',
    ])
    expect(readdirSync(fromRoot(DIR)).filter((name) => name.endsWith('.tsx'))).toEqual([])
  })

  it.each(sources)('%s imports no React', (name) => {
    for (const specifier of importsOf(code(name))) {
      expect(specifier, `${name} imports ${specifier}`).not.toMatch(
        /^react($|[/-])|^react-dom|^dexie-react-hooks|^@\/(app|components)\b/,
      )
    }
  })

  it.each(sources)('%s contains no JSX and no hook', (name) => {
    const source = code(name)
    expect(source).not.toMatch(/<\/[A-Za-z]|\/>/)
    expect(source).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|LiveQuery|Translation)\b/)
  })

  it.each(sources)('%s imports no dataset', (name) => {
    // `data/rules` is ~4 MB and `data/library` another 1.8. Every function that
    // needs to know what a card or a unit IS takes it as an argument, so the
    // datasets stay behind their own routes' lazy imports.
    for (const specifier of importsOf(code(name))) {
      expect(specifier, `${name} imports ${specifier}`).not.toMatch(/\.json|\?raw|(^|\/)data\//)
    }
  })

  it.each(sources)('%s reaches no network', (name) => {
    expect(code(name)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/)
  })

  it('keeps storage in store.ts alone', () => {
    for (const name of sources) {
      const touchesDexie = importsOf(code(name)).some((specifier) => /^@\/db$|^dexie$/.test(specifier))
      expect(touchesDexie, `${name} imports the database`).toBe(name === 'store.ts')
    }
  })

  it('sorts by code unit, never by locale', () => {
    // The claim `src/lib/srs/types.ts` states and this library inherits: two
    // devices holding the same history must produce the same order, and ICU
    // collation is a property of the runtime rather than of the data.
    for (const name of sources) {
      expect(code(name), `${name} sorts with localeCompare`).not.toMatch(/\.localeCompare\s*\(/)
    }
  })

  it('reads no clock of its own outside store.ts', () => {
    // `store.ts` is allowed a default of `new Date()` on its write helpers,
    // exactly as `src/lib/srs/store.ts` is: it is the boundary, and every one
    // of them still takes an explicit instant so the tests can freeze it.
    for (const name of sources) {
      if (name === 'store.ts') continue
      expect(code(name), `${name} reads the clock`).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })

  it('never reaches for randomness', () => {
    // The quiz's order has to be reproducible for one (chapter, seed) pair.
    // `Math.random()` would make a reload a different quiz, and would make the
    // acceptance tests meaningless.
    for (const name of sources) {
      expect(code(name), `${name} uses Math.random`).not.toMatch(/Math\.random\s*\(/)
    }
  })
})
