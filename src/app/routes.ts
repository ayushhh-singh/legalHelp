import { Calculator, FileSignature, GraduationCap, Scale, Settings, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type en from '@/i18n/en.json'

/** Exact translation keys under `nav.`, so a typo is a compile error. */
export type NavKey = `nav.${Extract<keyof typeof en.nav, string>}`

/**
 * Single source of truth for navigation. The sidebar, the bottom tab bar and
 * the router all read this, so a route can never appear in one and not another.
 *
 * `labelKey` is the short form used on the tab bar; `longLabelKey` is the
 * accessible name and the sidebar label.
 */
export interface NavRoute {
  path: string
  labelKey: NavKey
  longLabelKey: NavKey
  icon: LucideIcon
  /** Shown in the bottom tab bar on mobile. Settings is reachable from the top bar. */
  inTabBar: boolean
}

export const NAV_ROUTES: readonly NavRoute[] = [
  { path: '/law', labelKey: 'nav.law', longLabelKey: 'nav.lawLong', icon: Scale, inTabBar: true },
  { path: '/pay', labelKey: 'nav.pay', longLabelKey: 'nav.payLong', icon: Calculator, inTabBar: true },
  {
    path: '/draft',
    labelKey: 'nav.draft',
    longLabelKey: 'nav.draftLong',
    icon: FileSignature,
    inTabBar: true,
  },
  {
    path: '/learn',
    labelKey: 'nav.learn',
    longLabelKey: 'nav.learnLong',
    icon: GraduationCap,
    inTabBar: true,
  },
  { path: '/utils', labelKey: 'nav.utils', longLabelKey: 'nav.utilsLong', icon: Wrench, inTabBar: true },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    longLabelKey: 'nav.settingsLong',
    icon: Settings,
    inTabBar: false,
  },
] as const

export const TAB_BAR_ROUTES = NAV_ROUTES.filter((r) => r.inTabBar)

/** Landing route. Law is the most-used module, so it takes "/". */
export const HOME_PATH = '/law'
