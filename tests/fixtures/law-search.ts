/**
 * The search acceptance set: 50 queries an officer would actually type, and
 * what each one has to return.
 *
 * The set is the specification. Ranking here is a pile of judgement calls —
 * a heading is worth more than a keyword, a repealed heading less than the
 * section's own, an exact section number beats everything (see `SCORE` in
 * `src/lib/search.ts`) — and the only honest way to hold those judgements still
 * is a list of queries with the answer written down beside them. Every entry
 * below was checked against the committed `data/law/*.json` by hand.
 *
 * Four scripts are represented deliberately, because the module's promise is
 * that none of them is a second-class way in:
 *
 *   - section numbers, with and without an Act name and the "u/s" noise
 *   - English words
 *   - Devanagari words
 *   - roman-Hindi ("hatya", "chori", "jamanat")
 *
 * `top` is what must be FIRST. `within` is what must appear in the first N.
 * Ranking is judgement, so pinning a whole ordered list would make this a
 * change-detector; pinning the first result and the presence of the rest is the
 * part that is actually a requirement.
 */

export interface SearchCase {
  /** What the reader types. */
  query: string
  /** The one result that must be first, as `"<ACT> <section>"`. */
  top: string
  /** Results that must appear somewhere in the first `withinN`. */
  within?: string[]
  withinN?: number
  /** Repealed provisions the new Act dropped, as `"<ACT> <section>"`. */
  dropped?: string[]
  /** Notes for a reader of this file; never asserted. */
  why?: string
}

export const SEARCH_CASES: readonly SearchCase[] = [
  /* ---- Section numbers, the reader's own vocabulary ------------------ */
  {
    query: '302',
    top: 'BNS 103',
    within: ['BNS 302'],
    withinN: 5,
    why: 'The number-swap trap: 302 is now 103, and BNS 302 is a different offence that exists.',
  },
  { query: '420', top: 'BNS 318', why: 'IPC 415/417/418/420 consolidated into BNS 318.' },
  { query: '498a', top: 'BNS 85', within: ['BNS 86'], withinN: 3 },
  { query: '376', top: 'BNS 64', within: ['BNS 65'], withinN: 4 },
  { query: '124a', top: 'BNS 152', why: 'Sedition is repealed; BNS 152 is a differently worded offence.' },
  { query: '34', top: 'BNS 3' },
  { query: '120b', top: 'BNS 61' },
  { query: '304b', top: 'BNS 80' },
  { query: '65b', top: 'BSA 63', why: 'The electronic-evidence certificate every officer calls "65B".' },
  { query: '161', top: 'BNSS 180' },

  /* ---- Section numbers with an Act named ------------------------------ */
  { query: 'sec 438 crpc', top: 'BNSS 482', why: 'Anticipatory bail. CrPC 438 and 482 swapped places.' },
  { query: 'crpc 482', top: 'BNSS 528', why: "The High Court's inherent powers." },
  { query: 'u/s 302', top: 'BNS 103' },
  { query: 'section 154 crpc', top: 'BNSS 173' },
  { query: 'ipc 376', top: 'BNS 64' },
  { query: 'bns 103', top: 'BNS 103' },
  { query: 'bnss 187', top: 'BNSS 187' },
  { query: 'bsa 63', top: 'BSA 63' },
  { query: 'crpc 41a', top: 'BNSS 35' },
  { query: 'आईपीसी 302', top: 'BNS 103', why: 'The Act named in Devanagari.' },
  { query: 'धारा 173 bnss', top: 'BNSS 173' },

  /* ---- English ------------------------------------------------------- */
  { query: 'murder', top: 'BNS 101', within: ['BNS 103'], withinN: 4 },
  { query: 'theft', top: 'BNS 303' },
  { query: 'cheating', top: 'BNS 318' },
  { query: 'robbery', top: 'BNS 309' },
  { query: 'dacoity', top: 'BNS 310' },
  { query: 'extortion', top: 'BNS 308' },
  { query: 'forgery', top: 'BNS 336' },
  { query: 'snatching', top: 'BNS 304', why: 'A named offence for the first time in the BNS.' },
  { query: 'organised crime', top: 'BNS 111' },
  { query: 'anticipatory bail', top: 'BNSS 482' },
  { query: 'community service', top: 'BNS 4' },
  { query: 'kidnapping', top: 'BNS 137' },
  { query: 'dowry death', top: 'BNS 80' },

  /* ---- Devanagari ---------------------------------------------------- */
  { query: 'हत्या', top: 'BNS 101', within: ['BNS 103'], withinN: 4 },
  { query: 'चोरी', top: 'BNS 303' },
  { query: 'धोखा', top: 'BNS 318' },
  { query: 'लूट', top: 'BNS 309' },
  { query: 'डकैती', top: 'BNS 310' },
  { query: 'उद्दापन', top: 'BNS 308' },
  {
    query: 'जमानत',
    top: 'BNSS 478',
    within: ['BNSS 492'],
    withinN: 5,
    why:
      'Session 20 authored a curated Hindi heading for BNSS 478 ("किन मामलों में जमानत ली ' +
      'जाएगी" — "in what cases bail is to be taken"), which contains the query term directly. A ' +
      'heading match outranks the lexicon match that used to carry BNSS 492 to the top when no ' +
      'bail heading contained this word at all — and 478 (bail eligibility) is the more central ' +
      'section for a bare "bail" query than 492 (cancellation of a bail bond) in any case.',
  },
  { query: 'गिरफ्तारी', top: 'BNSS 41' },
  { query: 'दहेज', top: 'BNS 80' },
  { query: 'आत्महत्या', top: 'BNS 108' },
  { query: 'कूटरचना', top: 'BNS 336' },

  /* ---- Roman-Hindi --------------------------------------------------- */
  { query: 'hatya', top: 'BNS 101', within: ['BNS 103'], withinN: 4 },
  { query: 'chori', top: 'BNS 303' },
  {
    query: 'dhokha',
    top: 'BNS 318',
    why: 'A prefix of the lexicon term "dhokhadhadi", then translated to "cheating".',
  },
  { query: 'loot', top: 'BNS 309', why: 'Folds to "lut", which is the lexicon spelling.' },
  { query: 'dakaiti', top: 'BNS 310' },
  { query: 'jamanat', top: 'BNSS 478', within: ['BNSS 492'], withinN: 5 },
  { query: 'apharan', top: 'BNS 137' },
  { query: 'balatsang', top: 'BNS 63' },
]

/**
 * Provisions the new Act dropped outright. Searching for the number OR the
 * words must say so — returning a page of near misses instead is the single
 * worst failure this module can have, because it reads as "found it".
 */
export const DROPPED_CASES: readonly SearchCase[] = [
  { query: 'ipc 309', top: '', dropped: ['IPC 309'], why: 'Attempt to commit suicide.' },
  { query: 'ipc 377', top: '', dropped: ['IPC 377'] },
  { query: 'ipc 497', top: '', dropped: ['IPC 497'], why: 'Adultery.' },
  { query: 'adultery', top: '', dropped: ['IPC 497'], why: 'By its words, not its number.' },
  { query: 'attempt to commit suicide', top: '', dropped: ['IPC 309'] },
]
