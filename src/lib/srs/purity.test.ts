import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { cardSchema } from '@/modules/trainer/schema'
import { fromRoot, readFromRoot } from '@/test/paths'
import { makeAct, makeCard } from '@/test/rules-cards'

/**
 * The acceptance condition this session was given — "no React in src/lib/srs" —
 * asserted against the files rather than against a convention.
 *
 * It is worth a test rather than a code review because the pull towards
 * breaking it is real and gradual: the first thing anyone writes over this
 * library is a hook, and a hook is easiest to put beside the thing it wraps.
 * The same rule the Pay engine keeps (`src/lib/pay`, ADR-018) — the scheduler
 * is pure, the module owns the React.
 */

const DIR = 'src/lib/srs'

const sources = readdirSync(fromRoot(DIR))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()

const read = (name: string) => readFromRoot(DIR, name)

/** Every module specifier the file imports from, static or dynamic. */
function importsOf(source: string): string[] {
  return [
    ...[...source.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1] ?? ''),
    ...[...source.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1] ?? ''),
  ].filter(Boolean)
}

describe('src/lib/srs is pure', () => {
  it('has the files this session was asked for, and no component', () => {
    expect(sources).toEqual([
      'day.ts',
      'engine.ts',
      'index.ts',
      'queue.ts',
      'stats.ts',
      'store.ts',
      'transfer.ts',
      'types.ts',
    ])
    expect(readdirSync(fromRoot(DIR)).filter((name) => name.endsWith('.tsx'))).toEqual([])
  })

  it.each(sources)('%s imports no React', (name) => {
    for (const specifier of importsOf(read(name))) {
      expect(specifier, `${name} imports ${specifier}`).not.toMatch(
        /^react($|[/-])|^react-dom|^dexie-react-hooks|^@\/(app|components|i18n)\b/,
      )
    }
  })

  it.each(sources)('%s contains no JSX and no hook', (name) => {
    const source = read(name)
    expect(source).not.toMatch(/<\/[A-Za-z]|\/>/)
    expect(source).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|LiveQuery|Translation)\b/)
  })

  it.each(sources)('%s imports no dataset', (name) => {
    // `data/rules` is ~4 MB. It belongs behind the Trainer route's own lazy
    // import; pulling it in here would put it into whatever chunk imports the
    // scheduler. Every function is handed the cards it is to work over.
    for (const specifier of importsOf(read(name))) {
      expect(specifier, `${name} imports ${specifier}`).not.toMatch(/\.json|\?raw|(^|\/)data\//)
    }
  })

  it.each(sources)('%s reaches no network', (name) => {
    // The hard rule, and `eslint.config.js` grants exactly one exception to it
    // — `src/ai/providers/wire.ts`. Nothing here is that file.
    expect(read(name)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/)
  })

  it('keeps storage in store.ts alone', () => {
    for (const name of sources) {
      const touchesDexie = importsOf(read(name)).some((specifier) => /^@\/db$|^dexie$/.test(specifier))
      expect(touchesDexie, `${name} imports the database`).toBe(name === 'store.ts')
    }
  })

  it('reads no clock of its own — every function is told what time it is', () => {
    for (const name of sources) {
      expect(read(name), `${name} reads the clock`).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })
})

describe('the card fixtures', () => {
  it('are cards the trainer would actually be handed', () => {
    // A fixture that does not satisfy `cardSchema` tests the scheduler against
    // a shape it will never see.
    expect(() => cardSchema.parse(makeCard({ id: 'a-1', act: 'a' }))).not.toThrow()
    for (const card of makeAct('conduct', 3)) expect(() => cardSchema.parse(card)).not.toThrow()
  })

  it('can be built in any review state', () => {
    for (const state of ['approved', 'unreviewed', 'rejected', 'needs-hindi'] as const) {
      expect(cardSchema.parse(makeCard({ id: 'a-1', act: 'a', reviewState: state })).reviewState).toBe(state)
    }
  })
})
