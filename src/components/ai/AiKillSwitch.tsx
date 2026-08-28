import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { killSwitchPatch, purgeAiData } from '@/ai/consent'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * The kill switch.
 *
 * It does not merely set `tier: 'off'`. It withdraws consent, deletes the
 * stored key AND the key material that could decrypt it, and clears the cached
 * answers and the token ledger — because a reader who turns this off is saying
 * "leave nothing behind", and a leftover ciphertext they cannot see would make
 * that untrue.
 *
 * Two steps, and the confirm names what is about to be deleted. Destructive and
 * irreversible; it is the one place in Settings that uses --destructive.
 */
interface AiKillSwitchProps {
  /**
   * Reported to the parent rather than rendered here. Turning AI off is exactly
   * what removes this component's own reason to be on screen, so a confirmation
   * it owned would be unmounted in the same tick it was set — the reader would
   * never see it.
   */
  onPurged: () => void
}

export function AiKillSwitch({ onPurged }: AiKillSwitchProps) {
  const { t } = useT()
  const setAi = useAppStore((state) => state.setAi)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      // Settings first: if the purge throws (blocked storage), AI is already
      // off, which is the safe half of the operation.
      await setAi(killSwitchPatch())
      await purgeAiData()
    } finally {
      setBusy(false)
      setConfirming(false)
      onPurged()
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{t('ai.kill.title')}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{t('ai.kill.body')}</p>

      {confirming ? (
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void run()}>
            <Trash2 aria-hidden="true" />
            {t('ai.kill.confirm')}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            {t('ai.kill.cancel')}
          </Button>
        </div>
      ) : (
        <div className="mt-1">
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            {t('ai.kill.button')}
          </Button>
        </div>
      )}
    </section>
  )
}
