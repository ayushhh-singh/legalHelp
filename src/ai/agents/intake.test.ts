import { describe, expect, it } from 'vitest'

import { finalTurn } from '../fixtures/drafting-scripts'
import { MockProvider } from '../providers/mock'
import { runIntakeAgent, type IntakeAgentResult } from './intake'

import { analyseIntake } from '@/lib/drafting/intake'
import type { RetrievedSnippet } from '@/lib/retrieval'
import { INTAKE_LETTERS } from '../../../tests/fixtures/drafting/intake'

/**
 * The intake analysis agent, against `MockProvider`.
 *
 * Three of these tests are the ones that matter and they are all negative: a
 * letter naming classified material must not reach a provider at all, a
 * provision the model invented must fail the run rather than being dropped, and
 * a form id this app does not have must not be offered.
 */

const TEMPLATE_IDS = ['office-memorandum', 'letter', 'interim-reply', 'rti-reply']

const SNIPPETS: RetrievedSnippet[] = [
  {
    id: 's1',
    kind: 'section',
    citation: 'BNS 318',
    heading: 'Cheating',
    text: 'Whoever cheats shall be punished…',
    href: '/law?q=BNS%20318',
    sourceUrl: 'https://www.ncrb.gov.in/',
    personal: false,
    score: 1,
    reason: 'number',
  },
  {
    id: 's2',
    kind: 'rule',
    citation: 'Rule 3, CCS (Conduct) Rules, 1964',
    heading: 'General',
    text: 'Every Government servant shall at all times maintain absolute integrity…',
    href: '/library/ccs-conduct/3',
    sourceUrl: 'https://dopt.gov.in/',
    personal: false,
    score: 0.9,
    reason: 'number',
  },
]

const ANALYSIS = {
  summary: {
    en: 'The Department asks for pending case numbers.',
    hi: 'विभाग लंबित मामलों की संख्या माँगता है।',
  },
  whatIsAsked: [{ en: 'Furnish the number of pending cases.', hi: 'लंबित मामलों की संख्या दें।' }],
  deadline: '',
  citedProvisions: [],
  suggestedType: 'office-memorandum',
  risks: [],
  nextSteps: [],
}

const run = (
  overrides: Partial<Parameters<typeof runIntakeAgent>[0]> = {},
  json: unknown = ANALYSIS,
  letter: string = INTAKE_LETTERS.englishOm,
): { provider: MockProvider; result: Promise<IntakeAgentResult> } => {
  const provider = new MockProvider({ id: 'intake', turns: [finalTurn(json)] })
  return {
    provider,
    result: runIntakeAgent({
      provider,
      text: letter,
      extracted: analyseIntake(letter),
      templateIds: TEMPLATE_IDS,
      language: 'en',
      budgetLimit: null,
      ...overrides,
    }),
  }
}

describe('the happy path', () => {
  it('returns the analysis, in both languages', async () => {
    const { result } = run()
    const analysis = await result
    expect(analysis.status).toBe('analysis')
    if (analysis.status !== 'analysis') return
    expect(analysis.summary.hi).toMatch(/विभाग/)
    expect(analysis.whatIsAsked).toHaveLength(1)
    expect(analysis.suggestedType).toBe('office-memorandum')
  })

  it('gives the model the facts the app already extracted, as snippet 1', async () => {
    const { provider, result } = run()
    await result
    const system = provider.calls[0]?.system.map((block) => block.text).join('\n') ?? ''
    // The number, the date and the subject are already known; handing them over
    // as a citable snippet is what stops `validateCitations` rejecting an
    // answer for repeating the letter's own file number.
    expect(system).toContain('A-11011/4/2026-Estt.(Allowances)')
    expect(system).toContain('Children Education Allowance')
  })

  it('tells the model which forms exist', async () => {
    const { provider, result } = run()
    await result
    const message = JSON.stringify(provider.calls[0]?.messages ?? [])
    for (const id of TEMPLATE_IDS) expect(message).toContain(id)
  })
})

describe('the refusal screen', () => {
  it('refuses a letter naming classified material, before a provider is called', async () => {
    // The claim is "nothing was sent", not "we told the model to refuse", so
    // the assertion is on `provider.calls`.
    const letter = `${INTAKE_LETTERS.englishOm}\n\nThis is a SECRET communication.`
    const { provider, result } = run({}, ANALYSIS, letter)
    const analysis = await result
    expect(analysis.status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })

  it('refuses on a marking in the SUBJECT as well as in the body', async () => {
    const letter = INTAKE_LETTERS.englishOm.replace(
      'Subject: Grant of Children Education Allowance',
      'Subject: Confidential report on Children Education Allowance',
    )
    const { provider, result } = run({}, ANALYSIS, letter)
    expect((await result).status).toBe('refused')
    expect(provider.calls).toHaveLength(0)
  })

  it('does not refuse an ordinary letter that mentions the Secretary', async () => {
    // `\bsecret\b` is word-bounded because "Secretary" and "Secretariat" are in
    // almost every document this app touches.
    const letter = INTAKE_LETTERS.englishOm.replace('Under Secretary', 'Secretary')
    const { result } = run({}, ANALYSIS, letter)
    expect((await result).status).toBe('analysis')
  })
})

describe('a provision the model invented', () => {
  it('fails the run rather than dropping the entry', async () => {
    const { result } = run(
      { snippets: SNIPPETS },
      {
        ...ANALYSIS,
        citedProvisions: [{ snippetId: 's99', relevance: { en: 'It applies.', hi: 'यह लागू है।' } }],
      },
    )
    const analysis = await result
    expect(analysis.status).toBe('error')
    if (analysis.status !== 'error') return
    expect(analysis.code).toBe('ungrounded')
    expect(analysis.message).toMatch(/not in what it was shown/)
  })

  it('re-derives the citation from the snippet rather than believing the model', async () => {
    const { result } = run(
      { snippets: SNIPPETS },
      {
        ...ANALYSIS,
        citedProvisions: [
          { snippetId: 's1', relevance: { en: 'The letter cites it.', hi: 'पत्र इसका उल्लेख करता है।' } },
        ],
      },
    )
    const analysis = await result
    if (analysis.status !== 'analysis') throw new Error('expected an analysis')
    expect(analysis.citedProvisions[0]?.citation).toBe('BNS 318')
    expect(analysis.citedProvisions[0]?.href).toBe('/law?q=BNS%20318')
  })
})

describe('the suggested form', () => {
  it('drops one this app does not have, and says so', async () => {
    const { result } = run({}, { ...ANALYSIS, suggestedType: 'affidavit' })
    const analysis = await result
    if (analysis.status !== 'analysis') throw new Error('expected an analysis')
    expect(analysis.suggestedType).toBe('')
    expect(analysis.problems.join(' ')).toMatch(/"affidavit" is not one this app has/)
  })
})

describe('the deadline', () => {
  it('takes the one the extractor read off the letter over the one the model wrote', async () => {
    // The extractor read a labelled sentence with a regex; the model read the
    // same sentence and may have done arithmetic on a period, which the prompt
    // forbids and which nothing else would catch.
    const { result } = run({}, { ...ANALYSIS, deadline: '2026-10-15' }, INTAKE_LETTERS.threeAsks)
    const analysis = await result
    if (analysis.status !== 'analysis') throw new Error('expected an analysis')
    expect(analysis.deadline).toBe('2026-09-30')
    expect(analysis.problems.join(' ')).toMatch(/the letter itself says 2026-09-30/)
  })

  it('keeps the extractor’s deadline when the model gave none', async () => {
    const { result } = run({}, ANALYSIS, INTAKE_LETTERS.threeAsks)
    const analysis = await result
    if (analysis.status !== 'analysis') throw new Error('expected an analysis')
    expect(analysis.deadline).toBe('2026-09-30')
  })

  it('drops something that is not a date', async () => {
    const { result } = run({}, { ...ANALYSIS, deadline: 'within a fortnight' })
    const analysis = await result
    if (analysis.status !== 'analysis') throw new Error('expected an analysis')
    expect(analysis.deadline).toBe('')
    expect(analysis.problems.join(' ')).toMatch(/which is not one/)
  })
})

describe('failures', () => {
  it('reports a shape the model got wrong rather than half-reading it', async () => {
    const { result } = run({}, { summary: 'not bilingual' })
    const analysis = await result
    expect(analysis.status).toBe('error')
    if (analysis.status !== 'error') return
    expect(analysis.message).toMatch(/did not match the expected shape/)
  })

  it('reports a provider failure', async () => {
    const provider = new MockProvider({
      id: 'boom',
      turns: [{ content: [], stopReason: 'end_turn', throwError: { code: 'provider', message: 'no' } }],
    })
    const analysis = await runIntakeAgent({
      provider,
      text: INTAKE_LETTERS.englishOm,
      extracted: analyseIntake(INTAKE_LETTERS.englishOm),
      templateIds: TEMPLATE_IDS,
      language: 'en',
      budgetLimit: null,
    })
    expect(analysis.status).toBe('error')
  })
})

describe('progress', () => {
  it('reports every phase, in order, ending in done', async () => {
    const phases: string[] = []
    const { result } = run({ onProgress: (step) => phases.push(step.phase) })
    await result
    expect(phases).toEqual(['screening', 'reading', 'checking', 'done'])
  })

  it('stops at screening when the letter is refused', async () => {
    const phases: string[] = []
    const { result } = run(
      { onProgress: (step) => phases.push(step.phase) },
      ANALYSIS,
      `${INTAKE_LETTERS.englishOm}\nTOP SECRET`,
    )
    await result
    expect(phases).toEqual(['screening'])
  })
})
