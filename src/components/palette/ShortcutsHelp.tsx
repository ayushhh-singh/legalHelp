import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { usePaletteStore } from '@/app/paletteStore'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * The `?` shortcut's own help sheet — every global keyboard shortcut, in one
 * place, for a reader who does not want to guess.
 *
 * Built on `@radix-ui/react-dialog` directly rather than hand-rolled, the way
 * `AiConsentModal.tsx` had to be before this: `cmdk` already pulls the same
 * package in for `Command.Dialog`, so pinning it in `package.json` (rather
 * than only reaching it as cmdk's own transitive dependency) buys a proper
 * focus trap, Escape-to-close and `role="dialog"` wiring for free, here too.
 */
const ROWS = [
  { keys: ['Ctrl', 'K'], labelKey: 'shortcuts.palette' },
  { keys: ['g', 'h'], labelKey: 'shortcuts.goHome' },
  { keys: ['g', 's'], labelKey: 'shortcuts.goStudy' },
  { keys: ['g', 'r'], labelKey: 'shortcuts.goRead' },
  { keys: ['g', 'p'], labelKey: 'shortcuts.goPractise' },
  { keys: ['g', 'd'], labelKey: 'shortcuts.goDraft' },
  { keys: ['g', 'l'], labelKey: 'shortcuts.goLaw' },
  { keys: ['g', 't'], labelKey: 'shortcuts.goTools' },
  { keys: ['/'], labelKey: 'shortcuts.focusSearch' },
  { keys: ['?'], labelKey: 'shortcuts.help' },
  { keys: ['Esc'], labelKey: 'shortcuts.close' },
] as const

export function ShortcutsHelp() {
  const { t } = useT()
  const helpOpen = usePaletteStore((s) => s.helpOpen)
  const closeHelp = usePaletteStore((s) => s.closeHelp)

  return (
    <Dialog.Root open={helpOpen} onOpenChange={(next) => !next && closeHelp()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-lg focus-visible:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="font-heading text-lg font-semibold">{t('shortcuts.title')}</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t('nav.close')}>
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <dl className="mt-4 space-y-2.5">
            {ROWS.map((row) => (
              <div key={row.labelKey} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{t(row.labelKey)}</dt>
                <dd className="flex shrink-0 items-center gap-1">
                  {row.keys.map((key, i) => (
                    <kbd
                      key={i}
                      className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs text-muted-foreground">{t('shortcuts.note')}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
