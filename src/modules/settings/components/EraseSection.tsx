import { useId, useState } from 'react'

import { eraseAllLocalData } from '@/lib/backup'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

const CONFIRM_WORD = 'ERASE'

/**
 * "Erase all my data" (Settings): clears every Dexie table and the service
 * worker's Cache Storage entries (`eraseAllLocalData`).
 *
 * Gated by a typed confirmation rather than a plain "are you sure" dialog —
 * this is the one action in the app that cannot be undone by anything short
 * of a backup taken beforehand, so it earns the friction a destructive git
 * command would get.
 */
export function EraseSection() {
  const { t } = useT()
  const inputId = useId()
  const [value, setValue] = useState('')
  const [erasing, setErasing] = useState(false)

  const matches = value.trim().toUpperCase() === CONFIRM_WORD

  const erase = async () => {
    if (!matches || erasing) return
    setErasing(true)
    await eraseAllLocalData()
    // A full reload, not a state reset: the in-memory store, every open
    // module's cached rows and the router's own history all still describe a
    // device that no longer exists the moment this resolves.
    window.location.assign('/')
  }

  return (
    // The border alone carries the "danger zone" cue. A destructive TINT
    // behind the hint text failed color-contrast in the light theme —
    // `--muted-foreground` has no pairing with `--destructive`, unlike the
    // marigold/tulsi/coral trio's own `-foreground` tokens (tokens.css) — so
    // the fill stays plain and the text keeps the guarantee every other
    // `--muted-foreground` on `--card`/`--background` already has.
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <p className="text-sm text-muted-foreground">{t('pages.settings.erase.hint')}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t('pages.settings.erase.confirmLabel', { word: CONFIRM_WORD })}
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
      <div>
        <Button
          type="button"
          variant="destructive"
          disabled={!matches || erasing}
          onClick={() => void erase()}
        >
          {erasing ? t('pages.settings.erase.erasing') : t('pages.settings.erase.action')}
        </Button>
      </div>
    </div>
  )
}
