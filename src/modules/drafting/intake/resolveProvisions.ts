import { loadCorpus } from '../../law/data'
import type { LawCode } from '../../law/types'
import { toLawHref } from '../../law/url'
import type {
  FoundProvision,
  ProvisionResolution,
  ProvisionResolver,
  ResolvedProvision,
} from '@/lib/drafting/intake'
import { resolveProvisions } from '@/lib/drafting/intake'
import type { RetrievedSnippet } from '@/lib/retrieval'

/**
 * Turning the citations a letter contains into things an officer can open.
 *
 * `src/lib/drafting/intake.ts#findProvisions` is pure and only finds the
 * citations; this file is where they meet `data/law`, which is 3.9 MB and
 * belongs behind the reply route's own lazy import. That split is the rule
 * every module in this app keeps — a pure library takes its datasets as an
 * argument — and it is why this file is in `src/modules` and that one is not.
 *
 * ### The old codes are the interesting half
 *
 * A letter about a departmental matter cites the CCS Rules; a letter about a
 * criminal matter cites the IPC, and the IPC was repealed on 1 July 2024. So
 * the resolver's job for `Section 420 of the Indian Penal Code` is not to find
 * IPC 420 — this app holds no IPC text — but to find the BNS section that
 * REPLACED it, and to hand `resolveProvisions` both, so it can state the
 * offence-date rule.
 *
 * The reverse index is already in `data/law`: every BNS/BNSS/BSA section
 * carries `mappings[].old[]` naming the IPC/CrPC/IEA sections it replaces. This
 * file walks it once and keeps the map.
 *
 * ### What it will not do
 *
 * It never invents a citation and it never guesses at an Act. A citation with
 * no Act named ("rule 18") could be a rule of any of twelve rule books, so it
 * resolves to nothing rather than to the first book that happens to have a Rule
 * 18 — the ADR-029 point 4 ambiguity, which cost the command palette a wrong
 * link before anybody noticed.
 */

/** Which old Act a citation named, if it named one this app maps. */
type OldAct = 'IPC' | 'CrPC' | 'IEA'

const OLD_ACT_PATTERNS: ReadonlyArray<{ act: OldAct; pattern: RegExp }> = [
  { act: 'IPC', pattern: /\b(?:i\.?p\.?c\.?|indian penal code)\b/i },
  { act: 'IPC', pattern: /भारतीय दंड संहिता/ },
  { act: 'CrPC', pattern: /\b(?:cr\.?\s*p\.?\s*c\.?|code of criminal procedure)\b/i },
  { act: 'CrPC', pattern: /दंड प्रक्रिया संहिता/ },
  { act: 'IEA', pattern: /\b(?:indian evidence act|evidence act)\b/i },
  { act: 'IEA', pattern: /भारतीय साक्ष्य अधिनियम/ },
]

const NEW_ACT_PATTERNS: ReadonlyArray<{ code: LawCode; pattern: RegExp }> = [
  { code: 'bns', pattern: /\b(?:b\.?n\.?s\.?|bharatiya nyaya sanhita)\b/i },
  { code: 'bns', pattern: /भारतीय न्याय संहिता/ },
  { code: 'bnss', pattern: /\b(?:b\.?n\.?s\.?s\.?|bharatiya nagarik suraksha sanhita)\b/i },
  { code: 'bnss', pattern: /भारतीय नागरिक सुरक्षा संहिता/ },
  { code: 'bsa', pattern: /\b(?:b\.?s\.?a\.?|bharatiya sakshya adhiniyam)\b/i },
  { code: 'bsa', pattern: /भारतीय साक्ष्य अधिनियम, 2023/ },
]

const NEW_ACT_LABEL: Record<LawCode, string> = { bns: 'BNS', bnss: 'BNSS', bsa: 'BSA' }

/**
 * `124` and `124A` are different sections, so the key keeps the letter suffix.
 *
 * ADR-035's `refKey()` lesson, and ADR-040's addendum found the same trap one
 * resolution further down when a digits-only key folded `18(2)` into `182`, a
 * real rule number. The sub-clause is dropped — a letter citing `318(4)` is
 * citing section 318 — and the suffix is upper-cased because a citation prints
 * it either way.
 */
export const provisionKey = (number: string): string => {
  const base = /^(\d{1,4})([A-Za-z]{0,2})/.exec(number.replace(/\s+/g, ''))
  return base ? `${base[1]}${(base[2] ?? '').toUpperCase()}` : ''
}

export interface ProvisionIndex {
  /** `IPC:420` → the new section that replaced it. */
  oldToNew: Map<string, { code: LawCode; section: string; heading: string }>
  /** `bns:318` → its heading, so a direct citation resolves too. */
  newSections: Map<string, string>
}

/**
 * Build the index once, from the corpus the Law Converter already loads.
 *
 * `loadCorpus` is memoised by `src/modules/law/data.ts`, so a reader who has
 * opened the Law Converter pays nothing here, and one who has not pays for the
 * statute only when a letter they pasted actually cites something.
 */
export async function buildProvisionIndex(): Promise<ProvisionIndex> {
  const corpus = await loadCorpus()
  const oldToNew = new Map<string, { code: LawCode; section: string; heading: string }>()
  const newSections = new Map<string, string>()

  for (const code of ['bns', 'bnss', 'bsa'] as const) {
    const dataset = corpus.datasets[code]
    if (!dataset) continue
    for (const [section, record] of Object.entries(dataset.sections)) {
      newSections.set(`${code}:${provisionKey(section)}`, record.heading.en || record.heading.hi)
      for (const mapping of record.mappings) {
        for (const old of mapping.old) {
          const key = `${old.act}:${provisionKey(old.section)}`
          // The FIRST mapping wins. A repealed section occasionally maps onto
          // more than one new one, and offering the officer a second candidate
          // in a chip would be presenting an ambiguity as a fact; the note the
          // chip carries sends them to the Law Converter, which shows all of
          // them with the offence-date rule beside each.
          if (!oldToNew.has(key)) {
            oldToNew.set(key, {
              code,
              section,
              heading: record.heading.en || record.heading.hi,
            })
          }
        }
      }
    }
  }
  return { oldToNew, newSections }
}

/** Which Act a found citation named, if any. */
function actOf(provision: FoundProvision): { old?: OldAct; code?: LawCode } {
  const haystack = `${provision.act} ${provision.text}`
  for (const { code, pattern } of NEW_ACT_PATTERNS) {
    if (pattern.test(haystack)) return { code }
  }
  for (const { act, pattern } of OLD_ACT_PATTERNS) {
    if (pattern.test(haystack)) return { old: act }
  }
  return {}
}

/**
 * A resolver over the criminal codes.
 *
 * Deliberately narrow: it resolves a citation that names one of the six Acts
 * `data/law` holds, and nothing else. Everything else resolves to `null`, which
 * the chip renders as "this app does not hold that Act" rather than as an error.
 *
 * A rule of the CCS Conduct Rules is NOT resolved, and that is a gap rather than
 * an oversight — `docs/DATA-GAPS.md` #80 has it. Doing it properly means
 * retrieval over `data/library`, and a bare "rule 18" names no book: twelve of
 * them have one, and picking the first would be the ADR-029 point 4 mistake in a
 * new place. The chip still SHOWS the citation the letter made, which is the
 * half that matters for drafting a reply.
 */
export function lawResolver(index: ProvisionIndex): ProvisionResolver {
  return (provision) => {
    if (provision.unit !== 'section') return null
    const key = provisionKey(provision.number)
    if (!key) return null
    const { old, code } = actOf(provision)

    if (old) {
      const replacement = index.oldToNew.get(`${old}:${key}`)
      if (!replacement) return null
      const label = NEW_ACT_LABEL[replacement.code]
      return {
        citation: `${old} ${provision.number}`,
        // The old citation opens a SEARCH naming the Act, never a document id:
        // there is no document for "IPC 420" — the converter's answer to it IS
        // the new section — and `bns:420` is a real and different offence
        // (ADR-029 point 4).
        href: toLawHref({ query: `${old} ${provision.number}` }),
        replacedBy: {
          citation: `${label} ${replacement.section}`,
          href: toLawHref({ query: `${label} ${replacement.section}` }),
        },
      }
    }

    if (code && index.newSections.has(`${code}:${key}`)) {
      const label = NEW_ACT_LABEL[code]
      return {
        citation: `${label} ${provision.number}`,
        href: toLawHref({ query: `${label} ${provision.number}` }),
      }
    }
    return null
  }
}

/**
 * The whole resolution, with the offence-date rule applied.
 *
 * `offenceDateIso` is almost always empty for an inbound letter, and that is
 * the case the rule is written for: it says which Sanhita applies only when it
 * has been told when the thing happened, and says plainly that it has not been
 * told otherwise. Choosing an era silently is how an officer cites the wrong
 * Sanhita in something they sign.
 */
export async function resolveIntakeProvisions(
  provisions: readonly FoundProvision[],
  offenceDateIso = '',
): Promise<ResolvedProvision[]> {
  if (provisions.length === 0) return []
  const index = await buildProvisionIndex()
  return resolveProvisions(provisions, lawResolver(index), offenceDateIso)
}

/**
 * The resolved provisions, as snippets the intake agent may cite.
 *
 * A snippet is built only for a provision that RESOLVED, because the rule the
 * agent runs under is that a cited provision must be backed by one of these —
 * so an unresolved citation is one the analysis simply may not talk about.
 * That is the right direction: this app has no text for a citation it could not
 * resolve, and a model asked to explain the relevance of a provision it has
 * never seen would be writing from memory.
 */
export function provisionSnippets(resolved: readonly ResolvedProvision[]): RetrievedSnippet[] {
  const out: RetrievedSnippet[] = []
  resolved.forEach((provision, index) => {
    const resolution: ProvisionResolution | null = provision.resolution
    if (!resolution) return
    const target = resolution.replacedBy ?? resolution
    out.push({
      id: `p${index + 1}`,
      kind: 'section',
      citation: target.citation,
      heading: '',
      // The text is what the LETTER said, not what the provision says: this app
      // is telling the model which provision the letter cited, and the statute
      // itself is a click away in the Law Converter. Putting the section text
      // here would be sending several kilobytes of public statute to a provider
      // to answer a question about a letter.
      text: `The letter cites ${provision.text}.${resolution.replacedBy ? ` This app maps it to ${resolution.replacedBy.citation}.` : ''}`,
      href: target.href,
      sourceUrl: null,
      personal: false,
      score: 1,
      reason: 'number',
    })
  })
  return out
}
