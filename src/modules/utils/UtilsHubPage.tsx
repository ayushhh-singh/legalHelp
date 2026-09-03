import { BookMarked, CalendarDays, Landmark, Link2, PiggyBank } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * `/utils` — the Utilities hub.
 *
 * One card per tool, the way the Drafting Studio's picker is one card per
 * document type. Session 13 brings the Hindi glossary's three siblings —
 * holidays, leave, pension — up to the same "links somewhere real" bar,
 * plus the portals directory; every card here is now a working tool.
 */
export default function UtilsHubPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.utils.title')} subtitle={t('pages.utils.subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2">
        <ToolCard
          to="/utils/glossary"
          icon={BookMarked}
          title={t('utils.hub.glossaryTitle')}
          subtitle={t('utils.hub.glossarySubtitle')}
        />
        <ToolCard
          to="/utils/holidays"
          icon={CalendarDays}
          title={t('utils.hub.holidayCalendar')}
          subtitle={t('utils.hub.holidaySubtitle')}
        />
        <ToolCard
          to="/utils/leave"
          icon={PiggyBank}
          title={t('utils.hub.leaveCalculator')}
          subtitle={t('utils.hub.leaveSubtitle')}
        />
        <ToolCard
          to="/utils/pension"
          icon={Landmark}
          title={t('utils.hub.pensionCalculator')}
          subtitle={t('utils.hub.pensionSubtitle')}
        />
        <ToolCard
          to="/utils/portals"
          icon={Link2}
          title={t('utils.hub.portalsDirectory')}
          subtitle={t('utils.hub.portalsSubtitle')}
        />
      </div>

      <Disclaimer />
    </div>
  )
}

function ToolCard({
  to,
  icon: Icon,
  title,
  subtitle,
}: {
  to: string
  icon: typeof BookMarked
  title: string
  subtitle: string
}) {
  return (
    <Link
      to={to}
      className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <SectionCard active className="h-full p-4 transition-colors hover:border-input">
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-marigold-foreground" />
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </SectionCard>
    </Link>
  )
}
