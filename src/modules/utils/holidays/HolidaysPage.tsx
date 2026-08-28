import { CalendarDays, Download } from 'lucide-react'
import { useMemo } from 'react'

import { AVAILABLE_YEARS } from './data'
import { toIcs } from '@/lib/holidays/ics'
import { useHolidayPicks } from './useHolidayPicks'
import { useHolidays } from './useHolidaysData'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { istDay } from '@/lib/istDay'
import { MAX_RESTRICTED_PICKS } from '@/lib/holidays/types'
import { upcoming } from '@/lib/holidays/engine'
import { cn } from '@/lib/utils'

import type { Holiday } from './schema'
import type { Language } from '@/i18n'

const MONTH_NAMES: Record<Language, string[]> = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ], // fmt: skip
  hi: [
    'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
    'जुलाई', 'अगस्त', 'सितंबर', 'अक्तूबर', 'नवंबर', 'दिसंबर',
  ], // fmt: skip
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7)) - 1
}

function dayOf(date: string): number {
  return Number(date.slice(8, 10))
}

/** `/utils/holidays` — the DoPT holiday calendar, with restricted-holiday picks and an .ics export. */
export default function HolidaysPage() {
  const { t, language } = useT()
  const year = AVAILABLE_YEARS[0] ?? new Date().getFullYear()
  const calendar = useHolidays(year)
  const picks = useHolidayPicks(year)

  const dataset = calendar.status === 'ready' ? calendar.data : null

  const byMonth = useMemo(() => {
    if (!dataset) return null
    const months: { gazetted: Holiday[]; restricted: Holiday[] }[] = Array.from({ length: 12 }, () => ({
      gazetted: [],
      restricted: [],
    }))
    for (const h of dataset.gazetted) months[monthOf(h.date)]?.gazetted.push(h)
    for (const h of dataset.restricted) months[monthOf(h.date)]?.restricted.push(h)
    return months
  }, [dataset])

  const upcomingHolidays = useMemo(
    () => (dataset ? upcoming(dataset, istDay(), picks.picked, 5) : []),
    [dataset, picks.picked],
  )

  const handleExport = () => {
    if (!dataset) return
    const blob = new Blob([toIcs(dataset)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `holidays-${dataset.year}.ics`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    requestAnimationFrame(() => URL.revokeObjectURL(url))
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('utils.holidays.title')} subtitle={t('utils.holidays.subtitle')} />

      {calendar.status === 'error' ? <QueryErrorState body={t('errors.body')} onRetry={calendar.retry} /> : null}

      {calendar.status === 'loading' ? (
        <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : null}

      {dataset ? (
        <>
          <SectionCard active className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{t('utils.holidays.upcoming')}</h2>
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-action px-3 text-xs font-medium text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Download aria-hidden="true" className="h-3.5 w-3.5" />
                {t('utils.holidays.exportIcs')}
              </button>
            </div>
            {upcomingHolidays.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('utils.holidays.noneUpcoming')}</p>
            ) : (
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {upcomingHolidays.map((h) => (
                  <li
                    key={h.id}
                    className="flex min-w-40 shrink-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <span
                      className={cn(
                        'w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                        h.kind === 'gazetted'
                          ? 'bg-marigold/15 text-marigold-foreground'
                          : 'bg-accent text-accent-foreground',
                      )}
                    >
                      {h.kind === 'gazetted' ? t('utils.holidays.gazetted') : t('utils.holidays.restricted')}
                    </span>
                    <span className="text-sm font-medium">{h.name[language]}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{h.date}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t('utils.holidays.yearAtAGlance', { year: dataset.year })}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {byMonth?.map((month, index) => {
                const total = month.gazetted.length + month.restricted.length
                return (
                  <div key={index} className="rounded-lg border border-border p-2.5">
                    <p className="text-xs font-semibold">{MONTH_NAMES[language][index]}</p>
                    {total === 0 ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{t('utils.holidays.noneThisMonth')}</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[...month.gazetted, ...month.restricted]
                          .sort((a, b) => dayOf(a.date) - dayOf(b.date))
                          .map((h) => (
                            <span
                              key={h.id}
                              title={h.name[language]}
                              className={cn(
                                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                                month.gazetted.includes(h)
                                  ? 'bg-marigold/15 text-marigold-foreground'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {dayOf(h.date)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard className="p-4">
            <h2 className="mb-1 text-sm font-semibold">{t('utils.holidays.gazettedListTitle')}</h2>
            <ol className="mt-2 divide-y divide-border">
              {dataset.gazetted.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{h.name[language]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {h.date} · {h.day}
                  </span>
                </li>
              ))}
            </ol>
          </SectionCard>

          <SectionCard className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">{t('utils.holidays.restrictedListTitle')}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('utils.holidays.picksCount', { count: picks.picked.size, max: MAX_RESTRICTED_PICKS })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t('utils.holidays.picksHelp')}</p>
            <ol className="mt-2 divide-y divide-border">
              {dataset.restricted.map((h) => {
                const checked = picks.picked.has(h.id)
                const disabled = !checked && picks.picked.size >= MAX_RESTRICTED_PICKS
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <label className={cn('flex items-center gap-2', disabled && 'opacity-60')}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => void picks.toggle(h.id)}
                        className="h-4 w-4 rounded border-input"
                      />
                      {h.name[language]}
                    </label>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {h.date} · {h.day}
                    </span>
                  </li>
                )
              })}
            </ol>
          </SectionCard>

          <SectionCard className="border-dashed p-4">
            <div className="flex items-start gap-2.5">
              <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{dataset.delegationNote[language]}</p>
            </div>
          </SectionCard>
        </>
      ) : null}

      <Disclaimer />
      <DataVersion dataset={`holidays-${year}`} />
    </div>
  )
}
