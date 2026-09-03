import { describe, expect, it } from 'vitest'

import { BLANK, clozeStem, libraryCardDraft } from './trainerCard'
import type { LibraryUnit } from './types'

/**
 * DEFECT 5 — a cloze card whose stem was the answer's own blank.
 *
 * The first version built `cloze.text` as the literal `"____"`, so the card
 * asked nothing: it showed a citation and a blank, and could be answered only
 * by somebody who already had the rule in front of them. It looked right in the
 * dialog, would have looked right in the review queue, and would have been
 * discovered by whoever tried to review it.
 */

const TEXT =
  'Every Government servant shall at all times maintain absolute integrity and devotion to duty. ' +
  'The competent authority may relax this rule in a proper case.'

const unit: LibraryUnit = {
  id: 'ccs-conduct-3',
  number: '3',
  heading: { en: 'General', hi: 'सामान्य' },
  excerpt: null,
  body: { en: [TEXT], hi: [] },
  parts: [],
  chapter: null,
  citation: { en: 'Rule 3, CCS (Conduct) Rules, 1964', hi: 'नियम 3, सीसीएस (आचरण) नियम, 1964' },
  repealedRefs: [],
}

describe('clozeStem', () => {
  it('is the sentence the passage came from, with the passage blanked', () => {
    const stem = clozeStem(TEXT, 'absolute integrity')
    expect(stem).toBe(`Every Government servant shall at all times maintain ${BLANK} and devotion to duty.`)
  })

  it('takes the sentence the passage is IN, not the first one', () => {
    expect(clozeStem(TEXT, 'competent authority')).toBe(`The ${BLANK} may relax this rule in a proper case.`)
  })

  it('says so rather than inventing a sentence it could not find', () => {
    // A selection dragged across a paragraph break spans a join the sentence
    // splitter never sees.
    expect(clozeStem(TEXT, 'a phrase from somewhere else')).toBe(`… ${BLANK} …`)
  })

  it('keeps the blank in view when the sentence is enormous', () => {
    const long = `${'word '.repeat(200)}the marked words${' more'.repeat(200)}.`
    const stem = clozeStem(long, 'the marked words')
    expect(stem).toContain(BLANK)
    expect(stem.length).toBeLessThan(400)
  })

  it('is the blank alone for an empty passage', () => {
    expect(clozeStem(TEXT, '   ')).toBe(BLANK)
  })
})

describe('libraryCardDraft', () => {
  it('builds a cloze that can actually be answered', () => {
    const card = libraryCardDraft('cloze', unit, 'absolute integrity')
    expect(card.cloze?.text.en).toContain('Every Government servant')
    expect(card.cloze?.text.en).toContain(BLANK)
    expect(card.cloze?.answer.en).toBe('absolute integrity')
    // And the front carries the stem, not just the citation and a blank.
    expect(card.front.en).toContain('maintain ____ and devotion')
  })

  it('builds a rule card that asks which provision the passage is from', () => {
    const card = libraryCardDraft('rule', unit, 'absolute integrity')
    expect(card.front.en).toBe('absolute integrity')
    expect(card.back.en).toBe('Rule 3, CCS (Conduct) Rules, 1964')
    expect(card.cloze).toBeUndefined()
  })

  it('carries both languages, and never invents Hindi text', () => {
    const card = libraryCardDraft('cloze', unit, 'absolute integrity')
    // No Hindi text layer exists for any of these works (ADR-023). The same
    // English is carried in both halves rather than machine-translated; the
    // reader edits it in the review queue if they want to.
    expect(card.cloze?.answer.hi).toBe(card.cloze?.answer.en)
    expect(card.back.hi).toBe(card.back.en)
  })

  it('uses the Hindi body when that is the only text there is', () => {
    const hindiOnly: LibraryUnit = {
      ...unit,
      body: { en: [], hi: ['प्रत्येक सरकारी सेवक सत्यनिष्ठा बनाए रखेगा।'] },
    }
    expect(libraryCardDraft('cloze', hindiOnly, 'सत्यनिष्ठा').cloze?.text.en).toContain(BLANK)
  })
})
