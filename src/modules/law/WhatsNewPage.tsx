import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { resolveWhatsNew, WHATS_NEW_GROUPS, type ResolvedPoint } from './whatsNew'
import { useLawEngine } from './useLawEngine'
import { toLawHref } from './url'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * `/law/whats-new` — what changed on 1 July 2024.
 *
 * Every bullet is a POINTER into the datasets (`whatsNew.ts`), so the heading,
 * the status and the source URL on each one are read from the same records the
 * converter shows. The only prose written by hand is the one-sentence "why",
 * and each bullet links to the section so the reader can check it against the
 * Act's own words rather than taking this page's word for it.
 */
export default function WhatsNewPage() {
  const { t } = useT()
  const engine = useLawEngine()

  const points = engine.engine ? resolveWhatsNew(engine.engine.corpus) : []

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('law.whatsNew.title')}
        subtitle={t('law.whatsNew.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/law">
              <ArrowLeft aria-hidden="true" />
              {t('law.nav.converter')}
            </Link>
          </Button>
        }
      />

      <p className="max-w-prose text-sm text-muted-foreground">{t('law.whatsNew.intro')}</p>

      {engine.status === 'loading' ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {engine.status === 'error' ? (
        <QueryErrorState
          title={t('law.results.errorTitle')}
          body={t('law.results.errorBody')}
          onRetry={engine.retry}
        />
      ) : null}

      {WHATS_NEW_GROUPS.map((group) => {
        const inGroup = points.filter((entry) => entry.point.group === group)
        if (inGroup.length === 0) return null

        return (
          <section key={group} className="space-y-3">
            <h2 className="text-base font-semibold">{t(`law.whatsNew.groups.${group}`)}</h2>
            <ul className="space-y-3">
              {inGroup.map((entry) => (
                <li key={entry.point.id}>
                  <Bullet entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <footer className="space-y-3 border-t border-border pt-4">
        <DataVersion dataset="law-index" />
        <Disclaimer />
      </footer>
    </div>
  )
}

function Bullet({ entry }: { entry: ResolvedPoint }) {
  const { t, language } = useT()
  const { point } = entry

  const sectionLabel =
    point.kind === 'section'
      ? `${entry.record?.act ?? ''} ${point.clause ?? point.section}`
      : `${point.oldAct} ${point.section}`

  const heading =
    point.kind === 'section'
      ? (entry.record?.heading[language] ?? '') || (entry.record?.heading.en ?? '')
      : entry.entry?.heading[language] || entry.entry?.heading.en || ''

  // A dropped provision has no section to open, so the link goes to the search
  // that shows the "no counterpart" card for it. Both land the reader on the
  // full record rather than on this summary.
  const href =
    point.kind === 'section'
      ? toLawHref({
          query: `${entry.record?.act ?? ''} ${point.section}`,
          code: point.code,
          direction: 'new-old',
          date: null,
        })
      : toLawHref({ query: `${point.oldAct} ${point.section}`, code: null, direction: 'old-new', date: null })

  return (
    <SectionCard className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionNumber>{sectionLabel}</SectionNumber>
        {point.kind === 'dropped' ? (
          <Badge tone="danger">{t('law.status.dropped')}</Badge>
        ) : entry.record ? (
          <Badge tone={entry.record.status === 'new' ? 'success' : 'info'}>
            {t(`law.status.${entry.record.status}`)}
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">{entry.actName[language]}</span>
      </div>

      {heading ? <h3 className="mt-2 text-sm font-semibold">{heading}</h3> : null}
      <p className="mt-2 text-sm">{point.why[language]}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={href}>{t('law.whatsNew.open')}</Link>
        </Button>
        {entry.source ? (
          <SourceChip name={entry.source.name[language] || entry.source.name.en} url={entry.source.url} />
        ) : null}
      </div>
    </SectionCard>
  )
}
