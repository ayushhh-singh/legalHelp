import * as Dialog from '@radix-ui/react-dialog'

import { useT } from '@/i18n/useT'

/**
 * The `?` sheet: what the reading keys do.
 *
 * A real Radix dialog rather than a styled div, for the focus trap and the
 * ARIA wiring — and with a `Dialog.Title` INSIDE it, because Radix logs a
 * console error in every build without one and ADR-030 records that a console
 * error in a production build is a defect this project treats as one.
 *
 * It is also what makes the reader's other keys safe: every handler on the
 * reader page bails while a `[role="dialog"]` is open, so `?` opening this
 * cannot be followed by `j` navigating away underneath it.
 */

const KEYS: ReadonlyArray<[string, 'jk' | 'homeEnd' | 'b' | 'h' | 'n' | 'slash' | 'question']> = [
  ['J / K', 'jk'],
  ['Home / End', 'homeEnd'],
  ['B', 'b'],
  ['H', 'h'],
  ['N', 'n'],
  ['/', 'slash'],
  ['?', 'question'],
]

interface KeyboardHelpSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardHelpSheet({ open, onOpenChange }: KeyboardHelpSheetProps) {
  const { t } = useT()

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">{t('library.polish.helpTitle')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('library.polish.help')}</Dialog.Description>
          <dl className="mt-3 flex flex-col gap-2">
            {KEYS.map(([keys, key]) => (
              <div key={key} className="flex items-baseline justify-between gap-4">
                <dt>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs tabular-nums">
                    {keys}
                  </kbd>
                </dt>
                <dd className="flex-1 text-right text-sm text-muted-foreground">
                  {t(`library.polish.keys.${key}`)}
                </dd>
              </div>
            ))}
          </dl>
          <Dialog.Close className="mt-4 inline-flex min-h-9 items-center rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {t('library.terms.close')}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
