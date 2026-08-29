import { act, renderHook, waitFor } from '@testing-library/react'
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
})
