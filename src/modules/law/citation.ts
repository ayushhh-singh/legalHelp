import type { Bilingual, LawSection, NewActId, OldActId } from './types'

import type { Language } from '@/i18n'

/**
 * Citations, in the form they are actually written into a file.
 *
 * A citation is the one thing a reader copies out of this app and puts into a
 * document somebody else will act on, so the wording is fixed here and tested,
 * not assembled at the call site. Two rules it has to keep:
 *
 *  - **The sub-section travels with the section.** BNS 318 has four
 *    sub-sections that differ on punishment, cognizability and bail; "Section
 *    318" is not a citation, "Section 318(4)" is.
 *  - **The old number is named, not implied.** An officer reading the file may
 *    only know "302", and the whole point of the correspondence is to let both
 *    numbers appear together.
 */

/**
 * The abbreviations used inside a citation's parenthesis. The Hindi forms are
 * the ones the Sanhitas and the Rajbhasha drafting convention use — full stops
 * between the syllables, not spaces.
 */
export const ACT_SHORT: Readonly<Record<NewActId | OldActId, Bilingual>> = {
  BNS: { en: 'BNS', hi: 'भा.न्या.सं.' },
  BNSS: { en: 'BNSS', hi: 'भा.ना.सु.सं.' },
  BSA: { en: 'BSA', hi: 'भा.सा.अ.' },
  IPC: { en: 'IPC', hi: 'भा.दं.सं.' },
  CrPC: { en: 'CrPC', hi: 'दं.प्र.सं.' },
  IEA: { en: 'IEA', hi: 'भा.सा.अ., 1872' },
}

export interface CitationInput {
  /** Full act name in both languages, from the dataset — never hard-coded. */
  actName: Bilingual
  /** `"103"` or `"103(1)"`. */
  section: string
  /** The repealed-Act provisions this one corresponds to, if any. */
  corresponding?: ReadonlyArray<{ act: OldActId; section: string }>
}

/**
 * `"Section 103(1) of the Bharatiya Nyaya Sanhita, 2023 (corresponding to
 * Section 302 IPC)"`, and its Hindi equivalent.
 *
 * Hindi puts the Act first and the section second — `"भारतीय न्याय संहिता, 2023
 * की धारा 103(1)"` — which is the order the Sanhitas themselves use. It is not
 * the English sentence with the words swapped.
 */
export function formatCitation(input: CitationInput, language: Language): string {
  const { actName, section, corresponding = [] } = input

  const olds = corresponding.filter((ref) => ref.section.trim().length > 0)

  if (language === 'hi') {
    const base = `${actName.hi} की धारा ${section}`
    if (olds.length === 0) return base
    const refs = olds.map((ref) => `${ACT_SHORT[ref.act].hi} की धारा ${ref.section}`).join(' तथा ')
    return `${base} (${refs} के तत्स्थानी)`
  }

  const base = `Section ${section} of the ${actName.en}`
  if (olds.length === 0) return base
  const refs = olds.map((ref) => `Section ${ref.section} ${ACT_SHORT[ref.act].en}`).join(' and ')
  return `${base} (corresponding to ${refs})`
}

/**
 * The repealed-Act provisions a section record corresponds to, de-duplicated
 * and in the order the dataset lists them.
 *
 * `mappings[].old[]` carries the sub-section-level reference (`"415"`,
 * `"420"`), which is what belongs in a citation; `repeals` is the coarser
 * section-level list and is only used when a mapping carries nothing.
 */
export function correspondingRefs(record: LawSection): Array<{ act: OldActId; section: string }> {
  const seen = new Set<string>()
  const out: Array<{ act: OldActId; section: string }> = []

  for (const mapping of record.mappings) {
    for (const old of mapping.old) {
      const key = `${old.act}:${old.section}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ act: old.act, section: old.section })
    }
  }

  return out
}

/**
 * The clause to cite for a given sub-section, or the section itself.
 *
 * Passing `"103(2)"` cites the sub-section; passing `"103"` cites the section.
 * The caller decides, because which is right depends on what the reader clicked.
 */
export function citationFor(
  record: LawSection,
  actName: Bilingual,
  language: Language,
  clause?: string,
): string {
  const section = clause?.trim() || record.section
  // A citation of one sub-section should name only the provisions that
  // sub-section replaced, not everything the whole section absorbed.
  const mapping = record.mappings.find((entry) => entry.clause === section)
  const corresponding = mapping
    ? mapping.old.map((old) => ({ act: old.act, section: old.section }))
    : correspondingRefs(record)

  return formatCitation({ actName, section, corresponding }, language)
}

/**
 * The shareable form: the citation, the heading, and where it came from.
 *
 * `navigator.share` and the clipboard both take plain text, and this is the one
 * place the disclaimer has to travel with the content — a citation pasted into
 * a chat loses every piece of UI around it.
 */
export function shareText(
  record: LawSection,
  actName: Bilingual,
  disclaimer: Bilingual,
  language: Language,
  clause?: string,
): string {
  const heading = record.heading[language] || record.heading.en
  return [citationFor(record, actName, language, clause), heading, `— ${disclaimer[language]}`]
    .filter(Boolean)
    .join('\n')
}
