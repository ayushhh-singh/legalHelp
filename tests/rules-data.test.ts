import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { isServed, rulesCardsSchema, rulesIndexSchema, rulesTextSchema } from '@/modules/trainer/schema'
import { fromRoot, readFromRoot } from '@/test/paths'

import type { Card, RulesCards, RulesText } from '@/modules/trainer/schema'

/**
 * The committed bytes of `data/rules`, read off disk.
 *
 * Same arrangement as `tests/law-data.test.ts`, `tests/pay-data.test.ts` and
 * `tests/drafting-data.test.ts`: this suite reads the files rather than
 * importing a fixture, because the files are what
 * `scripts/authoring/extract_rules.py` and `scripts/authoring/make_cards.py`
 * produce and what the app will ship. A card that validates only against a
 * test's own object literal has been tested for nothing.
 *
 * The load-bearing assertions here are the four the brief names:
 *
 * 1. every **served** card carries Hindi on every string a reader sees;
 * 2. every `ruleRef.textId` resolves into `data/rules/text/<act>.json`;
 * 3. every served cloze answer appears in the rule text it cites;
 * 4. no two served cards have near-identical fronts (token_set_ratio ≥ 92);
 *
 * plus the coverage assertion: every rule of every extracted act has a rule
 * card. Coverage is over the file, not over the served set, because an act
 * whose Hindi has not been authored yet still has a card per rule waiting for
 * it — and `docs/DATA-GAPS.md` says which acts those are.
 */

const TEXT_DIR = 'data/rules/text'
const CARDS_DIR = 'data/rules/cards'

const readJson = <T>(path: string): T => JSON.parse(readFromRoot(path)) as T

const actIds = readdirSync(fromRoot(TEXT_DIR))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort()

const texts = new Map<string, RulesText>(
  actIds.map((id) => [id, readJson<RulesText>(`${TEXT_DIR}/${id}.json`)]),
)
const cardFiles = new Map<string, RulesCards>(
  actIds.map((id) => [id, readJson<RulesCards>(`${CARDS_DIR}/${id}.json`)]),
)

const allCards = actIds.flatMap((id) => cardFiles.get(id)!.cards)
const servedCards = allCards.filter(isServed)

/** Every string a reader of a served card actually sees. */
const readerFacing = (card: Card) => [
  card.front,
  card.back,
  ...(card.cloze ? [card.cloze.text, card.cloze.answer] : []),
  ...(card.options ?? []),
  ...(card.explanation ? [card.explanation] : []),
]

/**
 * The same measure `qa_pipeline.py` uses for stage D, reimplemented here so the
 * test does not depend on the Python pipeline having been run. `token_set_ratio`
 * compares the sets of tokens, so it is blind to word order — which is what
 * makes it catch a question that is a reworded copy of another.
 */
const tokenSetRatio = (a: string, b: string): number => {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean),
    )
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size && !right.size) return 100
  const shared = [...left].filter((token) => right.has(token))
  const union = new Set([...left, ...right])
  return (shared.length / union.size) * 100
}

describe('data/rules — shape', () => {
  it('has at least one act', () => {
    expect(actIds.length).toBeGreaterThan(0)
  })

  it.each(actIds)('%s text validates against the zod schema', (id) => {
    expect(() => rulesTextSchema.parse(texts.get(id))).not.toThrow()
  })

  it.each(actIds)('%s cards validate against the zod schema', (id) => {
    expect(() => rulesCardsSchema.parse(cardFiles.get(id))).not.toThrow()
  })

  it('index validates and lists every act', () => {
    const index = rulesIndexSchema.parse(readJson('data/rules/index.json'))
    expect(index.acts.map((act) => act.id).sort()).toEqual(actIds)
  })

  it('index counts agree with the card files', () => {
    const index = rulesIndexSchema.parse(readJson('data/rules/index.json'))
    for (const entry of index.acts) {
      const cards = cardFiles.get(entry.id)!.cards
      expect(entry.counts.cards, entry.id).toBe(cards.length)
      expect(entry.counts.served, entry.id).toBe(cards.filter(isServed).length)
      expect(entry.counts.rules, entry.id).toBe(texts.get(entry.id)!.rules.length)
    }
    expect(index.totals.served).toBe(servedCards.length)
    expect(index.totals.cards).toBe(allCards.length)
  })

  it('every card id is unique across every act', () => {
    const ids = allCards.map((card) => card.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('data/rules — every served card is bilingual', () => {
  it('has non-empty Hindi on every reader-facing string', () => {
    const missing = servedCards.filter((card) => readerFacing(card).some((pair) => !pair.hi.trim()))
    expect(missing.map((card) => card.id)).toEqual([])
  })

  it('never approves a card that is missing Hindi', () => {
    // A rejected card needs no Hindi — it is never shown — so the assertion is
    // about `approved`, not about every state.
    const wrong = allCards.filter(
      (card) => isServed(card) && readerFacing(card).some((pair) => !pair.hi.trim()),
    )
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  it('never marks a fully bilingual card as needs-hindi', () => {
    const stale = allCards.filter(
      (card) => card.reviewState === 'needs-hindi' && readerFacing(card).every((pair) => pair.hi.trim()),
    )
    expect(stale.map((card) => card.id)).toEqual([])
  })

  it('writes Hindi in Devanagari, not in transliterated Latin', () => {
    const devanagari = /[ऀ-ॿ]/
    const offenders = servedCards.filter((card) =>
      readerFacing(card).some((pair) => pair.hi.trim() && !devanagari.test(pair.hi)),
    )
    expect(offenders.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — every ruleRef resolves', () => {
  it.each(actIds)('%s cards cite rules that exist in the text file', (id) => {
    const ruleIds = new Set(texts.get(id)!.rules.map((rule) => rule.id))
    const dangling = cardFiles
      .get(id)!
      .cards.filter((card) => !ruleIds.has(card.ruleRef.textId))
      .map((card) => `${card.id} -> ${card.ruleRef.textId}`)
    expect(dangling).toEqual([])
  })

  it('every authored question grounds itself in rules that exist', () => {
    const dangling: string[] = []
    for (const id of actIds) {
      const ruleIds = new Set(texts.get(id)!.rules.map((rule) => rule.id))
      for (const card of cardFiles.get(id)!.cards) {
        for (const grounded of card.generationMeta?.groundingRuleIds ?? []) {
          if (!ruleIds.has(grounded)) dangling.push(`${card.id} -> ${grounded}`)
        }
      }
    }
    expect(dangling).toEqual([])
  })

  it('the citation on a card names the rule number the card claims', () => {
    const wrong = allCards.filter((card) => !card.ruleRef.citation.en.includes(card.subRule ?? card.rule))
    expect(wrong.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — cloze answers come from the rule text', () => {
  const normalise = (value: string) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()

  it.each(actIds)('%s served cloze answers appear in the cited rule', (id) => {
    const byId = new Map(texts.get(id)!.rules.map((rule) => [rule.id, rule]))
    const orphans = cardFiles
      .get(id)!
      .cards.filter((card) => card.kind === 'cloze' && isServed(card))
      .filter((card) => {
        const rule = byId.get(card.ruleRef.textId)
        if (!rule) return true
        const haystack = normalise(`${rule.heading.en} ${rule.text.en}`)
        return !haystack.includes(normalise(card.cloze!.answer.en))
      })
      .map((card) => `${card.id} (${card.cloze?.answer.en})`)
    expect(orphans).toEqual([])
  })

  it('every served cloze stem carries the blank marker in both languages', () => {
    const broken = servedCards
      .filter((card) => card.kind === 'cloze')
      .filter((card) => !card.cloze!.text.en.includes('____') || !card.cloze!.text.hi.includes('____'))
    expect(broken.map((card) => card.id)).toEqual([])
  })

  it('never blanks a bare connective', () => {
    const connectives = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'to', 'in', 'shall', 'may'])
    const trivial = servedCards
      .filter((card) => card.kind === 'cloze')
      .filter((card) => connectives.has(card.cloze!.answer.en.trim().toLowerCase()))
    expect(trivial.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — a cloze never gives away its own answer', () => {
  /**
   * The boundary is asserted only on the ends of the answer that are
   * alphanumeric. A plain `\\b...\\b` looks right and never matches an answer
   * starting or ending with punctuation — `(1)`, `₹250` — which is half the
   * cross-reference and amount answers in this corpus. Devanagari needs no
   * special case: JS `\\w` does not cover it, so the lookarounds are written
   * against an explicit class.
   */
  const leaks = (stem: string, answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    const body = stem.replaceAll('____', ' ')
    const wordish = /[\p{L}\p{N}_]/u
    const left = wordish.test(trimmed[0]!) ? '(?<![\\p{L}\\p{N}_])' : ''
    const right = wordish.test(trimmed.at(-1)!) ? '(?![\\p{L}\\p{N}_])' : ''
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(left + escaped + right, 'iu').test(body)
  }

  it('the sample cases behave', () => {
    expect(leaks('see clause (1) and ____', '(1)')).toBe(true)
    expect(leaks('see clause (2) and ____', '(1)')).toBe(false)
    expect(leaks('a Member to be nominated ____ here', 'one')).toBe(false)
    expect(leaks('नियम 18क — ____ के उपनियम', 'नियम 18')).toBe(false)
    expect(leaks('नियम 18 और ____ दोनों', 'नियम 18')).toBe(true)
  })

  it('no served cloze repeats its answer outside the blank', () => {
    const offenders: string[] = []
    for (const card of servedCards) {
      if (card.kind !== 'cloze') continue
      for (const lang of ['en', 'hi'] as const) {
        if (leaks(card.cloze!.text[lang], card.cloze!.answer[lang])) {
          offenders.push(`${card.id} [${lang}] ${card.cloze!.answer[lang]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('a cloze cards back is exactly its answer', () => {
    const mismatched = allCards
      .filter((card) => card.kind === 'cloze')
      .filter((card) => card.back.en !== card.cloze!.answer.en || card.back.hi !== card.cloze!.answer.hi)
    expect(mismatched.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — ids and citations', () => {
  /**
   * A cloze id is keyed on the rule and the span kind, never on a running
   * counter. Every review file is keyed on the id, so a positional id renamed
   * half the corpus the first time a span was filtered out.
   */
  it('every cloze id is <act>-cloze-<rule>-<kind>', () => {
    const slug = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    const wrong = allCards
      .filter((card) => card.kind === 'cloze')
      .filter((card) => {
        const kind = card.tags?.[2]
        return !kind || card.id !== `${card.act}-cloze-${slug(card.rule)}-${slug(kind)}`
      })
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  /**
   * The FR/SR compilation prints "F.R. 17", so prepending the act's unit gave
   * thirty-three cards a citation reading "Rule F.R. 17(1)".
   */
  it('never doubles the unit word in a citation', () => {
    const doubled = allCards.filter((card) =>
      /\b(?:Rule|Section|Paragraph)\s+(?:F\.R\.|S\.R\.|Rule|Section)/i.test(card.ruleRef.citation.en),
    )
    expect(doubled.map((card) => card.id)).toEqual([])
  })

  it('pairs answerIndex with options, both ways', () => {
    const wrong = allCards.filter((card) => (card.answerIndex === undefined) !== (card.options === undefined))
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  it('leaves no untrimmed whitespace on a served string', () => {
    const untidy = servedCards.filter((card) =>
      readerFacing(card).some((pair) => pair.en !== pair.en.trim() || pair.hi !== pair.hi.trim()),
    )
    expect(untidy.map((card) => card.id)).toEqual([])
  })

  it('keeps reviewed and reviewState in step', () => {
    const wrong = allCards.filter(
      (card) => card.reviewed !== (card.reviewState !== 'unreviewed' && card.reviewState !== 'needs-hindi'),
    )
    expect(wrong.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — rule cards cover every rule', () => {
  it.each(actIds)('%s has a rule card for 100% of its rules', (id) => {
    const covered = new Set(
      cardFiles
        .get(id)!
        .cards.filter((card) => card.kind === 'rule' && !card.subRule)
        .map((card) => card.ruleRef.textId),
    )
    const uncovered = texts
      .get(id)!
      .rules.filter((rule) => !covered.has(rule.id))
      .map((rule) => rule.number)
    expect(uncovered).toEqual([])
  })
})

describe('data/rules — no duplicate fronts', () => {
  const THRESHOLD = 92

  // O(n²) over every served card's English front, so its wall-clock tracks
  // the committed corpus size, not just this repo's complexity. Session 20's
  // Hindi-headings and cloze/MCQ authoring pass took the served count from
  // 571 to 1,541 — roughly 2.7x — which is roughly 7x the comparisons, and
  // that alone pushed this test past Vitest's 30s default under any real CPU
  // contention (it stays under 15s in isolation). An explicit timeout here is
  // the fix, not a smaller corpus or a weaker check — see CLAUDE.md's own
  // note on `tests/e2e/a11y.spec.ts`'s `setTimeout(240_000)` for the same
  // reasoning applied to a route sweep instead of a card sweep.
  it('no two served cards have near-identical English fronts', () => {
    const collisions: string[] = []
    for (let i = 0; i < servedCards.length; i += 1) {
      for (let j = i + 1; j < servedCards.length; j += 1) {
        const score = tokenSetRatio(servedCards[i]!.front.en, servedCards[j]!.front.en)
        if (score >= THRESHOLD) {
          collisions.push(`${servedCards[i]!.id} ~ ${servedCards[j]!.id} (${score.toFixed(1)})`)
        }
      }
    }
    expect(collisions).toEqual([])
  }, 60_000)
})

describe('data/rules — the authored questions carry their four-stage record', () => {
  const authored = allCards.filter((card) => card.generationMeta)

  it('has at least 150 authored questions', () => {
    expect(authored.length).toBeGreaterThanOrEqual(150)
  })

  it('has at least 110 approved after the four stages', () => {
    expect(authored.filter(isServed).length).toBeGreaterThanOrEqual(110)
  })

  it('never serves a question the critic rejected', () => {
    const wrong = authored.filter(
      (card) => isServed(card) && card.generationMeta!.critic.verdict === 'reject',
    )
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  it('never serves a question whose blind answer missed the key', () => {
    const wrong = authored.filter(
      (card) => isServed(card) && card.generationMeta!.blindVerify?.matched === false,
    )
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  it('never serves a question rapidfuzz called a duplicate', () => {
    const wrong = authored.filter(
      (card) => isServed(card) && card.generationMeta!.dedup.verdict === 'duplicate',
    )
    expect(wrong.map((card) => card.id)).toEqual([])
  })

  it('blind-verifies every served MCQ and true/false question', () => {
    const unverified = authored.filter(
      (card) =>
        isServed(card) &&
        (card.kind === 'mcq' || card.kind === 'trueFalse') &&
        card.generationMeta!.blindVerify === null,
    )
    expect(unverified.map((card) => card.id)).toEqual([])
  })

  it('gives every rejected card a reason', () => {
    const silent = allCards.filter((card) => card.reviewState === 'rejected' && !card.reviewNote)
    expect(silent.map((card) => card.id)).toEqual([])
  })
})

describe('data/rules — a question is answerable', () => {
  const withOptions = servedCards.filter((card) => card.options)

  it('points answerIndex at a real option', () => {
    const broken = withOptions.filter(
      (card) => card.answerIndex === undefined || card.answerIndex >= card.options!.length,
    )
    expect(broken.map((card) => card.id)).toEqual([])
  })

  it('has no repeated option within a question', () => {
    const repeated = withOptions.filter((card) => {
      const seen = card.options!.map((option) => option.en.trim().toLowerCase())
      return new Set(seen).size !== seen.length
    })
    expect(repeated.map((card) => card.id)).toEqual([])
  })

  /**
   * Authoring a multiple-choice question puts the right answer first, and stage
   * A did exactly that in 91% of its questions. `make_cards.py` rotates the
   * options by a hash of the card id; this is what stops that regressing into a
   * card set where the answer is always (a).
   */
  it('does not put the answer in one position more than half the time', () => {
    const mcq = withOptions.filter((card) => card.kind === 'mcq')
    const counts = new Map<number, number>()
    for (const card of mcq) counts.set(card.answerIndex!, (counts.get(card.answerIndex!) ?? 0) + 1)
    const worst = Math.max(...counts.values())
    expect(worst).toBeLessThan(mcq.length * 0.5)
  })
})

describe('data/rules — sourcing', () => {
  it('every card cites a source with a URL', () => {
    const unsourced = allCards.filter((card) => !card.source.url.startsWith('http'))
    expect(unsourced.map((card) => card.id)).toEqual([])
  })

  it('every text file records that Hindi could not be extracted, with a bilingual note', () => {
    for (const id of actIds) {
      const text = texts.get(id)!
      if (text.hindiTextExtractable) continue
      expect(text.hindiNote.en.length, id).toBeGreaterThan(20)
      expect(text.hindiNote.hi.length, id).toBeGreaterThan(20)
      expect(
        text.rules.every((rule) => rule.text.hi === ''),
        id,
      ).toBe(true)
    }
  })

  it('carries the project disclaimer, in both languages, on every file', () => {
    for (const id of actIds) {
      expect(texts.get(id)!.disclaimer.hi).toContain('सत्यापित')
      expect(cardFiles.get(id)!.disclaimer.en).toContain('Reference only')
    }
  })
})
