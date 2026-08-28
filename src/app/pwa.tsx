import { useEffect, useRef, useState } from 'react'
import type { Workbox } from 'workbox-window'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * Manual service-worker lifecycle, in place of vite-plugin-pwa's injected
 * register script: registerType is "prompt" (vite.config.ts), so the built
 * service worker waits for an explicit skip-waiting message before it takes
 * over, and this component is what sends it after the user agrees to reload.
 *
 * No IndexedDB round-trip for "has the offline-ready notice already been
 * shown": the "installed" event's isUpdate flag already fires false at most
 * once per origin for the lifetime of a service worker registration — a
 * fresh register() against an already-active worker of the same version
 * never re-enters the installing state, so there is nothing a persisted flag
 * would add. It would also survive `clearAllData` in a misleading way: that
 * clears settings, not the service worker registration, so the notice still
 * would not reappear.
 */
function usePwaLifecycle() {
  const [updateReady, setUpdateReady] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const wbRef = useRef<Workbox | null>(null)
  // clientsClaim (vite.config.ts) also fires "controlling" the first time a
  // worker ever claims this page, not only after a user-triggered update —
  // only that second case should reload the page.
  const skipWaitingRequestedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

    let cancelled = false

    void (async () => {
      const { Workbox } = await import('workbox-window')
      if (cancelled) return

      const wb = new Workbox('/sw.js')
      wbRef.current = wb

      wb.addEventListener('waiting', () => {
        if (cancelled) return
        // A fresh waiting worker is a new update even if an earlier one was
        // dismissed — otherwise dismissing once silences every later update
        // for the rest of the tab's life.
        setUpdateReady(true)
        setUpdateDismissed(false)
      })
      wb.addEventListener('controlling', () => {
        if (!cancelled && skipWaitingRequestedRef.current) window.location.reload()
      })
      wb.addEventListener('installed', (event) => {
        if (!cancelled && !event.isUpdate) setOfflineReady(true)
      })

      wb.register().catch((error: unknown) => {
        console.warn('[sahayak] service worker registration failed', error)
      })
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const reload = () => {
    skipWaitingRequestedRef.current = true
    wbRef.current?.messageSkipWaiting()
  }

  return {
    updateReady,
    updateDismissed,
    dismissUpdate: () => setUpdateDismissed(true),
    offlineReady,
    reload,
    dismissOfflineReady: () => setOfflineReady(false),
  }
}

function PwaToast({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}) {
  const { t } = useT()

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-sm border border-ink/20 bg-paper px-4 py-3 text-sm text-ink shadow-md"
    >
      <span className="flex-1">{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-sm border border-ink px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('pwa.dismiss')}
        className="shrink-0 text-ink-2 transition-colors hover:text-ink"
      >
        ×
      </button>
    </div>
  )
}

/** Mounted once, near the root of the shell. Renders nothing until there's something to say. */
export function PwaNotices({ className }: { className?: string }) {
  const { t } = useT()
  const { updateReady, updateDismissed, dismissUpdate, offlineReady, reload, dismissOfflineReady } =
    usePwaLifecycle()

  if ((!updateReady || updateDismissed) && !offlineReady) return null

  return (
    <div
      className={cn(
        'fixed inset-x-3 bottom-[4.5rem] z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-80 lg:bottom-4',
        className,
      )}
    >
      {updateReady && !updateDismissed ? (
        <PwaToast
          message={t('pwa.updateAvailable')}
          actionLabel={t('pwa.reload')}
          onAction={reload}
          onDismiss={dismissUpdate}
        />
      ) : null}
      {offlineReady ? <PwaToast message={t('pwa.readyOffline')} onDismiss={dismissOfflineReady} /> : null}
    </div>
  )
}
