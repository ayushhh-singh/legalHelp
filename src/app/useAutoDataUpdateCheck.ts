import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'

import { getSetting, setSetting, SETTING_KEYS } from '@/db'
import { diffVersions, fetchLatestVersions, hasUpdates, isCheckDue, type UpdateCheckResult } from '@/lib/dataUpdates'

/**
 * The automatic half of "Check for data updates" (ADR-034): runs
 * `CheckForUpdates.tsx`'s own comparison once, on its own, at most once a
 * calendar day, only while online, and only while the reader has not turned
 * it off in Settings. The manual button stays available regardless, for
 * whenever a reader wants to ask sooner.
 *
 * Every fetch goes through `src/lib/dataUpdates.ts` — this hook never calls
 * `fetch` itself, so the network exemption in `eslint.config.js` stays at
 * two files, not three.
 *
 * Offline, or opted out, or already checked today: this hook does nothing
 * and touches no storage at all, not even to record that it skipped.
 */
export function useAutoDataUpdateCheck(hydrated: boolean) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const autoCheck = useLiveQuery(
    async () => (await getSetting<boolean>(SETTING_KEYS.dataUpdateAutoCheck)) ?? true,
    [],
    undefined,
  )

  useEffect(() => {
    if (!hydrated || autoCheck === undefined || !autoCheck) return
    if (!(globalThis.navigator?.onLine ?? false)) return

    let cancelled = false

    void (async () => {
      const lastChecked = (await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)) ?? null
      const now = new Date()
      if (!isCheckDue(lastChecked, now)) return

      try {
        const remote = await fetchLatestVersions()
        if (cancelled) return
        const diff = diffVersions(remote)
        if (hasUpdates(diff)) setResult(diff)
      } catch {
        // A background convenience check failing silently is correct here —
        // the manual button in Settings already reports a failed check to a
        // reader who asked for one.
      } finally {
        if (!cancelled) await setSetting(SETTING_KEYS.dataUpdateLastChecked, now.toISOString())
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hydrated, autoCheck])

  return { result, dismiss: () => setResult(null) }
}
