import { forwardRef } from 'react'
import { Link, useLocation, type LinkProps } from 'react-router-dom'

import type { AppLinkState } from './useBackTo'

import { routeFor } from '@/lib/nav'

/**
 * A `<Link>` that says where it was followed from.
 *
 * It stamps the CURRENT section into `location.state`, and that one string is
 * what lets `useBackTo` tell "you came here from the register" apart from "you
 * opened this from a bookmark". The first can pop history and give the reader
 * the list exactly as they left it; the second must push the declared parent,
 * because popping would leave the app.
 *
 * Use it for any link that crosses from a tab or a detail page INTO a detail
 * or focus page. A plain `<Link>` still works everywhere — it simply falls to
 * the parent branch, which is the safe one — so this is an improvement to
 * reach for rather than a rule to enforce.
 */
export const AppLink = forwardRef<HTMLAnchorElement, LinkProps>(function AppLink({ state, ...props }, ref) {
  const { pathname } = useLocation()
  const from = routeFor(pathname)?.section
  const merged: AppLinkState & Record<string, unknown> = {
    ...(typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {}),
    ...(from ? { from } : {}),
  }
  return <Link ref={ref} state={merged} {...props} />
})
