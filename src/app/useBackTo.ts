import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { pathLabel } from './layouts/labels'

import { useT } from '@/i18n/useT'
import { resolveParent, routeFor } from '@/lib/nav'

/** What `AppLink` puts in `location.state`. */
export interface AppLinkState {
  /** The section the reader was in when they followed the link. */
  from?: string
}

export interface BackTarget {
  /** The declared parent, with this page's own parameters substituted in. */
  to: string
  /** What the control says: the name of the place it goes. */
  label: string
  /** Follow it. History where that is the same place, the parent otherwise. */
  goBack: () => void
  /** True when `goBack` will pop history rather than push the parent. */
  usesHistory: boolean
}

/**
 * Where "back" goes from a detail or focus page, and what it is called.
 *
 * **Two branches, and the difference is not cosmetic.**
 *
 * A reader who reached the document editor by pressing a row in the register
 * wants the register *as they left it* — the same filters, the same scroll
 * position, the same expanded thread. `navigate(-1)` gives them that and a
 * pushed parent route does not. A reader who reached the SAME editor from a
 * shared link, a bookmark, the command palette or a cold start has no history
 * to pop: popping would take them out of the app entirely, which is the
 * classic broken back chevron. So the hook asks one question — did we arrive
 * here from inside this section? — and `AppLink` is what makes that question
 * answerable, by stamping the section into `location.state` on the way in.
 *
 * The declared parent (`src/lib/nav.ts`'s `APP_ROUTES`) is the answer in the
 * second case, and it is REQUIRED on every detail and focus route, so there is
 * no third case where the chevron has to guess.
 *
 * Returns `null` on a tab route: a section root has no parent inside the app,
 * and a back control there would be a control that leaves it.
 */
export function useBackTo(): BackTarget | null {
  const location = useLocation()
  const navigate = useNavigate()
  const { t, language } = useT()

  const route = routeFor(location.pathname)
  const to = resolveParent(location.pathname)

  const state = location.state as AppLinkState | null
  const usesHistory = Boolean(route && state?.from && state.from === route.section)

  const label = useMemo(() => (to ? pathLabel(to, t, language) : ''), [to, t, language])

  const goBack = useCallback(() => {
    if (!to) return
    if (usesHistory) void navigate(-1)
    else void navigate(to)
  }, [navigate, to, usesHistory])

  if (!route || !to) return null
  return { to, label, goBack, usesHistory }
}
