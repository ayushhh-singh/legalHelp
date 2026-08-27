import { Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * Stub for the offline indicator. Reads navigator.onLine only; the real
 * service-worker-aware badge lands with vite-plugin-pwa in a later session.
 */
export function OfflineBadge({ className }: { className?: string }) {
  const { t } = useT()
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

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-thread/50 bg-thread/10 px-2 py-1 text-xs font-medium text-thread',
        className,
      )}
    >
      <WifiOff aria-hidden="true" className="h-3 w-3" />
      {t('common.offline')}
      <Wifi aria-hidden="true" className="hidden" />
    </span>
  )
}
