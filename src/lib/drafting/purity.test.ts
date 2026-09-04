import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readFromRoot } from '@/test/paths'

/**
 * `src/lib/drafting` is pure, and it is tested for it rather than trusted for it.
 *
 * ADR-041 §2 says this file exists and says what it asserts. It did not exist
 * when the ADR was written — the invariant was described rather than
 * implemented, which is the kind of claim ADR-037's addendum says to distrust
 * on sight, and which an edge-case pass over this session found. It exists now.
 *
 * The rules, and why each one is here rather than being a convention:
 *
 * - **No `@tiptap/*` anywhere.** The document body is stored as plain JSON and
 *   every consumer downstream of the editor — the renderer, the lint, the
 *   migration, the checklist — reads it as data. The moment one of them imports
 *   the editor, the 141 KB editor chunk is in whatever imports THEM, and
 *   `docx.ts` is imported by an export handler.
 * - **No React, no Dexie, no `fetch`, no clock.** The same three the Trainer's
 *   and the study layer's own guards enforce, for the same reasons: the first
 *   thing anybody builds over a pure library is a hook, and it is easiest to
 *   put beside the thing it wraps.
 * - **No `localeCompare`.** CLAUDE.md's rule for anything that decides bytes.
 *   `versions.ts#prune` does not merely display a list — it slices it, and the
 *   caller deletes what fell off. ICU collation is a property of the runtime.
 * - **`DOC_MODEL_VERSION` is named in exactly one file.** A second copy of the
 *   number is a second answer to "what version is this document".
 *
 * `code()` strips comments and string literals before matching, for the reason
 * `src/lib/study/purity.test.ts` needed the same helper: several files here
 * name `fetch`, `Date.now()` and `@tiptap` in prose explaining why they do not
 * use them, and a guard that reads its own documentation as a violation is a
 * guard nobody can write comments around.
 */

const DIR = 'src/lib/drafting'

/**
 * Every source file in the directory, on disk.
 *
 * The per-file rules below run over THIS, not over the ledger — which is a
 * deliberate departure from `src/lib/srs/purity.test.ts` and
 * `src/lib/study/purity.test.ts`, and the reason is worth stating. Those two
 * loop over a hand-written list, so a file added and not listed is a file no
 * rule applies to until somebody notices. Reading the directory means a new
 * file is guarded from the moment it lands.
 *
 * The hand-written list is kept below as a separate assertion, so "a new file
 * was added deliberately" is still checked — it just is not what decides
 * whether the file is guarded.
 */
const ON_DISK = readdirSync(join(import.meta.dirname))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()

/**
 * The ledger: files somebody has looked at and vouched for.
 *
 * Session 30 is building the import/export layer in this directory in the same
 * working tree, so this list moves under both of us. It is a separate
 * assertion from the rules above precisely so that a file of theirs landing
 * mid-session cannot leave a module unguarded — only this one test goes red,
 * and its message says what to do about it.
 */
const FILES = [
  'checklist.ts',
  'docLang.ts',
  'docx.ts',
  'engine.ts',
  'format.ts',
  'lint.ts',
  'migrate.ts',
  'model.ts',
  'numbering.ts',
  'personal.ts',
  'profile.ts',
  'renderDoc.ts',
  'skeleton.ts',
  'types.ts',
  'versions.ts',

  /*
    Session 30's files (docx/pdf import, docx and print export), built in this
    same working tree. Listed here at that session's own request, and synced at
    commit time — the per-file rules above run over the DIRECTORY, so a file of
    theirs landing between our commits is guarded from the moment it exists and
    only this ledger goes red.
  */
  'extract.ts',
  'html.ts',
  'importDocx.ts',
  'importPdf.ts',
  'letterhead.ts',
  'paste.ts',
  'print.ts',
  'zip.ts',

  /*
    Session 31's files (instruction builders, intake analysis, the modify
    proposal, the correspondence register), built in this same working tree and
    read before being listed — which is what an entry here means.

    `register.ts` is the one worth a second look, because it is the first file
    in this directory that imports zod and holds a stored row's schema. It is
    still pure by every rule below: the schema parses, `normaliseDates` reads a
    date through `format.ts`, and every clock is an argument (`today`, `at`), so
    "this follow-up is overdue" is a test that fails rather than one that passes
    until tomorrow.
  */
  'instructions.ts',
  'intake.ts',
  'proposal.ts',
  'register.ts',
] as const

/**
 * A file's code, with comments and string literals blanked.
 *
 * String literals go too, not only comments: `lint.ts` carries the words
 * `new Date` inside a message and `personal.ts` names `@tiptap` in one. What is
 * being asserted is what the module DOES, and a literal is data.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
}

const sourceOf = (name: string): string => code(readFromRoot(`${DIR}/${name}`))

describe('the ledger', () => {
  it('names every source file in the directory', () => {
    // If this is the only failure, a file was added and not vouched for: read
    // it, satisfy yourself it is pure, and add its name to `FILES`. Every rule
    // below already applied to it before you got here.
    expect(ON_DISK).toEqual([...FILES].sort())
  })
})

describe.each(ON_DISK)('%s', (name) => {
  const source = sourceOf(name)

  it('imports no editor', () => {
    // The body is JSON. Nothing that reads it may pull the editor in behind it.
    expect(source).not.toMatch(/from\s+['"]@tiptap\//)
    expect(source).not.toMatch(/from\s+['"]prosemirror-/)
  })

  it('imports no React and defines no component', () => {
    expect(source).not.toMatch(/from\s+['"]react['"]/)
    expect(source).not.toMatch(/from\s+['"]react-dom/)
    expect(source).not.toMatch(/\buse[A-Z]\w*\s*\(/)
  })

  it('opens no database', () => {
    // `import type` is excluded deliberately: a type is erased at compile time
    // and reaches no database. `analytics.ts` in the study layer needed the
    // same exclusion, with the reason written at the exclusion.
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+['"]@\/db['"]/m)
    expect(source).not.toMatch(/from\s+['"]dexie/)
  })

  it('reaches no network', () => {
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
  })

  it('carries no clock', () => {
    // Every timestamp in this layer is an argument — `now` on `LintInput`, `at`
    // on `newDoc`, `modified` on a zip entry. That is what makes "the date is
    // in the future" a test that fails rather than one that passes until
    // January, and what makes a rebuild byte-identical.
    expect(source).not.toMatch(/Date\.now\s*\(/)
    expect(source).not.toMatch(/new\s+Date\s*\(\s*\)/)
  })

  it('sorts by code unit, never by ICU collation', () => {
    expect(source).not.toMatch(/\.localeCompare\s*\(/)
  })
})

describe('the model version has one home', () => {
  it('is DECLARED in model.ts and nowhere else', () => {
    // Declared, not merely mentioned: `migrate.ts` imports the constant and
    // stamps it on the document it produces, which is exactly the use it
    // exists for. What must not happen is a second file writing the NUMBER —
    // a second copy is a second answer to "what version is this document",
    // and `readDoc`'s `too-new` refusal rests on there being one.
    const declaring = FILES.filter((name) => /export const DOC_MODEL_VERSION/.test(sourceOf(name)))
    expect(declaring).toEqual(['model.ts'])

    // And nobody hard-codes the literal in its place.
    for (const name of FILES) {
      if (name === 'model.ts') continue
      expect(sourceOf(name), name).not.toMatch(/docModelVersion:\s*\d/)
    }
  })
})
