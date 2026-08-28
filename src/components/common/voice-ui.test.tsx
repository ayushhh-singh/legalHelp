import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceSearchButton } from './VoiceSearchButton'

import { useAppStore } from '@/app/store'
import { isVoiceEnabled, VOICE_CONSENT_VERSION } from '@/lib/voiceConsent'

/**
 * The microphone button, and the one property worth more than all the others:
 * IT CANNOT OPEN THE MICROPHONE WITHOUT CONSENT.
 *
 * Speech recognition is a network service in Chrome, so a recogniser that gets
 * constructed before the reader has read the notice is a hard-rule breach, not
 * a UI bug. Every test below that counts constructions is checking that.
 */

let constructed = 0
let instances: FakeRecognition[] = []

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() {
    constructed += 1
    instances.push(this)
  }
}

beforeEach(() => {
  constructed = 0
  instances = []
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true })
})

afterEach(async () => {
  Reflect.deleteProperty(window, 'SpeechRecognition')
  await useAppStore.getState().setVoice({ enabled: false, consentVersion: 0, consentAt: null })
})

const consent = () =>
  useAppStore.getState().setVoice({
    enabled: true,
    consentVersion: VOICE_CONSENT_VERSION,
    consentAt: '2026-08-28T00:00:00Z',
  })

describe('VoiceSearchButton', () => {
  it('renders nothing where the browser has no speech API', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition')
    const { container } = render(<VoiceSearchButton onTranscript={vi.fn()} />)
    // A button that appears and then fails is worse than no button. Firefox
    // implements none of this.
    expect(container).toBeEmptyDOMElement()
  })

  it('is off by default and opens the notice instead of the microphone', async () => {
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))

    expect(screen.getByRole('dialog', { name: 'Before you use voice search' })).toBeVisible()
    expect(constructed, 'a recogniser was constructed before consent').toBe(0)
  })

  it('says where the audio goes, in those words', async () => {
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Search by voice' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Your voice leaves this device/)
    expect(dialog).toHaveTextContent(/not on-device/)
    expect(dialog).toHaveTextContent(/Google/)
  })

  it('declining leaves it off, and leaves nothing constructed', async () => {
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isVoiceEnabled(useAppStore.getState().voice)).toBe(false)
    expect(constructed).toBe(0)
  })

  it('Escape closes the notice without consenting', async () => {
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isVoiceEnabled(useAppStore.getState().voice)).toBe(false)
  })

  it('accepting records consent and starts listening', async () => {
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await user.click(screen.getByRole('button', { name: /I have read this/ }))

    await waitFor(() => expect(constructed).toBe(1))
    expect(isVoiceEnabled(useAppStore.getState().voice)).toBe(true)
    expect(useAppStore.getState().voice.consentAt).toBeTruthy()
  })

  it('goes straight to listening once consent is on record', async () => {
    await consent()
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(constructed).toBe(1))
  })

  it('announces that the microphone is open, in text', async () => {
    await consent()
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))

    // An open microphone with no indicator is not something to ship, and an
    // icon on its own is not an indicator.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Listening'))
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('passes the transcript up as it arrives, interim and final', async () => {
    await consent()
    const onTranscript = vi.fn()
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={onTranscript} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await waitFor(() => expect(instances).toHaveLength(1))

    const fire = (transcript: string, isFinal: boolean) =>
      instances[0]?.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { length: 1, isFinal, 0: { transcript } } },
      })

    fire('hatya', false)
    fire('hatya ka prayas', true)

    expect(onTranscript).toHaveBeenNthCalledWith(1, 'hatya', false)
    expect(onTranscript).toHaveBeenNthCalledWith(2, 'hatya ka prayas', true)
  })

  it('reports a refused microphone rather than failing silently', async () => {
    await consent()
    const user = userEvent.setup()
    render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await waitFor(() => expect(instances).toHaveLength(1))

    instances[0]?.onerror?.({ error: 'not-allowed' })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/microphone was blocked/i))
    // And the button goes back to "not listening" rather than sticking.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search by voice' })).toBeVisible())
  })

  it('closes the microphone when the screen goes away', async () => {
    await consent()
    const user = userEvent.setup()
    const { unmount } = render(<VoiceSearchButton onTranscript={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Search by voice' }))
    await waitFor(() => expect(instances).toHaveLength(1))

    unmount()
    // A microphone must not outlive the screen it was opened from.
    expect(instances[0]?.abort).toHaveBeenCalled()
  })
})
