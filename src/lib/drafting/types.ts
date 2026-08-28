import type { BlockRole, DocTemplate } from '@/modules/drafting/schema'

/** The two languages, on equal footing everywhere in this app. */
export type Lang = 'en' | 'hi'

/**
 * What an officer has typed into one field.
 *
 * A plain string or array is used for both languages — a file number and a
 * telephone number are the same in either. A `{ en, hi }` pair is what the
 * bilingual editor produces once the two versions diverge, and what every
 * template's `sample` is.
 */
export type FieldValue = string | string[] | Partial<Record<Lang, string | string[]>>

/**
 * What the officer has filled in, by field id.
 *
 * A field that is absent renders as nothing and is reported if the template
 * requires it. It does **not** fall back to the template's sample: a partially
 * filled form must not quietly emit a document signed by the specimen's
 * "(A.B.C.), Under Secretary" with the specimen's telephone number. Call
 * `sampleValues(template)` to ask for the worked example on purpose.
 */
export type DraftValues = Record<string, FieldValue | undefined>

export interface RenderOptions {
  /**
   * Render Hindi numerals as Devanagari digits — dates, paragraph numbers and
   * list markers. Off by default: an office that files its own O.M. numbers in
   * ASCII wants the date to match.
   */
  devanagariDigits?: boolean
  /** Line width the plain-text serialiser centres and right-aligns against. */
  width?: number
}

export interface RenderedBlock {
  role: BlockRole
  /**
   * Which entry of `template.layout[lang]` this came from.
   *
   * Roles repeat — a demi-official letter has two `header` blocks and two
   * `closing` blocks — so the role is not an identity. The index is, and it is
   * the same index in both languages, because `drafting_seed.py` refuses to
   * write a template whose two layouts place different blocks in a different
   * order. It is what `renderBilingual` pairs on and what the checklist's
   * paragraph-numbering rule uses to find the block it is talking about.
   */
  layoutIndex: number
  align: 'left' | 'center' | 'right'
  emphasis: 'normal' | 'bold' | 'title'
  lines: string[]
  /**
   * False when every placeholder in the block resolved to nothing. An unfilled
   * block still renders (so the preview shows an empty "Subject:" rather than
   * hiding the omission) unless the template marked it `omitWhenEmpty` — but
   * the checklist's `blockPresent` rule does not count it.
   */
  filled: boolean
}

export type IssueCode = 'required' | 'date-format' | 'unknown-field' | 'unknown-option' | 'too-long'

export interface ValidationIssue {
  code: IssueCode
  field?: string
  message: { en: string; hi: string }
}

/**
 * The structured document. `blocks` is what a renderer draws; the named slots
 * are the same content addressed the way the manual talks about it, so a
 * caller can ask for the subject line without knowing block roles.
 */
export interface DocumentModel {
  templateId: string
  lang: Lang
  urgency: string | null
  header: string[]
  title: string | null
  refLine: string | null
  subject: string | null
  paras: string[]
  closing: string | null
  signature: string[]
  enclosures: string[]
  copyTo: string[]
  blocks: RenderedBlock[]
}

export interface RenderResult {
  document: DocumentModel
  issues: ValidationIssue[]
  /** Every field's value resolved to this language, for the checklist. */
  resolved: Record<string, string | string[]>
}

/** A block and its counterpart, for a side-by-side view. */
export interface BlockPair {
  role: BlockRole
  /** The layout position both sides came from — a stable key for a list. */
  layoutIndex: number
  en: RenderedBlock
  hi: RenderedBlock
}

export interface BilingualRenderResult {
  en: RenderResult
  hi: RenderResult
  pairs: BlockPair[]
  /** English issues then Hindi ones, each tagged by the language it came from. */
  issues: (ValidationIssue & { lang: Lang })[]
}

export interface ChecklistResult {
  id: string
  label: string
  why: string
  severity: 'must' | 'should'
  csmopRef?: string
  passed: boolean
}

export type { DocTemplate }
