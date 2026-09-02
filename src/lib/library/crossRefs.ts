/**
 * Explicit cross-references from a rule book into the criminal codes.
 *
 * Deliberately NARROW. The only pattern matched is a full, unambiguous citation
 * the document itself writes out — "section 509 of the Indian Penal Code" — and
 * there are six of them across all twelve rule books (PoSH s.509 IPC four
 * times, OSA s.337 CrPC twice). A looser rule would find dozens more and most
 * of them would be wrong: "section 4" inside the CCS (Leave) Rules means Rule 4
 * of those rules, and offering it as a link to BNS 4 would be worse than
 * offering nothing.
 *
 * The result is a QUERY, not a document id, and it names the Act. ADR-029 point
 * 4 records why: `data/law`'s three codes each restart their numbering and a
 * bare number re-parses on a fresh visit as the repealed Act's section. The Law
 * Converter's own search resolves "IPC 509" correctly and shows the reader the
 * BNS provision that replaced it, which is the answer they actually want —
 * so nothing here needs `data/law/index.json` loaded to draw a link.
 */

/** How each Act names itself in the prose of a rule book. */
const ACTS: ReadonlyArray<{ pattern: RegExp; id: string }> = [
  { pattern: /Indian Penal Code/, id: 'IPC' },
  { pattern: /Code of Criminal Procedure/, id: 'CrPC' },
  { pattern: /Indian Evidence Act/, id: 'IEA' },
  { pattern: /Bharatiya Nyaya Sanhita/, id: 'BNS' },
  { pattern: /Bharatiya Nagarik Suraksha Sanhita/, id: 'BNSS' },
  { pattern: /Bharatiya Sakshya Adhiniyam/, id: 'BSA' },
]

const CITATION = new RegExp(
  String.raw`\bsections?\s+(\d{1,3}[A-Z]{0,2})\s+of\s+the\s+(` +
    ACTS.map((act) => act.pattern.source).join('|') +
    String.raw`)`,
  'gi',
)

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

  for (const match of text.matchAll(CITATION)) {
    const section = (match[1] ?? '').toUpperCase()
    const named = match[2] ?? ''
    const act = ACTS.find((candidate) => candidate.pattern.test(named))?.id
    if (!act || !section) continue
    const key = `${act}:${section}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ act, section, query: `${act} ${section}` })
  }

  return out
}
