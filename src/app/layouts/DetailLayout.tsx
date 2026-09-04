import { ChevronLeft } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { ancestorsOf, pathLabel } from './labels'

import { useBackTo } from '../useBackTo'

import { Breadcrumbs, type Crumb } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * Level 2: a page reached from a section.
 *
 * A trail on a screen wide enough for one, a back chevron on a phone where a
 * four-crumb trail wraps to two lines and says less than an arrow does. Both
 * are built from the SAME declared parents (`src/lib/nav.ts`), so the chevron
 * and the trail can never point at different places.
 *
 * The page keeps its own `<h1>`: at this level the page IS the subject, unlike
 * a tab page, where the section is.
 */
export function DetailLayout() {
  const { t, language } = useT()
  const { pathname } = useLocation()
  const back = useBackTo()

  const crumbs: Crumb[] = ancestorsOf(pathname).map((path) => ({
    label: pathLabel(path, t, language),
    to: path,
  }))
  // The current page is the last crumb and is NOT a link — that is what
  // `aria-current="page"` on it means. Its name comes from the same map the
  // chevron uses, so the two agree.
  crumbs.push({ label: pathLabel(pathname, t, language) })

  return (
    <div className="flex flex-col gap-4">
      {back ? (
        <button
          type="button"
          onClick={back.goBack}
          className="-ms-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          {back.label}
        </button>
      ) : null}

      <Breadcrumbs items={crumbs} className="hidden lg:block" />

      <Outlet />
    </div>
  )
}
