import type { Language } from '@/i18n'

/**
 * The shape of `data/law/*.json`, produced by `scripts/ingest/ncrb_sankalan.py`
 * and validated in CI against `schemas/law-mapping.schema.json` (Python, at
 * ingest time) and `src/modules/law/schema.ts` (zod, in `pnpm test`).
 *
 * Nothing here imports the JSON. The datasets are megabytes of section text and
 * belong behind a fetch on the Law Converter route, not in the initial bundle —
 * `tests/bundle-budget.test.ts` is what would catch the mistake.
 */

/** Every record carries both languages. `hi` may be empty where no source has one. */
export type Bilingual = Record<Language, string>

export type NewActId = 'BNS' | 'BNSS' | 'BSA'
export type OldActId = 'IPC' | 'CrPC' | 'IEA'

/** How a section of the new Act relates to what it replaced. */
export type SectionStatus =
  /** Same number, same substance. */
  | 'unchanged'
  /** Substance changed — NCRB marks the row "(Change)". */
  | 'changed'
  /** Same substance under a different number. */
  | 'renumbered'
  /** No counterpart in the repealed Act. */
  | 'new'

export type Cognizable = 'cognizable' | 'non-cognizable' | 'depends' | 'unspecified'
export type Bailable = 'bailable' | 'non-bailable' | 'depends' | 'unspecified'
export type Compoundable = 'compoundable' | 'compoundable-with-court-permission' | 'non-compoundable'

export interface ActRef {
  id: NewActId | OldActId
  year: number
  name: Bilingual
}

export interface DataSource {
  id: string
  name: Bilingual
  url: string
  fetchedAt: string
  sha256?: string
  bytes?: number
}

export interface OldSectionRef {
  act: OldActId
  /** Full reference including sub-parts, normalised: `"318(4)"`, `"2(f)"`. */
  section: string
  /** The section number alone: `"318"`. This is what keys a dataset. */
  base: string
  heading: Bilingual
}

export interface SectionMapping {
  /** The sub-section of the new Act this row is about: `"103(1)"`. */
  clause: string
  old: OldSectionRef[]
  isNewProvision: boolean
  changed: boolean
}

/** From the BNSS First Schedule and BNSS s.359. Offences under the BNS only. */
export interface Classification {
  clause: string
  offence: Bilingual
  punishment: Bilingual
  cognizable: Cognizable
  bailable: Bailable
  triableBy: Bilingual
  compoundable: Compoundable
  compoundableBy?: Bilingual
  source?: string
}

export type NoteKind = 'trap' | 'transitional' | 'context' | 'caution'

/** Hand-curated. `trap` is the number-swap warning a reader most needs. */
export interface SectionNote {
  kind: NoteKind
  title: Bilingual
  body: Bilingual
  source?: { name: Bilingual; url: string }
}

export interface LawSection {
  section: string
  act: NewActId
  heading: Bilingual
  status: SectionStatus
  chapter: { number: string; title: Bilingual }
  mappings: SectionMapping[]
  /** Every repealed-Act section number this one absorbs, deduplicated. */
  repeals: string[]
  text: Bilingual
  classification: Classification[]
  punishment: Bilingual
  keywords: { en: string[]; hi: string[]; roman: string[] }
  notes: SectionNote[]
  /** Ids into the dataset's `sources` array. */
  sources: string[]
  /** True where a value is curated rather than official — the UI must say so. */
  verify: boolean
  provenance?: Record<string, unknown>
}

export interface LawDataset {
  id: 'bns' | 'bnss' | 'bsa'
  version: string
  fetchedAt: string
  newAct: ActRef
  oldAct: ActRef
  commencement: { date: string; note: Bilingual; source: { name: Bilingual; url: string } }
  disclaimer: Bilingual
  sources: DataSource[]
  counts: Record<string, number | string>
  /** Keyed by section number of the new Act. */
  sections: Record<string, LawSection>
}

export interface LawIndexEntry {
  oldAct: OldActId
  newAct: NewActId
  /** May carry sub-parts (`"318(4)"`). Empty when the provision was dropped. */
  newSections: string[]
  status: 'mapped' | 'omitted'
  heading: Bilingual
  note: Bilingual | null
  warnings?: SectionNote[]
}

export interface LawIndex {
  version: string
  generatedAt: string
  disclaimer: Bilingual
  acts: Record<
    string,
    {
      newAct: NewActId
      oldActName?: Bilingual
      newActName?: Bilingual
      entries: Record<string, LawIndexEntry>
    }
  >
}

/** The three code pairs, as they appear in the URL and in `data/law/*.json`. */
export type LawCode = 'bns' | 'bnss' | 'bsa'

/** Everything the Law Converter loads: the reverse index plus all three codes. */
export interface LawCorpus {
  index: LawIndex
  datasets: Record<LawCode, LawDataset>
}
