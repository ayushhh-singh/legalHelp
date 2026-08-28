import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import i18n from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Reads navigator.onLine and the online/offline events directly. The service
 * worker (vite.config.ts, src/app/pwa.tsx) is what actually keeps the app
 * usable offline; this badge only reports the network state to the officer.
 *
 * The label shows both languages at once rather than following the current UI
 * language toggle — a status this important should read the same way no matter
 * which language the app happens to be in when the network drops.
 *
 * Coral is the low band; the tint carries --coral-foreground for text and icon.
 */
export function OfflineBadge({ className }: { className?: string }) {
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  const label = `${i18n.getFixedT('en')('common.offline')} · ${i18n.getFixedT('hi')('common.offline')}`

  return (
    <span
      data-testid="offline-badge"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-coral/30 bg-coral/15 px-2.5 py-1 text-xs font-medium text-coral-foreground',
        className,
      )}
    >
      <WifiOff aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  )
}
