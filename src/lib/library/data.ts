import { buildCorpus, type CorpusJson, type CorpusWork } from './corpus'
import type { LibraryCorpus } from './types'

import {
  libraryAidsSchema,
  libraryDefinitionsSchema,
  libraryIndexSchema,
  libraryQuickRefSchema,
  libraryWorkSchema,
  type LibraryAids,
  type LibraryDefinitions,
  type LibraryIndex,
  type LibraryQuickRef,
  type LibraryWork,
} from '@/schemas/library'

/**
 * Loading `data/library` and the corpora it points at.
 *
 * Same arrangement as the law, pay, drafting, glossary and rules datasets
 * (ADR-013): a `?raw` dynamic import, never a `fetch` of `/data/*.json`. That
 * is what keeps `src/ai/providers/wire.ts` the only module in the app allowed
 * to call `fetch`, and what makes the Library work offline on a device that has
 * never opened `/library` online — the service worker precaches the chunks
 * through the ordinary JavaScript glob, so a work read on a train was cached
 * when the app installed rather than when the reader first opened it.
 *
 * THE CORPUS SPECIFIERS ARE THE SAME STRINGS the Law Converter and the Rules
 * Trainer already use, deliberately. Rollup gives one chunk per resolved
 * specifier, so a reader who has opened `/law` and then opens the BNS here
 * downloads nothing new, and a reader who does the reverse gets `/law` for
 * free. Writing them out one per file rather than building them from a template
 * is what makes that possible at all — a bundler can only chunk a specifier it
 * can see (`src/modules/drafting/data.ts` records the same rule).
 *
 * The three loaders are separate because they answer different questions:
 * the INDEX draws the shelf (15 cards, ~11 KB), a WORK draws one table of
 * contents (8–220 KB and no statutory text), and only the READER pays for the
 * corpus itself.
 */

const parse = <T>(raw: string): T => JSON.parse(raw) as T

const WORK_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  bns: () => import('../../../data/library/works/bns.json?raw'),
  bnss: () => import('../../../data/library/works/bnss.json?raw'),
  bsa: () => import('../../../data/library/works/bsa.json?raw'),
  'ccs-cca': () => import('../../../data/library/works/ccs-cca.json?raw'),
  'ccs-conduct': () => import('../../../data/library/works/ccs-conduct.json?raw'),
  'ccs-leave': () => import('../../../data/library/works/ccs-leave.json?raw'),
  'ccs-pension': () => import('../../../data/library/works/ccs-pension.json?raw'),
  csmop: () => import('../../../data/library/works/csmop.json?raw'),
  'fr-sr': () => import('../../../data/library/works/fr-sr.json?raw'),
  gfr: () => import('../../../data/library/works/gfr.json?raw'),
  'ol-act': () => import('../../../data/library/works/ol-act.json?raw'),
  'ol-rules': () => import('../../../data/library/works/ol-rules.json?raw'),
  osa: () => import('../../../data/library/works/osa.json?raw'),
  posh: () => import('../../../data/library/works/posh.json?raw'),
  rti: () => import('../../../data/library/works/rti.json?raw'),
}

/** Keyed by `corpus.file`, so a work's own pointer is what selects the loader. */
const CORPUS_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  'law/bns.json': () => import('../../../data/law/bns.json?raw'),
  'law/bnss.json': () => import('../../../data/law/bnss.json?raw'),
  'law/bsa.json': () => import('../../../data/law/bsa.json?raw'),
  'rules/text/ccs-cca.json': () => import('../../../data/rules/text/ccs-cca.json?raw'),
  'rules/text/ccs-conduct.json': () => import('../../../data/rules/text/ccs-conduct.json?raw'),
  'rules/text/ccs-leave.json': () => import('../../../data/rules/text/ccs-leave.json?raw'),
  'rules/text/ccs-pension.json': () => import('../../../data/rules/text/ccs-pension.json?raw'),
  'rules/text/csmop.json': () => import('../../../data/rules/text/csmop.json?raw'),
  'rules/text/fr-sr.json': () => import('../../../data/rules/text/fr-sr.json?raw'),
  'rules/text/gfr.json': () => import('../../../data/rules/text/gfr.json?raw'),
  'rules/text/ol-act.json': () => import('../../../data/rules/text/ol-act.json?raw'),
  'rules/text/ol-rules.json': () => import('../../../data/rules/text/ol-rules.json?raw'),
  'rules/text/osa.json': () => import('../../../data/rules/text/osa.json?raw'),
  'rules/text/posh.json': () => import('../../../data/rules/text/posh.json?raw'),
  'rules/text/rti.json': () => import('../../../data/rules/text/rti.json?raw'),
}

/**
 * The two EXTRACT datasets, each behind its own control on the work page.
 *
 * Written out one per file for the reason the two maps above are: a bundler can
 * only chunk a specifier it can see. They are separate maps rather than one
 * because they are fetched at different moments — definitions when the reader
 * turns defined terms on in the reader, quick-reference when they open that tab
 * on the work page — and a combined loader would charge for both.
 */
const DEFINITION_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  bns: () => import('../../../data/library/definitions/bns.json?raw'),
  bnss: () => import('../../../data/library/definitions/bnss.json?raw'),
  bsa: () => import('../../../data/library/definitions/bsa.json?raw'),
  'ccs-cca': () => import('../../../data/library/definitions/ccs-cca.json?raw'),
  'ccs-conduct': () => import('../../../data/library/definitions/ccs-conduct.json?raw'),
  'ccs-leave': () => import('../../../data/library/definitions/ccs-leave.json?raw'),
  'ccs-pension': () => import('../../../data/library/definitions/ccs-pension.json?raw'),
  csmop: () => import('../../../data/library/definitions/csmop.json?raw'),
  'fr-sr': () => import('../../../data/library/definitions/fr-sr.json?raw'),
  gfr: () => import('../../../data/library/definitions/gfr.json?raw'),
  'ol-act': () => import('../../../data/library/definitions/ol-act.json?raw'),
  'ol-rules': () => import('../../../data/library/definitions/ol-rules.json?raw'),
  osa: () => import('../../../data/library/definitions/osa.json?raw'),
  posh: () => import('../../../data/library/definitions/posh.json?raw'),
  rti: () => import('../../../data/library/definitions/rti.json?raw'),
}

const QUICKREF_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  bns: () => import('../../../data/library/quickref/bns.json?raw'),
  bnss: () => import('../../../data/library/quickref/bnss.json?raw'),
  bsa: () => import('../../../data/library/quickref/bsa.json?raw'),
  'ccs-cca': () => import('../../../data/library/quickref/ccs-cca.json?raw'),
  'ccs-conduct': () => import('../../../data/library/quickref/ccs-conduct.json?raw'),
  'ccs-leave': () => import('../../../data/library/quickref/ccs-leave.json?raw'),
  'ccs-pension': () => import('../../../data/library/quickref/ccs-pension.json?raw'),
  csmop: () => import('../../../data/library/quickref/csmop.json?raw'),
  'fr-sr': () => import('../../../data/library/quickref/fr-sr.json?raw'),
  gfr: () => import('../../../data/library/quickref/gfr.json?raw'),
  'ol-act': () => import('../../../data/library/quickref/ol-act.json?raw'),
  'ol-rules': () => import('../../../data/library/quickref/ol-rules.json?raw'),
  osa: () => import('../../../data/library/quickref/osa.json?raw'),
  posh: () => import('../../../data/library/quickref/posh.json?raw'),
  rti: () => import('../../../data/library/quickref/rti.json?raw'),
}

/** Every work id the Library can open. */
export const WORK_IDS: readonly string[] = Object.keys(WORK_LOADERS)

/**
 * `Object.hasOwn`, never `in`, and never a bare bracket lookup.
 *
 * A work id comes out of `useParams`, which is to say out of the address bar,
 * and both maps above are object literals — so `'constructor' in WORK_LOADERS`
 * is TRUE and `WORK_LOADERS['toString']` is a real function. The committed
 * version of `isWorkId` said yes to five strings that name nothing in this
 * catalogue, and `loadWork` then called `Object.prototype.toString` as though
 * it were a dynamic import and failed inside a `JSON.parse` with a message
 * naming neither the work nor the problem.
 *
 * Nothing here was exploitable — there is no secret to reach and no network to
 * reach it over. It was wrong in the ordinary way: a guard saying yes to what
 * it was written to say no to, and an error that pointed at the wrong file.
 */
const loaderFor = (
  loaders: Record<string, () => Promise<{ default: string }>>,
  key: string,
): (() => Promise<{ default: string }>) | null =>
  Object.hasOwn(loaders, key) ? (loaders[key] ?? null) : null

export const isWorkId = (value: unknown): value is string =>
  typeof value === 'string' && Object.hasOwn(WORK_LOADERS, value)

const cache = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = load().catch((error: unknown) => {
    // A failed load is never cached: an offline first visit must be able to
    // succeed on the next attempt rather than being stuck for the tab's life.
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

export function loadLibraryIndex(): Promise<LibraryIndex> {
  return once('index', async () => {
    const module = await import('../../../data/library/index.json?raw')
    // Parsed through the schema rather than cast. This dataset is 16 files
    // written by a script that runs by hand, and a work whose `corpus.file`
    // points nowhere would otherwise surface as a blank reader page rather
    // than as an error naming the work.
    return libraryIndexSchema.parse(parse<unknown>(module.default))
  })
}

export function loadWork(workId: string): Promise<LibraryWork> {
  const loader = loaderFor(WORK_LOADERS, workId)
  if (!loader) return Promise.reject(new Error(`unknown library work: ${workId}`))
  return once(`work:${workId}`, async () => libraryWorkSchema.parse(parse<unknown>((await loader()).default)))
}

/**
 * One work's units, assembled from the corpus it points at.
 *
 * Not validated through a zod schema: `data/rules/text/*.json` and
 * `data/law/*.json` each already have one (`src/modules/trainer/schema.ts` and
 * `src/modules/law/schema.ts`), both are exercised by their own dataset tests
 * against the committed bytes, and parsing 1.9 MB of statute a second time to
 * re-establish what those suites already assert would cost every reader of a
 * Sanhita a visible pause. What this file DOES check is the pointer — an
 * unknown `corpus.file` rejects by name.
 */
export function loadCorpus(work: CorpusWork): Promise<LibraryCorpus> {
  const loader = loaderFor(CORPUS_LOADERS, work.corpus.file)
  if (!loader) return Promise.reject(new Error(`unknown corpus pointer: ${work.corpus.file}`))
  return once(`corpus:${work.corpus.file}:${work.id}`, async () =>
    buildCorpus(work, parse<CorpusJson>((await loader()).default)),
  )
}

/** Test seam. Production never needs to drop what it has parsed. */
export function resetLibraryCache(): void {
  cache.clear()
}

/**
 * One work's defined terms, and one work's quick-reference rows.
 *
 * Both resolve to an EMPTY dataset for a work id with no file rather than
 * rejecting: a personal work has neither, and the surfaces that use these run
 * their own extraction over it instead (`src/lib/library/personal.ts`). A
 * rejection would make every one of those surfaces handle an error for a case
 * that is not an error.
 */
export function loadDefinitions(workId: string): Promise<LibraryDefinitions> {
  const loader = DEFINITION_LOADERS[workId]
  if (!loader) return Promise.resolve(emptyDefinitions(workId))
  return once(`definitions:${workId}`, async () =>
    libraryDefinitionsSchema.parse(parse<unknown>((await loader()).default)),
  )
}

export function loadQuickRef(workId: string): Promise<LibraryQuickRef> {
  const loader = QUICKREF_LOADERS[workId]
  if (!loader) return Promise.resolve(emptyQuickRef(workId))
  return once(`quickref:${workId}`, async () =>
    libraryQuickRefSchema.parse(parse<unknown>((await loader()).default)),
  )
}

/**
 * An empty dataset cites nothing, and says so with an empty string rather than
 * a placeholder domain.
 *
 * The first version used `https://example.invalid` to satisfy the source type,
 * and `tests/no-external-urls.test.ts` refused it — correctly. A URL that
 * exists only to satisfy a type is still a URL in the shipped bundle, and the
 * allowlist that would have let it through is meant for citations somebody
 * reviewed. The only consumer of this is a personal work, whose source is the
 * reader themselves and which renders no source chip at all.
 */
const NO_SOURCE = { name: '', url: '' }

const emptyDefinitions = (workId: string): LibraryDefinitions => ({
  version: '1.0.0',
  generatedAt: '1970-01-01',
  workId,
  unitId: null,
  unitNumber: null,
  source: NO_SOURCE,
  terms: [],
})

const emptyQuickRef = (workId: string): LibraryQuickRef => ({
  version: '1.0.0',
  generatedAt: '1970-01-01',
  workId,
  source: NO_SOURCE,
  counts: { time: 0, money: 0, authority: 0 },
  rows: [],
})

/**
 * `data/library/aids/<work>.json` — the precomputed study aids.
 *
 * Seven of the fifteen works have one; the other eight have none, and that is
 * a fact about how far the authoring has got rather than about the schema.
 * Like the two extract maps above, an absent file resolves to an EMPTY dataset
 * rather than rejecting: the rail renders nothing for a work with no aids, and
 * every caller would otherwise have to handle an error for a case that is not
 * one. The specifiers are written out for the reason the maps above are — a
 * bundler can only chunk a specifier it can see.
 */
const AID_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  'ccs-cca': () => import('../../../data/library/aids/ccs-cca.json?raw'),
  'ccs-conduct': () => import('../../../data/library/aids/ccs-conduct.json?raw'),
  'ccs-leave': () => import('../../../data/library/aids/ccs-leave.json?raw'),
  csmop: () => import('../../../data/library/aids/csmop.json?raw'),
  osa: () => import('../../../data/library/aids/osa.json?raw'),
  posh: () => import('../../../data/library/aids/posh.json?raw'),
  rti: () => import('../../../data/library/aids/rti.json?raw'),
}

/** Every work id that ships a study-aid file. Ordered, for the tests. */
export const AID_WORK_IDS: readonly string[] = Object.keys(AID_LOADERS)

export function loadStudyAids(workId: string): Promise<LibraryAids> {
  const loader = loaderFor(AID_LOADERS, workId)
  if (!loader) return Promise.resolve(emptyAids(workId))
  return once(`aids:${workId}`, async () => libraryAidsSchema.parse(parse<unknown>((await loader()).default)))
}

const emptyAids = (workId: string): LibraryAids => ({
  version: '1.0.0',
  generatedAt: '1970-01-01',
  workId,
  unitLabel: { en: 'Unit', hi: 'इकाई' },
  disclaimer: { en: '', hi: '' },
  source: NO_SOURCE,
  aids: [],
})
