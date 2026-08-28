import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The modal the phrase library and the glossary open in.
 *
 * Hand-built rather than Radix, for the reason the Pay module's combobox is
 * hand-built: this app has three modal surfaces in total and each is small,
 * whereas `@radix-ui/react-dialog` is a dependency, a portal and a set of
 * scroll-lock behaviours to reason about on a route that must stay light.
 *
 * What it does have to get right, and does:
 *
 *  - `role="dialog"` with `aria-modal` and a heading it is labelled by;
 *  - focus moved in on open and **returned to the opener on close**, which is
 *    the half everyone forgets and the half a keyboard user notices;
 *  - a focus trap over the dialog's own tabbables, so Tab cannot walk out into
 *    the form behind it;
 *  - Escape closes, and so does the backdrop.
 *
 * It is deliberately NOT a `<dialog>` element. `showModal()` would give the
 * trap and the backdrop for free, but it also puts the panel in the top layer,
 * where `max-h-[85dvh]` and the mobile bottom-sheet position behave
 * differently across browsers — and this sheet needs no top layer, because
 * nothing in the app renders above it.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({
  title,
  subtitle,
  placement = 'center',
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  /** `center` is a modal over the page; `end` is a full-height side drawer. */
  placement?: 'center' | 'end'
  onClose: () => void
  children: React.ReactNode
}) {
  const { t } = useT()
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    /*
      `[data-autofocus]` first, and only then the first tabbable.

      The close button sits in the header and is therefore FIRST in DOM order,
      so focusing the first tabbable put a keyboard user on "Close" every time
      a sheet opened — the one control they did not want. Both sheets mark
      their search box, which is where an officer actually wants to be.
    */
    const panelNode = panel.current
    const target =
      panelNode?.querySelector<HTMLElement>('[data-autofocus]') ??
      panelNode?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()

    const returnTo = opener.current
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const tabbables = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      )
      const first = tabbables[0]
      const last = tabbables[tabbables.length - 1]
      if (!first || !last) return

      // Wrap at both ends. Without this, Tab from the last control lands on
      // the browser chrome and the next Tab is inside the form behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-foreground/40',
        placement === 'end'
          ? 'items-stretch justify-end'
          : 'items-end justify-center p-0 sm:items-center sm:p-6',
      )}
    >
      {/*
        The backdrop is a real <button>, not a div with a click handler: a
        click target has to be an interactive element for the keyboard and for
        assistive technology, and a bare <div onMouseDown> is neither.

        It is `tabIndex={-1}` and `aria-hidden` because it is a REDUNDANT
        pointer affordance — Escape closes, and so does the labelled close
        button in the header. Putting it in the tab order would make the first
        Tab stop an unlabelled full-screen control, and it would steal the
        initial focus this sheet deliberately gives to the search box.
      */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          // `relative` so the panel stacks above the absolute backdrop button.
          'relative flex flex-col border-border bg-card shadow-lg',
          placement === 'end'
            ? 'h-dvh w-full max-w-md border-s'
            : 'max-h-[85dvh] w-full max-w-2xl rounded-t-lg border sm:rounded-lg',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
