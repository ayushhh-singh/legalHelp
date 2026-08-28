import type { DocTemplate, TemplateField } from './schema'
import type { DraftValues, FieldValue, Lang } from '@/lib/drafting/types'

/**
 * Editing one bilingual form.
 *
 * `FieldValue` is either a plain value or an `{ en, hi }` pair, and which one
 * a field holds is the whole of this file's subject. The rule is:
 *
 * > **A field holds one shared value until the officer says the two languages
 * > differ.** Then, and only then, it becomes a pair.
 *
 * That is not a shortcut around equal bilingual footing — it is what makes
 * equal footing bearable to type. A file number, a telephone number, an e-mail
 * address and a date are the same string in both issues of a document, and a
 * form that demanded each of them twice would be a form officers abandon. A
 * subject line and a body paragraph are not the same string, so those get the
 * "different in Hindi" control and become a pair the moment it is pressed.
 *
 * The engine already reads both shapes: `valueFor` returns a plain value for
 * either language, and falls back to the other side of a pair when one is
 * missing. Nothing here teaches it anything new; it decides what the form
 * writes.
 */

export const otherLang = (lang: Lang): Lang => (lang === 'en' ? 'hi' : 'en')

/** True when the two languages have been separated for this field. */
export function isSplit(value: FieldValue | undefined): value is Partial<Record<Lang, string | string[]>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const emptyFor = (field: TemplateField): string | string[] =>
  field.type === 'list' || field.type === 'paras' ? [] : ''

/** One field's current value in one language, whichever shape it is stored in. */
export function readValue(values: DraftValues, field: TemplateField, lang: Lang): string | string[] {
  const raw = values[field.id]
  if (raw === undefined) return emptyFor(field)
  if (!isSplit(raw)) return raw
  return raw[lang] ?? raw[otherLang(lang)] ?? emptyFor(field)
}

/** The same, as text — `paras` and `list` fields edit as one box, a line each. */
export const asText = (value: string | string[]): string => (Array.isArray(value) ? value.join('\n') : value)

/**
 * Text back into the shape the field stores.
 *
 * A box with nothing in it becomes `[]`, not `['']`, and that distinction is
 * load-bearing rather than tidy. The engine's `asList` filters blank entries
 * before rendering, so the DOCUMENT was right either way — but
 * `src/lib/drafting/checklist.ts` and the engine's required-field validation
 * both read the RESOLVED value, and to them an array holding one empty string
 * is an array with something in it. Clearing the Copy-to box therefore left
 * "Copies are endorsed to everyone concerned" passing, and emptying the body
 * left its `required` issue unreported. Caught in a real browser, not here.
 *
 * Interior and trailing blanks ARE kept: `fromText` runs on every keystroke,
 * and dropping the empty line an officer just made by pressing Enter would
 * take the caret with it.
 */
export const fromText = (text: string, field: TemplateField): string | string[] => {
  if (field.type !== 'list' && field.type !== 'paras') return text
  return text.trim() === '' ? [] : text.split('\n').map((line) => line.trim())
}

/**
 * Write one field.
 *
 * A shared value is replaced wholesale whichever language tab is showing; a
 * split value has only the named side written. The returned object is new —
 * this never mutates what it was given, so React sees a change.
 */
export function setValue(
  values: DraftValues,
  field: TemplateField,
  lang: Lang,
  next: string | string[],
): DraftValues {
  const previous = values[field.id]
  if (!isSplit(previous)) return { ...values, [field.id]: next }
  return { ...values, [field.id]: { ...previous, [lang]: next } }
}

/**
 * Separate the two languages for a field, seeding both sides from what is
 * there now.
 *
 * Seeding rather than blanking is deliberate: an officer pressing "different in
 * Hindi" on a subject line wants to *edit* the English into Hindi, not to face
 * an empty box and retype the parts that were already right.
 */
export function splitField(values: DraftValues, field: TemplateField): DraftValues {
  const current = values[field.id]
  if (isSplit(current)) return values
  const shared = current ?? emptyFor(field)
  return { ...values, [field.id]: { en: shared, hi: shared } }
}

/** Collapse a pair back to one shared value — the language shown wins. */
export function mergeField(values: DraftValues, field: TemplateField, lang: Lang): DraftValues {
  const current = values[field.id]
  if (!isSplit(current)) return values
  return { ...values, [field.id]: current[lang] ?? current[otherLang(lang)] ?? emptyFor(field) }
}

/**
 * Insert text at a caret position inside a `paras` or `textarea` field.
 *
 * Used by the body toolbar. It returns the new text AND where the caret should
 * land, because a toolbar that drops a phrase in and then throws the caret to
 * the end of the document is a toolbar an officer stops using after the second
 * paragraph.
 */
export function insertAt(text: string, at: number, insert: string): { text: string; caret: number } {
  const cut = Math.max(0, Math.min(at, text.length))
  return { text: `${text.slice(0, cut)}${insert}${text.slice(cut)}`, caret: cut + insert.length }
}

/**
 * Which fields "Save as my template" must never keep.
 *
 * Anything that is the document rather than the letterhead: the body, the
 * subject, the enclosure list, the reference to the last communication, and
 * the date. Restoring last week's paragraphs into a blank form is how a wrong
 * sentence gets signed, and a stale date is how it gets signed on the wrong
 * day.
 */
export function documentFields(template: DocTemplate): string[] {
  return template.fields
    .filter(
      (field) =>
        field.type === 'paras' ||
        field.type === 'date' ||
        /^(subject|enclosures|refNumber|refDate|ref|paras|body)$/i.test(field.id),
    )
    .map((field) => field.id)
}

/**
 * What to call a draft in the recent list.
 *
 * The subject line if there is one, because that is how an officer refers to a
 * document; the form's own name otherwise. Trimmed to something that fits a
 * row rather than wrapping to three lines.
 */
export function draftTitle(template: DocTemplate, values: DraftValues, lang: Lang): string {
  const subject = template.fields.find((field) => field.id === 'subject')
  if (subject) {
    const text = asText(readValue(values, subject, lang)).trim()
    if (text) return text.length > 90 ? `${text.slice(0, 89)}…` : text
  }
  return template.name[lang]
}

/**
 * Collapse every `{ en, hi }` pair whose two sides say the same thing.
 *
 * This is what "Fill with the worked example" runs the specimen through.
 * `sampleValues` hands back a pair for EVERY field, because that is how a
 * template stores its samples — but the O.M. specimen's telephone number is
 * `011-2309 2590` on both sides, and its e-mail is `us-estt@nic.in` on both.
 * Without this, filling from the example put every one of fifteen fields into
 * two boxes and asked the officer to maintain a second copy of a phone number.
 *
 * A pair whose sides genuinely differ — the subject, the body, the file number,
 * which the specimen really does print differently in each issue — stays split,
 * because that IS the worked example and hiding half of it would defeat the
 * point of offering it.
 */
export function collapseIdentical(values: DraftValues): DraftValues {
  const out: DraftValues = {}
  for (const [id, value] of Object.entries(values)) {
    if (!isSplit(value)) {
      out[id] = value
      continue
    }
    const { en, hi } = value
    out[id] = en !== undefined && hi !== undefined && JSON.stringify(en) === JSON.stringify(hi) ? en : value
  }
  return out
}

/** Every field the template defines, blank — the state a new draft starts in. */
export function blankValues(template: DocTemplate): DraftValues {
  return Object.fromEntries(template.fields.map((field) => [field.id, emptyFor(field)]))
}
