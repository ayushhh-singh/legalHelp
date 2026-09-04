import { Navigate, useLocation } from 'react-router-dom'

import { HOME_PATH, redirectTarget, type Redirect } from '@/lib/nav'

/**
 * One row of `LEGACY_REDIRECTS`, as a route element.
 *
 * `replace`, always: a redirect that pushed would put the dead URL in history,
 * so the back button would land on it and bounce forward again.
 *
 * The query string and the fragment travel with the reader, which is the whole
 * point for a link like `/pay?job=ib-acio-ii-executive&city=delhi&da=60` — a
 * redirect that dropped those would technically work and would have thrown
 * away everything the link was for.
 */
export function LegacyRedirect({ redirect }: { redirect: Redirect }) {
  const location = useLocation()
  const to = redirectTarget(redirect, location.pathname, location.search, location.hash)
  return <Navigate to={to ?? HOME_PATH} replace />
}
