import * as Dialog from '@radix-ui/react-dialog'

import { useT } from '@/i18n/useT'

/**
 * The editor's keyboard shortcuts, on Ctrl+/.
 *
 * The ten strings this renders were authored with the rest of Session 29 and
 * nothing showed them — an edge-case pass found the whole block dead. Ctrl+S,
 * Ctrl+P and Ctrl+F worked; Ctrl+/ did nothing, which is the one shortcut whose
 * entire job is to tell you the others exist.
 *
 * A Radix dialog rather than a bespoke panel, for the focus trap and the
 * Escape handling — the same reason the command palette uses `Command.Dialog`,
 * and with the same lesson applied: a dialog needs a real `Dialog.Title` inside
 * it, or Radix logs a console error in every build (ADR-030's addendum).
 */

/*
  `as const`, so `label` is a literal union rather than `string`.

  `useT`'s key type is the i18n catalogue itself (module augmentation), so a
  widened `string` is rejected at compile time — which is the point: a renamed
  key is a build error here rather than a raw `draft.shortcuts.save` on screen.
*/
const KEYS = [
  { keys: 'Ctrl S', label: 'draft.shortcuts.save' },
  { keys: 'Ctrl P', label: 'draft.shortcuts.print' },
  { keys: 'Ctrl E', label: 'draft.shortcuts.export' },
  { keys: 'Ctrl Shift F', label: 'draft.shortcuts.find' },
  { keys: 'Ctrl /', label: 'draft.shortcuts.help' },
  { keys: 'Esc', label: 'draft.shortcuts.escape' },
  { keys: 'Ctrl B', label: 'draft.shortcuts.bold' },
  { keys: 'Ctrl I', label: 'draft.shortcuts.italic' },
  { keys: 'Tab', label: 'draft.shortcuts.indent' },
  { keys: 'Shift Tab', label: 'draft.shortcuts.outdent' },
] as const

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const { t } = useT()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg">
          <Dialog.Title className="mb-3 text-base font-semibold">{t('draft.shortcuts.heading')}</Dialog.Title>
          <dl className="flex flex-col gap-2 text-sm">
            {KEYS.map((entry) => (
              <div key={entry.keys} className="flex items-center justify-between gap-4">
                <dt>{t(entry.label)}</dt>
                <dd className="flex gap-1">
                  {entry.keys.split(' ').map((key) => (
                    <kbd
                      key={key}
                      className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <Dialog.Close className="mt-4 rounded-[10px] border border-border px-3 py-2 text-sm hover:bg-muted">
            {t('draft.find.close')}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
