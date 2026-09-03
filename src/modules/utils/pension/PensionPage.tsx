import { useMemo, useState } from 'react'

import { loadPensionTables } from './data'
import {
  commuteePension,
  currentGpfRate,
  projectGpfBalance,
  projectNpsCorpus,
  retirementGratuity,
  superannuationDate,
  upsAssuredPayout,
  upsLumpSum,
} from '@/lib/pension/engine'
import type { PensionScheme } from '@/lib/pension/types'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, QueryErrorState, SectionCard, Skeleton, StatCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { completedMonths, completedYears, isIsoDate, istDay } from '@/lib/istDay'
import { formatRupees } from '@/lib/pay/format'
import { useAsync } from '@/lib/useAsync'

function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  suffix?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={0}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}

const num = (value: string, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** `/utils/pension` — superannuation date, NPS/UPS projection, gratuity and commutation. */
export default function PensionPage() {
  const { t, language } = useT()
  const tables = useAsync(loadPensionTables, 'pension-tables', true)
  const today = istDay()

  const [dob, setDob] = useState('1970-03-15')
  const [doj, setDoj] = useState('1995-07-01')
  const [scheme, setScheme] = useState<PensionScheme>('ups')
  const [basicPay, setBasicPay] = useState('56100')
  const [daPercent, setDaPercent] = useState('60')
  const [avgLast12, setAvgLast12] = useState('')
  const [annualReturn, setAnnualReturn] = useState('9')
  const [existingCorpus, setExistingCorpus] = useState('0')
  const [gpfMonthly, setGpfMonthly] = useState('')
  const [gpfBalance, setGpfBalance] = useState('0')

  const datesValid = isIsoDate(dob) && isIsoDate(doj)
  const retirementDate = datesValid ? superannuationDate(dob) : null

  const basic = num(basicPay)
  const basicPlusDa = basic * (1 + num(daPercent) / 100)
  const avgLast12Basic = avgLast12 ? num(avgLast12) : basic

  const facts = tables.status === 'ready' ? tables.data.facts : null

  const gratuity = useMemo(() => {
    if (!facts || !retirementDate) return null
    return retirementGratuity(facts, doj, retirementDate, basicPlusDa)
  }, [facts, doj, retirementDate, basicPlusDa])

  const monthsToRetirement = retirementDate ? Math.max(0, completedMonths(today, retirementDate)) : 0
  const qualifyingYears = retirementDate ? completedMonths(doj, retirementDate) / 12 : 0

  const npsCorpus =
    scheme === 'nps'
      ? projectNpsCorpus({
          monthlyBasicPlusDa: basicPlusDa,
          employeeRatePercent: 10,
          employerRatePercent: 14,
          months: monthsToRetirement,
          annualReturnPercent: num(annualReturn, 9),
          existingCorpus: num(existingCorpus),
        })
      : null

  const upsPayout = scheme === 'ups' ? upsAssuredPayout(avgLast12Basic, qualifyingYears) : null
  const upsLump = scheme === 'ups' && gratuity ? upsLumpSum(basicPlusDa, gratuity.halfYears) : null

  const ageNextBirthdayAtRetirement =
    datesValid && retirementDate ? completedYears(dob, retirementDate) + 1 : null

  const commutation =
    facts && upsPayout?.eligible && ageNextBirthdayAtRetirement
      ? commuteePension(facts, upsPayout.amount, ageNextBirthdayAtRetirement)
      : undefined

  const gpfRate = facts ? currentGpfRate(facts, today) : 0
  const gpfProjection =
    facts && num(gpfMonthly) > 0
      ? projectGpfBalance({
          monthlyContribution: num(gpfMonthly),
          months: monthsToRetirement,
          annualRatePercent: gpfRate,
          existingBalance: num(gpfBalance),
        })
      : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('utils.pension.title')} subtitle={t('utils.pension.subtitle')} />

      <SectionCard active className="p-4">
        <h2 className="mb-3 text-sm font-semibold">{t('utils.pension.inputsTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label htmlFor="pension-dob" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('utils.pension.dob')}
            </label>
            <input
              id="pension-dob"
              type="date"
              value={dob}
              onChange={(event) => setDob(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          <div>
            <label htmlFor="pension-doj" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('utils.pension.doj')}
            </label>
            <input
              id="pension-doj"
              type="date"
              value={doj}
              onChange={(event) => setDoj(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('utils.pension.scheme')}
            </label>
            <div className="flex h-10 items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="radio" checked={scheme === 'ups'} onChange={() => setScheme('ups')} />
                {t('utils.pension.ups')}
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="radio" checked={scheme === 'nps'} onChange={() => setScheme('nps')} />
                {t('utils.pension.nps')}
              </label>
            </div>
          </div>
          <NumberField
            id="pension-basic"
            label={t('utils.pension.basicPay')}
            value={basicPay}
            onChange={setBasicPay}
          />
          <NumberField
            id="pension-da"
            label={t('utils.pension.daPercent')}
            value={daPercent}
            onChange={setDaPercent}
            suffix="%"
          />
          {scheme === 'ups' ? (
            <NumberField
              id="pension-avg12"
              label={t('utils.pension.avgLast12')}
              value={avgLast12}
              onChange={setAvgLast12}
            />
          ) : (
            <NumberField
              id="pension-return"
              label={t('utils.pension.annualReturn')}
              value={annualReturn}
              onChange={setAnnualReturn}
              suffix="%"
            />
          )}
        </div>
      </SectionCard>

      {tables.status === 'error' ? <QueryErrorState body={t('errors.body')} onRetry={tables.retry} /> : null}
      {tables.status === 'loading' ? (
        <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {facts && retirementDate ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label={t('utils.pension.superannuationDate')} value={retirementDate} />
            <StatCard
              label={t('utils.pension.qualifyingService')}
              value={t('utils.pension.years', { count: Math.round(qualifyingYears * 10) / 10 })}
            />
          </div>

          {gratuity ? (
            <SectionCard className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t('utils.pension.gratuityTitle')}</h2>
                {facts.gratuity.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{facts.gratuity.rule[language]}</p>
              <p className="font-display mt-2 text-2xl">{formatRupees(gratuity.amount, language)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('utils.pension.gratuityHint', {
                  halfYears: gratuity.halfYears,
                  ceiling: formatRupees(gratuity.ceiling, language),
                })}
              </p>
              <div className="mt-2">
                <SourceChip name={facts.gratuity.source.name} url={facts.gratuity.source.url} />
              </div>
            </SectionCard>
          ) : null}

          {scheme === 'nps' ? (
            <SectionCard className="p-4">
              <h2 className="text-sm font-semibold">{t('utils.pension.npsTitle')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('utils.pension.npsHelp')}</p>
              <NumberField
                id="pension-nps-existing"
                label={t('utils.pension.existingCorpus')}
                value={existingCorpus}
                onChange={setExistingCorpus}
              />
              <p className="font-display mt-3 text-2xl">
                {npsCorpus !== null ? formatRupees(npsCorpus, language) : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('utils.pension.npsProjectionNote')}</p>
            </SectionCard>
          ) : (
            <SectionCard className="p-4">
              <h2 className="text-sm font-semibold">{t('utils.pension.upsTitle')}</h2>
              {upsPayout?.eligible ? (
                <>
                  <p className="font-display mt-2 text-2xl">
                    {formatRupees(upsPayout.amount, language)}{' '}
                    <span className="text-sm font-normal text-muted-foreground">
                      {t('utils.pension.perMonth')}
                    </span>
                  </p>
                  {upsPayout.flooredByMinimum ? (
                    <p className="mt-1 text-xs text-muted-foreground">{t('utils.pension.upsFloored')}</p>
                  ) : null}
                  {upsLump !== null ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('utils.pension.upsLumpSum', { amount: formatRupees(upsLump, language) })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t('utils.pension.upsNotEligible')}</p>
              )}
            </SectionCard>
          )}

          {commutation ? (
            <SectionCard className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t('utils.pension.commutationTitle')}</h2>
                {facts.commutation.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{facts.commutation.rule[language]}</p>
              <p className="font-display mt-2 text-2xl">{formatRupees(commutation.lumpSum, language)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('utils.pension.commutationHint', {
                  reduced: formatRupees(commutation.reducedMonthlyPension, language),
                })}
              </p>
              <div className="mt-2">
                <SourceChip name={facts.commutation.source.name} url={facts.commutation.source.url} />
              </div>
            </SectionCard>
          ) : null}

          <SectionCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('utils.pension.gpfTitle')}</h2>
              {facts.gpf.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('utils.pension.gpfRate', { rate: gpfRate })}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <NumberField
                id="pension-gpf-balance"
                label={t('utils.pension.gpfExisting')}
                value={gpfBalance}
                onChange={setGpfBalance}
              />
              <NumberField
                id="pension-gpf-monthly"
                label={t('utils.pension.gpfMonthly')}
                value={gpfMonthly}
                onChange={setGpfMonthly}
              />
            </div>
            <p className="font-display mt-3 text-2xl">
              {gpfProjection !== null ? formatRupees(gpfProjection, language) : '—'}
            </p>
            <div className="mt-2">
              <SourceChip name={facts.gpf.source.name} url={facts.gpf.source.url} />
            </div>
          </SectionCard>
        </>
      ) : null}

      <Disclaimer />
      <DataVersion dataset="pension-facts" />
    </div>
  )
}
