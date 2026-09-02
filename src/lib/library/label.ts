import type { Bilingual } from '@/schemas/library'
import type { Language } from '@/i18n'

export interface UnitLabel {
  text: string
  /** True when `text` is a quotation of the opening, not a published heading. */
  isExcerpt: boolean
  /** The language `text` is actually in — not always the one that was asked for. */
  lang: Language
}

/**
 * What to show for a unit or a chapter, in the reader's language.
 *
 * There are three real gaps in the corpus and this is the one place that
 * decides what to do about each, so a table of contents, a search result and a
 * side rail cannot answer them differently:
 *
 * - **221 leaf nodes have no ENGLISH heading** — the whole of FR/SR and CSMOP,
 *   thirteen GFR rules and a handful of others print none their extractor could
 *   read. The work carries an `excerpt` for exactly these, which is what
 *   `scripts/authoring/make_cards.py` already puts on the front of a rule card.
 * - **71 of the 87 law chapter titles have no HINDI.** NCRB Sankalan publishes
 *   English chapter titles only, and a chapter heading is not a provision, so
 *   none was authored.
 * - **Two CCS (Leave) rules have neither.**
 *
 * Nothing is invented for any of them (`docs/DATA-GAPS.md` #70, #71). The order
 * is: the reader's own language, then a quotation in it, then the OTHER
 * language, then a quotation in that. Falling back across languages is not the
 * silent fallback `fallbackLng: false` forbids — that rule is about a missing
 * key inside a catalogue. This is a navigation control over a corpus that is
 * genuinely one-sided, and `lang` comes back with the answer so the caller can
 * mark up what it actually rendered.
 */
export function unitLabel(
  heading: Bilingual,
  excerpt: Bilingual | null | undefined,
  language: Language,
): UnitLabel {
  const other: Language = language === 'en' ? 'hi' : 'en'

  const own = heading[language].trim()
  if (own) return { text: own, isExcerpt: false, lang: language }

  const quoted = excerpt?.[language]?.trim()
  if (quoted) return { text: quoted, isExcerpt: true, lang: language }

  const across = heading[other].trim()
  if (across) return { text: across, isExcerpt: false, lang: other }

  const quotedAcross = excerpt?.[other]?.trim()
  if (quotedAcross) return { text: quotedAcross, isExcerpt: true, lang: other }

  return { text: '', isExcerpt: false, lang: language }
}
