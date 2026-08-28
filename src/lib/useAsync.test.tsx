import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useAsync } from './useAsync'

/**
 * The shared "load this lazily, only when asked" hook behind the Utilities
 * module's three datasets.
 *
 * Every test here renders inside `<StrictMode>`, deliberately. `src/main.tsx`
 * does, which means every effect is mounted, cleaned up and mounted again in
 * development — and `pnpm test:e2e` runs against a production build where
 * StrictMode is inert, so a non-idempotent effect passes all 82 e2e specs and
 * is broken the moment anyone opens `pnpm dev`. Session 8 shipped exactly that
 * twice in one hook (see `src/modules/drafting/useDraft.test.tsx`, and the
 * CLAUDE.md note that file is named in). This hook has both of the shapes that
 * went wrong there — a cleanup that disarms a flag, and state that survives a
 * remount — so it gets the same treatment.
 */

function Probe({
  load,
  loadKey,
  enabled = true,
}: {
  load: () => Promise<string>
  loadKey: string
  enabled?: boolean
}) {
  const state = useAsync(load, loadKey, enabled)
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="data">{state.data ?? ''}</output>
      <output data-testid="error">{state.error instanceof Error ? state.error.message : ''}</output>
      <button type="button" onClick={state.retry}>
        Retry
      </button>
    </div>
  )
}

/** A promise plus the handles to settle it, so no test races a real timer. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const status = () => screen.getByTestId('status').textContent
const data = () => screen.getByTestId('data').textContent

/**
 * Settle a promise and let React see it, inside `act`.
 *
 * The await is what makes this work rather than decoration: resolving a promise
 * only queues its continuation, so without draining the microtask queue the
 * hook's `.then` has not run by the time `act` returns and the assertion reads
 * the previous render.
 */
const flush = (mutate: () => void) =>
  act(async () => {
    mutate()
    await Promise.resolve()
  })

describe('useAsync', () => {
  it('starts loading, then reports the settled value', async () => {
    const gate = deferred<string>()
    render(
      <StrictMode>
        <Probe load={() => gate.promise} loadKey="a" />
      </StrictMode>,
    )

    expect(status()).toBe('loading')

    await flush(() => gate.resolve('the holidays'))

    expect(status()).toBe('ready')
    expect(data()).toBe('the holidays')
  })

  it('reports a rejection as an error state rather than throwing', async () => {
    const gate = deferred<string>()
    render(
      <StrictMode>
        <Probe load={() => gate.promise} loadKey="a" />
      </StrictMode>,
    )

    await flush(() => {
      gate.reject(new Error('dataset is corrupt'))
    })

    expect(status()).toBe('error')
    expect(screen.getByTestId('error').textContent).toBe('dataset is corrupt')
    expect(data()).toBe('')
  })

  it('does not call the loader at all while disabled, and calls it on enabling', async () => {
    const load = vi.fn(() => Promise.resolve('loaded'))

    function Gate() {
      const [enabled, setEnabled] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setEnabled(true)}>
            Enable
          </button>
          <Probe load={load} loadKey="a" enabled={enabled} />
        </>
      )
    }

    render(
      <StrictMode>
        <Gate />
      </StrictMode>,
    )

    // This is the property `useLawEngine(enabled)` relies on: a reader who only
    // looks at the page downloads nothing.
    expect(load).not.toHaveBeenCalled()
    expect(status()).toBe('loading')

    await userEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(status()).toBe('ready'))
    expect(load).toHaveBeenCalled()
  })

  it('reads as loading under a new key rather than showing the previous key’s data', async () => {
    const first = deferred<string>()
    const second = deferred<string>()

    function Switcher() {
      const [key, setKey] = useState('first')
      return (
        <>
          <button type="button" onClick={() => setKey('second')}>
            Switch
          </button>
          <Probe load={() => (key === 'first' ? first.promise : second.promise)} loadKey={key} />
        </>
      )
    }

    render(
      <StrictMode>
        <Switcher />
      </StrictMode>,
    )

    await flush(() => {
      first.resolve('holidays 2026')
    })
    expect(data()).toBe('holidays 2026')

    await userEvent.click(screen.getByRole('button', { name: 'Switch' }))

    // The settled value carries the key it answers, which is what lets a key
    // change read as "loading" without the effect clearing state first — a bare
    // clear would render one frame of the previous request's data under the new
    // key, which is the defect this shape exists to avoid.
    expect(status()).toBe('loading')
    expect(data()).toBe('')

    await flush(() => {
      second.resolve('holidays 2027')
    })
    expect(data()).toBe('holidays 2027')
  })

  it('ignores a request that settles after its key has moved on', async () => {
    const stale = deferred<string>()
    const fresh = deferred<string>()

    function Switcher() {
      const [key, setKey] = useState('first')
      return (
        <>
          <button type="button" onClick={() => setKey('second')}>
            Switch
          </button>
          <Probe load={() => (key === 'first' ? stale.promise : fresh.promise)} loadKey={key} />
        </>
      )
    }

    render(
      <StrictMode>
        <Switcher />
      </StrictMode>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Switch' }))

    // The first request lands late. Its cleanup has already run, so it must not
    // overwrite the second request's state — the classic out-of-order response.
    await flush(() => {
      stale.resolve('the wrong dataset')
    })
    expect(status()).toBe('loading')
    expect(data()).toBe('')

    await flush(() => {
      fresh.resolve('the right dataset')
    })
    expect(data()).toBe('the right dataset')
  })

  it('retries after a failure and reports the second attempt', async () => {
    const attempts: Array<ReturnType<typeof deferred<string>>> = []
    const load = () => {
      const gate = deferred<string>()
      attempts.push(gate)
      return gate.promise
    }

    render(
      <StrictMode>
        <Probe load={load} loadKey="a" />
      </StrictMode>,
    )

    await flush(() => {
      attempts.at(-1)!.reject(new Error('offline'))
    })
    expect(status()).toBe('error')

    const before = attempts.length
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Retry must clear the failed state on the way out, not leave the error on
    // screen next to a spinner.
    expect(status()).toBe('loading')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(attempts.length).toBeGreaterThan(before)

    await flush(() => {
      attempts.at(-1)!.resolve('loaded on the second try')
    })
    expect(status()).toBe('ready')
    expect(data()).toBe('loaded on the second try')
  })

  it('re-runs the loader on retry even from a ready state', async () => {
    let calls = 0
    const load = () => {
      calls += 1
      return Promise.resolve(`call ${calls}`)
    }

    render(
      <StrictMode>
        <Probe load={load} loadKey="a" />
      </StrictMode>,
    )
    await waitFor(() => expect(status()).toBe('ready'))
    const first = calls

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(calls).toBeGreaterThan(first))
    await waitFor(() => expect(status()).toBe('ready'))
    expect(data()).toBe(`call ${calls}`)
  })
})
