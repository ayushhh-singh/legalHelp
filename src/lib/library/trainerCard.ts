import { normaliseText } from './anchor'
import { sentenceRanges } from './tts'
import type { LibraryUnit } from './types'

/**
 * A highlighted passage, turned into a card the Trainer's review queue can hold.
 *
 * Pure and separate from the dialog that calls it, because the interesting part
 * is not the dialog: it is what a card made this way actually ASKS. The first
 * version put the bare answer in the stem —
 *
 *     front: "Rule 3, CCS (Conduct) Rules, 1964: ____"
 *     cloze.text: "____"
 *
 * — which is not a question. A cloze card with no sentence around the blank
 * cannot be answered by anybody who does not already have the rule in front of
 * them, and it would sit in the review queue looking plausible until somebody
 * tried to review it. The stem is the SENTENCE the passage came from, with the
 * passage replaced by the blank.
 *
 * `BLANK` is four underscores for the reason `src/ai/agents/drafting.ts` uses
 * them: `data/rules`' own cloze cards are written that way, and the Trainer's
 * card renderer already knows the shape.
 */

export const BLANK = '____'

export type LibraryCardKind = 'cloze' | 'rule'

export interface LibraryCardDraft {
  front: { en: string; hi: string }
  back: { en: string; hi: string }
  cloze?: { text: { en: string; hi: string }; answer: { en: string; hi: string } }
}

/** How much of a very long sentence to keep around the blank. */
const MAX_STEM = 320

/**
 * The sentence containing the passage, with the passage blanked out.
 *
 * Falls back to the passage's own words with the blank appended when the quote
 * cannot be located — which happens when the reader highlighted across a
 * paragraph break, so the selected text spans a join the sentence splitter
 * never sees. A stem that is honest about being partial beats one that claims
 * a sentence it could not find.
 */
export function clozeStem(unitText: string, quote: string): string {
  const text = normaliseText(unitText)
  const needle = normaliseText(quote)
  if (!needle) return BLANK

  const at = text.indexOf(needle)
  if (at < 0) return `… ${BLANK} …`

  const sentence = sentenceRanges(text).find((range) => range.start <= at && range.end >= at + needle.length)
  const source = sentence?.text ?? text.slice(Math.max(0, at - 120), at + needle.length + 120)
  const blanked = source.replace(needle, BLANK)

  if (blanked.length <= MAX_STEM) return blanked
  // Keep the blank in view: an ellipsis on each side of a window around it.
  const centre = blanked.indexOf(BLANK)
  const from = Math.max(0, centre - MAX_STEM / 2)
  const to = Math.min(blanked.length, centre + MAX_STEM / 2)
  return `${from > 0 ? '… ' : ''}${blanked.slice(from, to).trim()}${to < blanked.length ? ' …' : ''}`
}

/**
 * The two card shapes this surface can produce.
 *
 * A `cloze` asks for the words that were marked; a `rule` asks which provision
 * the passage comes from. Both are bilingual because every card in `data/rules`
 * is — and both carry the SAME text in each language, because this app has no
 * Hindi text layer for any of these works (ADR-023) and inventing one is the
 * thing it must never do. The reader can edit either side in the review queue,
 * which is where a card is accepted.
 */
export function libraryCardDraft(kind: LibraryCardKind, unit: LibraryUnit, quote: string): LibraryCardDraft {
  const trimmed = normaliseText(quote)

  if (kind === 'rule') {
    return {
      front: { en: trimmed, hi: trimmed },
      back: { en: unit.citation.en, hi: unit.citation.hi },
    }
  }

  const stem = clozeStem(unit.body.en.join(' ') || unit.body.hi.join(' '), trimmed)
  return {
    front: { en: `${unit.citation.en} — ${stem}`, hi: `${unit.citation.hi} — ${stem}` },
    back: { en: trimmed, hi: trimmed },
    cloze: { text: { en: stem, hi: stem }, answer: { en: trimmed, hi: trimmed } },
  }
}
