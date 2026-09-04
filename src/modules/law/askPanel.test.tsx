import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConverterPage from './ConverterPage'
import { AskPanel } from './components/AskPanel'
import type { LawCorpus, LawDataset, LawIndex } from './types'
import { resetEngineCache } from './useLawEngine'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import {
  CHEATING_ANSWER,
  CHEATING_CALLS,
  SEDITION_ANSWER,
  SEDITION_CALLS,
  lawScript,
} from '@/ai/fixtures/law-scripts'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import { resetLawToolCache } from '@/ai/tools/law'
import type { UseAi } from '@/ai/useAi'
import { readFromRoot } from '@/test/paths'

/**
 * The "Ask" panel, driven end to end against `MockProvider`.
 *
 * The provider is handed in through `ai.provider` exactly as `useAi()` would
 * hand in a real one, so pressing Ask runs the REAL agent — both passes, the
 * real tools over the committed `data/law/*.json`, the citation verification —
 * against scripted model turns. A test that stubbed `useLawAsk` would assert
 * that this component renders the props it was given, which is not the thing
 * that can be wrong.
 */

const load = <T,>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

const realCorpus = (): LawCorpus => ({
  index: load<LawIndex>('index.json'),
  datasets: {
    bns: load<LawDataset>('bns.json'),
    bnss: load<LawDataset>('bnss.json'),
    bsa: load<LawDataset>('bsa.json'),
  },
})

const loadCorpus = vi.fn(() => Promise.resolve(realCorpus()))

vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  loadCorpus: () => loadCorpus(),
}))

beforeEach(() => {
  clearRegistry()
  resetLawToolCache()
})

afterEach(() => {
  resetEngineCache()
})

const aiState = (over: Partial<UseAi> = {}): UseAi => ({
  enabled: true,
  ready: true,
  tier: 'byok',
  settings: { ...DEFAULT_AI_SETTINGS, tier: 'byok', consentVersion: CONSENT_VERSION, hasKey: true },
  provider: null,
  budget: null,
  error: null,
  refreshBudget: () => Promise.resolve(),
  ...over,
})

function setup(over: { ai?: Partial<UseAi>; offenceDate?: string | null } = {}) {
  const onOpenCitation = vi.fn()
  const utils = render(
    <AskPanel ai={aiState(over.ai)} offenceDate={over.offenceDate ?? null} onOpenCitation={onOpenCitation} />,
  )
  return { ...utils, onOpenCitation }
}

const askWith = async (provider: MockProvider, question: string, offenceDate: string | null = null) => {
  const harness = setup({ ai: { provider }, offenceDate })
  await userEvent.type(screen.getByLabelText('What do you want to know?'), question)
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return harness
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

describe('the panel and the consent gate', () => {
  it('renders nothing at all when AI is off', () => {
    const { container } = setup({ ai: { enabled: false, ready: false, tier: 'off' } })
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * Consent given but no key yet: the panel explains itself and offers no way
   * to spend anything. A surface that showed a working input and then failed on
   * the press would teach a reader to distrust the whole feature.
   */
  it('shows the notice but no input when the tier is not ready', () => {
    setup({ ai: { ready: false } })
    expect(screen.getByRole('complementary', { name: 'AI notice' })).toBeInTheDocument()
    expect(screen.getByText(/Add your Anthropic key in Settings/)).toBeInTheDocument()
    expect(screen.queryByLabelText('What do you want to know?')).not.toBeInTheDocument()
  })

  it('carries the standing AI notice permanently, above the input', () => {
    setup()
    const banner = screen.getByRole('complementary', { name: 'AI notice' })
    expect(banner).toBeInTheDocument()
    expect(
      within(banner).getByText(/Do not enter official, sensitive or classified content/),
    ).toBeInTheDocument()
    // It is not dismissible: there is no control inside it at all.
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
  })

  it('will not spend anything until there is a question', async () => {
    // A resolved provider, so the only thing this test varies is the question —
    // Ask is also gated on the provider having arrived (askPanel.edge.test.tsx).
    const provider = new MockProvider(lawScript('idle', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }))
    setup({ ai: { provider } })

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('What do you want to know?'), 'x')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
  })
})

/* ------------------------------------------------------------------ *
 * A whole answer, through the real agent
 * ------------------------------------------------------------------ */

describe('an answer', () => {
  it('shows the answer, its sources and the caveats the app adds', async () => {
    const provider = new MockProvider(
      lawScript('panel-cheating', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    await askWith(provider, 'What is the BNS equivalent of 420, and is it bailable?')

    const answer = await screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
    expect(within(answer).getByText(/now falls under/)).toBeInTheDocument()

    // The citation chips carry the citation `format_citation` produced, not a
    // string the model wrote.
    expect(
      within(answer).getByRole('button', { name: /Section 318\(4\) of the Bharatiya Nyaya Sanhita/ }),
    ).toBeInTheDocument()
    // Anchored: the BNS chip's own citation NAMES the repealed section in its
    // parenthesis, so an unanchored match finds both chips.
    expect(within(answer).getByRole('button', { name: /^open Section 420 IPC$/ })).toBeInTheDocument()

    // The date rule and the disclaimer are always there, whatever the model wrote.
    expect(within(answer).getByText(/DATE OF THE OFFENCE/)).toBeInTheDocument()
    expect(
      within(answer).getByText('Reference only; verify with the official gazette/order or your DDO.'),
    ).toBeInTheDocument()
  })

  it('opens the cited section when a source chip is pressed', async () => {
    const provider = new MockProvider(
      lawScript('panel-open', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const { onOpenCitation } = await askWith(provider, 'What is the BNS equivalent of 420?')

    const answer = await screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
    await userEvent.click(
      within(answer).getByRole('button', { name: /Section 318\(4\) of the Bharatiya Nyaya Sanhita/ }),
    )

    expect(onOpenCitation).toHaveBeenCalledTimes(1)
    expect(onOpenCitation.mock.calls[0]?.[0]).toMatchObject({ act: 'BNS', code: 'bns', section: '318(4)' })
  })

  /**
   * The `[n]` marks in the answer text are the citation, not a footnote about
   * one. Mark [3] here points at the First Schedule snippet, which is about
   * section 318 while the answer cites 318(4) — the two have to meet at the
   * section, and the obvious `startsWith` version of that would also pair a
   * snippet about section 31 with a citation of 318.
   */
  it('turns each [n] mark in the answer into a button that opens its source', async () => {
    const provider = new MockProvider(
      lawScript('panel-marks', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const { onOpenCitation } = await askWith(provider, 'What is the BNS equivalent of 420?')

    const answer = await screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
    // The raw marks are gone from the rendered text; each is a control now.
    expect(within(answer).queryByText(/\[2\]/)).not.toBeInTheDocument()

    const mark = within(answer).getByRole('button', { name: 'open BNS 318' })
    await userEvent.click(mark)
    expect(onOpenCitation.mock.calls[0]?.[0]).toMatchObject({ act: 'BNS', section: '318(4)' })

    await userEvent.click(within(answer).getByRole('button', { name: 'open IPC 420' }))
    expect(onOpenCitation.mock.calls[1]?.[0]).toMatchObject({ act: 'IPC', section: '420' })
  })

  it('copies the answer WITH its citations and the disclaimer', async () => {
    // Typed on the parameter, not inferred: `vi.fn(() => …)` infers a zero-arg
    // signature, so `mock.calls[0]` is the empty tuple and reading `[0]` off it
    // is a compile error rather than the string this test is about.
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })

    const provider = new MockProvider(
      lawScript('panel-copy', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    await askWith(provider, 'What is the BNS equivalent of 420?')

    const answer = await screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
    await userEvent.click(within(answer).getByRole('button', { name: /Copy answer with citations/ }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]?.[0] ?? ''
    expect(copied).toContain('Citations:')
    expect(copied).toContain('Section 318(4) of the Bharatiya Nyaya Sanhita, 2023')
    expect(copied).toContain('Reference only; verify with the official gazette/order or your DDO.')

    // Every copy affordance in this app announces itself.
    await screen.findByText('Answer and citations copied.')
  })

  it('uses the converter’s offence date to say which code applies', async () => {
    const provider = new MockProvider(
      lawScript('panel-date', { calls: SEDITION_CALLS, answer: SEDITION_ANSWER }),
    )
    await askWith(provider, 'What changed in sedition?', '2024-06-20')

    const answer = await screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
    expect(within(answer).getByText(/before 1 July 2024/)).toBeInTheDocument()
    expect(within(answer).getByText(/531\(2\)/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * When it will not answer
 * ------------------------------------------------------------------ */

describe('when it will not answer', () => {
  it('refuses a question naming a departmental record without calling the provider', async () => {
    const provider = new MockProvider(
      lawScript('panel-refused', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    await askWith(provider, 'Which section applies to FIR No. 112/2024?')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Not sent.')).toBeInTheDocument()
    expect(within(alert).getByText(/names a departmental record/)).toBeInTheDocument()
    expect(provider.calls).toHaveLength(0)
  })

  /**
   * The "why can't it answer" note. `ungrounded` and `invalid_citation` are the
   * grounding rule working; a reader told only "that did not finish" would
   * reasonably conclude the app was broken rather than careful.
   */
  it('explains the grounding rule when an answer could not be sourced', async () => {
    const provider = new MockProvider(
      lawScript('panel-ungrounded', {
        calls: CHEATING_CALLS,
        answer: {
          ...CHEATING_ANSWER,
          answer: {
            en: 'Section 420 IPC is now Section 318(4) of the BNS and it is bailable.',
            hi: 'भा.दं.सं. की धारा 420 अब भा.न्या.सं. की धारा 318(4) है।',
          },
        },
      }),
    )
    await askWith(provider, 'What is the BNS equivalent of 420?')

    const alert = await screen.findByRole('alert', {}, { timeout: 8_000 })
    expect(within(alert).getByText('It would not answer that.')).toBeInTheDocument()
    expect(within(alert).getByText(/has to come from the section tables on this device/)).toBeInTheDocument()
    // And it says what it did read, so the reader knows the question reached
    // the right tables.
    expect(within(alert).getByText(/compare_old_new/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * Inside the converter
 * ------------------------------------------------------------------ */

describe('inside the Law Converter', () => {
  const renderConverter = () =>
    render(
      <MemoryRouter initialEntries={['/law']}>
        <Routes>
          <Route path="/law" element={<ConverterPage />} />
        </Routes>
      </MemoryRouter>,
    )

  /**
   * The acceptance check the brief names: with AI off — every device's default
   * — there is no Ask input. `useAi()` reads the hydrated settings row, which
   * `src/test/setup.ts` clears before every test, so this is the real default
   * rather than a mocked one.
   */
  it('shows no Ask input at all when AI is off', async () => {
    renderConverter()
    // The converter is a sub-tab of the Law section now, so its own masthead
    // is an `<h2>` — `TabLayout` owns the `<h1>` (ADR-046).
    await screen.findByRole('heading', { level: 2, name: 'Law Converter' })

    expect(screen.queryByRole('heading', { name: 'Ask about a section' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('What do you want to know?')).not.toBeInTheDocument()
    // Not merely hidden: the panel's own chunk is never asked for either, which
    // is the property `tests/bundle-budget.test.ts` measures from the other end.
    expect(screen.queryByRole('complementary', { name: 'AI notice' })).not.toBeInTheDocument()
  })
})
