import { parseDate } from './format'

import type { BodyDoc, OfficialDoc } from './model'
import type { Lang } from './types'

/**
 * Two questions the editor asks about a document, answered in ONE place each.
 *
 * Both were written twice before this file existed, and both pairs disagreed.
 * That is the whole reason it is here: a question with two implementations is a
 * question with two answers, and the reader only ever sees one of them.
 */

/**
 * Which slot of the document a language edits.
 *
 * `DocEditorPage` asked this twice — once to READ (`bodyHi ? bodyHi : body`)
 * and once to WRITE (`lang === 'bilingual' ? bodyHi : body`) — and for a
 * bilingual document whose `bodyHi` was absent the two disagreed. The officer
 * saw the English text, typed one character, and the English vanished: the
 * keystroke landed in `bodyHi`, which then became the slot the read preferred.
 *
 * `bodyHi` is optional on `OfficialDoc` (a document that was never separated
 * has none), so "bilingual and missing" is a shape the schema permits and the
 * editor has to survive.
 */
export function bodySlotForLanguage(doc: OfficialDoc, lang: Lang): 'body' | 'bodyHi' {
  return lang === 'hi' && doc.lang === 'bilingual' && doc.bodyHi ? 'bodyHi' : 'body'
}

/** The body that slot holds. */
export const bodyForLanguage = (doc: OfficialDoc, lang: Lang): BodyDoc =>
  bodySlotForLanguage(doc, lang) === 'bodyHi' ? (doc.bodyHi ?? doc.body) : doc.body

/**
 * Start editing Hindi separately.
 *
 * The one way `bodyHi` comes into existence, and it SEEDS from the English
 * rather than blanking — the same reason `values.ts#splitField` seeds a split
 * field: an officer pressing "write Hindi separately" wants to edit what is
 * there, not to retype the half that was already right.
 */
export function separateHindiBody(doc: OfficialDoc): OfficialDoc {
  if (doc.bodyHi) return doc
  return {
    ...doc,
    lang: 'bilingual',
    bodyHi: structuredClone(doc.body),
  }
}

/**
 * The year a reference number should be issued under.
 *
 * The document's own date, not the day the button was pressed: a document dated
 * into January belongs to next year's series, and one dated last December
 * belongs to last year's.
 *
 * `Number(date.slice(0, 4))` read **28** out of `28.09.2026` — and 28 is
 * truthy, so it did not even fall through to the fallback. Every document
 * migrated from the Session 8 editor carries a dd.mm.yyyy date, so issuing a
 * number on one stamped `seqYear: 28` on the pattern and restarted a
 * yearly-reset series at 1. `parseDate` already accepts both shapes, in either
 * script; it was simply not asked.
 */
export function yearOfDocument(doc: OfficialDoc, fallbackYear: number): number {
  return parseDate(doc.meta.date)?.year ?? fallbackYear
}
