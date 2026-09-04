import { toUnitHref, toWorkHref } from './url'

import type { Language } from '@/i18n'
import { unitLabel, type LibraryCorpus } from '@/lib/library'
import type { RetrievalDoc } from '@/lib/retrieval'
import type { GlossaryTerm } from '@/modules/utils/glossary/schema'
import type { DefinedTermRecord, LibraryWork, StudyAid } from '@/schemas/library'

/**
 * Turning the datasets this app already ships into `RetrievalDoc`s.
 *
 * `src/lib/retrieval.ts` is pure and takes its documents as an argument; this
 * is the file that builds them, and it lives in the module because it names
 * routes (`toUnitHref`) and module types. Nothing here loads a dataset either —
 * the caller hands in a corpus it has already loaded.
 *
 * THE CITATION IS NEVER COMPOSED HERE. Every unit already carries one, written
 * by `src/lib/library/corpus.ts` from the work's own `unitLabel` and title —
 * including the FR/SR case where the number carries its own unit word and must
 * not be given a second one (ADR-023). A second composer would eventually
 * disagree with the first.
 */

const line = (parts: readonly string[]): string => parts.filter(Boolean).join(' — ')

/** Every unit of one work, as retrievable documents in one language. */
export function docsFromCorpus(
  corpus: LibraryCorpus,
  language: Language,
  kind: 'rule' | 'section',
  sourceUrl: string | null,
): RetrievalDoc[] {
  const docs: RetrievalDoc[] = []
  for (const unitId of corpus.order) {
    const unit = corpus.units.get(unitId)
    if (!unit) continue
    const shown = unitLabel(unit.heading, unit.excerpt, language)
    // Both languages are indexed, always — the rule
    // `src/lib/library/search.ts` states and the reason it gives: fifteen of
    // fifteen works carry English text and no Hindi text, while every heading
    // has authored Hindi, so indexing one language would make one of the two
    // obvious searches silently find nothing.
    //
    // The BODY carries both directly. The other language's heading and citation
    // go into `alsoSearch`, which is indexed and never rendered — putting them
    // in `text` would print a Hindi citation inside an English snippet.
    const body = [...unit.body.en, ...unit.body.hi].filter(Boolean).join(' ')
    const other: Language = language === 'en' ? 'hi' : 'en'
    docs.push({
      id: `${kind}:${corpus.workId}:${unitId}`,
      kind,
      citation: unit.citation[language] || unit.citation.en,
      heading: shown.text,
      text: body,
      href: toUnitHref(corpus.workId, unitId),
      sourceUrl,
      personal: false,
      number: unit.number,
      workId: corpus.workId,
      language,
      alsoSearch: [unit.citation[other], unit.heading[other], unit.heading[language]]
        .filter(Boolean)
        .join(' '),
    })
  }
  return docs
}

/** One work's study aids. The aid is the document, not the unit it explains. */
export function docsFromAids(
  aids: readonly StudyAid[],
  corpus: LibraryCorpus,
  language: Language,
): RetrievalDoc[] {
  return aids.map((aid) => {
    const unit = corpus.units.get(aid.unitId)
    const shown = unit ? unitLabel(unit.heading, unit.excerpt, language) : null
    return {
      id: `aid:${aid.workId}:${aid.unitId}`,
      kind: 'aid' as const,
      citation: unit?.citation[language] || unit?.citation.en || aid.unitId,
      heading: shown?.text ?? '',
      text: line([
        aid.explanation[language],
        aid.example[language],
        aid.misconception?.[language] ?? '',
        aid.examRelevance?.[language] ?? '',
        aid.mnemonic?.[language] ?? '',
      ]),
      href: toUnitHref(aid.workId, aid.unitId),
      sourceUrl: aid.source.url || null,
      personal: false,
      ...(unit ? { number: unit.number } : {}),
      workId: aid.workId,
      language,
      alsoSearch: [
        unit?.citation[language === 'en' ? 'hi' : 'en'] ?? '',
        aid.explanation[language === 'en' ? 'hi' : 'en'],
      ]
        .filter(Boolean)
        .join(' '),
    }
  })
}

/** One work's defined terms. `unitId` is the definitions clause, where there is one. */
export function docsFromDefinitions(
  terms: readonly DefinedTermRecord[],
  work: Pick<LibraryWork, 'id' | 'shortTitle'>,
  unitId: string | null,
  language: Language,
): RetrievalDoc[] {
  return terms.map((term) => ({
    id: `definition:${work.id}:${term.term}`,
    kind: 'definition' as const,
    citation: `${term.term} — ${work.shortTitle[language] || work.shortTitle.en}`,
    heading: term.term,
    text: term.definition,
    href: unitId ? toUnitHref(work.id, unitId) : toWorkHref(work.id),
    sourceUrl: null,
    personal: false,
    workId: work.id,
  }))
}

/** The Hindi administrative glossary. Both scripts go into one document. */
export function docsFromGlossary(terms: readonly GlossaryTerm[]): RetrievalDoc[] {
  return terms.map((term) => ({
    id: `glossary:${term.id}`,
    kind: 'glossary' as const,
    citation: `${term.en} / ${term.hi}`,
    heading: term.en,
    text: [term.hi, ...(term.alsoHi ?? []), term.note?.en ?? '', term.note?.hi ?? '']
      .filter(Boolean)
      .join(' '),
    href: `/tools/glossary?term=${encodeURIComponent(term.id)}`,
    sourceUrl: null,
    personal: false,
    alsoSearch: term.hi,
  }))
}

export interface NoteLike {
  id: string
  workId: string
  unitId: string
  body: string
}

/**
 * The reader's own margin notes.
 *
 * `personal: true` on every one, and `sourceUrl: null` — a note has no source
 * because the reader is the source. Everything downstream reads that flag; the
 * study agent labels such a snippet as the reader's own words, and never as
 * anything the law says.
 */
export function docsFromNotes(
  notes: readonly NoteLike[],
  citationFor: (workId: string, unitId: string) => string,
): RetrievalDoc[] {
  return notes.map((note) => ({
    id: `note:${note.id}`,
    kind: 'note' as const,
    citation: citationFor(note.workId, note.unitId),
    heading: '',
    text: note.body,
    href: toUnitHref(note.workId, note.unitId),
    sourceUrl: null,
    personal: true,
    workId: note.workId,
  }))
}
