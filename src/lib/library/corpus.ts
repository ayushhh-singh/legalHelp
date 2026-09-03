import type { LibraryCorpus, LibraryUnit } from './types'

import type { Bilingual, LibraryWork, TocNode } from '@/schemas/library'

/**
 * Turning a corpus this repository already ships into readable units.
 *
 * PURE, and it takes both the work and the corpus as arguments — the same rule
 * `src/lib/pay` follows and for the same reason: `data/law/bns.json` is 1.9 MB,
 * and importing it here would put it into whatever chunk imports this file.
 * `src/lib/library/data.ts` is the one module that names a dataset, behind a
 * dynamic import.
 *
 * Two shapes go in and one comes out. `data/rules/text/*.json` is a list of
 * rules with optional sub-rules; `data/law/*.json` is a map of section number to
 * a record with a chapter and mappings back to the repealed Act. Everything the
 * reader page renders is on `LibraryUnit`, so nothing above this file has to
 * know which corpus a work points at.
 */

/** The two corpus shapes, narrowed to only what this file reads. */
interface RulesCorpusLike {
  act: { name: Bilingual; short: Bilingual; unit: Bilingual }
  rules: {
    id: string
    number: string
    heading: { en: string; hi: string }
    text: { en: string; hi: string }
    subRules?: { number: string; text: { en: string; hi: string } }[]
  }[]
}

interface LawCorpusLike {
  newAct: { id: string; name: Bilingual }
  oldAct: { id: string }
  sections: Record<
    string,
    {
      section: string
      heading: { en: string; hi: string }
      text: { en: string; hi: string }
      chapter?: { number: string; title: { en: string; hi: string } }
      mappings?: { old?: { act: string; section: string }[] }[]
    }
  >
}

export type CorpusJson = RulesCorpusLike | LawCorpusLike

const isLaw = (corpus: CorpusJson): corpus is LawCorpusLike => 'sections' in corpus

/**
 * Where a paragraph break belongs in a run-on statutory string.
 *
 * `data/law/*.json` prints real newlines between sub-sections; the twelve rule
 * books print none at all, so a rule arrives as one 4,000-character line and
 * renders as a wall. These are the four places a printed rule book itself
 * breaks: a numbered sub-clause, a proviso, an explanation and an illustration.
 *
 * NOTHING IS ADDED OR REMOVED. `paragraphs(text).join(' ')` is `text` with its
 * whitespace collapsed, which `corpus.test.ts` asserts over every unit of every
 * work — that is the whole guarantee that makes presentational splitting safe
 * to do to a statute.
 */
/**
 * The Devanagari alternatives carry NO `\b`, deliberately.
 *
 * JavaScript defines a word boundary over `[A-Za-z0-9_]`, so `/परन्तु\b/`
 * matches nothing, ever — a pattern that looks symmetric with its English half
 * and silently covers one language. The first version of this constant had it,
 * and the Devanagari test below is what found it. `src/ai/agents/law.ts`'s
 * `SECTION_MENTION` made the same allowance for the same reason (ADR-035).
 */
const BREAK_BEFORE =
  /(?=\s(?:\(\d+[A-Za-z]?\)\s|Provided\b|PROVIDED\b|Explanation\b|Explanations\b|Illustration\b|Illustrations\b|परन्तु|परंतु|स्पष्टीकरण|दृष्टांत))/g

export function paragraphs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // A corpus that already breaks its own lines is telling us where the breaks
  // are; second-guessing it would split inside a sub-section it kept together.
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > 1) return lines

  return trimmed
    .split(BREAK_BEFORE)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Every leaf of a table of contents, in order. */
export function tocLeaves(nodes: readonly TocNode[]): TocNode[] {
  const out: TocNode[] = []
  for (const node of nodes) {
    const children = node.children ?? []
    if (children.length > 0) out.push(...tocLeaves(children))
    else out.push(node)
  }
  return out
}

const cite = (unitLabel: Bilingual, number: string, title: Bilingual): Bilingual => ({
  // "Rule 11, CCS (Conduct) Rules, 1964". A number that already carries its own
  // unit word — FR/SR prints "F.R. 9" — must not be given a second one, which
  // is what put "Rule F.R. 17(1)" on 179 Trainer cards before ADR-023 caught it.
  en: /^[A-Za-z]/.test(number) ? `${number}, ${title.en}` : `${unitLabel.en} ${number}, ${title.en}`,
  hi: /^[A-Za-z]/.test(number) ? `${number}, ${title.hi}` : `${unitLabel.hi} ${number}, ${title.hi}`,
})

/**
 * Build every unit of one work.
 *
 * Headings come from the CORPUS where it prints one and from the WORK's table
 * of contents otherwise — which is how the four rule books that publish no
 * heading at all still read with the authored Hindi headings
 * `scripts/authoring/hindi/*.json` carries and `make_cards.py` already uses.
 * The excerpt travels with the unit for the same reason, so a caller with a
 * unit in hand never has to go back to the TOC to label it.
 */
/**
 * The parts of a work this file actually reads.
 *
 * Narrower than `LibraryWork` on purpose: a document the reader added has no
 * publisher, no official URL and no source (`src/lib/library/personal.ts`), and
 * it must still be able to become a corpus. Taking a structural subtype is what
 * lets one reader render both without the dataset schema being relaxed to
 * accommodate something that is not a dataset.
 */
export type CorpusWork = Pick<LibraryWork, 'id' | 'toc' | 'readingOrder' | 'unitLabel' | 'title' | 'corpus'>

export function buildCorpus(work: CorpusWork, corpus: CorpusJson): LibraryCorpus {
  const byNodeUnit = new Map<string, TocNode>()
  for (const node of tocLeaves(work.toc)) {
    const unitId = node.unitIds[0]
    if (unitId) byNodeUnit.set(unitId, node)
  }

  const units = new Map<string, LibraryUnit>()

  const push = (
    id: string,
    number: string,
    corpusHeading: { en: string; hi: string },
    text: { en: string; hi: string },
    parts: { number: string; text: Bilingual }[],
    chapter: { number: string; title: Bilingual } | null,
    repealedRefs: { act: string; section: string }[],
  ) => {
    const node = byNodeUnit.get(id)
    const heading: Bilingual = {
      en: corpusHeading.en || node?.heading.en || '',
      hi: corpusHeading.hi || node?.heading.hi || '',
    }
    units.set(id, {
      id,
      number,
      heading,
      excerpt: node?.excerpt ?? null,
      body: { en: paragraphs(text.en), hi: paragraphs(text.hi) },
      parts,
      chapter,
      citation: cite(work.unitLabel, number, work.title),
      repealedRefs,
    })
  }

  if (isLaw(corpus)) {
    for (const id of work.readingOrder) {
      const record = corpus.sections[id]
      if (!record) continue
      const refs: { act: string; section: string }[] = []
      const seen = new Set<string>()
      for (const mapping of record.mappings ?? []) {
        for (const old of mapping.old ?? []) {
          const key = `${old.act}:${old.section}`
          if (seen.has(key)) continue
          seen.add(key)
          refs.push({ act: old.act, section: old.section })
        }
      }
      push(
        id,
        record.section,
        record.heading,
        record.text,
        [],
        record.chapter ? { number: record.chapter.number, title: record.chapter.title } : null,
        refs,
      )
    }
  } else {
    const byId = new Map(corpus.rules.map((rule) => [rule.id, rule]))
    for (const id of work.readingOrder) {
      const rule = byId.get(id)
      if (!rule) continue
      push(id, rule.number, rule.heading, rule.text, rule.subRules ?? [], null, [])
    }
  }

  return { workId: work.id, order: work.readingOrder, units }
}
