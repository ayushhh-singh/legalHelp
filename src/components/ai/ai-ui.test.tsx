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
    expect(within(dialog).getByText(/Nothing leaves the device/)).toBeInTheDocument()
    expect(within(dialog).getByText(/are sent to Anthropic/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Anthropic bills your own account/)).toBeInTheDocument()
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

    const options = within(tierGroup()).getAllByRole('radio')
    expect(options.map((option) => option.textContent?.split('No')[0]?.trim())).toBeTruthy()
    // Tier 0 needs the on-device model and Tier 2 needs a proxy URL; neither
    // ships here, so both are shown disabled with a reason rather than hidden.
    expect(screen.getByRole('radio', { name: /On this device/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Shared service/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Your own Anthropic key/ })).toBeEnabled()
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

  it('leaves nothing behind when the kill switch is used', async () => {
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
