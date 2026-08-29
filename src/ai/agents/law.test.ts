import { beforeEach, describe, expect, it } from 'vitest'

import {
  caseAdviceSteer,
  copyableAnswer,
  dateRuleCaveat,
  mentionedSections,
  partialAnswerText,
  policyForTier,
  runLawAgent,
  screenLawQuestion,
  type LawAnswerResult,
  type LawStep,
} from './law'
import {
  CHEATING_ANSWER,
  CHEATING_CALLS,
  DATE_ANSWER,
  DATE_CALLS,
  SEDITION_ANSWER,
  SEDITION_CALLS,
  STALKING_ANSWER,
  STALKING_CALLS,
  lawScript,
  type AnswerShape,
} from '../fixtures/law-scripts'
import { MockProvider } from '../providers/mock'
import { clearRegistry, listTools } from '../tools/registry'
import { resetLawToolCache } from '../tools/law'
import { registerBuiltinTools } from '../tools/index'

/**
 * The law research agent, against scripted model turns and the REAL committed
 * `data/law/*.json`.
 *
 * Nothing here stubs a tool. The section numbers, the headings, the First
 * Schedule rows and every citation string are read off the bytes the ingest
 * committed, so a test that says "420 becomes 318(4) and 318(4) is
 * non-bailable" is an assertion about the dataset as well as about the agent.
 * Only the model is scripted, because only the model is the part this app
 * cannot make deterministic.
 */

beforeEach(() => {
  clearRegistry()
  resetLawToolCache()
  registerBuiltinTools()
})

const tools = () => listTools('law')

function record(): { steps: LawStep[]; onProgress: (step: LawStep) => void } {
  const steps: LawStep[] = []
  return { steps, onProgress: (step) => steps.push(step) }
}

const toolsUsed = (steps: readonly LawStep[]): string[] =>
  steps.flatMap((step) => (step.tool ? [step.tool] : []))

/** Fails the test rather than the type-narrowing, and says what went wrong. */
function expectAnswer(result: Awaited<ReturnType<typeof runLawAgent>>): LawAnswerResult {
  if (result.status !== 'answer') {
    throw new Error(
      `expected an answer, got ${result.status}${result.status === 'error' ? `: ${result.message}` : ''}`,
    )
  }
  return result
}

/* ------------------------------------------------------------------ *
 * The refusal screen, before anything is sent
 * ------------------------------------------------------------------ */

describe('screenLawQuestion', () => {
  it.each([
    ['an FIR number', 'Which section applies to FIR No. 112/2024 at this police station?'],
    ['a case number', 'What is the punishment in case no. 45 of 2025?'],
    ['a crime number', 'Crime number 91 — which BNS section is it?'],
    ['a Hindi FIR number', 'प्राथमिकी संख्या 44/2024 में कौन-सी धारा लगेगी?'],
  ])('refuses %s', (_label, question) => {
    const refusal = screenLawQuestion(question)
    expect(refusal?.reason).toBe('departmental')
    expect(refusal?.message.en).toContain('nothing has been sent')
    expect(refusal?.message.hi.length).toBeGreaterThan(0)
  })

  /**
   * The whole point of the narrow patterns. A question about the date rule is
   * this surface's own acceptance case, and it necessarily says "FIR"; a
   * question about the Official Secrets Act necessarily says "secret". Neither
   * is a departmental record, and refusing either would refuse the statute.
   */
  it.each([
    ['an FIR with a date but no number', 'An FIR was filed on 20 June 2024 — which code applies?'],
    ['secret information', 'Which BNS section covers communicating secret information to a foreign agent?'],
    ['a confidential report', 'Is disclosure of a confidential report an offence under the BNS?'],
    ['a case in the abstract', 'Can a case under BNS 318 be compounded?'],
  ])('does not refuse %s', (_label, question) => {
    expect(screenLawQuestion(question)).toBeNull()
  })

  it('sends nothing to the provider when a question is refused', async () => {
    const provider = new MockProvider(lawScript('unused', { calls: [], answer: CHEATING_ANSWER }))

    const result = await runLawAgent({
      provider,
      question: 'Which section applies to FIR No. 112/2024?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('refused')
    // "We told the model to refuse" and "nothing was sent" are different
    // claims, and only one of them is a privacy property.
    expect(provider.calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * "What is the BNS equivalent of 420, and is it bailable?"
 * ------------------------------------------------------------------ */

describe('the BNS equivalent of 420, and whether it is bailable', () => {
  it('runs both passes, cites both provisions and formats the citations itself', async () => {
    const provider = new MockProvider(
      lawScript('cheating', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const { steps, onProgress } = record()

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What is the BNS equivalent of 420, and is it bailable?',
        language: 'en',
        tools: tools(),
        onProgress,
      }),
    )

    expect(toolsUsed(steps)).toEqual(['compare_old_new', 'get_classification'])
    expect(steps.map((step) => step.phase)).toEqual([
      'screening',
      'researching',
      'researching',
      'researching',
      'reading',
      'answering',
      'verifying',
      'done',
    ])

    expect(result.citations.map((citation) => `${citation.act} ${citation.section}`)).toEqual([
      'IPC 420',
      'BNS 318(4)',
    ])
    // The citation TEXT is `format_citation`'s, not the model's: the Act name,
    // the word order and the repealed Act's abbreviation all differ between
    // the two languages, and this is what an officer pastes into a file.
    const bns = result.citations[1]
    expect(bns?.citation.en).toContain('Section 318(4) of the Bharatiya Nyaya Sanhita, 2023')
    expect(bns?.citation.en).toContain('420')
    expect(bns?.citation.hi).toContain('भारतीय न्याय संहिता, 2023 की धारा 318(4)')
    expect(result.citations[0]?.citation.en).toBe('Section 420 IPC')
    expect(result.citations[0]?.citation.hi).toBe('भा.दं.सं. की धारा 420')
    expect(result.problems).toEqual([])
  })

  /**
   * The label is the substance of stage 3. Handed a First Schedule row under a
   * `(section …)` label, a model answers "is it bailable" from a heading that
   * begins "Punishment for…" — which cannot answer it.
   */
  it('labels the First Schedule row as a classification and the mapping as a mapping', async () => {
    const provider = new MockProvider(
      lawScript('cheating-labels', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )

    await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420, and is it bailable?',
      language: 'en',
      tools: tools(),
    })

    // The last request is the answer pass; its volatile system block carries
    // the numbered snippets.
    const context = provider.calls.at(-1)?.system.at(-1)?.text ?? ''
    expect(context).toContain('(classification, BNSS First Schedule: BNS 318')
    expect(context).toContain('(old→new mapping: IPC 420')
    expect(context).toContain('non-bailable')
    // And the answer pass is handed no tools at all — everything it may say is
    // already a snippet.
    expect(provider.calls.at(-1)?.tools ?? []).toHaveLength(0)
    expect(provider.calls[0]?.tools?.length ?? 0).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * "What changed in sedition?"
 * ------------------------------------------------------------------ */

describe('what changed in sedition', () => {
  it('carries the curated warning into the snippets and cites both numbers', async () => {
    const provider = new MockProvider(
      lawScript('sedition', { calls: SEDITION_CALLS, answer: SEDITION_ANSWER }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What changed in sedition?',
        language: 'en',
        tools: tools(),
      }),
    )

    const context = provider.calls.at(-1)?.system.at(-1)?.text ?? ''
    // `data/law/overlays/` curates this warning by hand precisely because the
    // number-to-number mapping is the misleading part of the answer.
    expect(context).toContain('WARNING')
    expect(context).toContain('124A')

    expect(result.citations.map((citation) => `${citation.act} ${citation.section}`)).toEqual([
      'IPC 124A',
      'BNS 152',
    ])
    expect(result.citations[1]?.heading?.en).toBe(
      'Act endangering sovereignty, unity and integrity of India.',
    )
  })
})

/* ------------------------------------------------------------------ *
 * "Cite the section for stalking, in Hindi."
 * ------------------------------------------------------------------ */

describe('the Hindi answer path', () => {
  it('answers in Hindi and formats the citation the way a Hindi citation is written', async () => {
    const provider = new MockProvider(
      lawScript('stalking', { calls: STALKING_CALLS, answer: STALKING_ANSWER }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'हिंदी में पीछा करने की धारा बताइए',
        language: 'hi',
        tools: tools(),
      }),
    )

    expect(result.answer.hi).toContain('धारा 78')
    expect(/[ऀ-ॿ]/.test(result.answer.hi)).toBe(true)
    // Hindi puts the Act first and the section second. It is not the English
    // sentence with the words swapped, which is why nothing composes it here.
    const bns = result.citations.find((citation) => citation.act === 'BNS')
    expect(bns?.citation.hi).toContain('भारतीय न्याय संहिता, 2023 की धारा 78')
    expect(bns?.heading?.hi).toBe('पीछा करना।')
    // The repealed provision is cited too, in the abbreviation a Hindi
    // citation actually uses.
    expect(result.citations.find((citation) => citation.act === 'IPC')?.citation.hi).toBe(
      'भा.दं.सं. की धारा 354D',
    )

    // Every caveat carries both languages, whatever the interface language is.
    for (const caveat of result.caveats) {
      expect(caveat.en.length).toBeGreaterThan(0)
      expect(caveat.hi.length).toBeGreaterThan(0)
    }
    expect(result.caveats.at(-1)?.hi).toContain('केवल संदर्भ हेतु')

    // The language directive is in the VOLATILE block, never the cached prefix.
    const answerCall = provider.calls.at(-1)
    expect(answerCall?.system.at(-1)?.text).toContain('Answer in Hindi')
    expect(answerCall?.system[0]?.cache).toBe(true)
    expect(answerCall?.system[0]?.text ?? '').not.toContain('Answer in Hindi')
  })
})

/* ------------------------------------------------------------------ *
 * The date rule — always added, never the model's
 * ------------------------------------------------------------------ */

describe('the offence-date rule', () => {
  it('is the first caveat and the disclaimer is the last, on every answer', async () => {
    const provider = new MockProvider(
      lawScript('sedition-date', { calls: SEDITION_CALLS, answer: SEDITION_ANSWER }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What changed in sedition?',
        language: 'en',
        tools: tools(),
      }),
    )

    expect(result.caveats.length).toBeGreaterThanOrEqual(2)
    expect(result.caveats[0]?.en).toContain('DATE OF THE OFFENCE')
    expect(result.caveats[0]?.en).toContain('No offence date was given')
    expect(result.caveats.at(-1)?.en).toBe(
      'Reference only; verify with the official gazette/order or your DDO.',
    )
  })

  it('states which era an FIR filed on 20 June 2024 falls in', async () => {
    const provider = new MockProvider(lawScript('fir-date', { calls: DATE_CALLS, answer: DATE_ANSWER }))

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'An FIR was filed on 20 June 2024 — which code applies?',
        language: 'en',
        offenceDate: '2024-06-20',
        tools: tools(),
      }),
    )

    expect(result.caveats[0]?.en).toContain('before 1 July 2024')
    expect(result.caveats[0]?.en).toContain('531(2)')
    expect(result.caveats[0]?.hi).toContain('531(2)')
    expect(result.citations.map((citation) => `${citation.act} ${citation.section}`)).toEqual([
      'CrPC 154',
      'BNSS 173',
    ])
  })

  it.each([
    ['2024-06-30', 'before 1 July 2024'],
    ['2024-07-01', 'on or after 1 July 2024'],
  ])('puts %s on the right side of commencement', (date, expected) => {
    expect(dateRuleCaveat(date).en).toContain(expected)
  })

  it('says it does not know which code applies when no date was given', () => {
    expect(dateRuleCaveat(null).en).toContain('does not say which code governs')
    expect(dateRuleCaveat('not-a-date').en).toContain('does not say which code governs')
  })
})

/* ------------------------------------------------------------------ *
 * Grounding — the failures this surface exists to prevent
 * ------------------------------------------------------------------ */

describe('grounding', () => {
  it('rejects an answer that states a section number and cites no snippet', async () => {
    const ungrounded: AnswerShape = {
      answer: {
        en: 'Section 420 IPC is now Section 318(4) of the BNS and it is bailable.',
        hi: 'भा.दं.सं. की धारा 420 अब भा.न्या.सं. की धारा 318(4) है और यह जमानतीय है।',
      },
      citations: CHEATING_ANSWER.citations,
    }
    const provider = new MockProvider(lawScript('ungrounded', { calls: CHEATING_CALLS, answer: ungrounded }))

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('invalid_citation')
    // The reader is told what was read, so "it could not answer" is not a
    // dead end — it names the tables it looked in.
    expect(result.toolsCalled).toEqual(['compare_old_new', 'get_classification'])
  })

  it('rejects an answer naming a section it left out of the citation list', async () => {
    const uncited: AnswerShape = {
      answer: {
        // 318(4) is cited; 316(2) is named and is in no citation, so there is
        // no source for a reader to open.
        en: 'Section 420 IPC is now Section 318(4) of the BNS [2]; compare Section 316(2) of the BNS.',
        hi: 'भा.दं.सं. की धारा 420 अब भा.न्या.सं. की धारा 318(4) है [2]।',
      },
      citations: CHEATING_ANSWER.citations,
    }
    const provider = new MockProvider(lawScript('uncited', { calls: CHEATING_CALLS, answer: uncited }))

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('invalid_citation')
    expect(result.message).toContain('316(2)')
  })

  it('fails when the model answered without reading anything', async () => {
    const provider = new MockProvider(lawScript('no-tools', { calls: [], answer: CHEATING_ANSWER }))

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('ungrounded')
    expect(result.message).toContain('read nothing from the section tables')
    // One provider call — the research pass. There is nothing to answer FROM,
    // so the second pass is never paid for.
    expect(provider.calls).toHaveLength(1)
  })

  /**
   * The research pass's closing sentence is thrown away, so `validateCitations`
   * failing on it is not a failure of the run — the tool results are its
   * output. Every other failure really does stop the run, and the distinction
   * is asserted in both directions below.
   */
  it('keeps going when the research pass’s discarded sentence names a section', async () => {
    const provider = new MockProvider(
      lawScript('chatty-research', {
        calls: CHEATING_CALLS,
        answer: CHEATING_ANSWER,
        gathered: 'Gathered [T1] [T2] — section 420 maps to section 318(4).',
      }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What is the BNS equivalent of 420, and is it bailable?',
        language: 'en',
        tools: tools(),
      }),
    )

    expect(result.problems.some((problem) => problem.includes('invalid_citation'))).toBe(true)
    expect(result.citations).toHaveLength(2)
  })

  it('does not keep going when the research pass failed for a real reason', async () => {
    const script = lawScript('provider-down', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER })
    const provider = new MockProvider({
      ...script,
      turns: [
        { stopReason: 'end_turn', content: [], throwError: { code: 'rate_limited', message: 'Slow down.' } },
      ],
    })

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('rate_limited')
  })
})

/* ------------------------------------------------------------------ *
 * Citations are verified, not believed
 * ------------------------------------------------------------------ */

describe('citations are re-derived from the tool results', () => {
  it('corrects a citation attributed to the wrong tool result', async () => {
    const misattributed: AnswerShape = {
      ...SEDITION_ANSWER,
      citations: [
        { act: 'IPC', section: '124A', toolResultId: 'T9' },
        { act: 'BNS', section: '152', toolResultId: 'T1' },
      ],
    }
    const provider = new MockProvider(
      lawScript('misattributed', { calls: SEDITION_CALLS, answer: misattributed }),
    )

    const result = expectAnswer(
      await runLawAgent({ provider, question: 'What changed in sedition?', language: 'en', tools: tools() }),
    )

    expect(result.citations[0]?.toolResultId).toBe('T1')
    expect(result.problems.join(' ')).toContain('Corrected the source of "IPC 124A" from T9 to T1')
  })

  it('drops a citation no tool result in the run supports', async () => {
    const invented: AnswerShape = {
      ...SEDITION_ANSWER,
      citations: [
        { act: 'IPC', section: '124A', toolResultId: 'T1' },
        { act: 'BNS', section: '152', toolResultId: 'T1' },
        { act: 'BSA', section: '61', toolResultId: 'T1' },
      ],
    }
    const provider = new MockProvider(lawScript('invented', { calls: SEDITION_CALLS, answer: invented }))

    const result = expectAnswer(
      await runLawAgent({ provider, question: 'What changed in sedition?', language: 'en', tools: tools() }),
    )

    expect(result.citations.map((citation) => citation.act)).toEqual(['IPC', 'BNS'])
    expect(result.problems.join(' ')).toContain('Dropped the citation "BSA 61"')
  })
})

/* ------------------------------------------------------------------ *
 * Advice about a particular person's case
 * ------------------------------------------------------------------ */

describe('a question about somebody’s case is steered, not refused', () => {
  it.each([
    ['a relative', 'Will my brother get bail if the FIR is under 420?'],
    ['what to do', 'My case is under IPC 420 — what should I do?'],
    ['Hindi', 'मेरे भाई को 420 में जमानत मिलेगी क्या?'],
  ])('detects %s', (_label, question) => {
    expect(caseAdviceSteer(question)).not.toBeNull()
  })

  it.each([
    ['a plain lookup', 'What is the BNS equivalent of 420, and is it bailable?'],
    ['a general "can I"', 'Can I file a complaint under a section of the repealed IPC after July 2024?'],
    ['a general "why"', 'Why did the numbering of cheating change?'],
  ])('leaves %s alone', (_label, question) => {
    expect(caseAdviceSteer(question)).toBeNull()
  })

  it('still answers the general rule, and adds the caveat whatever the model wrote', async () => {
    const provider = new MockProvider(
      lawScript('steered', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'Will my brother get bail if his case is under 420?',
        language: 'en',
        tools: tools(),
      }),
    )

    expect(result.caveats.some((caveat) => caveat.en.includes('not advice about any particular case'))).toBe(
      true,
    )
    expect(result.citations).toHaveLength(2)
    // Both passes are told, so the answer itself is about the rule.
    for (const call of provider.calls) {
      const turn = call.messages[0]?.content[0]
      expect(turn?.type === 'text' ? turn.text : '').toContain('particular person')
    }
  })
})

/* ------------------------------------------------------------------ *
 * Tier 0 — a smaller run for a model running in the reader's browser
 * ------------------------------------------------------------------ */

describe('the local tier restricts the run', () => {
  it('has a policy of one tool-calling turn, one result and a shorter answer', () => {
    expect(policyForTier('local')).toEqual({
      researchSteps: 2,
      maxToolResults: 1,
      maxSearchHits: 2,
      answerSentences: 2,
    })
    expect(policyForTier('byok').maxToolResults).toBeGreaterThan(1)
    expect(policyForTier('proxy')).toEqual(policyForTier('byok'))
  })

  it('reads one tool result even when the single turn called two tools', async () => {
    const provider = new MockProvider(
      lawScript('local', {
        // Both calls in ONE turn, which is all `researchSteps: 2` permits.
        calls: [[...CHEATING_CALLS[0]!, ...CHEATING_CALLS[1]!]],
        answer: {
          answer: {
            en: 'Section 420 IPC is now Section 318(4) of the BNS [2].',
            hi: 'भा.दं.सं. की धारा 420 अब भा.न्या.सं. की धारा 318(4) है [2]।',
          },
          citations: [
            { act: 'IPC', section: '420', toolResultId: 'T1' },
            { act: 'BNS', section: '318(4)', toolResultId: 'T1' },
          ],
        },
      }),
    )

    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What is the BNS equivalent of 420?',
        language: 'en',
        tier: 'local',
        tools: tools(),
      }),
    )

    expect(result.snippets).toHaveLength(1)
    expect(result.problems.join(' ')).toContain('beyond this tier’s limit of 1')

    const answerTurn = provider.calls.at(-1)?.messages[0]?.content[0]
    expect(answerTurn?.type === 'text' ? answerTurn.text : '').toContain('at most 2 sentences')
    const researchTurn = provider.calls[0]?.messages[0]?.content[0]
    expect(researchTurn?.type === 'text' ? researchTurn.text : '').toContain(
      'ONE turn in which to call tools',
    )
  })
})

/* ------------------------------------------------------------------ *
 * Streaming, copying, and the small pure pieces
 * ------------------------------------------------------------------ */

describe('partialAnswerText', () => {
  it('reads the answer out of a half-arrived JSON document', () => {
    expect(partialAnswerText('{"answer":{"en":"Section 103 of the BN', 'en')).toBe('Section 103 of the BN')
    expect(partialAnswerText('{"answer":{"en":"done","hi":"धारा 103', 'hi')).toBe('धारा 103')
  })

  it('unescapes what JSON escaped, and gives up cleanly on a partial escape', () => {
    expect(partialAnswerText('{"answer":{"en":"a \\"quoted\\" word', 'en')).toBe('a "quoted" word')
    expect(partialAnswerText('{"answer":{"en":"line\\none', 'en')).toBe('line\none')
    expect(partialAnswerText('{"answer":{"en":"\\u0915\\u094b', 'en')).toBe('को')
    expect(partialAnswerText('{"answer":{"en":"trailing\\', 'en')).toBe('trailing')
    expect(partialAnswerText('{"answ', 'en')).toBe('')
  })

  it('streams the answer as it arrives', async () => {
    const provider = new MockProvider(
      lawScript('streaming', { calls: SEDITION_CALLS, answer: SEDITION_ANSWER }),
    )
    const seen: string[] = []

    await runLawAgent({
      provider,
      question: 'What changed in sedition?',
      language: 'en',
      tools: tools(),
      onPartialAnswer: (text) => seen.push(text),
    })

    expect(seen.at(-1)).toBe(SEDITION_ANSWER.answer.en)
  })
})

describe('mentionedSections', () => {
  it('finds a provision however the two languages write it', () => {
    expect(mentionedSections('Section 318(4) of the BNS').map((one) => one.full)).toEqual(['3184'])
    expect(mentionedSections('भा.न्या.सं. की धारा 103').map((one) => one.full)).toEqual(['103'])
    // Sorted by the digits, which is what the failure message reads back.
    expect(mentionedSections('BNS 78 and IPC 354D').map((one) => one.written)).toEqual(['354D', '78'])
    expect(mentionedSections('धारा १०३').map((one) => one.full)).toEqual(['103'])
  })

  it('does not read a date or a year as a provision', () => {
    expect(mentionedSections('All three Sanhitas came into force on 1 July 2024.')).toEqual([])
    expect(mentionedSections('the Bharatiya Nyaya Sanhita, 2023')).toEqual([])
  })
})

describe('copyableAnswer', () => {
  it('carries the citations and the disclaimer with the text', async () => {
    const provider = new MockProvider(lawScript('copy', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }))
    const result = expectAnswer(
      await runLawAgent({
        provider,
        question: 'What is the BNS equivalent of 420?',
        language: 'en',
        tools: tools(),
      }),
    )

    const text = copyableAnswer(result, 'en')
    expect(text).toContain(CHEATING_ANSWER.answer.en)
    expect(text).toContain('Citations:')
    expect(text).toContain('Section 318(4) of the Bharatiya Nyaya Sanhita, 2023')
    expect(text).toContain('Reference only; verify with the official gazette/order or your DDO.')

    const hindi = copyableAnswer(result, 'hi')
    expect(hindi).toContain('उद्धरण:')
    expect(hindi).toContain('केवल संदर्भ हेतु')
  })
})

describe('cancellation', () => {
  it('stops without a second pass when the signal aborts during research', async () => {
    const provider = new MockProvider(
      lawScript('cancelled', { calls: SEDITION_CALLS, answer: SEDITION_ANSWER }),
    )
    const controller = new AbortController()

    const result = await runLawAgent({
      provider,
      question: 'What changed in sedition?',
      language: 'en',
      tools: tools(),
      signal: controller.signal,
      onProgress: (step) => {
        if (step.phase === 'researching' && step.tool) controller.abort()
      },
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('aborted')
  })
})
