import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { fromRoot, readFromRoot } from '@/test/paths'

/**
 * `src/lib/exam` is pure, and it is TESTED for it rather than trusted for it.
 *
 * The rules are `src/lib/srs/purity.test.ts`'s and `src/lib/study/purity.test.ts`'s.
 * The SHAPE is `src/lib/drafting/purity.test.ts`'s, which CLAUDE.md asks the
 * next library to copy: the rules run over the DIRECTORY, so a file added here
 * is guarded from the moment it lands rather than from the moment somebody
 * remembers to list it. The ledger below is kept as a separate assertion — it
 * still catches "added without being looked at", it just is not what decides
 * whether the file is guarded.
 */

const DIR = 'src/lib/exam'

const sources = readdirSync(fromRoot(DIR))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()

/** The file with its comments removed — `src/lib/study/purity.test.ts`'s helper. */
const code = (name: string) =>
  readFromRoot(DIR, name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

/** Every module specifier the file imports from at RUNTIME. `import type` is erased. */
function importsOf(source: string): string[] {
  return [
    ...[...source.matchAll(/^\s*(?:import|export)(?!\s+type\b)[\s\S]*?from\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? '')
      .filter((specifier) => !specifier.startsWith('type ')),
    ...[...source.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1] ?? ''),
  ].filter(Boolean)
}

describe('src/lib/exam is pure', () => {
  it('found the directory, rather than silently guarding nothing', () => {
    // A guard that iterates an empty list passes. The floor is below the real
    // count so ordinary growth never touches it.
    expect(sources.length).toBeGreaterThanOrEqual(6)
  })

  it('is the file list this session was asked for, and no component', () => {
    expect(sources).toEqual([
      'checklist.ts',
      'coverage.ts',
      'index.ts',
      'mock.ts',
      'plan.ts',
      'readiness.ts',
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
    // `data/rules` is ~4 MB and `data/exams` another 40 KB that belongs behind
    // the exam screens' own lazy import. Every function that needs to know what
    // a card or a profile IS takes it as an argument.
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
      // `types.ts` type-imports `ExamChoiceRow` from `@/db` and `index.ts`
      // re-exports `./store`; neither is a runtime import of the database, and
      // `importsOf` is what makes that distinction rather than this line.
      expect(touchesDexie, `${name} imports the database`).toBe(name === 'store.ts')
    }
  })

  it('sorts by code unit, never by locale', () => {
    // Two devices holding the same history must produce the same plan and the
    // same paper, and ICU collation is a property of the runtime rather than of
    // the data. `src/lib/srs/types.ts#compareStrings` is the one comparator.
    for (const name of sources) {
      expect(code(name), `${name} sorts with localeCompare`).not.toMatch(/\.localeCompare\s*\(/)
    }
  })

  it('reads no clock of its own outside store.ts', () => {
    // `store.ts` is allowed a default of `new Date()` on its write helpers,
    // exactly as `src/lib/srs/store.ts` and `src/lib/study/store.ts` are: it is
    // the boundary, and each still takes an explicit instant so a test can
    // freeze it. Everything else is handed `now`.
    for (const name of sources) {
      if (name === 'store.ts') continue
      expect(code(name), `${name} reads the clock`).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })

  it('never reaches for randomness', () => {
    // A mock paper has to be reproducible for one (profile, paper, seed) triple
    // — a reader who reloads mid-paper must get their paper back — and a plan
    // that reshuffled itself on every visit is a plan nobody follows.
    for (const name of sources) {
      expect(code(name), `${name} uses Math.random`).not.toMatch(/Math\.random\s*\(/)
    }
  })

  it('holds no reader-facing copy outside the bilingual data it is handed', () => {
    /*
      The exam-day checklist and the "next three actions" are ids and parameters
      here, and sentences in `src/i18n`. That is not a style rule: this library
      is pure and has no `useT`, so any sentence written into it would be
      single-language by construction — which is the one thing this project's
      master context forbids outright.

      The pattern looks for a Devanagari code point, because an English sentence
      in a comment is ordinary and a Hindi one is the tell that somebody started
      writing copy here. `checklist.ts` names its i18n ids and no text.
    */
    for (const name of sources) {
      expect(code(name), `${name} contains Devanagari copy`).not.toMatch(/[ऀ-ॿ]/)
    }
  })
})
