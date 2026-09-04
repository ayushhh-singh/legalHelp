import { describe, expect, it } from 'vitest'

import {
  analyseIntake,
  deadlineIn,
  eraOf,
  findAsks,
  findEnclosures,
  findProvisions,
  findUrgency,
  MAX_ASKS,
  periodIn,
  resolveProvisions,
  sentencesOf,
  type FoundProvision,
} from './intake'

/**
 * The deterministic intake pass, over the eight letters the session brief names.
 *
 * They are fixtures rather than a corpus, and they are written to be the eight
 * shapes an office actually receives: an English O.M., a Hindi O.M., one with
 * no reference number, one carrying two dates, one citing a repealed IPC
 * section, one making three separate requests, a forwarded letter, and one with
 * an enclosure list. Each is checked for the thing it exists to check.
 *
 * The letters are in `tests/fixtures/drafting/intake.ts` so the Playwright spec
 * can paste the same bytes an assertion here was written against — a fixture
 * that exists twice is a fixture the two halves can disagree about.
 */
import { INTAKE_LETTERS } from '../../../tests/fixtures/drafting/intake'

const letter = (id: keyof typeof INTAKE_LETTERS): string => INTAKE_LETTERS[id]

describe('the English O.M.', () => {
  const analysis = analyseIntake(letter('englishOm'))

  it('reads its number, date and subject', () => {
    expect(analysis.meta.number).toBe('A-11011/4/2026-Estt.(Allowances)')
    expect(analysis.meta.confidence.number).toBe('high')
    expect(analysis.letterDate).toBe('2026-08-12')
    expect(analysis.meta.subject).toMatch(/Children Education Allowance/)
  })

  it('reads the addressee block', () => {
    expect(analysis.meta.to[0]).toMatch(/Under Secretary/)
  })

  it('finds the one thing it asks for', () => {
    expect(analysis.asks).toHaveLength(1)
    expect(analysis.asks[0]?.text).toMatch(/may kindly be furnished/i)
  })
})

describe('the Hindi O.M.', () => {
  const analysis = analyseIntake(letter('hindiOm'))

  it('reads a Devanagari subject and a Devanagari date', () => {
    expect(analysis.meta.subject).toMatch(/अवकाश/)
    expect(analysis.letterDate).toBe('2026-07-30')
  })

  it('finds the request written as कृपया', () => {
    expect(analysis.asks.length).toBeGreaterThan(0)
    expect(analysis.asks.some((ask) => /कृपया/.test(ask.text))).toBe(true)
  })

  it('reads the Hindi urgency grading the Manual actually prints', () => {
    // CSMOP 2022's own Hindi for Top Priority is परम अग्रता, not the
    // सर्वोच्च अग्रता everyone expects (CLAUDE.md records the discovery).
    // A letter that arrives may use either, so both are matched.
    expect(analysis.urgency).toBe('topPriority')
  })
})

describe('a letter with no reference number', () => {
  const analysis = analyseIntake(letter('noNumber'))

  it('says so rather than inventing one', () => {
    expect(analysis.meta.number).toBe('')
    expect(analysis.meta.confidence.number).toBe('none')
  })

  it('still reads everything else', () => {
    expect(analysis.meta.subject).toMatch(/transfer/i)
    expect(analysis.letterDate).toBe('2026-09-01')
  })
})

describe('a letter carrying two dates', () => {
  const analysis = analyseIntake(letter('twoDates'))

  it('takes the labelled one as the letter date', () => {
    expect(analysis.letterDate).toBe('2026-08-20')
    expect(analysis.meta.confidence.date).toBe('high')
  })

  it('takes the receipt stamp as the receipt date, separately', () => {
    expect(analysis.receiptDate).toBe('2026-08-27')
    expect(analysis.receiptDateConfidence).toBe('high')
    expect(analysis.diaryNumber).toBe('4417')
  })

  it('never guesses a receipt date when the letter carries no stamp', () => {
    // The single most tempting inference in this file, and the one that would
    // be wrong most often: an officer's follow-up is counted from the day the
    // paper reached them, and the letter date is frequently a week earlier.
    expect(analyseIntake(letter('englishOm')).receiptDate).toBe('')
    expect(analyseIntake(letter('englishOm')).receiptDateConfidence).toBe('none')
  })
})

describe('a letter citing a repealed section', () => {
  const analysis = analyseIntake(letter('citesIpc'))

  it('finds the citation with its Act', () => {
    const ipc = analysis.provisions.find((provision) => provision.number === '420')
    expect(ipc).toBeDefined()
    expect(ipc?.unit).toBe('section')
    expect(ipc?.act).toMatch(/Indian Penal Code/)
  })

  it('keeps a sub-section whole', () => {
    // ADR-035's refKey lesson: 124 and 124A are different sections and
    // 318(4) is not 318 followed by 4.
    const found = findProvisions('Section 318(4) of the Bharatiya Nyaya Sanhita, 2023 applies.')
    expect(found[0]?.number).toBe('318(4)')
  })

  it('keeps a letter suffix', () => {
    expect(findProvisions('section 65B of the Evidence Act')[0]?.number).toBe('65B')
    expect(findProvisions('section 124A of the IPC')[0]?.number).toBe('124A')
  })

  it('finds a rule cited in Devanagari', () => {
    // The trap this file is built to avoid: `\b` does not exist between a
    // space and a Devanagari letter, and `नियमों?` never matches the singular.
    const found = findProvisions('सीसीएस (आचरण) नियम, 1964 के नियम 18 के अंतर्गत सूचना अपेक्षित है।')
    expect(found.map((provision) => provision.number)).toContain('18')
    expect(found[0]?.unit).toBe('rule')
  })

  it('finds a Devanagari section and a Devanagari plural', () => {
    expect(findProvisions('धारा 302 के अधीन').map((each) => each.number)).toEqual(['302'])
    expect(findProvisions('नियमों 3 और 11 का उल्लंघन').map((each) => each.number)).toContain('3')
  })
})

describe('the offence-date rule', () => {
  const found: FoundProvision = {
    text: 'Section 420 of the Indian Penal Code',
    unit: 'section',
    number: '420',
    act: 'Indian Penal Code, 1860',
  }
  const resolver = () => ({
    citation: 'IPC 420',
    href: '/law?q=IPC%20420',
    replacedBy: { citation: 'BNS 318(4)', href: '/law?q=BNS%20318' },
  })

  it('reads the boundary', () => {
    expect(eraOf('2024-06-30')).toBe('old')
    expect(eraOf('2024-07-01')).toBe('new')
    expect(eraOf('')).toBe('unknown')
    expect(eraOf('not a date')).toBe('unknown')
  })

  it('keeps the old section for an offence before 1 July 2024', () => {
    const [resolved] = resolveProvisions([found], resolver, '2024-03-04')
    expect(resolved?.note?.en).toMatch(/IPC 420 still governs/)
    expect(resolved?.note?.hi).toMatch(/IPC 420 ही लागू रहेगी/)
  })

  it('takes the new one for an offence on or after it', () => {
    const [resolved] = resolveProvisions([found], resolver, '2024-07-01')
    expect(resolved?.note?.en).toMatch(/BNS 318\(4\) governs/)
  })

  it('refuses to choose when no offence date was given', () => {
    // The important case, and the one an inbound letter almost always is.
    const [resolved] = resolveProvisions([found], resolver)
    expect(resolved?.note?.en).toMatch(/turns on the date of the offence/)
    expect(resolved?.note?.en).not.toMatch(/still governs|BNS 318\(4\) governs/)
  })

  it('says nothing at all about a provision that was never repealed', () => {
    const [resolved] = resolveProvisions([found], () => ({ citation: 'BNS 318', href: '/law' }))
    expect(resolved?.note).toBeNull()
  })

  it('reports a citation this app does not hold as unresolved, not as wrong', () => {
    const [resolved] = resolveProvisions([found], () => null)
    expect(resolved?.resolution).toBeNull()
    expect(resolved?.note).toBeNull()
  })
})

describe('a letter making three separate asks', () => {
  const analysis = analyseIntake(letter('threeAsks'))

  it('finds all three, in the letter’s own order', () => {
    expect(analysis.asks).toHaveLength(3)
    expect(analysis.asks.map((ask) => ask.index)).toEqual(
      [...analysis.asks].map((ask) => ask.index).sort((a, b) => a - b),
    )
  })

  it('marks the one carrying a date as a deadline', () => {
    const deadline = analysis.asks.find((ask) => ask.kind === 'deadline')
    expect(deadline?.deadline).toBe('2026-09-30')
  })

  it('does not mistake a statement about the past for a request', () => {
    // "the information furnished by your office" is not an ask, and a scan for
    // the verb rather than the request formula finds thirty of them.
    expect(findAsks('The information furnished by your office has been examined.')).toEqual([])
  })
})

describe('a forwarded letter', () => {
  const analysis = analyseIntake(letter('forwarded'))

  it('takes the forwarding office’s own number, not the one it quotes', () => {
    expect(analysis.meta.number).toBe('B-12013/1/2026-Vig.')
  })

  it('lists every number on the page, its own first', () => {
    expect(analysis.references[0]).toBe('B-12013/1/2026-Vig.')
    expect(analysis.references).toContain('A-11011/4/2026-Estt.(Allowances)')
  })
})

describe('a letter with an enclosure list', () => {
  const analysis = analyseIntake(letter('withEnclosures'))

  it('believes the stated count over the list', () => {
    expect(analysis.enclosures.count).toBe(3)
    expect(analysis.enclosures.confidence).toBe('high')
  })

  it('keeps the listed items too', () => {
    expect(analysis.enclosures.items.length).toBeGreaterThan(0)
  })

  it('counts a bare "as above" as one rather than none', () => {
    // Zero would be a claim the letter does not make. There IS an enclosure
    // line, so there is at least one enclosure, and the confidence says the
    // number is not to be relied on.
    const bare = findEnclosures('Encl.: as above\n\nYours faithfully,')
    expect(bare.count).toBe(1)
    expect(bare.confidence).toBe('low')
  })

  it('finds nothing when there is no enclosure line', () => {
    expect(findEnclosures('Yours faithfully,\n(A.B.C.)').count).toBe(0)
    expect(findEnclosures('Yours faithfully,').confidence).toBe('none')
  })

  it('reads a Devanagari enclosure line', () => {
    expect(findEnclosures('संलग्न: 2\n').count).toBe(2)
  })
})

describe('urgency', () => {
  it('reads the three gradings in both languages', () => {
    expect(findUrgency('MOST IMMEDIATE\nF.No. 1/2/2026')).toBe('immediate')
    expect(findUrgency('तत्काल\nसंख्या 1/2/2026')).toBe('immediate')
    expect(findUrgency('PRIORITY\nF.No. 1/2/2026')).toBe('priority')
    expect(findUrgency('परम अग्रता\nसंख्या 1/2/2026')).toBe('topPriority')
  })

  it('reads Top Priority as top priority and not as priority', () => {
    // The alternation is ordered for exactly this: `priority` matches inside
    // "Top Priority", so the longer form has to be tried first.
    expect(findUrgency('TOP PRIORITY\nF.No. 1/2/2026')).toBe('topPriority')
  })

  it('is none when the letter carries no grading', () => {
    expect(findUrgency('F.No. 1/2/2026\nSubject: something.')).toBe('none')
  })

  it('reads only the top of the page', () => {
    // A body paragraph saying "this is a priority for the Department" is not a
    // grading, and treating it as one would mark half the register urgent.
    const body = `${'filler\n'.repeat(20)}This is a priority for the Department.`
    expect(findUrgency(body)).toBe('none')
  })
})

describe('deadlines and periods', () => {
  it('reads a date after a limit word', () => {
    expect(deadlineIn('The reply may be sent by 30.09.2026.')).toBe('2026-09-30')
    expect(deadlineIn('Please respond on or before 15 October 2026.')).toBe('2026-10-15')
  })

  it('reads no deadline from a date with no limit word', () => {
    expect(deadlineIn('Your letter dated 30.09.2026 refers.')).toBeNull()
  })

  it('reads a period without turning it into a date', () => {
    // Deliberately not converted: the letter date and the receipt date are
    // different starting points and the office knows which it counts from.
    expect(periodIn('within 15 days')).toBe(15)
    expect(periodIn('within 2 weeks')).toBe(14)
    expect(periodIn('15 दिन के भीतर')).toBe(15)
    expect(periodIn('no period at all')).toBeNull()
  })
})

describe('sentences', () => {
  it('ends a sentence on a danda as well as a full stop', () => {
    expect(sentencesOf('पहला वाक्य। दूसरा वाक्य।')).toHaveLength(2)
  })
})

describe('what the edge-case pass found', () => {
  it('names the Act when it comes BEFORE the number, which is where Hindi puts it', () => {
    /*
      `ACT_TAIL` looked only AFTER the number, because that is where English
      puts it — "section 420 of the Indian Penal Code". Hindi puts it first:
      "भारतीय दंड संहिता की धारा 420". So every Devanagari citation came back
      with `act: ''`, and `resolveProvisions`' caller — which decides what Act a
      citation names by matching patterns against `act` and `text` — could never
      resolve one. The English half working is not evidence (ADR-035, ADR-039).
    */
    const [hindi] = findProvisions('भारतीय दंड संहिता की धारा 420 के अधीन अपराध कारित किया गया।')
    expect(hindi?.number).toBe('420')
    expect(hindi?.act).toMatch(/भारतीय दंड संहिता/)

    // And English still reads the Act that follows, as it always did.
    const [english] = findProvisions('an offence under section 420 of the Indian Penal Code, 1860')
    expect(english?.act).toMatch(/Indian Penal Code/)
  })

  it('does not take a preceding Act name across a sentence boundary', () => {
    // The whole risk of looking backwards: "…under the Indian Penal Code. Rule
    // 3 of the Conduct Rules also applies" must not attach the Penal Code to
    // Rule 3.
    const found = findProvisions(
      'The matter was examined under the Indian Penal Code. Rule 3 of the CCS (Conduct) Rules, 1964 also applies.',
    )
    const rule = found.find((each) => each.unit === 'rule')
    expect(rule?.act).toMatch(/CCS \(Conduct\) Rules/)
    expect(rule?.act).not.toMatch(/Penal Code/)
  })

  it('caps how many requests one letter can produce', () => {
    /*
      `findAsks` had no cap, and every ask it finds is put into the prompt by
      `src/ai/agents/intake.ts` — the letter BODY is capped at 12,000 characters
      and the sentences derived from it were not, so a long circular could push
      a far larger context than the letter it came from. The cap is on the
      extractor rather than on the agent so the chips and the prompt agree about
      what the letter asks for.
    */
    const many = Array.from(
      { length: MAX_ASKS + 20 },
      (_, index) => `It is requested that item ${index + 1} may kindly be furnished.`,
    ).join(' ')
    const asks = findAsks(many)
    expect(asks).toHaveLength(MAX_ASKS)
    // The letter's own order is kept: it is the FIRST asks that survive, which
    // is where an office puts what it most wants.
    expect(asks[0]?.text).toMatch(/item 1 /)
  })

  it('keeps a deadline that falls past the cap', () => {
    // A cap that dropped the one sentence carrying a date would take the
    // follow-up with it, so a deadline is kept over a plain request.
    const filler = Array.from(
      { length: MAX_ASKS + 5 },
      (_, index) => `It is requested that item ${index + 1} may kindly be furnished.`,
    ).join(' ')
    const asks = findAsks(`${filler} The reply may be sent by 30.09.2026.`)
    expect(asks).toHaveLength(MAX_ASKS)
    expect(asks.some((ask) => ask.deadline === '2026-09-30')).toBe(true)
  })
})
