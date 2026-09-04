import type { Lang } from './types'
import type { BlockRole, DocTemplate } from '@/modules/drafting/schema'

/**
 * The per-template instruction builder: what a model is handed when it is asked
 * to write, or change, one of the forty-three forms.
 *
 * ### Why there is one builder and not forty-three
 *
 * The session brief asks for `instructionBuilder(values, context?)` on every
 * template. A template is a JSON file (`data/drafting/templates/*.json`) and a
 * function is not JSON, so the choice is between forty-three hand-written
 * builders in TypeScript beside a dataset that already states the same facts,
 * and one builder that DERIVES the instruction from the template it is given.
 *
 * This is the second. `person`, `salutation`, `subscription`, `urgencyAllowed`,
 * `csmopRef.paras`, the layout's block order and the checklist's `must` items
 * are already in the dataset, already validated by two schemas, and already
 * what `renderOfficialDoc` and `evaluateChecklist` read. A second, prose copy
 * of them in a builder is the "two implementations of one grammar" ADR-039 §4
 * spent a Node script avoiding, and it would go stale the first time
 * `drafting_seed.py` changed a form. `buildInstruction(template, …)` is
 * therefore forty-three builders in the only sense that matters: it produces a
 * different, form-specific instruction for each, and
 * `instructions.snapshot.test.ts` commits all forty-three so a change to any
 * one of them shows up in a diff.
 *
 * Where the derivation genuinely cannot know something, `TEMPLATE_NOTES` holds
 * a per-form line. It is deliberately small: a note there is a claim about a
 * form that the dataset does not make, and every one of them cites CSMOP.
 *
 * ### What the instruction is, and what it is not
 *
 * It is **not** the renderer. `renderOfficialDoc` lays the document out, the
 * checklist marks it, and both run whether or not a model was ever involved —
 * the deterministic path stays primary (ADR-043 §1). The instruction is only
 * what the agent is handed, so the model writes prose that fits the form the
 * app is going to lay out around it.
 *
 * It is **not** cached prompt prefix either. It varies per document, per
 * language and per field value, so it goes in the volatile part of a request —
 * the user message or a PLATFORM CONTEXT snippet — never through
 * `buildSystem({ instructions })`, which is cached and must be the same bytes
 * on every request an agent makes (`src/ai/prompts.ts`).
 *
 * ### Sanitisation is here rather than at the call site
 *
 * Every value is passed through `sanitiseField` before it can reach a provider:
 * control characters removed, whitespace normalised, and a hard cap of
 * {@link INSTRUCTION_FIELD_CAP} characters per field with the truncation
 * reported rather than silent. Doing it here means a caller cannot forget —
 * there is no path from a field value into an instruction that does not pass
 * through this file — and reporting it means an officer whose twelve-page
 * annexure was cut short is told so rather than wondering why the model
 * ignored half of it.
 *
 * The screen (`screenOutbound` in `src/ai/agents/drafting.ts`) is a separate
 * and earlier gate: it decides whether anything may be sent at all. This
 * decides what the text looks like once that question has been answered yes.
 */

/* ------------------------------------------------------------------ *
 * Sanitisation
 * ------------------------------------------------------------------ */

/**
 * The per-field ceiling, in characters.
 *
 * Five thousand is roughly 800 words — longer than any paragraph of any
 * document in `data/drafting`, and long enough for a pasted annexure. The cap
 * is per FIELD rather than per instruction on purpose: capping the whole
 * instruction would let one long field silently push the CSMOP rules and the
 * structure list off the end, which is the half the model most needs.
 */
export const INSTRUCTION_FIELD_CAP = 5_000

/** What replaces the tail of a field that was too long. Visible, not silent. */
export const TRUNCATION_MARKER = ' […truncated]'

/**
 * One field's text, safe to put in a prompt.
 *
 * Control characters go first, and the reason is not cosmetic. A value can
 * reach here from a pasted PDF, a `.docx` import or a letter typed into the
 * intake box, and those carry form feeds, vertical tabs and — the one that
 * matters — bidirectional overrides (U+202A-U+202E, U+2066-U+2069), which can
 * make a line of text render in an order other than the order it is stored in.
 * A reviewer reading the instruction on screen and a model reading the bytes
 * would then disagree about what it says.
 *
 * `\n` and `\t` survive, because a paragraph break is content.
 */
export function sanitiseField(value: string): { text: string; truncated: boolean } {
  const cleaned = value
    .normalize('NFC')
    /*
      C0 and C1 controls except tab and newline. `no-control-regex` is disabled
      for this line rather than worked around: the rule exists to catch a
      control character typed into a pattern by accident, and this pattern is
      about control characters — removing them is the whole job. A `\p{Cc}`
      class would match tab and newline too, which are content here.
    */
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    // A run of blank lines is a formatting artefact of a PDF, not structure.
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (cleaned.length <= INSTRUCTION_FIELD_CAP) return { text: cleaned, truncated: false }
  return {
    text: cleaned.slice(0, INSTRUCTION_FIELD_CAP - TRUNCATION_MARKER.length) + TRUNCATION_MARKER,
    truncated: true,
  }
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

/**
 * What this file accepts as "the values".
 *
 * Deliberately the union of the two shapes this app already has:
 * `DraftValues` from the Session 8 form model (`string | string[] | {en,hi}`)
 * and `bindings(doc, lang)` from the Session 29 document model
 * (`string | string[]`). A caller holding either can pass it unchanged, which
 * is what stops the reply flow and the modify flow from needing two builders.
 */
export type InstructionValues = Record<
  string,
  string | string[] | Partial<Record<Lang, string | string[]>> | undefined
>

/** One value flattened into this language's plain text. */
function flatten(value: InstructionValues[string], lang: Lang): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((line) => line.trim()).join('\n')
  /*
    An EMPTY side falls through to the other one, exactly as `model.ts#pick`
    does. `??` would not: a bilingual value whose Hindi half is `''` is the
    ordinary state of a field an officer has filled in one language, and
    reporting it as empty would make a Hindi run ask them for something they
    have already given.
  */
  const own = flatSide(value[lang])
  return own || flatSide(value[lang === 'en' ? 'hi' : 'en'])
}

const flatSide = (side: string | string[] | undefined): string => {
  if (side === undefined) return ''
  return Array.isArray(side) ? side.filter((line) => line.trim()).join('\n') : side
}

/* ------------------------------------------------------------------ *
 * The structure list
 * ------------------------------------------------------------------ */

/**
 * What each block role is called in an instruction.
 *
 * English only, and that is not a bilingual lapse: this string is read by a
 * model, not by an officer. Everything an officer reads goes through
 * `src/i18n`, and `docs/AI.md` §6 already establishes that the prompt language
 * is a separate question from the interface language — the LANGUAGE DIRECTIVE
 * in `prompts.ts` is what tells the model which language to answer in.
 *
 * A role with no entry is skipped rather than named by its id. A structure list
 * that says "gazetteLine" teaches the model an identifier instead of a part of
 * a document.
 */
const ROLE_PARTS: Partial<Record<BlockRole, string>> = {
  urgency: 'the urgency grading, at the very top',
  fileNumber: 'the file number',
  gazetteLine: 'the gazette publication line',
  header: 'the letterhead — Ministry, Department and office',
  title: 'the form’s own title, centred',
  dateLine: 'the place and date',
  addressee: 'the addressee block',
  attention: 'the “Kind attention” line',
  subject: 'the subject line, one sentence, ending in “regarding.” or “के संबंध में।”',
  refLine: 'the reference to the communication being answered — its number and its date',
  salutation: 'the salutation',
  body: 'the body paragraphs',
  closing: 'the subscription',
  signature: 'the signature block — name, designation, telephone and e-mail',
  enclosures: 'the list of enclosures',
  copyTo: 'the copy-to list',
  endorsement: 'the endorsement',
  footer: 'the footer',
}

/**
 * The parts of this form, in the order the form prints them, once.
 *
 * Read off `template.layout.en`, so it is the real order for the real form and
 * cannot drift from what `renderOfficialDoc` will actually lay out.
 * De-duplicated because a demi-official letter places `header` and `closing`
 * twice and the instruction wants the part named once.
 */
export function structureOf(template: DocTemplate): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const block of template.layout.en) {
    const part = ROLE_PARTS[block.role]
    if (!part || seen.has(block.role)) continue
    seen.add(block.role)
    out.push(part)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The per-form notes the dataset cannot state
 * ------------------------------------------------------------------ */

/**
 * Facts about one form that no field of the template carries.
 *
 * Each one is a rule CSMOP states in prose about a particular form, which the
 * schema has no place for and which changes what a model should write. Keep
 * this list short and keep every entry citable: a note here is an assertion
 * about the Manual, and an assertion about the Manual with no paragraph behind
 * it is the thing `verify: true` exists to mark.
 */
const TEMPLATE_NOTES: Record<string, string> = {
  'office-memorandum':
    'Never address an O.M. to a constitutional or statutory authority; a letter is used for that (CSMOP 8.4(3)).',
  'demi-official':
    'A D.O. is written from one named officer to another, in the FIRST person, signed with the writer’s own name and no designation above it (CSMOP 8.4(2)).',
  noting:
    'A note on a file is written for the officer who will decide, not for the addressee of the case: state the facts, the rule, the precedent and then the precise point on which orders are sought (CSMOP 7.3).',
  'id-note':
    'An inter-departmental note asks another Department for its views and is returned on the same file; it never conveys a decision (CSMOP 8.4(6)).',
  endorsement:
    'An endorsement adds no new matter of its own — it passes a communication on, and anything the endorsing office wants to say goes in a covering paragraph above it (CSMOP 8.4(8)).',
  notification:
    'A notification is for publication in the Gazette of India and is written in the passive, impersonal register the Gazette prints; the enabling provision is quoted in the opening words.',
  circular:
    'A circular says the same thing to many addressees at once, so it names no individual and asks for nothing that would differ between them.',
  'interim-reply':
    'An interim reply says only that the matter is receiving attention and when a substantive reply may be expected. It must not anticipate the decision.',
  'rti-reply':
    'An RTI reply states the information, or the exemption relied on with the sub-clause of section 8(1) or 9, and it must always give the name and address of the First Appellate Authority and the thirty-day limit (RTI Act s.7, s.19(1)).',
  'rti-first-appeal-reply':
    'A first-appeal order is a speaking order: it records the appeal, the CPIO’s reply, the finding on each ground, and the further appeal to the Central Information Commission within ninety days (RTI Act s.19(3)).',
  'show-cause-reply':
    'A reply to a show-cause notice answers each charge separately, in the officer’s own voice, and never argues a point the notice did not raise.',
  'speaking-order':
    'A speaking order records the material considered, the submissions made and the reason for the conclusion, in that order — a conclusion with no reason behind it is the defect the form exists to prevent.',
  'sanction-order':
    'A sanction order names the authority sanctioning, the exact amount in figures and in words, the head of account and the financial year, and quotes the rule of the GFR or the delegation under which the sanction is issued.',
  reminder:
    'A reminder quotes the number and the date of the communication being reminded about and adds nothing else; the substance was in the original.',
}

/* ------------------------------------------------------------------ *
 * The instruction
 * ------------------------------------------------------------------ */

/** What the caller knows about this run that the template cannot. */
export interface InstructionContext {
  /** Which issue(s) of the document are wanted. */
  lang?: Lang | 'bilingual'
  /** What the officer asked for, in their own words. Sanitised here. */
  brief?: string
  /**
   * A change the officer asked for on an existing document — the modify flow's
   * "make para 3 firmer". Sanitised here, and stated as the LAST thing in the
   * instruction so it is what the model acts on.
   */
  instruction?: string
  /**
   * The letter being answered, reduced to what a reply has to address. Never
   * the whole letter: the intake analysis is what turns a page of text into
   * these, and passing the page as well would double what is sent.
   */
  answering?: {
    subject?: string
    reference?: string
    asks?: readonly string[]
  }
  /** Only these blocks may change. The app enforces it; this states it. */
  scopeNote?: string
  /** Extra standing lines a caller wants at the end. Sanitised. */
  extra?: readonly string[]
}

export interface BuiltInstruction {
  templateId: string
  /** The instruction itself — what goes into the request. */
  text: string
  /** The numbered "Structure:" list, exported so a test can assert on it. */
  structure: string[]
  /** Field ids whose value was cut at the cap. Shown to the officer. */
  truncatedFields: string[]
  /** Fields the template defines that carry no value yet. */
  emptyFields: string[]
}

const bullet = (lines: readonly string[]): string => lines.map((line) => `- ${line}`).join('\n')

/**
 * Build the instruction for one form.
 *
 * `values` is what the officer has so far; it is summarised rather than
 * reproduced, and every value goes through `sanitiseField`. A field that is
 * empty is named as empty rather than omitted, because "the subject is not
 * written yet" is the single most useful thing a model can be told about a
 * half-finished document.
 */
export function buildInstruction(
  template: DocTemplate,
  values: InstructionValues = {},
  context: InstructionContext = {},
): BuiltInstruction {
  const lang: Lang = context.lang === 'hi' ? 'hi' : 'en'
  const structure = structureOf(template)
  const truncatedFields: string[] = []
  const emptyFields: string[] = []

  const clean = (raw: string): string => {
    const { text } = sanitiseField(raw)
    return text
  }

  /* ---- what is already written --------------------------------- */

  const written: string[] = []
  for (const field of template.fields) {
    const flat = flatten(values[field.id], lang)
    if (!flat.trim()) {
      if (field.required) emptyFields.push(field.id)
      continue
    }
    const { text, truncated } = sanitiseField(flat)
    if (truncated) truncatedFields.push(field.id)
    written.push(`${field.id}: ${text}`)
  }
  for (const variable of template.variables ?? []) {
    const flat = flatten(values[variable.key], lang)
    if (!flat.trim()) {
      if (variable.required) emptyFields.push(variable.key)
      continue
    }
    const { text, truncated } = sanitiseField(flat)
    if (truncated) truncatedFields.push(variable.key)
    written.push(`${variable.key}: ${text}`)
  }

  /* ---- the rules of this form ----------------------------------- */

  const rules: string[] = []
  rules.push(
    template.person === 'third'
      ? 'Write in the THIRD person throughout — "the undersigned", "it is requested", never "I" or "we".'
      : 'Write in the FIRST person — this form is one named officer writing to another.',
  )
  rules.push(
    template.salutation
      ? `Open with the salutation "${template.salutation[lang] || template.salutation.en}".`
      : 'This form carries NO salutation.',
  )
  rules.push(
    template.subscription
      ? `Close with the subscription "${template.subscription[lang] || template.subscription.en}".`
      : 'This form carries NO subscription.',
  )
  rules.push(
    template.urgencyAllowed
      ? 'An urgency grading (Immediate / Priority / Top Priority — तत्काल / प्राथमिकता / परम अग्रता) may be shown at the top. Grade it only if the officer asked for one; an ungraded communication is the normal case.'
      : 'This form carries NO urgency grading.',
  )
  if (context.lang === 'bilingual') {
    rules.push('Both issues of this document are wanted. Write the English and the Hindi as equals.')
  }
  rules.push(
    'Hindi register: use the administrative Hindi of the Central Secretariat (Rajbhasha) — "कार्यालय ज्ञापन", "अवर सचिव", "एतद्द्वारा" — and not everyday or literary Hindi. Keep file numbers, section numbers and English proper names in their original form.',
  )
  rules.push(
    'Leave anything you were not told as four underscores (____). Never invent a file number, a date, an amount, a name or a designation.',
  )

  const note = TEMPLATE_NOTES[template.id]
  if (note) rules.push(note)

  /* ---- what the checklist will mark ----------------------------- */

  const musts = template.checklist
    .filter((item) => item.severity === 'must')
    .map((item) => `${item.label.en} — ${item.why.en}`)

  /* ---- assemble -------------------------------------------------- */

  const sections: string[] = []

  sections.push(
    `Form: ${template.name.en} / ${template.name.hi} (id: ${template.id}).`,
    `Used by: ${template.usedBy.en}`,
    // `edition` already reads "CSMOP 2022, sixteenth edition" on every form in
    // the library, so prefixing it again produced "CSMOP CSMOP 2022".
    `${template.csmopRef.edition}, ${template.csmopRef.paras.length === 1 ? 'paragraph' : 'paragraphs'} ${template.csmopRef.paras.join(', ')}.`,
  )
  if (template.verify) {
    sections.push(
      'CSMOP prescribes no format for this document. This form follows the format of the nearest prescribed one; say nothing that claims the Manual specifies it.',
    )
  }

  sections.push('', 'Structure:', structure.map((part, index) => `${index + 1}. ${part}`).join('\n'))
  sections.push('', 'Rules:', bullet(rules))

  if (musts.length > 0) {
    sections.push(
      '',
      'The document will be marked against this checklist, by the app, after you answer. Every item below must pass:',
      bullet(musts),
    )
  }

  if (context.answering) {
    const answering: string[] = []
    if (context.answering.subject) answering.push(`Its subject: ${clean(context.answering.subject)}`)
    if (context.answering.reference) answering.push(`Its reference: ${clean(context.answering.reference)}`)
    for (const ask of context.answering.asks ?? []) answering.push(`It asks: ${clean(ask)}`)
    if (answering.length > 0) {
      sections.push(
        '',
        'This document answers a communication that has been received. Address every point it raises:',
        bullet(answering),
      )
    }
  }

  if (written.length > 0) {
    sections.push(
      '',
      'What the officer has already written. Complete it — do not replace what is there:',
      bullet(written),
    )
  }
  if (emptyFields.length > 0) {
    sections.push('', `Still empty: ${emptyFields.join(', ')}.`)
  }

  if (context.brief?.trim()) {
    sections.push('', `The officer’s own brief: ${clean(context.brief)}`)
  }
  if (context.scopeNote) {
    sections.push('', context.scopeNote)
  }
  for (const line of context.extra ?? []) {
    if (line.trim()) sections.push('', clean(line))
  }
  if (context.instruction?.trim()) {
    sections.push('', `What to change: ${clean(context.instruction)}`)
  }

  return {
    templateId: template.id,
    text: sections.join('\n').trim(),
    structure,
    truncatedFields,
    emptyFields,
  }
}
