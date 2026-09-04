import { Outlet, useLocation } from 'react-router-dom'

import { SegmentedTabs } from './SegmentedTabs'
import { SECTION_SUBTITLE_KEYS } from './titles'

import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'
import { NAV_TABS, tabFor } from '@/lib/nav'

/**
 * Level 1: a section's own page.
 *
 * The app chrome (top bar, sidebar, bottom bar) is `App.tsx`'s; what this adds
 * is the two things that make a section a section — ONE `<h1>` naming it, and
 * the strip of sub-tabs underneath. Each sub-tab's page therefore starts at
 * `<h2>`: a heading level says how deep you are, and four pages each claiming
 * to be the top of the same section is exactly the flatness this restructure
 * was for.
 *
 * `badges` comes from the section's own router — which is lazily loaded —
 * rather than from a hook in here, because a count computed in the app shell
 * is a count every reader downloads the machinery for whether or not they ever
 * open that section.
 */
export function TabLayout({ badges }: { badges?: Readonly<Record<string, number | undefined>> }) {
  const { t, language } = useT()
  const { pathname } = useLocation()
  const tab = tabFor(pathname) ?? NAV_TABS[0]

  if (!tab) return <Outlet />

  const subtitleKey = SECTION_SUBTITLE_KEYS[tab.id as keyof typeof SECTION_SUBTITLE_KEYS]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tab.label[language]}
        {...(subtitleKey ? { subtitle: t(subtitleKey) } : {})}
        className="pb-3"
      />
      <SegmentedTabs subTabs={tab.subTabs} {...(badges ? { badges } : {})} />
      <Outlet />
    </div>
  )
}
