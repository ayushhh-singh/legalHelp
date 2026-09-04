import { ArrowLeft, Languages, MoreHorizontal, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { FocusSlotsProvider, useFocusSlotState } from './focusSlots'
import { pathLabel } from './labels'

import { useAppStore } from '../store'
import { useBackTo } from '../useBackTo'

import { LANGUAGE_LABELS } from '@/i18n'
import { useT } from '@/i18n/useT'
import { SETTINGS_PATH } from '@/lib/nav'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

export function FocusBar({
  backLabel,
  onBack,
  title,
  status,
  actions,
  panel,
}: {
  backLabel: string
  onBack: () => void
  title: string
  status?: React.ReactNode
  actions?: React.ReactNode
  panel?: React.ReactNode
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
    <div className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="-ms-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="max-w-[9rem] truncate sm:max-w-none">{backLabel}</span>
          <span className="sr-only"> — {t('a11y.backToParent')}</span>
        </button>

        {/* The gold rule, as everywhere else: this is the file tab on its side,
            marking the one thing the reader is inside. */}
        <span aria-hidden="true" className="h-6 w-[3px] shrink-0 rounded-sm bg-marigold" />

        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>

        {status ? (
          <span role="status" className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {status}
          </span>
        ) : null}

        <span className="flex shrink-0 items-center gap-1">
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
 */
function FocusActions() {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const toggleLanguage = useAppStore((s) => s.toggleLanguage)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const otherLanguage = language === 'en' ? 'hi' : 'en'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const item =
    'flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-start text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
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
        className="absolute end-0 top-11 z-50 w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
      >
        {/*
          The SAME accessible names the top bar's own toggles carry, because
          this is the same control in the one place that bar is hidden — a
          reader (or a test) looking for "Switch to Hindi" should find it
          wherever they are.
        */}
        <button
          type="button"
          className={item}
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
          className={item}
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
        <Link to={SETTINGS_PATH} className={item} onClick={() => setOpen(false)}>
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
  const { slots, provider } = useFocusSlotState()

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
  }, [goBack])

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
            actions={<FocusActions />}
            panel={slots.panel}
          />
        ) : null}
        <div className="min-w-0 flex-1 px-4 pt-4 pb-[calc(2.5rem+var(--pwa-toast-space,0px))] sm:px-6">
          <Outlet />
        </div>
      </div>
    </FocusSlotsProvider>
  )
}
