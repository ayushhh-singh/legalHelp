import { NavLink } from 'react-router-dom'

import { NAV_ROUTES, TAB_BAR_ROUTES } from './routes'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/** Desktop (>=1024px) left sidebar. */
export function Sidebar() {
  const { t } = useT()

  return (
    <nav
      aria-label={t('a11y.mainNavigation')}
      className="hidden w-56 shrink-0 border-r border-border bg-paper-2/50 lg:block"
    >
      <ul className="flex flex-col gap-1 p-3">
        {NAV_ROUTES.map(({ path, longLabelKey, icon: Icon }) => (
          <li key={path}>
            <NavLink
              to={path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-ink font-medium text-paper' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span>{t(longLabelKey)}</span>
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

/** Mobile (<1024px) bottom tab bar. */
export function BottomTabs() {
  const { t } = useT()

  return (
    <nav
      /* Distinct from the sidebar's label: both are in the DOM at once (only
         one is visible per breakpoint), so landmarks must be distinguishable. */
      aria-label={t('a11y.tabNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-paper lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Column count is derived, so adding a tab cannot silently break the row. */}
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${TAB_BAR_ROUTES.length}, minmax(0, 1fr))` }}
      >
        {TAB_BAR_ROUTES.map(({ path, labelKey, longLabelKey, icon: Icon }) => (
          <li key={path}>
            <NavLink
              to={path}
              aria-label={t(longLabelKey)}
              className={({ isActive }) =>
                cn(
                  // 56px min target height keeps the tap area comfortable.
                  'flex min-h-[3.5rem] flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] transition-colors',
                  isActive ? 'font-medium text-thread' : 'text-ink-2',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  <span className="truncate">{t(labelKey)}</span>
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
