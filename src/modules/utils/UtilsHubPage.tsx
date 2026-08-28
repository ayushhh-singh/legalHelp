import { BookMarked, CalendarDays, Landmark, Link2, PiggyBank, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * `/utils` — the Utilities hub.
 *
 * One card per tool, the way the Drafting Studio's picker is one card per
 * document type: the Hindi glossary is the first tool this module has built,
 * so it is the only card that links anywhere. The rest state what is coming
 * without pretending to be a working control — a disabled-looking card that
 * still accepts a click, or a click that goes nowhere, is worse than a card
 * that plainly says "coming later".
 */
export default function UtilsHubPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.utils.title')} subtitle={t('pages.utils.subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/utils/glossary"
          className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <SectionCard active className="h-full p-4 transition-colors hover:border-input">
            <div className="flex items-start gap-3">
              <BookMarked aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-marigold-foreground" />
              <div>
                <h2 className="text-sm font-semibold">{t('utils.hub.glossaryTitle')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t('utils.hub.glossarySubtitle')}</p>
              </div>
            </div>
          </SectionCard>
        </Link>

        <ComingSoonCard
          icon={CalendarDays}
          title={t('utils.hub.holidayCalendar')}
          label={t('utils.hub.comingSoon')}
        />
        <ComingSoonCard
          icon={PiggyBank}
          title={t('utils.hub.leaveCalculator')}
          label={t('utils.hub.comingSoon')}
        />
        <ComingSoonCard
          icon={Landmark}
          title={t('utils.hub.pensionCalculator')}
          label={t('utils.hub.comingSoon')}
        />
        <ComingSoonCard
          icon={Link2}
          title={t('utils.hub.portalsDirectory')}
          label={t('utils.hub.comingSoon')}
        />
      </div>

      <Disclaimer />
    </div>
  )
}

/**
 * `opacity-*` is deliberately not used here: it dims text along with
 * everything else, and this card's Badge was already at the tokens' own
 * contrast floor — a uniform fade took it below AA (caught by
 * `tests/e2e/a11y.spec.ts` in a real browser, not by the token-level test,
 * which never renders a Badge inside a faded ancestor). A dashed border reads
 * as "not here yet" without touching any text colour.
 */
function ComingSoonCard({
  icon: Icon = Wrench,
  title,
  label,
}: {
  icon?: typeof Wrench
  title: string
  label: string
}) {
  return (
    <SectionCard className="h-full border-dashed p-4">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <Badge tone="neutral" className="mt-1.5">
            {label}
          </Badge>
        </div>
      </div>
    </SectionCard>
  )
}
