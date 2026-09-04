import { NavLink } from 'react-router-dom'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'
import { NAV_TABS, type NavTab } from '@/lib/nav'

/**
 * Both navs read src/lib/nav.ts and nothing else.
 *
 * ACTIVE STATE IS NEVER COLOUR ALONE. It is a 3px --marigold rule laid on the
 * chrome's own edge — the sidebar's left edge, the tab bar's top edge — plus a
 * semibold label. That reads for someone who cannot separate the two colours,
 * and it is the same "index tab" gesture as the file tab on an active card.
 *
 * ### There is no "More"
 *
 * There used to be: seven destinations against four bottom-bar slots meant
 * three of them lived behind a sheet, so half the app was invisible on a phone
 * until you opened a menu that told you nothing about where you were. Five tabs
 * fit the bar at every width, so the sheet is gone and both chromes now render
 * the same five things (ADR-046). What was behind it did not disappear — the
 * Library became Study → Read, Utilities became Tools, and Settings became the
 * top-right menu, which is where an officer looks for it anyway.
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
        {NAV_TABS.map((item) => (
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

function TabLink({ item }: { item: NavTab }) {
  const { t, language } = useT()

  return (
    <NavLink
      to={item.path}
      aria-label={item.label[language]}
      className={({ isActive }) =>
        cn(
          'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] transition-colors',
          isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
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
 * Mobile / tablet (<1024px) bottom tab bar: five tabs, every width, no sheet.
 */
export function BottomTabs() {
  const { t } = useT()

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Distinct label from the sidebar's, since both are in the DOM at once
          (only one is visible per breakpoint). */}
      <nav aria-label={t('a11y.tabNavigation')}>
        <ul className="grid grid-cols-5 border-t border-border bg-card">
          {NAV_TABS.map((item) => (
            <li key={item.id}>
              <TabLink item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
