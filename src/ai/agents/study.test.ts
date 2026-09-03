import { beforeEach, describe, expect, it } from 'vitest'

import {
  AID_NOTE,
  caseAdviceSteer,
  misattributesPersonal,
  PERSONAL_NOTE,
  policyForTier,
  partialAnswerText,
  runStudyAgent,
  screenStudyQuestion,
  STUDY_DISCLAIMER,
  type StudyAgentResult,
} from './study'

import { MockProvider, type MockTurn } from '../providers/mock'
import { clearRegistry, listTools } from '../tools/registry'
import { registerBuiltinTools } from '../tools/index'
import { resetLibraryToolCache } from '../tools/library'

import { clearAllData, db } from '@/db'

/**
 * The study agent, against `MockProvider` and the REAL committed datasets.
 *
 * The tools read `data/library` and `data/rules` off the bundler's `?raw`
 * specifiers, so a passing run here is a run over the same bytes the app ships
 * — which is what makes "the aid for Rule 18 was read" a claim about the
 * dataset rather than about a fixture.
 */

const text = (value: string): MockTurn => ({
  content: [{ type: 'text', text: value }],
  stopReason: 'end_turn',
  usage: { inputTokens: 500, outputTokens: 50 },
})

const call = (name: string, input: unknown, id = 'c1'): MockTurn => ({
  content: [{ type: 'tool_use', id, name, input }],
  stopReason: 'tool_use',
  usage: { inputTokens: 500, outputTokens: 20 },
})

const json = (value: unknown): MockTurn => text(JSON.stringify(value))

const answer = (over: Record<string, unknown> = {}) =>
  json({
    answer: {
      en: 'Rule 18 requires previous knowledge of the prescribed authority [2].',
      hi: 'नियम 18 विहित प्राधिकारी की पूर्व जानकारी अपेक्षित करता है [2]।',
    },
    used: [2],
    ...over,
  })

const run = (turns: readonly MockTurn[], over: Partial<Parameters<typeof runStudyAgent>[0]> = {}) => {
  const provider = new MockProvider({ id: 'study', turns })
  return {
    provider,
    result: runStudyAgent({
      provider,
      question: 'What does Rule 18 require?',
      intent: 'custom',
      language: 'en',
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-18',
      tools: listTools('library'),
      ...over,
    }),
  }
}

beforeEach(async () => {
  clearRegistry()
  registerBuiltinTools()
  resetLibraryToolCache()
  await clearAllData()
})

describe('screenStudyQuestion', () => {
  it('refuses a question naming a departmental record', () => {
    expect(screenStudyQuestion('what about charge-sheet no. 42')).toMatchObject({ reason: 'departmental' })
    expect(screenStudyQuestion('FIR No. 118 of 2026')).not.toBeNull()
    expect(screenStudyQuestion('मामला संख्या 42 में क्या होगा')).not.toBeNull()
  })

  it('does NOT refuse the words that a rule book itself uses', () => {
    // Narrower than screenBrief() on purpose: the Official Secrets Act is one
    // of the fifteen works, so "secret" cannot be a trigger on this surface.
    expect(screenStudyQuestion('what does section 5 say about secret official codes')).toBeNull()
    expect(screenStudyQuestion('when is a document classified under Rule 11')).toBeNull()
    expect(screenStudyQuestion('what does Rule 14 require before a charge-sheet is drawn up')).toBeNull()
  })

  it('requires a digit, so a rule about records stays answerable', () => {
    expect(screenStudyQuestion('what is a case diary')).toBeNull()
    expect(screenStudyQuestion('what does the manual say about file numbers')).toBeNull()
  })

  it('sends NOTHING when it refuses', async () => {
    const { provider, result } = run([text('should not be reached')], {
      question: 'what happened in charge-sheet no. 9',
    })
    expect((await result).status).toBe('refused')
    // "We told the model to refuse" and "nothing was sent" are different
    // claims, and this is the one that matters.
    expect(provider.calls).toHaveLength(0)
  })
})

describe('caseAdviceSteer', () => {
  it('steers a question about the reader’s own matter', () => {
    expect(caseAdviceSteer('will I be punished for this')).not.toBeNull()
    expect(caseAdviceSteer('what should I do about my inquiry')).not.toBeNull()
    expect(caseAdviceSteer('मुझे क्या करना चाहिए')).not.toBeNull()
  })

  it('leaves an ordinary study question alone', () => {
    // `heuristics.ts#isPersonalQuery` matches "can I" and "should I", which
    // open a large share of perfectly ordinary questions here.
    expect(caseAdviceSteer('can I take commuted leave without a certificate')).toBeNull()
    expect(caseAdviceSteer('what does Rule 30 require')).toBeNull()
  })
})

describe('a successful run', () => {
  it('reads a unit, then answers from the numbered snippet', async () => {
    const { provider, result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      answer(),
    ])
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.status).toBe('answer')
    expect(outcome.answer.en).toContain('Rule 18')
    expect(outcome.snippets).toHaveLength(1)
    expect(outcome.snippets[0]).toMatchObject({ index: 2, kind: 'rule', personal: false })
    // Two model passes, forced by the citation rule — ADR-035.
    expect(provider.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('always ends with the app’s own disclaimer', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      answer(),
    ])
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.caveats.at(-1)).toEqual(STUDY_DISCLAIMER)
  })

  it('puts the case-advice caveat first when the question asked for one', async () => {
    const { result } = run(
      [call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }), text('Gathered [T1]'), answer()],
      { question: 'will I be punished if I do not report a purchase' },
    )
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.caveats[0]?.en).toContain('not advice about any particular case')
  })

  it('marks an answer that leaned on a study aid', async () => {
    const { result } = run([
      call('get_study_aid', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      answer(),
    ])
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.aidNote).toEqual(AID_NOTE)
    // The aid is a `note`, never a `rule`: a study aid and a provision read
    // alike in a prompt and only one of them is the law.
    expect(outcome.snippets[0]?.kind).toBe('note')
  })

  it('does not mark an aid note when no aid was read', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      answer(),
    ])
    expect(((await result) as Extract<StudyAgentResult, { status: 'answer' }>).aidNote).toBeNull()
  })
})

describe('the reader’s own notes', () => {
  beforeEach(async () => {
    await db.libraryNotes.put({
      id: 'n1',
      workId: 'ccs-conduct',
      unitId: 'ccs-conduct-18',
      body: 'I think this means sanction is always needed.',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
  })

  it('is not even offered as a tool unless the caller asked for it', async () => {
    const { provider, result } = run([text('Gathered nothing')], { includeNotes: false })
    await result
    const specs = provider.calls[0]?.tools ?? []
    // Absent, not present-and-forbidden: a tool that is absent cannot be
    // called, and one that is present and forbidden is an instruction away.
    expect(specs.map((tool) => tool.name)).not.toContain('get_my_notes')
  })

  it('is offered when the caller asked for it', async () => {
    const { provider, result } = run([text('Gathered nothing')], { includeNotes: true })
    await result
    expect((provider.calls[0]?.tools ?? []).map((tool) => tool.name)).toContain('get_my_notes')
  })

  it('labels a note snippet as the reader’s own, and marks the answer', async () => {
    const { result } = run(
      [
        call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
        call('get_my_notes', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }, 'c2'),
        text('Gathered [T1] [T2]'),
        json({
          answer: {
            en: 'The rule requires previous knowledge [2]; your own note says sanction is always needed [3].',
            hi: 'नियम पूर्व जानकारी अपेक्षित करता है [2]; आपकी अपनी टिप्पणी कहती है कि मंजूरी सदा चाहिए [3]।',
          },
          used: [2, 3],
        }),
      ],
      { includeNotes: true },
    )
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.status).toBe('answer')
    expect(outcome.snippets.find((snippet) => snippet.personal)).toBeDefined()
    expect(outcome.personalNote).toEqual(PERSONAL_NOTE)
  })

  it('REFUSES an answer that states a requirement resting only on a note', async () => {
    // The failure this guards is entirely plausible: every clause traceable,
    // the attribution wrong. A reader would have no way to tell.
    const { result } = run(
      [
        call('get_my_notes', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
        text('Gathered [T1]'),
        json({
          answer: {
            en: 'The rule requires previous sanction in every case [2].',
            hi: 'नियम प्रत्येक मामले में पूर्व मंजूरी अपेक्षित करता है [2]।',
          },
          used: [2],
        }),
      ],
      { includeNotes: true },
    )
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') {
      expect(outcome.code).toBe('invalid_citation')
      expect(outcome.message).toContain('note is not the law')
    }
  })
})

describe('misattributesPersonal', () => {
  it('fires when a requirement rests only on personal snippets', () => {
    expect(misattributesPersonal('The rule requires X [3].', [3], new Set([3]))).toBe(true)
    expect(misattributesPersonal('नियम अपेक्षित करता है [3]।', [3], new Set([3]))).toBe(true)
  })

  it('does not fire when a provision snippet is also used', () => {
    expect(
      misattributesPersonal('The rule requires X [2] and your note says Y [3].', [2, 3], new Set([3])),
    ).toBe(false)
  })

  it('does not fire on an answer that states no requirement', () => {
    expect(misattributesPersonal('You marked this passage earlier [3].', [3], new Set([3]))).toBe(false)
  })

  it('does not fire when the model claimed nothing', () => {
    expect(misattributesPersonal('The rule requires X.', [], new Set([3]))).toBe(false)
  })
})

describe('failure paths', () => {
  it('refuses an empty question without touching the provider', async () => {
    const { provider, result } = run([text('x')], { question: '   ' })
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('empty')
    expect(provider.calls).toHaveLength(0)
  })

  it('says so when the research pass read nothing at all', async () => {
    const { result } = run([text('Gathered nothing')])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') {
      expect(outcome.code).toBe('ungrounded')
      expect(outcome.message).toContain('read nothing')
    }
  })

  it('says so when a tool succeeded but found nothing', async () => {
    // `found: false` is `ok: true`. Gating on "did any tool succeed" would let
    // a run that read nothing pay for a second pass — ADR-035's own lesson.
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'no-such-unit' }),
      text('Gathered [T1]'),
      answer(),
    ])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('ungrounded')
  })

  it('TOLERATES an ungrounded research pass that had already gathered something', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      // No handle cited: `runAgent` fails this pass `ungrounded`. Its closing
      // sentence is discarded anyway, so the run continues — and says so.
      text('I have finished looking.'),
      answer(),
    ])
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.status).toBe('answer')
    expect(outcome.problems.join(' ')).toContain('ungrounded')
  })

  it('does NOT tolerate a research pass that failed for a real reason', async () => {
    // A tolerance with no test on its negative side is an unconditional bypass.
    const { result } = run([
      { content: [], stopReason: 'end_turn', throwError: { code: 'auth', message: 'bad key' } },
    ])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('auth')
  })

  it('discards an answer that states a rule number no snippet supports', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      json({
        answer: {
          en: 'This is governed by Rule 999 [2].',
          hi: 'यह नियम 999 से शासित है [2]।',
        },
        used: [2],
      }),
    ])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('invalid_citation')
  })

  it('discards an answer that cites nothing at all', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      json({
        answer: { en: 'Rule 18 requires knowledge.', hi: 'नियम 18 जानकारी अपेक्षित करता है।' },
        used: [],
      }),
    ])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('invalid_citation')
  })

  it('reports a shape the schema refuses rather than rendering it', async () => {
    const { result } = run([
      call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }),
      text('Gathered [T1]'),
      json({ answer: { en: 'only English' }, used: [2] }),
    ])
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('provider')
  })

  it('stops when the run is cancelled between stages', async () => {
    const controller = new AbortController()
    const { result } = run(
      [call('get_unit', { work: 'ccs-conduct', unit: 'ccs-conduct-18' }), text('Gathered [T1]'), answer()],
      { signal: controller.signal },
    )
    controller.abort()
    const outcome = await result
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.code).toBe('aborted')
  })
})

describe('the tier policy', () => {
  it('cuts Tier 0 to one tool-calling turn and one snippet', () => {
    expect(policyForTier('local')).toEqual({ researchSteps: 2, maxToolResults: 1, answerSentences: 2 })
    expect(policyForTier('byok').researchSteps).toBe(6)
  })

  it('reads only one tool result on Tier 0, and says how many it dropped', async () => {
    const { result } = run(
      [
        {
          content: [
            {
              type: 'tool_use',
              id: 'a',
              name: 'get_unit',
              input: { work: 'ccs-conduct', unit: 'ccs-conduct-18' },
            },
            {
              type: 'tool_use',
              id: 'b',
              name: 'get_study_aid',
              input: { work: 'ccs-conduct', unit: 'ccs-conduct-18' },
            },
          ],
          stopReason: 'tool_use',
        },
        text('Gathered [T1] [T2]'),
        answer(),
      ],
      { tier: 'local' },
    )
    const outcome = (await result) as Extract<StudyAgentResult, { status: 'answer' }>
    expect(outcome.snippets).toHaveLength(1)
    expect(outcome.problems.join(' ')).toContain('limit of 1')
  })
})

describe('partialAnswerText', () => {
  it('reads the answer out of half-arrived JSON', () => {
    expect(partialAnswerText('{"answer":{"en":"Rule 18 req', 'en')).toBe('Rule 18 req')
    expect(partialAnswerText('{"answer":{"en":"x","hi":"नियम', 'hi')).toBe('नियम')
  })

  it('stops at a half-arrived escape rather than consuming it', () => {
    // The regex requires a character after a backslash, so a stream that ends
    // mid-escape yields the text before it. Safe, and the partial is honest.
    expect(partialAnswerText('{"answer":{"en":"a\\', 'en')).toBe('a')
  })

  it('returns nothing rather than throwing on a raw control character', () => {
    // This is what makes the catch reachable: `[^"\\]` matches a literal
    // newline, and JSON.parse refuses an unescaped control character inside a
    // string. A branch nothing can reach would be worse than no branch.
    expect(partialAnswerText('{"answer":{"en":"a\nb', 'en')).toBe('')
  })

  it('returns nothing for a stream that has not reached the answer yet', () => {
    expect(partialAnswerText('', 'en')).toBe('')
    expect(partialAnswerText('{"an', 'en')).toBe('')
  })
})
