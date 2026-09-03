/**
 * The acceptance set for `src/lib/retrieval.ts` — forty queries with the answer
 * written beside each.
 *
 * This file is the SPECIFICATION, not a convenience. `tests/fixtures/law-search.ts`
 * plays the same role for the Law Converter's ranking table, and the reason is
 * recorded there: a ranking is a set of claims about the corpus, and the only
 * way to change one deliberately is to have the claims in front of you.
 *
 * Each row says what a reader typed and what must come back. `expectId` is a
 * document that MUST appear in the results; `topKind` is what the first result
 * must be. A row states one or the other or both — a query like "leave" has no
 * single right answer and it would be dishonest to assert one.
 *
 * The document ids are the ones `src/modules/library/retrievalDocs.ts` builds:
 * `rule:<work>:<unit>`, `section:<work>:<unit>`, `aid:<aid id>`,
 * `glossary:<term id>`, `definition:<work>:<term>`, `note:<row id>`.
 */

import type { RetrievalScope, SnippetKind } from '@/lib/retrieval'

export interface RetrievalCase {
  /** What the officer typed. */
  query: string
  /** Why this case is in the set. Read when one of them starts failing. */
  why: string
  scope?: RetrievalScope
  /** A document that must be somewhere in the results. */
  expectId?: string
  /** What the FIRST result must be. */
  topId?: string
  topKind?: SnippetKind
  /** A document that must NOT come back. */
  rejectId?: string
  k?: number
}

export const RETRIEVAL_CASES: readonly RetrievalCase[] = [
  // --- bare numbers: the most direct thing a reader can type -----------------
  {
    query: '18',
    why: 'A bare rule number reaches the rules NUMBERED 18, above the dozen whose text merely mentions one. WHICH work comes first is not asserted and must not be: seven rule books each have a Rule 18, and an index across all of them has no right answer to a bare number — the ambiguity ADR-029 point 4 records for the command palette, in a second place. The order among them is by id, deterministically.',
    topKind: 'rule',
    expectId: 'rule:ccs-conduct:ccs-conduct-18',
    k: 20,
  },
  {
    query: '3C',
    why: 'A letter suffix is part of the number: 3C is sexual harassment, 3 is the general duties rule.',
    topId: 'rule:ccs-conduct:ccs-conduct-3c',
  },
  {
    query: '3',
    why: 'And a bare number must never be answered by its own suffixed sibling: 3C is a different rule from 3.',
    expectId: 'rule:ccs-conduct:ccs-conduct-3',
    rejectId: 'rule:ccs-conduct:ccs-conduct-3c',
    k: 20,
  },
  {
    query: 'Rule 18',
    why: 'The written form reaches the same set as the bare number.',
    topKind: 'rule',
    expectId: 'rule:ccs-conduct:ccs-conduct-18',
    k: 20,
  },
  {
    query: 'rule 18(2)',
    why: 'A sub-section resolves to the rule that stores it: the corpus keeps Rule 18 whole.',
    expectId: 'rule:ccs-conduct:ccs-conduct-18',
  },
  {
    query: 'नियम 18',
    why: 'The Devanagari unit word has no \\b to anchor it — the ADR-035 trap, in this file.',
    expectId: 'rule:ccs-conduct:ccs-conduct-18',
  },
  {
    query: 'धारा 8',
    why: 'The Devanagari word for section, over a corpus whose units are indexed as rules.',
    scope: 'rules',
    expectId: 'rule:rti:rti-8',
  },
  {
    query: '१८',
    why: 'Devanagari digits fold to ASCII before anything is compared.',
    expectId: 'rule:ccs-conduct:ccs-conduct-18',
  },
  {
    query: 'section 20',
    why: 'The RTI penalty section, by its English unit word.',
    expectId: 'rule:rti:rti-20',
  },
  {
    query: '4.7',
    why: 'A CSMOP paragraph number carries a dot and must survive the number key.',
    expectId: 'rule:csmop:csmop-4-7',
  },

  // --- headings and citations -----------------------------------------------
  {
    query: 'Gifts',
    why: 'A heading that is one word must beat every rule whose text mentions a gift.',
    topId: 'rule:ccs-conduct:ccs-conduct-13',
  },
  {
    query: 'Dowry',
    why: 'A heading match, and the only rule in the book about it.',
    topId: 'rule:ccs-conduct:ccs-conduct-13a',
  },
  {
    query: 'Suspension',
    why: 'The CCA rule whose heading is the word, above the appeal rules that discuss it.',
    topId: 'rule:ccs-cca:ccs-cca-10',
  },
  {
    query: 'Penalties',
    why: 'Rule 11 of the CCA rules is the list of penalties; everything else refers to it.',
    topId: 'rule:ccs-cca:ccs-cca-11',
  },
  {
    query: 'Maternity Leave',
    why: 'A two-word heading in the Leave rules.',
    topId: 'rule:ccs-leave:ccs-leave-43',
  },
  {
    query: 'Child Care Leave',
    why: 'And the one next to it, which shares two of its three words.',
    topId: 'rule:ccs-leave:ccs-leave-43c',
  },
  {
    query: 'Extraordinary leave',
    why: 'Rule 32, above Rule 25 which debits absence to it.',
    topId: 'rule:ccs-leave:ccs-leave-32',
  },
  {
    query: 'Commuted leave',
    why: 'Rule 30, above Rule 10 (commutation of one kind into another), which is a different thing.',
    topId: 'rule:ccs-leave:ccs-leave-30',
  },
  {
    query: 'Prohibition of sexual harassment of working women',
    why: 'A whole heading, typed out. The exact-citation weight is what should carry this.',
    topId: 'rule:ccs-conduct:ccs-conduct-3c',
  },
  {
    query: 'Interpretation',
    why: 'A heading three of these books share — a case with no single right answer, so only the kind is asserted.',
    topKind: 'rule',
  },

  // --- body text ------------------------------------------------------------
  {
    query: 'habitual indebtedness',
    why: 'A phrase that appears in exactly one rule heading and in its own text.',
    topId: 'rule:ccs-conduct:ccs-conduct-17',
  },
  {
    query: 'absolute integrity',
    why: 'The first limb of Rule 3, findable from the body when nobody remembers the number.',
    expectId: 'rule:ccs-conduct:ccs-conduct-3',
  },
  {
    query: 'forty-eight hours',
    why: 'The deemed-suspension threshold, in the body of CCA Rule 10.',
    expectId: 'rule:ccs-cca:ccs-cca-10',
  },
  {
    query: 'two hundred and fifty rupees',
    why: 'The RTI penalty rate, spelt out in words in the Act.',
    expectId: 'rule:rti:rti-20',
  },
  {
    query: 'deemed to have resigned',
    why: 'The five-year absence consequence in Leave Rule 12.',
    expectId: 'rule:ccs-leave:ccs-leave-12',
  },
  {
    query: 'Green Sheet',
    why: 'CSMOP 7.2, and the phrase every noting instruction turns on.',
    expectId: 'rule:csmop:csmop-7-2',
  },
  {
    query: 'speed with accuracy',
    why: 'The manual’s own phrase, in CSMOP 5.10.',
    expectId: 'rule:csmop:csmop-5-10',
  },
  {
    query: 'prohibited place',
    why: 'The Official Secrets Act’s hinge definition — buried in a 3,700-character body, so it is asserted within the rules scope rather than against the glossary term of the same name.',
    scope: 'rules',
    expectId: 'rule:osa:osa-2',
  },

  // --- Hindi and roman-Hindi ------------------------------------------------
  {
    query: 'आचरण',
    why: 'A Devanagari query reaches the Hindi half of a citation, which every unit carries. Scoped to rules: "Conduct / आचरण" is a defensible top hit for the unscoped query and asserting otherwise would be an over-claim.',
    scope: 'rules',
    topKind: 'rule',
  },
  {
    query: 'avar sachiv',
    why: 'Roman-Hindi for Under Secretary reaches the glossary through the folded Latin skeleton.',
    scope: 'glossary',
    topKind: 'glossary',
  },
  {
    query: 'karyalay',
    why: 'And roman-Hindi for office, the same way.',
    scope: 'glossary',
    topKind: 'glossary',
  },

  // --- the study aids -------------------------------------------------------
  {
    query: 'knowledge of the prescribed authority',
    why: 'The knowledge-versus-sanction distinction lives in the Rule 18 aid, not in the rule’s heading.',
    expectId: 'aid:ccs-conduct:ccs-conduct-18',
  },
  {
    query: 'deemed permission after three months',
    why: 'A phrase that exists only in an aid — proof the aids are actually in the index.',
    expectId: 'aid:ccs-conduct:ccs-conduct-19',
  },
  {
    query: 'Report in 10, act in 60',
    why: 'A mnemonic, which is an aid-only field.',
    expectId: 'aid:posh:posh-13',
  },

  // --- scope ----------------------------------------------------------------
  {
    query: 'gift',
    why: 'Scoped to the glossary, a rule must not come back however well it matches.',
    scope: 'glossary',
    rejectId: 'rule:ccs-conduct:ccs-conduct-13',
  },
  {
    query: 'integrity',
    why: 'Scoped to rules, a glossary term must not come back.',
    scope: 'rules',
    topKind: 'rule',
  },
  {
    query: 'my own words on rule 3',
    why: 'The reader’s own note, reachable only in the personal scope.',
    scope: 'personal',
    topKind: 'note',
  },
  {
    query: 'my own words on rule 3',
    why: 'And the same note is in scope for `all`. k is raised because "rule 3" is an exact number across seven works, and seven rules legitimately outrank a note that merely mentions it.',
    scope: 'all',
    k: 20,
    expectId: 'note:test-note-1',
  },

  // --- nothing, and near-nothing --------------------------------------------
  {
    query: 'zzzzqqqq',
    why: 'A query that matches nothing must return nothing rather than the whole corpus at a low score.',
    k: 5,
  },
  {
    query: 'a',
    why: 'One letter of prose is refused before the index is touched.',
  },
]
