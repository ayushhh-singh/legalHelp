import { MoreHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, OVERFLOW_NAV_ITEMS, PRIMARY_NAV_ITEMS, type NavItem } from '@/lib/nav'

/**
 * Both navs read src/lib/nav.ts and nothing else.
 *
 * ACTIVE STATE IS NEVER COLOUR ALONE. It is a 3px --marigold rule laid on the
 * chrome's own edge — the sidebar's left edge, the tab bar's top edge — plus a
 * semibold label. That reads for someone who cannot separate the two colours,
 * and it is the same "index tab" gesture as the file tab on an active card.
 */

const GOLD_RULE = 'bg-marigold absolute'

/** Desktop (>=1024px) left sidebar. */
export function Sidebar() {
  const { t, language } = useT()

  return (
    <nav
      aria-label={t('a11y.mainNavigation')}
      className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block"
    >
      <ul className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                cn(
                  // 44px minimum tap target (WCAG 2.5.8).
                  'relative flex min-h-11 items-center gap-3 rounded-md py-2 pr-3 pl-4 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span aria-hidden="true" className={cn(GOLD_RULE, 'inset-y-1 left-0 w-[3px]')} />
                  ) : null}
                  <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label[language]}</span>
                  {isActive ? <span className="sr-only"> ({t('a11y.currentPage')})</span> : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function TabLink({ item, className }: { item: NavItem; className?: string }) {
  const { t, language } = useT()

  return (
    <NavLink
      to={item.path}
      aria-label={item.label[language]}
      className={({ isActive }) =>
        cn(
          'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] transition-colors',
          isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
          className,
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span aria-hidden="true" className={cn(GOLD_RULE, 'inset-x-0 top-0 h-[3px]')} /> : null}
          <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span className="truncate">{item.short[language]}</span>
          {isActive ? <span className="sr-only"> ({t('a11y.currentPage')})</span> : null}
        </>
      )}
    </NavLink>
  )
}

/**
 * Mobile / tablet (<1024px) bottom tab bar.
 *
 * Below 768px it is four flagship modules plus a "More" sheet; from 768px there
 * is room for every destination, so the extra items appear inline and "More"
 * disappears. Both states are pure CSS — no breakpoint kept in React state,
 * which would disagree with the rendered layout for one frame after a resize.
 */
export function BottomTabs() {
  const { t, language } = useT()
  const { pathname } = useLocation()
  const moreRef = useRef<HTMLDivElement>(null)

  /**
   * Open state is DERIVED from the route the sheet was opened on, not tracked
   * separately and reset in an effect. Navigating anywhere — from inside the
   * sheet or from a tab beside it — makes `openedAt` stale and closes the sheet
   * in the same render, with no cascading state update.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const moreOpen = openedAt === pathname
  const setMoreOpen = (open: boolean) => setOpenedAt(open ? pathname : null)

  // Escape, or a click outside, also close it.
  useEffect(() => {
    if (!moreOpen) return
    // setOpenedAt directly, not the setMoreOpen helper: the helper closes over
    // `pathname` and is a new function every render, which would re-subscribe
    // these listeners on each one.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedAt(null)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setOpenedAt(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [moreOpen])

  const overflowIsActive = OVERFLOW_NAV_ITEMS.some((item) => pathname.startsWith(item.path))

  return (
    <div
      ref={moreRef}
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* The sheet lives INSIDE the nav landmark, not beside it: content outside
          every landmark is an axe `region` violation, and these are navigation
          links either way. Distinct label from the sidebar's, since both are in
          the DOM at once (only one is visible per breakpoint). */}
      <nav aria-label={t('a11y.tabNavigation')}>
        {moreOpen ? (
          <div
            id="nav-more-sheet"
            className="mx-2 mb-2 rounded-lg border border-border bg-card p-2 shadow-lg md:hidden"
          >
            <ul className="flex flex-col gap-1">
              {OVERFLOW_NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      cn(
                        'relative flex min-h-11 items-center gap-3 rounded-md py-2 pr-3 pl-4 text-sm',
                        isActive ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <span aria-hidden="true" className={cn(GOLD_RULE, 'inset-y-1 left-0 w-[3px]')} />
                        ) : null}
                        <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                        <span>{item.label[language]}</span>
                        {isActive ? <span className="sr-only"> ({t('a11y.currentPage')})</span> : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ul className="grid grid-cols-5 border-t border-border bg-card md:grid-cols-6">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <TabLink item={item} />
            </li>
          ))}

          {/* From 768px there is room for the overflow items inline. */}
          {OVERFLOW_NAV_ITEMS.map((item) => (
            <li key={item.id} className="hidden md:block">
              <TabLink item={item} />
            </li>
          ))}

          <li className="md:hidden">
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-controls="nav-more-sheet"
              aria-label={t('nav.moreSheet')}
              className={cn(
                'relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] transition-colors',
                overflowIsActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {overflowIsActive ? (
                <span aria-hidden="true" className={cn(GOLD_RULE, 'inset-x-0 top-0 h-[3px]')} />
              ) : null}
              {moreOpen ? (
                <X aria-hidden="true" className="h-5 w-5 shrink-0" />
              ) : (
                <MoreHorizontal aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              <span className="truncate">{moreOpen ? t('nav.close') : t('nav.more')}</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  )
}
