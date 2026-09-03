import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useWork } from './useLibrary'

import type { Language } from '@/i18n'

import {
  db,
  type LibraryBookmarkRow,
  type LibraryHighlightRow,
  type LibraryNoteRow,
  type LibraryPersonalWorkRow,
  type LibraryProgressRow,
} from '@/db'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import {
  anchorText,
  buildPersonalCorpus,
  extractQuickRef,
  fromDataset,
  fromPersonal,
  isDefinitionsUnit,
  isPersonalWorkId,
  listPersonalWorks,
  loadDefinitions,
  loadQuickRef,
  loadCorpus,
  loadWork,
  parseDefinitions,
  resolveHighlights,
  type LibraryCorpus,
  type ReaderWork,
} from '@/lib/library'
import type { DefinedTermRecord, LibraryQuickRef } from '@/schemas/library'

/**
 * Everything the annotation layer reads, and the one place a work stops being
 * either "a dataset" or "the reader's own" and becomes just a work.
 *
 * Two rules run through all of it:
 *
 * 1. **`useLiveQuery` over a store function, never a load-once effect.** Dexie's
 *    live query tracks every table the querier reads, so highlighting a phrase
 *    updates the reader, My Study and the work page's counts without a manual
 *    refetch anywhere — the same arrangement the Rules Trainer settled on
 *    (ADR-027).
 * 2. **A personal work is computed, a dataset work is fetched.** The definitions
 *    and quick-reference datasets exist only for the fifteen bundled works;
 *    for a document the reader added, the SAME parsers run in the browser over
 *    its text. That is why `scripts/library-extracts.mjs` generates the
 *    committed files by running these very modules — one grammar, two moments.
 */

// -------------------------------------------------------------- the work

export interface ReaderWorkState {
  status: 'loading' | 'ready' | 'error' | 'missing'
  work: ReaderWork | null
  retry: () => void
}

/**
 * A work, from whichever of the two places it lives.
 *
 * `missing` is its own answer, distinct from `error`: a personal work the
 * reader deleted, or a link somebody shared from a device that had one, is not
 * a failed load and must not offer a Retry button that can never succeed.
 */
export function useReaderWork(workId: string | undefined): ReaderWorkState {
  const personal = isPersonalWorkId(workId ?? '')
  const dataset = useWork(personal ? undefined : workId)
  /**
   * `null` for "no such document", `undefined` for "still asking".
   *
   * `useLiveQuery` reports its own pending state as `undefined`, and
   * `Table.get` reports a missing row the same way — so the obvious version
   * cannot tell them apart and treats the first render of a work that DOES
   * exist as one that does not. It navigated away from a document the reader
   * had just saved, every time. Only the browser run found it, because nothing
   * in jsdom opened a personal work by its route. Mapping "not found" to `null`
   * inside the querier is what separates the two.
   */
  const row = useLiveQuery(
    (): Promise<LibraryPersonalWorkRow | null> =>
      personal && workId
        ? db.libraryPersonalWorks.get(workId).then((found) => found ?? null)
        : Promise.resolve(null),
    [personal, workId],
    undefined,
  )

  const work = useMemo(() => {
    if (personal) return row ? fromPersonal(row) : null
    return dataset.data ? fromDataset(dataset.data) : null
  }, [personal, row, dataset.data])

  if (personal) {
    const status = row === undefined ? 'loading' : row === null ? 'missing' : 'ready'
    return { status, work, retry: () => undefined }
  }
  return { status: dataset.status, work, retry: dataset.retry }
}

/** The units of a work, from the pointed-at corpus or from the stored document. */
export function useReaderCorpus(
  work: ReaderWork | null,
  enabled = true,
): AsyncState<LibraryCorpus> & { retry: () => void } {
  // The same `null` vs `undefined` split as `useReaderWork` above, and for the
  // same reason: `ready` below must not fire before the row has arrived.
  const row = useLiveQuery(
    (): Promise<LibraryPersonalWorkRow | null> =>
      work && work.origin === 'personal'
        ? db.libraryPersonalWorks.get(work.id).then((found) => found ?? null)
        : Promise.resolve(null),
    [work?.id, work?.origin],
    undefined,
  )

  const load = useCallback(() => {
    if (!work) return Promise.reject(new Error('no work'))
    if (work.origin === 'personal') {
      return row ? Promise.resolve(buildPersonalCorpus(row)) : Promise.reject(new Error('no document'))
    }
    // `ReaderWork` is a widened `LibraryWork`; `loadCorpus` reads only `corpus`
    // and `readingOrder`, both of which are present and identical on it.
    return loadCorpus(work)
  }, [work, row])

  const ready = Boolean(work) && enabled && (work?.origin !== 'personal' || row !== undefined)
  return useAsync(load, `library-corpus:${work?.id ?? ''}:${row?.updatedAt ?? ''}`, ready)
}

// ------------------------------------------------------ defined terms

export interface DefinedTerms {
  terms: DefinedTermRecord[]
  /** The unit that IS the definitions clause, for the popover's "read it" link. */
  unitId: string | null
  /** True when the terms were read in the browser rather than shipped. */
  extractedHere: boolean
}

const NO_TERMS: DefinedTerms = { terms: [], unitId: null, extractedHere: false }

/**
 * Read a personal document's own definitions clause, here in the browser.
 *
 * A module-level function rather than a closure inside the memo: the React
 * Compiler cannot preserve a `useMemo` whose body branches and loops like this,
 * and `react-hooks/preserve-manual-memoization` is right to refuse it —
 * "memoized in source but not in the output" is a claim about performance that
 * silently is not true.
 */
function extractTerms(corpus: LibraryCorpus): DefinedTerms {
  for (const id of corpus.order) {
    const unit = corpus.units.get(id)
    if (!unit) continue
    const text = [...unit.body.en, ...unit.body.hi].join(' ')
    if (!isDefinitionsUnit(unit.heading.en || unit.heading.hi, text)) continue
    const terms = parseDefinitions(text)
    if (terms.length > 0) return { terms, unitId: unit.id, extractedHere: true }
  }
  return NO_TERMS
}

/** The same, for the quick-reference tables. */
function extractRows(corpus: LibraryCorpus): LibraryQuickRef['rows'] {
  const rows: LibraryQuickRef['rows'] = []
  for (const id of corpus.order) {
    const unit = corpus.units.get(id)
    if (!unit) continue
    for (const row of extractQuickRef([...unit.body.en, ...unit.body.hi].join(' '))) {
      rows.push({ unitId: unit.id, unitNumber: unit.number, ...row })
    }
  }
  return rows
}

/**
 * A work's defined terms.
 *
 * Fetched for a bundled work (`data/library/definitions/<id>.json`, generated
 * by running this same parser at build time) and computed here for a personal
 * one. `extractedHere` is what the popover uses to say "read from your own
 * document" rather than presenting it as something this app checked.
 */
export function useDefinedTerms(
  work: ReaderWork | null,
  corpus: LibraryCorpus | null,
  enabled: boolean,
): DefinedTerms {
  const personal = work?.origin === 'personal'
  const load = useCallback(
    () => (work && !personal ? loadDefinitions(work.id) : Promise.resolve(null)),
    [work, personal],
  )
  const fetched = useAsync(
    load,
    `library-definitions:${work?.id ?? ''}`,
    Boolean(work) && !personal && enabled,
  )

  const shipped = fetched.data
  return useMemo(() => {
    if (!enabled || !work) return NO_TERMS
    if (!personal) {
      return shipped ? { terms: shipped.terms, unitId: shipped.unitId, extractedHere: false } : NO_TERMS
    }
    return corpus ? extractTerms(corpus) : NO_TERMS
  }, [enabled, work, personal, corpus, shipped])
}

// -------------------------------------------------------- quick reference

const NO_QUICKREF: LibraryQuickRef = {
  version: '1.0.0',
  generatedAt: '1970-01-01',
  workId: '',
  source: { name: '', url: '' },
  counts: { time: 0, money: 0, authority: 0 },
  rows: [],
}

/** A work's time limits, monetary figures and named authorities. */
export function useQuickRef(work: ReaderWork | null, corpus: LibraryCorpus | null, enabled: boolean) {
  const personal = work?.origin === 'personal'
  const load = useCallback(
    () => (work && !personal ? loadQuickRef(work.id) : Promise.resolve(null)),
    [work, personal],
  )
  const fetched = useAsync(load, `library-quickref:${work?.id ?? ''}`, Boolean(work) && !personal && enabled)

  const shipped = fetched.data
  const loading = fetched.status === 'loading'
  return useMemo(() => {
    if (!enabled || !work) return { data: NO_QUICKREF, extractedHere: false, loading: false }
    if (!personal) return { data: shipped ?? NO_QUICKREF, extractedHere: false, loading }
    if (!corpus) return { data: NO_QUICKREF, extractedHere: true, loading: true }

    const rows = extractRows(corpus)
    return {
      data: {
        ...NO_QUICKREF,
        workId: work.id,
        counts: {
          time: rows.filter((row) => row.kind === 'time').length,
          money: rows.filter((row) => row.kind === 'money').length,
          authority: rows.filter((row) => row.kind === 'authority').length,
        },
        rows,
      },
      extractedHere: true,
      loading: false,
    }
  }, [enabled, work, personal, corpus, shipped, loading])
}

// ------------------------------------------------------------ annotations

export function useHighlights(workId: string | undefined, unitId: string | undefined) {
  return useLiveQuery(
    (): Promise<LibraryHighlightRow[]> =>
      workId && unitId
        ? db.libraryHighlights.where('[workId+unitId]').equals([workId, unitId]).toArray()
        : Promise.resolve([]),
    [workId, unitId],
    undefined,
  )
}

export function useNotes(workId: string | undefined, unitId: string | undefined) {
  return useLiveQuery(
    (): Promise<LibraryNoteRow[]> =>
      workId && unitId
        ? db.libraryNotes.where('[workId+unitId]').equals([workId, unitId]).toArray()
        : Promise.resolve([]),
    [workId, unitId],
    undefined,
  )
}

/**
 * Everything the reader has written, across every work — My Study's whole feed.
 *
 * One live query over three tables rather than three, so the page cannot paint
 * a state where the highlights have arrived and the notes have not.
 */
export function useStudyRows(): StudyRows | undefined {
  return useLiveQuery(
    async (): Promise<StudyRows> => {
      const [highlights, notes, bookmarks] = await Promise.all([
        db.libraryHighlights.orderBy('createdAt').reverse().toArray(),
        db.libraryNotes.orderBy('updatedAt').reverse().toArray(),
        db.libraryBookmarks.orderBy('createdAt').reverse().toArray(),
      ])
      return { highlights, notes, bookmarks }
    },
    [],
    undefined,
  )
}

export interface StudyRows {
  highlights: LibraryHighlightRow[]
  notes: LibraryNoteRow[]
  bookmarks: LibraryBookmarkRow[]
}

export interface StudyContext {
  /** Highlights that neither their offsets nor their quote can locate. */
  lost: ReadonlySet<string>
  /** `"<workId>:<unitId>"` → how that unit cites itself, and its printed number. */
  units: ReadonlyMap<string, { citation: string; number: string }>
  /** False until the corpora have been read. "Not yet" and "none" are different answers. */
  checked: boolean
}

/** Settled, with nothing in it — what an unannotated reader gets. */
const NOTHING_TO_CHECK: StudyContext = { lost: new Set<string>(), units: new Map(), checked: true }

/**
 * NOT settled. The distinction is the whole point of `checked`, and conflating
 * the two was a real defect: the initial state claimed to be checked, so My
 * Study rendered "0 need attention" before a single corpus had been opened and
 * the hook's own test passed against a hook that did nothing at all.
 */
const NOT_YET: StudyContext = { lost: new Set<string>(), units: new Map(), checked: false }

/**
 * The two things My Study cannot answer from its own rows.
 *
 * 1. **Which highlights are lost.** The brief is explicit: a highlight that can
 *    be found by neither its offsets nor its quote is listed under "needs
 *    attention" and never dropped. That needs the text as it is now.
 * 2. **How each annotated unit cites itself.** The export leaves this app, and
 *    "ccs-conduct-3" is an internal id, not a citation an officer could use a
 *    month later. `unit.citation` is the real one.
 *
 * Both need the corpus, which My Study otherwise deliberately does not load —
 * so this loads the corpora of the works the reader has ACTUALLY annotated, in
 * one pass, and answers both. That is one or two books for almost everybody,
 * every one already precached, and bounded by what they marked rather than by
 * the size of the shelf.
 *
 * A work that will not load is skipped rather than reported: the annotations in
 * it are fine and the corpus is what failed.
 */
export function useStudyContext(rows: StudyRows | undefined, language: Language): StudyContext {
  const [state, setState] = useState<StudyContext>(NOT_YET)

  const highlights = rows?.highlights
  const notes = rows?.notes
  const bookmarks = rows?.bookmarks

  /**
   * The effect is keyed on a SIGNATURE of the rows, not on their identity.
   *
   * `useLiveQuery` returns stable arrays between writes, so identity would
   * usually do — but a caller that builds `{ highlights, notes: [], bookmarks: [] }`
   * inline gets three new arrays on every render, and each one cancels the
   * in-flight pass before it can finish. That is not a hypothetical: this
   * hook's own test does exactly that, and it is a reasonable thing for a
   * caller to do.
   *
   * The rows themselves are read through a ref updated in an effect declared
   * ABOVE the one that uses it, so it is written before it is read on the same
   * commit and never during render. Safe here in a way the reader's key handler
   * was not (see `../url.ts#unitIdFromPath`): nothing about this depends on
   * landing before a paint.
   */
  const signature = useMemo(
    () =>
      [
        (highlights ?? []).map((row) => `${row.id}:${row.quote}:${row.lang}`).join('|'),
        (notes ?? []).map((row) => `${row.id}:${row.workId}:${row.unitId}`).join('|'),
        (bookmarks ?? []).map((row) => row.id).join('|'),
      ].join('#'),
    [highlights, notes, bookmarks],
  )

  const rowsRef = useRef<StudyRows | undefined>(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  /**
   * Keyed on the ROWS, not on a derived work list.
   *
   * These come from `useLiveQuery`, which returns new arrays only when the
   * query actually re-runs — that is, when something is written. So this
   * re-checks exactly when the annotations change and not on every render.
   *
   * The first version cached a `workId` set and read the rows through a ref
   * assigned during render, which `react-hooks/refs` refuses — and rightly:
   * adding a highlight to a work already in the set would not have re-checked.
   */
  useEffect(() => {
    let cancelled = false
    const current = rowsRef.current
    const all = [...(current?.highlights ?? []), ...(current?.notes ?? []), ...(current?.bookmarks ?? [])]
    // Nothing to check is answered at READ time below, not by setting state
    // here: `react-hooks/set-state-in-effect` refuses a synchronous setState in
    // an effect, and it is right — this is a fact about the arguments. Same
    // shape `ReviewPage`'s `wrongAnswer` uses: derive, do not resynchronise.
    if (all.length === 0) return

    const check = async () => {
      const lost = new Set<string>()
      const units = new Map<string, { citation: string; number: string }>()

      for (const workId of new Set(all.map((row) => row.workId))) {
        try {
          const corpus = isPersonalWorkId(workId)
            ? await db.libraryPersonalWorks.get(workId).then((row) => (row ? buildPersonalCorpus(row) : null))
            : await loadWork(workId).then(loadCorpus)
          if (!corpus) continue

          for (const row of all.filter((entry) => entry.workId === workId)) {
            const unit = corpus.units.get(row.unitId)
            if (!unit) {
              // A unit the work no longer has is as lost as a quote that moved.
              if ('quote' in row) lost.add(row.id)
              continue
            }
            units.set(`${workId}:${row.unitId}`, {
              citation: unit.citation[language],
              number: unit.number,
            })
            if (!('quote' in row)) continue

            const text = anchorText(unit.body[row.lang])
            const [resolved] = resolveHighlights([row], text, row.lang)
            if (resolved?.resolution.status === 'lost') lost.add(row.id)
          }
        } catch {
          // The corpus failed, not the annotations. Say nothing about them.
        }
      }
      if (!cancelled) setState({ lost, units, checked: true })
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [signature, language])

  const empty = (highlights?.length ?? 0) + (notes?.length ?? 0) + (bookmarks?.length ?? 0) === 0
  return empty ? NOTHING_TO_CHECK : state
}

export function usePersonalWorks() {
  return useLiveQuery(() => listPersonalWorks(), [], undefined)
}

/** The bookmark row for one unit, so the reader can show and edit its label. */
export function useBookmark(workId: string | undefined, unitId: string | undefined) {
  return useLiveQuery(
    (): Promise<LibraryBookmarkRow | undefined> =>
      workId && unitId ? db.libraryBookmarks.get(`${workId}:${unitId}`) : Promise.resolve(undefined),
    [workId, unitId],
    undefined,
  )
}

/** The progress row for one unit — the read tick and the remembered scroll. */
export function useUnitProgress(workId: string | undefined, unitId: string | undefined) {
  return useLiveQuery(
    (): Promise<LibraryProgressRow | undefined> =>
      workId && unitId ? db.libraryProgress.get(`${workId}:${unitId}`) : Promise.resolve(undefined),
    [workId, unitId],
    undefined,
  )
}
