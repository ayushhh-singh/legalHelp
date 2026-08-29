import { beforeEach, describe, expect, it } from 'vitest'

import { mentionedSections, runLawAgent } from './law'
import {
  CHEATING_ANSWER,
  CHEATING_CALLS,
  SEDITION_ANSWER,
  SEDITION_CALLS,
  STALKING_ANSWER,
  STALKING_CALLS,
  lawScript,
} from '../fixtures/law-scripts'
import { MockProvider } from '../providers/mock'
import { clearRegistry, listTools } from '../tools/registry'
import { resetLawToolCache } from '../tools/law'
import { registerBuiltinTools } from '../tools/index'

/**
 * An edge-case pass over the law research agent, run after the commit that
 * built it — the same exercise ADR-032's addendum records for the drafting
 * agent, and it found the same SHAPE of defect it did.
 *
 * **Every test in this file was confirmed to fail against the committed code
 * before its fix was written.** A regression test that has never been red is a
 * test of nothing.
 *
 * The pattern in what it found is worth stating, because it is the pattern
 * ADR-032 named and this agent repeated: the MODEL's half of the run was
 * written defensively and the agent's own half was not. The model is obviously
 * untrusted, so every value it returns is validated, re-derived and dropped
 * when unsupported — while the code around it assumed a tool always returns
 * something usable, a question always has words in it, and a cancelled run had
 * already stopped.
 */

beforeEach(() => {
  clearRegistry()
  resetLawToolCache()
  registerBuiltinTools()
})

const tools = () => listTools('law')

/* ------------------------------------------------------------------ *
 * 1. Reading nothing is not the same as calling nothing
 * ------------------------------------------------------------------ */

describe('a run whose tools all came back empty', () => {
  /**
   * The committed code only checked whether any tool SUCCEEDED, and a lookup of
   * a section that does not exist succeeds — `get_section` returns
   * `{ found: false }` rather than throwing. So a run that read nothing at all
   * still paid for a second model pass, over a context containing the reader's
   * own question and not one row of statute.
   *
   * Worse than the wasted tokens: the only thing that context CAN support is a
   * number the reader themselves typed, so the likeliest outcome is an answer
   * built from the question, which is exactly the failure grounding exists to
   * prevent.
   */
  it('stops before the answer pass when no tool result produced a snippet', async () => {
    const provider = new MockProvider(
      lawScript('found-nothing', {
        calls: [[{ name: 'get_section', input: { code: 'bns', section: '9999' } }]],
        answer: CHEATING_ANSWER,
      }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What does BNS 9999 say?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('ungrounded')
    expect(result.message).toContain('read nothing from the section tables')
    /*
      Two calls, both the research pass's: one turn to request the tool and one
      to finish. A THIRD would be the answer pass, and that is the one this
      stops — asserting `1` here would be asserting that the research pass
      never ran.
    */
    expect(provider.calls).toHaveLength(2)
    expect(result.toolsCalled).toEqual(['get_section'])
  })

  it('does the same for a search that matched nothing at all', async () => {
    const provider = new MockProvider(
      lawScript('search-empty', {
        calls: [[{ name: 'search_sections', input: { query: 'zzzqqqxxx nonsense phrase' } }]],
        answer: CHEATING_ANSWER,
      }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What is the section for zzzqqqxxx?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('ungrounded')
    // The research pass's two turns, and no answer pass.
    expect(provider.calls).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ *
 * 2. A question with no question in it
 * ------------------------------------------------------------------ */

describe('an empty question', () => {
  /**
   * `improveWording` in the drafting agent already refuses to rewrite an empty
   * field, for the reason stated there: asking a model to improve nothing
   * spends the reader's tokens on inventing content. The same argument applies
   * to a question, and the same guard was missing here — the panel's own button
   * is disabled on a blank box, but the agent is a module anything may call and
   * it is the agent that spends the money.
   */
  it.each([
    ['empty', ''],
    ['whitespace', '   \n  '],
  ])('refuses a %s question without calling the provider', async (_label, question) => {
    const provider = new MockProvider(lawScript('unused', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }))

    const result = await runLawAgent({ provider, question, language: 'en', tools: tools() })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('empty')
    expect(provider.calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * 3. A year is not a section number
 * ------------------------------------------------------------------ */

describe('the section-mention scan', () => {
  /**
   * `SECTION_MENTION` reads a number after an Act abbreviation as a section, so
   * "the BNS 2023 replaced the IPC 1860" named two provisions that were never
   * cited, and a completely correct answer was discarded.
   *
   * The guard is data-backed rather than a heuristic: the longest of the six
   * Acts is the BNSS at 531 sections, so a four-digit section does not exist in
   * any of them and cannot be lost by refusing to read one.
   */
  it.each([
    ['a year after the new Act', 'The BNS 2023 replaced the IPC 1860.'],
    ['a year after a repealed Act', 'The IEA 1872 was repealed.'],
    ['a commencement year', 'All three came into force in 2024 under the BNSS 2023.'],
  ])('does not read %s as a section number', (_label, text) => {
    expect(mentionedSections(text)).toEqual([])
  })

  it('still reads every real section number, including the highest one there is', () => {
    expect(mentionedSections('BNSS 531 is the saving provision').map((one) => one.full)).toEqual(['531'])
    expect(mentionedSections('Section 318(4) of the BNS').map((one) => one.full)).toEqual(['3184'])
    expect(mentionedSections('BNS 103 and IPC 302').map((one) => one.written)).toEqual(['103', '302'])
  })

  it('does not discard an otherwise correct answer that names a year', async () => {
    const provider = new MockProvider(
      lawScript('year-in-answer', {
        calls: SEDITION_CALLS,
        answer: {
          ...SEDITION_ANSWER,
          answer: {
            en: 'Section 124A IPC has no counterpart; the BNS 2023 puts the nearest offence at Section 152 [2].',
            hi: 'भा.दं.सं. की धारा 124A का कोई तत्स्थानी नहीं; भा.न्या.सं. 2023 में निकटतम अपराध धारा 152 है [2]।',
          },
        },
      }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What changed in sedition?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('answer')
  })
})

/* ------------------------------------------------------------------ *
 * 4. 124 and 124A are different sections
 * ------------------------------------------------------------------ */

describe('a section number that differs only by its letter suffix', () => {
  /**
   * The support index and the mention scan both reduced a reference to its
   * DIGITS, so `124` and `124A` were the same key. IPC 124A is sedition; IPC
   * 124 is assaulting the President or a Governor — two unrelated offences.
   *
   * That made a citation of "IPC 124" look supported by a tool result that had
   * only ever read 124A, and a repealed-Act citation takes the
   * `oldActCitation` path, which does no dataset lookup — so nothing else
   * downstream could catch it. The reader would get a chip reading "Section 124
   * IPC" under an answer about sedition, and clicking it opens a real section
   * about a different crime, which is worse than an obviously broken link.
   *
   * The same collision exists for 65B/65 and 376AB/376.
   */
  it('does not let a citation of 124 ride on a tool result about 124A', async () => {
    const provider = new MockProvider(
      lawScript('suffix-collision', {
        calls: SEDITION_CALLS,
        answer: {
          ...SEDITION_ANSWER,
          answer: {
            en: 'Sedition was Section 124A IPC; the nearest new offence is Section 152 of the BNS [2].',
            hi: 'राजद्रोह भा.दं.सं. की धारा 124A था; निकटतम नया अपराध भा.न्या.सं. की धारा 152 है [2]।',
          },
          citations: [
            { act: 'IPC', section: '124', toolResultId: 'T1' },
            { act: 'BNS', section: '152', toolResultId: 'T1' },
          ],
        },
      }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What changed in sedition?',
      language: 'en',
      tools: tools(),
    })

    // The answer names 124A, which is now in no citation, so the whole answer
    // is discarded rather than shown with a chip pointing at another offence.
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('invalid_citation')
    expect(result.message).toContain('124A')
  })

  it('still matches a sub-section against the section that was read', async () => {
    // `get_classification` reads BNS 318 and reports rows per sub-section; the
    // answer cites 318(4). Those must still meet, or the working case breaks.
    const provider = new MockProvider(
      lawScript('subsection-ok', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('answer')
    if (result.status !== 'answer') return
    expect(result.citations.map((one) => `${one.act} ${one.section}`)).toEqual(['IPC 420', 'BNS 318(4)'])
  })

  it('reads a lettered reference as itself, not as its bare number', () => {
    expect(mentionedSections('Section 124A IPC').map((one) => one.full)).toEqual(['124A'])
    expect(mentionedSections('IEA 65B').map((one) => one.full)).toEqual(['65B'])
    // And a lettered reference is still not mistaken for a year.
    expect(mentionedSections('Section 124A and section 124').map((one) => one.full)).toEqual(['124', '124A'])
  })
})

/* ------------------------------------------------------------------ *
 * 5. A provision the new Act simply dropped
 * ------------------------------------------------------------------ */

describe('a repealed provision with no counterpart', () => {
  /**
   * `compare_old_new`'s `status: 'dropped'` branch had no test at all, and it
   * is the branch that matters most on this surface: IPC 377, 497 and 309 have
   * NO corresponding provision in the BNS, and the wrong answer to "what is the
   * BNS equivalent of 377" is a section number rather than an error.
   *
   * The tool's own description says so ("Do not assume a provision carried
   * over"), and stage 3 must carry that through as a snippet the model can
   * cite — otherwise the only grounded thing it can say is "I could not find
   * it", which reads as a broken lookup rather than the legal answer it is.
   *
   * Unlike the rest of this file, this test found NO defect: the branch was
   * already right. It is kept because it had no coverage at all, and an
   * untested branch that happens to work is one edit away from not working.
   */
  it('carries "no counterpart" through to a citable snippet', async () => {
    const provider = new MockProvider(
      lawScript('dropped', {
        calls: [[{ name: 'compare_old_new', input: { oldAct: 'IPC', oldSection: '377' } }]],
        answer: {
          answer: {
            en: 'Section 377 IPC has NO counterpart in the BNS — the new Act carries no equivalent provision [2].',
            hi: 'भा.दं.सं. की धारा 377 का भा.न्या.सं. में कोई तत्स्थानी उपबंध नहीं है [2]।',
          },
          citations: [{ act: 'IPC', section: '377', toolResultId: 'T1' }],
        },
      }),
    )

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of IPC 377?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('answer')
    if (result.status !== 'answer') return

    // The snippet the model was given says it outright, in words it can cite,
    // and carries the curated note from `data/law/overlays/` with it.
    const context = provider.calls.at(-1)?.system.at(-1)?.text ?? ''
    expect(context).toContain('This provision was DROPPED: the new Act has no counterpart to it.')
    expect(context).toContain('Section 377 of the IPC')
    expect(context).toContain('no corresponding provision in the BNS')

    // And the citation resolves against the repealed Act, not a new-Act guess.
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]?.citation.en).toBe('Section 377 IPC')
    expect(result.citations[0]?.code).toBe('bns')
    expect(result.problems).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 6. Hand-authored Hindi has to say so, here as well as on the card
 * ------------------------------------------------------------------ */

describe('curated Hindi', () => {
  /**
   * Every one of the 1,059 records in `data/law` carries `verify: true`,
   * because the HINDI on it is hand-authored by this app and the source
   * publishes none (`docs/DATA-GAPS.md` #18). `SectionResultCard.tsx` marks
   * that with a marigold "Verify" banner, and CLAUDE.md states the rule
   * outright: it is the one place a reader could mistake hand-authored text for
   * the Act, so keep both halves when you touch either.
   *
   * The Ask panel was the second half and it had nothing. A reader asking in
   * Hindi got hand-authored Hindi headings back with no marker at all — while
   * the very same section, opened in the card two inches below, carried the
   * banner. The agent knows which sections are curated (the tools return
   * `hindiIsCurated`), so this is a fact the app can state rather than an
   * instruction the model was given and may or may not have followed.
   *
   * Hindi only, exactly as the card does it: the English is the official text
   * either way, and a banner shown to an English reader is a false alarm — which
   * is how readers learn to stop reading banners.
   */
  it('adds a caveat to a Hindi answer whose cited Hindi is hand-authored', async () => {
    const provider = new MockProvider(
      lawScript('curated-hi', { calls: STALKING_CALLS, answer: STALKING_ANSWER }),
    )

    const result = await runLawAgent({
      provider,
      question: 'पीछा करने की धारा कौन-सी है?',
      language: 'hi',
      tools: tools(),
    })

    expect(result.status).toBe('answer')
    if (result.status !== 'answer') return
    // Carried as text on the result, not folded into `caveats`, so the panel
    // can follow the language toggle — see the field's own note.
    expect(result.curatedHindiNote?.hi).toContain('सहायक')
    expect(result.curatedHindiNote?.en).toContain('hand-authored')
    expect(result.caveats.some((caveat) => caveat.en.includes('hand-authored'))).toBe(false)
  })

  it('does not show it to an English reader, for whom nothing is curated', async () => {
    const provider = new MockProvider(
      lawScript('curated-en', { calls: STALKING_CALLS, answer: STALKING_ANSWER }),
    )

    const result = await runLawAgent({
      provider,
      question: 'Which section covers stalking?',
      language: 'en',
      tools: tools(),
    })

    expect(result.status).toBe('answer')
    if (result.status !== 'answer') return
    // The FACT is reported either way — it is about the sections, not the
    // reader — and the panel is what decides not to show it in English.
    expect(result.curatedHindiNote).not.toBeNull()
    expect(result.caveats.some((caveat) => caveat.en.includes('hand-authored'))).toBe(false)
    // The date rule and the disclaimer, and nothing else.
    expect(result.caveats).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ *
 * 7. A cancelled run must not return an answer
 * ------------------------------------------------------------------ */

describe('cancellation during the local stages', () => {
  /**
   * `runAgent` checks the signal at the top of each of ITS loops, and this
   * agent checked it after each model pass. Stage 5 sits after the last of
   * those checks and awaits `format_citation` twice per citation, so a run
   * cancelled while the citations were being resolved went on to return a
   * complete answer — the identical defect ADR-032's addendum records for the
   * drafting agent, which is what made it worth looking for here.
   *
   * `useLawAsk` happens to drop the result of an aborted run before it reaches
   * the screen, which is exactly why this needs a test at the agent: the bug is
   * invisible from the UI and the agent is what other callers will use.
   */
  it('returns aborted, not an answer, when cancelled while verifying', async () => {
    const provider = new MockProvider(
      lawScript('cancel-verify', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const controller = new AbortController()

    const result = await runLawAgent({
      provider,
      question: 'What is the BNS equivalent of 420?',
      language: 'en',
      tools: tools(),
      signal: controller.signal,
      onProgress: (step) => {
        if (step.phase === 'verifying') controller.abort()
      },
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('aborted')
  })
})
