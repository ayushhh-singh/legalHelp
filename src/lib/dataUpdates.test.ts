import { afterEach, describe, expect, it, vi } from 'vitest'

import { diffVersions, fetchLatestVersions, hasUpdates, type RemoteVersions } from './dataUpdates'

import { DATASETS } from './dataVersion'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('diffVersions', () => {
  it('reports no changes when the remote manifest matches the bundled one', () => {
    const remote: RemoteVersions = {
      datasets: Object.fromEntries(
        Object.entries(DATASETS).filter((entry): entry is [string, NonNullable<(typeof DATASETS)[string]>] =>
          Boolean(entry[1]),
        ),
      ),
    }

    const result = diffVersions(remote)

    expect(result.changed).toEqual([])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(hasUpdates(result)).toBe(false)
  })

  it('reports a dataset whose version moved', () => {
    const bumped = { ...DATASETS.app!, version: '9.9.9' }
    const result = diffVersions({ datasets: { ...DATASETS, app: bumped } })

    expect(result.changed).toEqual([
      {
        id: 'app',
        label: bumped.label,
        localVersion: DATASETS.app!.version,
        remoteVersion: '9.9.9',
        localUpdated: DATASETS.app!.updated,
        remoteUpdated: bumped.updated,
      },
    ])
    expect(hasUpdates(result)).toBe(true)
  })

  it('reports a dataset whose updated date moved but whose version did not', () => {
    const touched = { ...DATASETS.app!, updated: '2099-01-01' }
    const result = diffVersions({ datasets: { ...DATASETS, app: touched } })

    expect(result.changed).toHaveLength(1)
    expect(result.changed[0]?.remoteUpdated).toBe('2099-01-01')
  })

  it('reports a dataset the origin has that this build does not know about', () => {
    const result = diffVersions({
      datasets: {
        ...DATASETS,
        'law-something-new': { version: '1.0.0', updated: '2026-09-01', label: { en: 'x', hi: 'x' } },
      },
    })

    expect(result.added).toEqual(['law-something-new'])
    expect(hasUpdates(result)).toBe(true)
  })

  it('reports a dataset this build has that the origin no longer lists', () => {
    const rest = { ...DATASETS }
    delete rest.app
    const result = diffVersions({ datasets: rest })

    expect(result.removed).toEqual(['app'])
    expect(hasUpdates(result)).toBe(true)
  })

  it('ignores a null entry in the remote datasets map', () => {
    const result = diffVersions({ datasets: { ...DATASETS, ghost: undefined } })
    expect(result.changed).toEqual([])
    expect(result.added).toEqual([])
  })
})

describe('fetchLatestVersions', () => {
  it('requests the versions.json path with cache-busting and no-store', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ datasets: {} }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await fetchLatestVersions()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^\/data\/_meta\/versions\.json\?bypass=\d+$/)
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('throws on a non-OK response rather than returning something malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    )

    await expect(fetchLatestVersions()).rejects.toThrow(/503/)
  })

  it('throws when the body has no datasets object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ oops: true }) }),
    )

    await expect(fetchLatestVersions()).rejects.toThrow(/malformed/)
  })
})
