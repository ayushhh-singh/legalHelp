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
      // Checked again after EVERY await, not only the last one: StrictMode
      // (src/main.tsx, development only) mounts, cleans up and mounts again
      // synchronously, before the first await here has resolved.
      //
      // Measured directly (src/app/useAutoDataUpdateCheck.test.ts) rather
      // than reasoned about: today, BOTH of StrictMode's doubled
      // invocations already bail out at the effect's own guard above,
      // before this IIFE ever starts — `autoCheck` is still `undefined`
      // during the synchronous double-mount, because its `useLiveQuery`
      // (line 26) has not resolved yet. So nothing currently exercises
      // these extra `cancelled` checks. They stay anyway, as insurance
      // rather than dead code: that safety is a side effect of
      // `autoCheck`'s initial value being `undefined`, not a guarantee this
      // function makes on its own, and it would silently stop holding if
      // that default ever changed. The StrictMode test proves the CURRENT
      // behaviour either way, so a future change that broke it would fail
      // there regardless of which mechanism was doing the protecting.
      if (cancelled) return
      const lastChecked = (await getSetting<string>(SETTING_KEYS.dataUpdateLastChecked)) ?? null
      if (cancelled) return
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
