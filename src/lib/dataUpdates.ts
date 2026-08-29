import { DATASETS, type Dataset } from './dataVersion'

/**
 * Is a newer `data/_meta/versions.json` sitting on the origin than the one
 * bundled into this build? Two callers share this module: the "Check for
 * data updates" button in Settings (`CheckForUpdates.tsx`, one-shot,
 * user-initiated, ADR-028) and `useAutoDataUpdateCheck` (`src/app/`,
 * automatic, at most once a day, on by default — ADR-034).
 *
 * This is the second of the two files this app is allowed to call `fetch`
 * from — `eslint.config.js` grants the exception by filename, exactly as it
 * does for `src/ai/providers/wire.ts` (ADR-011 point 3), and for the same
 * reason: the audit question "what in this app can talk to the network?"
 * has to stay answerable from the lint config alone. Both callers go through
 * `fetchLatestVersions` here rather than calling `fetch` themselves, so the
 * exemption never has to grow to a third file.
 *
 * The request is same-origin, carries no user data, and its path is a
 * literal string — never built from a parameter — so this module cannot
 * become a way to fetch anything but this one file.
 */

/** Same shape `src/lib/dataVersion.ts` already types the bundled copy as. */
export interface RemoteVersions {
  datasets: Record<string, Dataset | undefined>
}

function isRemoteVersions(value: unknown): value is RemoteVersions {
  if (!value || typeof value !== 'object') return false
  const datasets = (value as { datasets?: unknown }).datasets
  return Boolean(datasets) && typeof datasets === 'object'
}

/**
 * Fetches the manifest fresh, bypassing every cache layer that would
 * otherwise hide a newer release: `cache: 'no-store'` skips the browser's
 * HTTP cache, and the timestamp query param gives this exact URL no entry in
 * the service worker's `StaleWhileRevalidate` rule for `/data/**\/*.json`
 * (vite.config.ts) to serve stale — a cache miss there is a network fetch.
 */
export async function fetchLatestVersions(): Promise<RemoteVersions> {
  const response = await fetch(`/data/_meta/versions.json?bypass=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`versions.json responded ${response.status}`)
  const body: unknown = await response.json()
  if (!isRemoteVersions(body)) throw new Error('malformed versions.json')
  return body
}

export interface DatasetChange {
  id: string
  label: Record<string, string>
  localVersion: string | null
  remoteVersion: string
  localUpdated: string | null
  remoteUpdated: string
}

export interface UpdateCheckResult {
  checkedAt: string
  /** A dataset whose version or updated date differs from what is bundled. */
  changed: DatasetChange[]
  /** A dataset the origin has that this build does not know about. */
  added: string[]
  /** A dataset this build has that the origin no longer lists. */
  removed: string[]
}

/** Pure: everything above the fetch itself, so the comparison is unit-testable without a network. */
export function diffVersions(remote: RemoteVersions): UpdateCheckResult {
  const changed: DatasetChange[] = []
  const added: string[] = []
  const remoteIds = new Set(Object.keys(remote.datasets))

  for (const [id, entry] of Object.entries(remote.datasets)) {
    if (!entry) continue
    const local = DATASETS[id]
    if (!local) {
      added.push(id)
      continue
    }
    if (local.version !== entry.version || local.updated !== entry.updated) {
      changed.push({
        id,
        label: entry.label,
        localVersion: local.version,
        remoteVersion: entry.version,
        localUpdated: local.updated,
        remoteUpdated: entry.updated,
      })
    }
  }

  const removed = Object.keys(DATASETS).filter((id) => !remoteIds.has(id))

  return { checkedAt: new Date().toISOString(), changed, added, removed }
}

export const hasUpdates = (result: UpdateCheckResult): boolean =>
  result.changed.length > 0 || result.added.length > 0 || result.removed.length > 0

/**
 * Whether `useAutoDataUpdateCheck` should run again: never twice on the same
 * UTC calendar day. This is a network-call throttle, not a scheduling
 * primitive — deliberately NOT `src/lib/srs/day.ts`'s or
 * `src/lib/istDay.ts`'s fixed +05:30 IST boundary, which exist for
 * spaced-repetition and streak correctness a reader actually sees. UTC
 * rather than the device's local calendar day for the reason `day.ts`'s own
 * fixed offset exists: a boundary that depends on `Date`'s LOCAL getters
 * depends on the runtime's timezone, which makes the same input produce a
 * different answer on a different machine. Being a few hours early or late
 * relative to IST midnight costs nothing here; a test that only passes in
 * one timezone would.
 */
export function isCheckDue(lastCheckedIso: string | null, now: Date): boolean {
  if (!lastCheckedIso) return true
  const last = new Date(lastCheckedIso)
  if (Number.isNaN(last.getTime())) return true
  return (
    last.getUTCFullYear() !== now.getUTCFullYear() ||
    last.getUTCMonth() !== now.getUTCMonth() ||
    last.getUTCDate() !== now.getUTCDate()
  )
}
