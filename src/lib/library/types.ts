import type { Bilingual, LibraryWork, TocNode } from '@/schemas/library'

/**
 * One readable unit — a rule, a section or a numbered paragraph — assembled
 * from the corpus that owns its text and the work that owns its structure.
 *
 * Nothing in `data/library` holds a unit's body: `src/lib/library/corpus.ts`
 * builds these from `data/rules/text/*.json` or `data/law/*.json` at read time,
 * which is what makes a dataset refresh correct the Library for free.
 */
export interface LibraryUnit {
  id: string
  /** As the document prints it: "11", "3A", "5.2", "F.R. 9", "103". */
  number: string
  /**
   * From the corpus where it has one, from the work's own table of contents
   * where the corpus prints none. `headingMissing` says which languages have
   * nothing rather than leaving a caller to test for an empty string.
   */
  heading: Bilingual
  /**
   * The navigation excerpt the work carries for a unit with no heading. `null`
   * when the unit has a real heading in both languages.
   */
  excerpt: Bilingual | null
  /** Paragraphs, split for rendering. Joining them reproduces the corpus text. */
  body: { en: string[]; hi: string[] }
  /**
   * The sub-rules the corpus records as their own records — `1(1)`, `1(2)`.
   *
   * A RE-SEGMENTATION of `body`, not extra content: all 219 rules in
   * `data/rules/text` that have sub-rules have them as verbatim slices of
   * `text`, which `library.test.ts` asserts. So a surface that renders `body`
   * must NOT also render this, or it prints the whole rule twice — which is
   * what the first version of the reader did, and what a real browser found.
   *
   * Kept because a sub-rule number is a real citation an officer uses, and
   * because Session 27's highlights and notes need something to anchor to
   * finer than a whole rule.
   */
  parts: { number: string; text: Bilingual }[]
  /** Law units only — the chapter the corpus files the section under. */
  chapter: { number: string; title: Bilingual } | null
  /** "Rule 11, CCS (Conduct) Rules, 1964" / "धारा 103, भारतीय न्याय संहिता, 2023". */
  citation: Bilingual
  /**
   * Law units only — where a repealed-Act provision maps to this one, as the
   * old Act's own id and section. What the reader page turns into a link into
   * the Law Converter.
   */
  repealedRefs: { act: string; section: string }[]
}

/** Every unit of one work, in reading order, plus a lookup by id. */
export interface LibraryCorpus {
  workId: string
  order: readonly string[]
  units: ReadonlyMap<string, LibraryUnit>
}

export type { LibraryWork, TocNode }
