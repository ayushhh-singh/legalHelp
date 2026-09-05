import { useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A small anchored panel: one trigger, one `hidden` container beside it.
 *
 * Not a Radix dialog, and the reason is the one `FocusLayout`'s ⋯ menu already
 * gives — a focus trap is right for something that takes over the screen and
 * wrong for a settings tray an officer opens while reading. Radix Popover is
 * also not a dependency of this project and adding one for four call sites
 * would be the largest thing in the diff.
 *
 * What it does owe the reader, and does:
 *
 * - `aria-expanded` / `aria-controls` on the trigger, so the relationship is
 *   announced rather than implied by position.
 * - Escape closes it and returns focus to the trigger. Two things make that
 *   work rather than one: the listener is in the CAPTURE phase and stops
 *   propagation, AND the open panel carries `data-focus-overlay`, which is what
 *   `FocusLayout` reads before deciding the press means "leave this screen".
 *   Stopping propagation alone is not enough and looks as though it is — that
 *   listener is on `window` and this one is on `document`, so capture reaches
 *   it first whatever this one does, and Escape in the reader's "Aa" tray threw
 *   the officer out of the provision. ADR-029's "two Escape handlers on one
 *   press", which this project has now hit four times.
 *
 *   It handles the press whatever has focus, and that is the other half. The
 *   first version only acted when the event target was inside the panel, so
 *   with focus anywhere else Escape did NOTHING AT ALL — the layout stood down
 *   because of the marker and this stood down because of the target, and the
 *   tray was stuck open on a screen that could no longer be left. An overlay
 *   that suppresses a global control has to replace it unconditionally.
 * - A pointer-down outside closes it, which is what every menu in this app does.
 * - `hidden`, not unmounted: the panel's own state (a search box's text, a
 *   scroll position) survives being shut and reopened.
 */
export function Popover({
  label,
  description,
  trigger,
  children,
  align = 'end',
  panelClassName,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  /** The trigger's accessible name — what the control IS. */
  label: string
  /** Its description — what to do about it, when that is a different thing. */
  description?: string
  /** What the trigger shows. */
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'start' | 'end'
  panelClassName?: string
  triggerClassName?: string
  /** Optional control, for a caller that also opens it from somewhere else. */
  open?: boolean
  onOpenChange?: (next: boolean) => void
}) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlledOpen ?? uncontrolled
  const setOpen = (next: boolean) => {
    setUncontrolled(next)
    onOpenChange?.(next)
  }
  const id = useId()
  const hintId = `${id}-hint`
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setUncontrolled(false)
        onOpenChange?.(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Ours, and nobody else's: without this the same press also leaves the
      // focus route, and the reader loses the page as well as the panel.
      event.stopPropagation()
      event.preventDefault()
      setUncontrolled(false)
      onOpenChange?.(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onOpenChange])

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        {...(description ? { 'aria-describedby': hintId } : {})}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          open && 'bg-accent text-accent-foreground',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {description ? (
        <span id={hintId} className="sr-only">
          {description}
        </span>
      ) : null}
      <div
        id={id}
        hidden={!open}
        {...(open ? { 'data-focus-overlay': '' } : {})}
        className={cn(
          'absolute top-11 z-50 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg',
          align === 'end' ? 'end-0' : 'start-0',
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
