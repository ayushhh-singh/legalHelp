import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AskPanel } from './components/AskPanel'
import type { LawCorpus, LawDataset, LawIndex } from './types'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import { CHEATING_ANSWER, CHEATING_CALLS, lawScript } from '@/ai/fixtures/law-scripts'
import { MockProvider } from '@/ai/providers/mock'
import { clearRegistry } from '@/ai/tools/registry'
import { resetLawToolCache } from '@/ai/tools/law'
import type { UseAi } from '@/ai/useAi'
import i18n from '@/i18n'
import { readFromRoot } from '@/test/paths'

/**
 * The edge-case pass's UI half. Same rule as `law.edge.test.ts`: every test
 * here was confirmed to fail against the committed code before its fix existed.
 */

const load = <T,>(file: string): T => JSON.parse(readFromRoot('data/law', file)) as T

vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  loadCorpus: () =>
    Promise.resolve<LawCorpus>({
      index: load<LawIndex>('index.json'),
      datasets: {
        bns: load<LawDataset>('bns.json'),
        bnss: load<LawDataset>('bnss.json'),
        bsa: load<LawDataset>('bsa.json'),
      },
    }),
}))

const originalClipboard = navigator.clipboard

beforeEach(() => {
  clearRegistry()
  resetLawToolCache()
})

afterEach(() => {
  Object.assign(navigator, { clipboard: originalClipboard })
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

async function answerOnScreen(provider: MockProvider) {
  render(<AskPanel ai={aiState({ provider })} offenceDate={null} onOpenCitation={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('What do you want to know?'), 'BNS equivalent of 420?')
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return screen.findByRole('region', { name: 'The answer' }, { timeout: 8_000 })
}

describe('the window where the tier is ready but the provider is not', () => {
  /**
   * `useAi().ready` is computed synchronously from the settings row, while
   * `provider` is the result of a dynamic import and arrives a tick or two
   * later. So there is a real window — the first moment the panel appears —
   * where the input is rendered, Ask is enabled, and pressing it throws "The AI
   * provider is not ready" into a red alert.
   *
   * Nothing is broken in that window; the reader was simply early. An error
   * banner for a condition that resolves on its own teaches people that the
   * feature is flaky, so the button waits instead.
   */
  it('keeps Ask disabled until the provider has actually resolved', async () => {
    const { rerender } = render(
      <AskPanel ai={aiState({ provider: null })} offenceDate={null} onOpenCitation={vi.fn()} />,
    )

    await userEvent.type(screen.getByLabelText('What do you want to know?'), 'Is BNS 318(4) bailable?')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()

    const provider = new MockProvider(
      lawScript('late-provider', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    rerender(<AskPanel ai={aiState({ provider })} offenceDate={null} onOpenCitation={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
    // And nothing was said about a failure that never happened.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the language toggle after an answer has arrived', () => {
  /**
   * Equal bilingual footing is a hard rule of this project and the toggle is on
   * every screen, so an answer already on the page has to survive one — the
   * text, the citations, the caveats and the curated-Hindi mark all switch.
   *
   * The mark is the part that needed the design change. The agent computes it
   * at the end of a run, and folding it into `caveats` there would have frozen
   * it to the language the question was asked in: ask in English, switch to
   * Hindi to read the Hindi phrasing, and the hand-authored Hindi would have
   * been unmarked — on the one surface whose whole job is to say where a number
   * came from. `SectionResultCard.tsx` has been reactive about this since
   * Session 4; this brings the panel into line.
   */
  it('switches the answer, and shows the curated-Hindi mark only in Hindi', async () => {
    const provider = new MockProvider(lawScript('toggle', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }))
    const answer = await answerOnScreen(provider)

    // English first: the answer's English half, and no curated-Hindi mark,
    // because the English IS the official text.
    expect(within(answer).getByText(/now falls under/)).toBeInTheDocument()
    expect(within(answer).queryByText(/hand-authored by Sahayak/)).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('hi')
    })

    const hindi = await screen.findByRole('region', { name: 'उत्तर' })
    expect(within(hindi).getByText(/अजमानतीय/)).toBeInTheDocument()
    // The mark appears now, on the same answer, with no second run.
    expect(within(hindi).getByText(/सहायक द्वारा स्वयं लिखा गया है/)).toBeInTheDocument()
    // The disclaimer switched too, rather than staying in English.
    expect(within(hindi).getByText(/केवल संदर्भ हेतु/)).toBeInTheDocument()
    expect(provider.calls).toHaveLength(4)
  })
})

describe('copying an answer when the clipboard refuses', () => {
  /**
   * Every other copy affordance in this app — `SectionActions.tsx`,
   * `TermRow.tsx`, `PortalsPage.tsx`, the pay slip, the drafting export —
   * wraps `navigator.clipboard.writeText` in a try/catch and announces a
   * failure. This one did not, so a browser that refuses the clipboard (an
   * insecure origin, a permission denied, a locked-down managed device — none
   * of them exotic on a government laptop) produced an unhandled promise
   * rejection and a button that silently did nothing.
   *
   * Silence is the defect. A reader who presses Copy and sees no confirmation
   * has no way to tell whether it worked, and the answer they are about to
   * paste into a file may be the previous clipboard contents.
   */
  it('tells the reader instead of failing silently', async () => {
    const rejection = vi.fn()
    globalThis.addEventListener('unhandledrejection', rejection)

    Object.assign(navigator, {
      clipboard: { writeText: () => Promise.reject(new Error('Denied.')) },
    })

    const provider = new MockProvider(
      lawScript('copy-refused', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const answer = await answerOnScreen(provider)

    await userEvent.click(within(answer).getByRole('button', { name: /Copy answer with citations/ }))

    /*
      Announced, and inside a live region — the rule `tests/e2e/keyboard.spec.ts`
      enforces for every copy confirmation in this app. `role="alert"` counts
      and is the right one HERE: the success confirmation is a polite
      `role="status"`, but a copy that did not happen is something the reader
      has to know before they paste, which is what assertive means. The two
      other alerts in this panel (refused, error) are marked the same way.
    */
    const message = await screen.findByText('The browser would not let this app use the clipboard.')
    expect(message.closest('[aria-live], [role="status"], [role="alert"]')).not.toBeNull()

    await waitFor(() => expect(rejection).not.toHaveBeenCalled())
    globalThis.removeEventListener('unhandledrejection', rejection)
  })

  it('still announces success when the clipboard works', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })

    const provider = new MockProvider(
      lawScript('copy-ok', { calls: CHEATING_CALLS, answer: CHEATING_ANSWER }),
    )
    const answer = await answerOnScreen(provider)

    await userEvent.click(within(answer).getByRole('button', { name: /Copy answer with citations/ }))

    await screen.findByText('Answer and citations copied.')
    expect(
      screen.queryByText('The browser would not let this app use the clipboard.'),
    ).not.toBeInTheDocument()
  })
})
