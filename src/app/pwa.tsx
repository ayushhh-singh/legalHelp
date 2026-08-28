import { useEffect, useRef, useState } from 'react'
import type { Workbox } from 'workbox-window'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * Long enough to read a short sentence in either script, short enough that it
 * is gone before a reader has finished orienting themselves on a new install.
 */
const OFFLINE_NOTICE_MS = 6_000

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

  /**
   * "Ready to work offline." is purely informational — there is nothing for a
   * reader to do about it — so it times out. The update notice does NOT: it
   * asks a question ("Reload?") and a notice that disappears while you are
   * deciding is worse than one that waits.
   *
   * This is a real defect, not a polish item (docs/DATA-GAPS.md #59). On a
   * phone the toast bar is full width at bottom-[4.5rem], which is exactly
   * where the Trainer mock test's "Next question" button sits — so a reader
   * who installed the app and started a mock test could not finish one until
   * they found the ×. Found only at a phone viewport in a real browser.
   */
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => setOfflineReady(false), OFFLINE_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [offlineReady])

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
      className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg"
    >
      <span className="flex-1">{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-md bg-action px-3 py-1.5 text-xs font-medium text-action-foreground transition-colors hover:bg-action/90"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('pwa.dismiss')}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
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
        // pointer-events-none on the container, restored on each toast: the
        // container is a full-width fixed box on a phone, so without this it
        // intercepts every tap in the strip above the tab bar even where
        // there is nothing drawn — including the gap between two toasts.
        'pointer-events-none fixed inset-x-3 bottom-[4.5rem] z-50 flex flex-col gap-2',
        'sm:inset-x-auto sm:right-4 sm:w-80 lg:bottom-4',
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
