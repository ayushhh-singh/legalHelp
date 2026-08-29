import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAutoDataUpdateCheck } from './useAutoDataUpdateCheck'

import { getSetting, setSetting, SETTING_KEYS } from '@/db'
import { DATASETS } from '@/lib/dataVersion'

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
}

function mockVersionsResponse(datasets: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ datasets }) }))
}

const UNCHANGED_DATASETS = Object.fromEntries(
  Object.entries(DATASETS).filter((entry): entry is [string, NonNullable<(typeof DATASETS)[string]>] =>
    Boolean(entry[1]),
  ),
)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAutoDataUpdateCheck', () => {
  it('does nothing while not hydrated', async () => {
    setOnline(true)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderHook(() => useAutoDataUpdateCheck(false))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing while offline', async () => {
    setOnline(false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderHook(() => useAutoDataUpdateCheck(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing once the reader has turned auto-check off in Settings', async () => {
    setOnline(true)
    await setSetting(SETTING_KEYS.dataUpdateAutoCheck, false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderHook(() => useAutoDataUpdateCheck(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not check again the same UTC day', async () => {
    setOnline(true)
    await setSetting(SETTING_KEYS.dataUpdateLastChecked, new Date().toISOString())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderHook(() => useAutoDataUpdateCheck(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('checks once, finds a change, and surfaces it — then records the check', async () => {
    setOnline(true)
    const bumped = { ...DATASETS.app!, version: '9.9.9' }
    mockVersionsResponse({ ...UNCHANGED_DATASETS, app: bumped })

    const { result } = renderHook(() => useAutoDataUpdateCheck(true))
    await waitFor(() => expect(result.current.result).not.toBeNull())

    expect(result.current.result?.changed.map((c) => c.id)).toContain('app')
    const lastChecked = await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)
    expect(lastChecked).toBeTruthy()
  })

  it('records the check but surfaces nothing when there is no update', async () => {
    setOnline(true)
    mockVersionsResponse(UNCHANGED_DATASETS)

    const { result } = renderHook(() => useAutoDataUpdateCheck(true))
    await waitFor(async () => {
      expect(await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)).toBeTruthy()
    })

    expect(result.current.result).toBeNull()
  })

  it('a fetch failure is swallowed, and the day is still recorded so it is not retried in a loop', async () => {
    setOnline(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useAutoDataUpdateCheck(true))
    await waitFor(async () => {
      expect(await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)).toBeTruthy()
    })

    expect(result.current.result).toBeNull()
  })

  it('dismiss clears the surfaced result', async () => {
    setOnline(true)
    const bumped = { ...DATASETS.app!, version: '9.9.9' }
    mockVersionsResponse({ ...UNCHANGED_DATASETS, app: bumped })

    const { result } = renderHook(() => useAutoDataUpdateCheck(true))
    await waitFor(() => expect(result.current.result).not.toBeNull())

    act(() => result.current.dismiss())

    expect(result.current.result).toBeNull()
  })

  it('under StrictMode, the double-invoked mount fetches once, not twice', async () => {
    // src/main.tsx renders under <StrictMode>, which mounts, cleans up and
    // mounts an effect again — synchronously, before this hook's first
    // await has resolved. Playwright cannot see this: StrictMode's double
    // invocation is development-only and a production build (what e2e runs
    // against) is unaffected.
    //
    // What this actually proves, measured rather than assumed: BOTH doubled
    // invocations bail out at the effect's own `autoCheck === undefined`
    // guard before ever starting the async body, because `useLiveQuery`
    // has not resolved by the time StrictMode's synchronous double-mount
    // happens — so today it is that guard, not the `cancelled` checks
    // inside the async IIFE, doing the protecting. This test still earns
    // its place: it is what would catch either mechanism breaking, and it
    // is what showed the `cancelled` checks were not exercised here before
    // this comment could honestly say so instead of assuming it.
    //
    // `wrapper: StrictMode` — the bare component, the same way useDraft.
    // test.tsx's own StrictMode tests pass it — not `wrapper: ({children})
    // => <StrictMode>{children}</StrictMode>`. Measured directly against a
    // probe component: the arrow-function form renders StrictMode one
    // level below a plain function component, and in this @testing-library/
    // react version that does NOT double-invoke effects the way wrapping
    // the element in StrictMode directly does — an easy, silent way for a
    // "StrictMode test" to stop testing StrictMode at all while still
    // passing. If this test starts failing after a testing-library upgrade,
    // check that assumption again before assuming the hook broke.
    setOnline(true)
    const bumped = { ...DATASETS.app!, version: '9.9.9' }
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ datasets: { ...UNCHANGED_DATASETS, app: bumped } }) })
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useAutoDataUpdateCheck(true), { wrapper: StrictMode })

    await waitFor(() => expect(result.current.result).not.toBeNull())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // And the checked-today flag was written exactly once too — not by
    // both the cancelled first invocation and the surviving second one.
    const lastChecked = await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)
    expect(lastChecked).toBeTruthy()
  })

  it('under StrictMode, no update still records exactly one check', async () => {
    setOnline(true)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ datasets: UNCHANGED_DATASETS }) })
    vi.stubGlobal('fetch', fetchSpy)

    renderHook(() => useAutoDataUpdateCheck(true), { wrapper: StrictMode })

    await waitFor(async () => {
      expect(await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)).toBeTruthy()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
