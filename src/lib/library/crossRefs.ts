import { DEFAULT_ACTS, findReferences, type ActPattern } from './refs'

/**
 * Explicit cross-references from a rule book into the criminal codes.
 *
 * Deliberately NARROW, and unchanged in what it matches: a full, unambiguous
 * citation the document itself writes out — "section 509 of the Indian Penal
 * Code" — of which there are six across all twelve rule books (PoSH s.509 IPC
 * four times, OSA s.337 CrPC twice). A looser rule would find dozens more and
 * most of them would be wrong: "section 4" inside the CCS (Leave) Rules means
 * Rule 4 of those rules, and offering it as a link to BNS 4 would be worse than
 * offering nothing.
 *
 * WHAT CHANGED IN SESSION 27 is where the grammar lives. `src/lib/library/
 * refs.ts` reads every citation in a passage — including the ones that name no
 * Act, which the reader now renders as inline links inside this document — and
 * a second copy of "how a citation is written" would drift from it. This is a
 * FILTER over that one grammar: the citations that name a criminal code. The
 * result is still a QUERY that names the Act, for the reason ADR-029 point 4
 * records.
 */

const LAW_ACTS: readonly ActPattern[] = DEFAULT_ACTS.filter((act) => act.target === 'law')

export interface LawCrossReference {
  /** "IPC", "CrPC", "IEA", "BNS", "BNSS", "BSA". */
  act: string
  section: string
  /** What the Law Converter's search box is given. Names the Act (ADR-029). */
  query: string
}

export function lawCrossReferences(text: string): LawCrossReference[] {
  const out: LawCrossReference[] = []
  const seen = new Set<string>()

  for (const reference of findReferences(text, LAW_ACTS)) {
    if (reference.act?.target !== 'law' || reference.kind !== 'section') continue
    const act = reference.act.id
    const section = reference.number.toUpperCase()
    const key = `${act}:${section}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ act, section, query: `${act} ${section}` })
  }

  return out
}
