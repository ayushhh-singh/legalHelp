import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import AiSettingsSection from './AiSettingsSection'
import { AiBanner } from './AiBanner'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import { ANTHROPIC_KEY_ID, hasStoredKey, storeSecret } from '@/ai/secrets'
import { useAppStore } from '@/app/store'
import { db } from '@/db'
import i18n from '@/i18n'

/**
 * Consent gating, from the outside. The point of these is that no sequence of
 * clicks reaches an enabled state without the notice having been accepted —
 * the same `consentVersion` the feature flag reads.
 */

const consented = { ...DEFAULT_AI_SETTINGS, consentVersion: CONSENT_VERSION, consentAt: '2026-08-28' }

beforeEach(() => {
  useAppStore.setState({ ai: DEFAULT_AI_SETTINGS })
})

const tierGroup = () => screen.getByRole('radiogroup', { name: 'How AI runs' })

describe('the AI settings section', () => {
  it('is visible, and off, on a fresh device', async () => {
    render(<AiSettingsSection />)

    expect(screen.getByRole('heading', { name: 'AI features' })).toBeInTheDocument()
    expect(screen.getByText('off')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/no network request of any kind/i)).toBeInTheDocument()
    })
  })

  it('disables every control until the notice is accepted', async () => {
    render(<AiSettingsSection />)

    for (const option of within(tierGroup()).getAllByRole('radio')) {
      expect(option).toBeDisabled()
    }
    expect(screen.getByLabelText('Model')).toBeDisabled()
    expect(screen.getByLabelText('Monthly token limit')).toBeDisabled()
    await waitFor(() => expect(useAppStore.getState().ai.consentVersion).toBe(0))
  })

  it('shows the classified-content rule in the notice before anything can be enabled', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))

    const dialog = screen.getByRole('dialog', { name: 'Before you turn on AI' })
    expect(
      within(dialog).getByText(/Never enter official, sensitive or classified content/),
    ).toBeInTheDocument()
    // Each tier states, in one line, what it sends.
    expect(within(dialog).getByText(/Nothing you type leaves the device/)).toBeInTheDocument()
    expect(within(dialog).getByText(/are sent to Anthropic/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Anthropic bills your own account/)).toBeInTheDocument()
    // Tier 0's line names the one thing that DOES cross the network on that
    // tier, and it is why CONSENT_VERSION went to 2 (ADR-037). "Nothing leaves
    // the device" full stop was true of a tier that did not exist yet.
    expect(within(dialog).getByText(/downloaded once, from its public host/)).toBeInTheDocument()
    // A build with no VITE_AI_PROXY_URL cannot offer the shared service, and
    // must not describe it either — the notice has to be about this app.
    expect(within(dialog).queryByText(/this app's operator/)).not.toBeInTheDocument()
  })

  it('records consent only when the reader accepts, not when they dismiss', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(useAppStore.getState().ai.consentVersion).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))
    await user.click(screen.getByRole('button', { name: 'I have read this — enable AI' }))

    await waitFor(() => expect(useAppStore.getState().ai.consentVersion).toBe(CONSENT_VERSION))
    // Consent alone does not turn anything on.
    expect(useAppStore.getState().ai.tier).toBe('off')
  })

  it('closes the notice on Escape without consenting', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAppStore.getState().ai.consentVersion).toBe(0)
  })

  it('offers only the tiers this build can actually run', async () => {
    useAppStore.setState({ ai: consented })
    render(<AiSettingsSection />)

    // Tier 0 and Tier 1 ship in every build, so both are selectable. Whether
    // this particular device can RUN Tier 0 is a WebGPU question answered
    // inside its own section, with the reason and with a smaller model to
    // fall back to — not by disabling the row (ADR-037).
    expect(screen.getByRole('radio', { name: /On this device/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Your own Anthropic key/ })).toBeEnabled()
    // Tier 2 has nowhere to send a request in a build with no
    // VITE_AI_PROXY_URL, and a permanently disabled control the reader can do
    // nothing about is noise rather than disclosure.
    expect(screen.queryByRole('radio', { name: /Shared service/ })).not.toBeInTheDocument()
    expect(within(tierGroup()).getAllByRole('radio')).toHaveLength(3)
    await waitFor(() => expect(screen.getByLabelText('Model')).toBeEnabled())
  })

  it('reports "needs setup" for a chosen tier with no key, and shows the banner', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ ai: consented })
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('radio', { name: /Your own Anthropic key/ }))

    await waitFor(() => expect(screen.getByText('needs setup')).toBeInTheDocument())
    expect(screen.getByText(/Do not enter official, sensitive or classified content/)).toBeInTheDocument()
    expect(screen.getByText('No key is stored.')).toBeInTheDocument()
  })

  it('refuses a key that is not an Anthropic key, and stores one that is', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ ai: { ...consented, tier: 'byok' } })
    render(<AiSettingsSection />)

    const field = screen.getByLabelText('Anthropic API key')
    await user.type(field, 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('That does not look like an Anthropic key.')).toBeInTheDocument()
    expect(await hasStoredKey()).toBe(false)

    await user.clear(field)
    await user.type(field, 'sk-ant-api03-real-looking')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    await waitFor(() => expect(useAppStore.getState().ai.hasKey).toBe(true))
    expect(await hasStoredKey()).toBe(true)
    // The plaintext is nowhere in the table.
    expect(JSON.stringify(await db.secrets.toArray())).not.toContain('sk-ant')
  })

  it('leaves nothing behind when the kill switch is used, and says so', async () => {
    const user = userEvent.setup()
    await storeSecret(ANTHROPIC_KEY_ID, 'sk-ant-api03-real-looking')
    useAppStore.setState({ ai: { ...consented, tier: 'byok', hasKey: true } })
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Turn off and delete' }))
    await user.click(screen.getByRole('button', { name: /Delete the stored key/ }))

    await waitFor(() => expect(useAppStore.getState().ai.tier).toBe('off'))
    expect(useAppStore.getState().ai.consentVersion).toBe(0)
    expect(await db.secrets.count()).toBe(0)
    expect(await db.aiAnswers.count()).toBe(0)

    // Turning AI off is what removes the kill switch's own reason to be on
    // screen, so its confirmation has to outlive it.
    expect(await screen.findByText('AI is off and nothing was left behind.')).toBeInTheDocument()
  })

  it('reports a key that could not be stored instead of failing silently', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ ai: { ...consented, tier: 'byok' } })
    // What an insecure origin looks like: no SubtleCrypto.
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: real.getRandomValues.bind(real) },
      configurable: true,
    })

    try {
      render(<AiSettingsSection />)
      await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-api03-real-looking')
      await user.click(screen.getByRole('button', { name: 'Save key' }))

      expect(await screen.findByText(/WebCrypto is unavailable/)).toBeInTheDocument()
      expect(useAppStore.getState().ai.hasKey).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
    }
  })

  it('lets the budget field be cleared and retyped without blocking every run', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ ai: consented })
    render(<AiSettingsSection />)

    const field = screen.getByLabelText('Monthly token limit')
    await user.clear(field)

    // An empty field must not commit 0 — a zero budget refuses every run.
    expect(useAppStore.getState().ai.monthlyTokenBudget).toBe(DEFAULT_AI_SETTINGS.monthlyTokenBudget)

    await user.type(field, '50000')
    await waitFor(() => expect(useAppStore.getState().ai.monthlyTokenBudget).toBe(50_000))
  })

  it('shows a model stored by a newer build rather than silently selecting another', () => {
    useAppStore.setState({ ai: { ...consented, model: 'claude-from-the-future' } })
    render(<AiSettingsSection />)

    const select = screen.getByLabelText('Model')
    expect(select).toHaveValue('claude-from-the-future')
    expect(within(select).getByRole('option', { name: 'claude-from-the-future' })).toBeInTheDocument()
  })

  it('drops a passed connection test when the model it proved is changed', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ ai: { ...consented, tier: 'byok', hasKey: true, model: 'claude-sonnet-4-6' } })
    await storeSecret(ANTHROPIC_KEY_ID, 'sk-ant-api03-real-looking')
    render(<AiSettingsSection />)

    await user.selectOptions(screen.getByLabelText('Model'), 'claude-haiku-4-5')
    expect(screen.queryByText('The key works.')).not.toBeInTheDocument()
  })
})

describe('the consent modal', () => {
  it('keeps Tab inside the dialog, including from the panel it opens focused on', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    const opener = screen.getByRole('button', { name: 'Read what this sends' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Before you turn on AI' })
    expect(dialog).toHaveFocus()

    const accept = within(dialog).getByRole('button', { name: 'I have read this — enable AI' })
    const cancel = within(dialog).getByRole('button', { name: 'Not now' })

    // The panel holds focus but is not itself in the tab order, and it is the
    // last element in the document. jsdom happens to wrap forward into the
    // dialog anyway, so this direction is a regression guard; the backwards
    // case below is the one that actually distinguishes the fix.
    await user.tab()
    expect(accept).toHaveFocus()

    await user.tab()
    expect(cancel).toHaveFocus()

    // And the far end wraps back rather than escaping.
    await user.tab()
    expect(accept).toHaveFocus()
  })

  it('wraps backwards from the panel to the last control, not out of the dialog', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))
    const dialog = screen.getByRole('dialog', { name: 'Before you turn on AI' })

    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toHaveFocus()
  })

  it('returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    const opener = screen.getByRole('button', { name: 'Read what this sends' })
    await user.click(opener)
    await user.keyboard('{Escape}')

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('stops the page behind it from scrolling, and gives that back on close', async () => {
    const user = userEvent.setup()
    render(<AiSettingsSection />)

    await user.click(screen.getByRole('button', { name: 'Read what this sends' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'))
  })
})

describe('AiBanner', () => {
  it('says what leaves the device, and says the opposite for a local tier', () => {
    const { rerender } = render(<AiBanner />)
    expect(screen.getByText(/What you type is sent off this device/)).toBeInTheDocument()

    rerender(<AiBanner localOnly />)
    expect(screen.getByText(/Nothing you type leaves this device/)).toBeInTheDocument()
  })

  it('renders in Hindi with no English left behind', async () => {
    await i18n.changeLanguage('hi')
    render(<AiBanner />)

    expect(screen.getByText('AI के उत्तर ग़लत हो सकते हैं।')).toBeInTheDocument()
    expect(screen.queryByText(/AI answers can be wrong/)).not.toBeInTheDocument()
  })
})
