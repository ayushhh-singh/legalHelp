import { ArrowLeft, Languages, MoreHorizontal, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { FocusSlotsProvider, useFocusSlotState, type FocusHost } from './focusSlots'
import { pathLabel } from './labels'

import { useAppStore } from '../store'
import { useBackTo } from '../useBackTo'

import { LANGUAGE_LABELS } from '@/i18n'
import { useT } from '@/i18n/useT'
import { SETTINGS_PATH } from '@/lib/nav'
import { cn } from '@/lib/utils'

/** The one class every entry in the ⋯ menu wears, page entries included. */
export const FOCUS_MENU_ITEM =
  'flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-start text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50'

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

export function FocusBar({
  backLabel,
  onBack,
  title,
  titleHint,
  status,
  actions,
  panel,
  hostRef,
}: {
  backLabel: string
  onBack: () => void
  title: string
  /** A second line under the title, for a document's own form name. */
  titleHint?: string | null
  status?: React.ReactNode
  actions?: React.ReactNode
  panel?: React.ReactNode
  hostRef?: (host: FocusHost) => (element: HTMLElement | null) => void
}) {
  const { t } = useT()

  /*
    A `<div>`, not a `<header>`.

    This bar renders INSIDE `<main>`, where HTML-AAM scopes `<header>` to a
    generic element — but some tooling ignores that rule and reports a second
    `banner` landmark, and `PageHeader` already removes the same ambiguity at
    the source for the same reason. Nothing here needs a landmark: the content
    is inside `main` already, so it is not orphaned.
  */
  return (
    <div data-print-hide className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="-ms-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="hidden max-w-[9rem] truncate sm:inline">{backLabel}</span>
          <span className="sr-only sm:hidden">{backLabel}</span>
          <span className="sr-only"> — {t('a11y.backToParent')}</span>
        </button>

        {/* The gold rule, as everywhere else: this is the file tab on its side,
            marking the one thing the reader is inside. */}
        <span aria-hidden="true" className="h-6 w-[3px] shrink-0 rounded-sm bg-marigold" />

        {/*
          The centre. A page that portals a control in here (the reader's unit
          switcher, the editor's title box) replaces the plain text; one that
          does not gets the route's own name. The fallback is `hidden` rather
          than removed so the two cannot both be on screen for a frame.
        */}
        <span ref={hostRef?.('title')} className="focus-title-host flex min-w-0 items-center empty:hidden" />
        <span className="focus-title-fallback min-w-0 flex-1 truncate text-sm font-semibold">
          <span className="truncate">{title}</span>
          {titleHint ? (
            <span className="ms-2 hidden truncate text-xs font-normal text-muted-foreground lg:inline">
              {titleHint}
            </span>
          ) : null}
        </span>

        {status ? (
          <span role="status" className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {status}
          </span>
        ) : null}

        <span className="flex shrink-0 items-center gap-1">
          <span ref={hostRef?.('actions')} className="flex items-center gap-1" />
          {panel}
          {actions}
        </span>
      </div>
    </div>
  )
}

/**
 * The ⋯ menu.
 *
 * It carries the language and theme toggles because the app's top bar is HIDDEN
 * at this level, and a reader who cannot switch to Hindi in the middle of
 * reading a rule has lost the one control this app promises everywhere. Plain
 * `<button>`s in a `hidden` container rather than a Radix menu: the palette is
 * the only dialog this app opens with a keyboard shortcut, and adding a second
 * focus trap to a screen an officer is working inside buys nothing here.
 *
 * A focus page's own actions — print a rule, export a document — are PORTALLED
 * into the top of this one list rather than opening a second ⋯ beside it.
 */
function FocusActions({
  open,
  setOpen,
  hostRef,
}: {
  open: boolean
  setOpen: (next: boolean) => void
  hostRef: (host: FocusHost) => (element: HTMLElement | null) => void
}) {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const toggleLanguage = useAppStore((s) => s.toggleLanguage)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const wrapper = useRef<HTMLDivElement>(null)
  const otherLanguage = language === 'en' ? 'hi' : 'en'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, setOpen])

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="focus-actions"
        aria-label={t('a11y.moreActions')}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      <div
        id="focus-actions"
        hidden={!open}
        className="absolute end-0 top-11 z-50 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
      >
        {/* The page's own entries, then a rule, then the three the shell owes
            every focus route. */}
        <div ref={hostRef('menu')} className="flex flex-col" data-focus-menu />
        <hr className="my-1 border-border" />
        {/*
          The SAME accessible names the top bar's own toggles carry, because
          this is the same control in the one place that bar is hidden — a
          reader (or a test) looking for "Switch to Hindi" should find it
          wherever they are.
        */}
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          aria-label={t('a11y.toggleLanguage')}
          onClick={() => {
            // Closes after it acts, like the Settings link below it does. A
            // menu that stays open over the document the reader has just
            // re-rendered in another language is a menu they have to dismiss.
            setOpen(false)
            void toggleLanguage()
          }}
        >
          <Languages aria-hidden="true" className="h-4 w-4" />
          {LANGUAGE_LABELS[otherLanguage]}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          aria-label={theme === 'light' ? t('a11y.toggleTheme') : t('a11y.toggleThemeLight')}
          onClick={() => {
            setOpen(false)
            void toggleTheme()
          }}
        >
          {theme === 'light' ? (
            <Moon aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Sun aria-hidden="true" className="h-4 w-4" />
          )}
          {theme === 'light' ? t('a11y.toggleTheme') : t('a11y.toggleThemeLight')}
        </button>
        <Link to={SETTINGS_PATH} className={FOCUS_MENU_ITEM} onClick={() => setOpen(false)}>
          <Settings aria-hidden="true" className="h-4 w-4" />
          {t('pages.settings.title')}
        </Link>
      </div>
    </div>
  )
}

/**
 * Level 3: a page the officer is INSIDE.
 *
 * No sidebar, no bottom tab bar, no app top bar — `App.tsx` drops all three by
 * asking `levelOf(pathname)`, synchronously and from the route registry, so
 * there is no frame in which the chrome is painted and then taken away. What
 * replaces it is one bar that answers the only two questions this level raises:
 * what am I in, and how do I get out.
 *
 * Escape leaves, unless the reader is typing or a dialog is open — the same two
 * exclusions `useGlobalShortcuts` makes, for the same reason: Escape belongs to
 * whatever is nearest, and the document editor is a screen made of fields.
 */
export function FocusLayout({ className }: { className?: string }) {
  const { t, language } = useT()
  const { pathname } = useLocation()
  const back = useBackTo()
  const { slots, hostRef, menuOpen, setMenuOpen, provider } = useFocusSlotState()

  const goBack = back?.goBack
  useEffect(() => {
    if (!goBack) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing) return
      /*
        The ⋯ menu is nearest, so it wins. Closed here rather than by a
        listener of its own: two capture-phase listeners on `window` fire in
        registration order, and a guarantee that depends on which component
        mounted first is not a guarantee.
      */
      if (menuOpen) {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      /*
        A page's own OVERLAY owns this press, and it cannot say so by handling
        the event first.

        This listener is on `window` in the capture phase and a popover's is on
        `document`, so this one runs FIRST whatever either does — capture walks
        from the window down. The reader's "Aa" tray and its study sheet both
        stopped propagation and both were still thrown out of the provision they
        were open over, because by the time their handler ran this one had
        already navigated.

        So an overlay marks itself in the DOM instead — `data-focus-overlay` on
        the element while it is open — and this asks. That is the same shape as
        the `[role="dialog"]` check below, and it is order-independent, which is
        the property the ⋯ menu's own comment above says a registration-order
        guarantee is not.
      */
      if (document.querySelector('[data-focus-overlay]')) return
      /*
        A dialog that is OPEN owns this press, and the check has to happen
        before it closes.

        This listener is in the CAPTURE phase for exactly that reason. In the
        bubble phase Radix has already handled the same Escape and removed its
        dialog from the DOM, so this query finds nothing and the reader is
        thrown out of the document editor by the press that shut a shortcuts
        sheet — which is ADR-029's "two Escape handlers on one press" arriving
        in a new file, and is how `tests/e2e/draft-editor.spec.ts` found it.
      */
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      goBack()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [goBack, menuOpen, setMenuOpen])

  const title = slots.title ?? pathLabel(pathname, t, language)

  return (
    <FocusSlotsProvider value={provider}>
      <div className={cn('flex min-h-full flex-1 flex-col', className)}>
        {back ? (
          <FocusBar
            backLabel={back.label}
            onBack={back.goBack}
            title={title}
            status={slots.status}
            actions={<FocusActions open={menuOpen} setOpen={setMenuOpen} hostRef={hostRef} />}
            panel={slots.panel}
            hostRef={hostRef}
          />
        ) : null}
        <div className="min-w-0 flex-1 px-4 pt-4 pb-[calc(2.5rem+var(--pwa-toast-space,0px))] sm:px-6">
          <Outlet />
        </div>
      </div>
    </FocusSlotsProvider>
  )
}
