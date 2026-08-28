import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { checkAndShowReminder } from './reminder'
import { useNow } from './useNow'

import { loadSettings, saveSettings } from '@/lib/srs'
import { useLanguage } from '@/i18n/useT'

import type { TrainerSettings } from '@/lib/srs'

/**
 * `TrainerSettings`, reactive: `useLiveQuery` re-runs `loadSettings()` the
 * moment `saveSettings` writes `trainerSettings`, so every screen reading this
 * (the daily-new count on Home, the act toggles, Browse) updates together with
 * no manual refetch.
 */
export function useTrainerSettings(): TrainerSettings | undefined {
  return useLiveQuery(() => loadSettings(), [], undefined)
}

export { saveSettings }

/**
 * Checks the daily reminder on every `useNow` tick (roughly once a minute)
 * for as long as some component mounts this — see `reminder.ts` for why that
 * is the ceiling of what a push-server-free app can do. Mounted once, at the
 * Trainer's own router root, so it runs while any `/learn/*` screen is open
 * without every screen needing to know about it.
 */
export function useDailyReminder(): void {
  const now = useNow(60_000)
  const language = useLanguage()

  useEffect(() => {
    void checkAndShowReminder(now, language)
  }, [now, language])
}
