import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Download, Flag } from 'lucide-react'
import { Link } from 'react-router-dom'

import { listReports, reportsToCsv } from '../store'
import { useEffectiveCatalogue } from '../useCatalogue'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Chip, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * `/learn/reports` — every card a reader has flagged, kept visible for an
 * auditor rather than acted on automatically (see `TrainerReportRow`'s own
 * note in `src/db/index.ts`). "Exportable" is a CSV download built entirely
 * client-side — no network, matching the master context's zero-analytics rule.
 */
export default function ReportsPage() {
  const { t, language } = useT()
  const catalogue = useEffectiveCatalogue()
  const reports = useLiveQuery(() => listReports(), [], undefined)

  if (!catalogue || reports === undefined) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const cardById = new Map(catalogue.map((card) => [card.id, card]))

  const download = () => {
    const csv = reportsToCsv(reports)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'trainer-reports.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.reports.title')}
        subtitle={t('trainer.reports.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={t('trainer.reports.emptyTitle')}
          body={t('trainer.reports.emptyBody')}
        />
      ) : (
        <>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={download}>
              <Download aria-hidden="true" />
              {t('trainer.reports.exportCsv')}
            </Button>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {reports.map((report) => {
              const card = cardById.get(report.qId)
              return (
                <li key={report.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="coral">
                      {t(`trainer.review.reasons.${report.reason}`, { defaultValue: report.reason })}
                    </Chip>
                    {card ? (
                      <Chip tone="marigold">
                        {card.ruleRef.citation[language] || card.ruleRef.citation.en}
                      </Chip>
                    ) : null}
                  </div>
                  {card ? <p className="mt-1 text-sm">{card.front[language] || card.front.en}</p> : null}
                  {report.note ? <p className="mt-1 text-sm text-muted-foreground">{report.note}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('trainer.reports.reportedOn', {
                      date: new Date(report.createdAt).toLocaleString(language),
                    })}
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
