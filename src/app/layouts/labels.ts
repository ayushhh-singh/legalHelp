import { ROUTE_TITLE_KEYS } from './titles'

import type { Language } from '@/i18n'
import type { useT } from '@/i18n/useT'
import { NAV_TABS, resolveParent, routeFor, SETTINGS_PATH, SETTINGS_SECTIONS } from '@/lib/nav'

type Translate = ReturnType<typeof useT>['t']

/**
 * What a path is CALLED, in the reader's language.
 *
 * One function, so the breadcrumb trail, the mobile back chevron and the focus
 * bar cannot disagree about the name of the page above. A tab or a sub-tab is
 * named by `src/lib/nav.ts` (bilingual, in the data); anything else is named by
 * the literal key map in `titles.ts`.
 */
export function pathLabel(path: string, t: Translate, language: Language): string {
  const tab = NAV_TABS.find((candidate) => candidate.path === path)
  if (tab) return tab.label[language]

  for (const candidate of NAV_TABS) {
    const subTab = candidate.subTabs.find((entry) => entry.path === path)
    if (subTab) return subTab.label[language]
  }

  if (path === SETTINGS_PATH) return t('pages.settings.title')
  const section = SETTINGS_SECTIONS.find((entry) => entry.path === path)
  if (section) return section.label[language]

  const route = routeFor(path)
  const key = route ? ROUTE_TITLE_KEYS[route.path as keyof typeof ROUTE_TITLE_KEYS] : undefined
  return key ? t(key) : path
}

/**
 * The ancestor chain of a pathname, outermost first, EXCLUDING the page itself.
 *
 * Walks the declared parents rather than the URL's own segments: `/settings/ai`
 * is a child of `/settings` and `/draft/d/<id>` is a child of `/draft/documents`,
 * which no amount of splitting on "/" would say. Bounded, because a cycle in
 * the registry would otherwise hang the shell rather than fail a test.
 */
export function ancestorsOf(pathname: string): string[] {
  const chain: string[] = []
  let current = pathname
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = resolveParent(current)
    if (!parent || chain.includes(parent)) break
    chain.unshift(parent)
    current = parent
  }
  return chain
}
