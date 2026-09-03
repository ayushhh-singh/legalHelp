import { useMemo, useState } from 'react'

import { calculateLeaveBalances, cashEquivalent } from '@/lib/leave/engine'
import {
  CL_CITATION,
  EL_CITATION,
  EL_ENCASHMENT_CITATION,
  EL_ENCASHMENT_MAX_DAYS,
  EOL_CITATION,
  HPL_CITATION,
  LEAVE_PREPARATORY_TO_RETIREMENT_CITATION,
  LTC_BLOCK_YEARS,
  LTC_ENCASHMENT_CITATION,
  LTC_ENCASHMENT_DAYS,
  RH_CITATION,
} from '@/lib/leave/rules'
import type { RuleCitation } from '@/lib/leave/rules'

import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard, StatCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { formatRupees } from '@/lib/pay/format'
import { istDay, isIsoDate } from '@/lib/istDay'

function Citation({ citation }: { citation: RuleCitation }) {
  const { t, language } = useT()
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {citation.act[language]}, {citation.rule}
      {citation.verify ? (
        <Badge tone="warning" className="px-1.5 py-0 text-[10px]">
          {t('common.verifyWithDdo')}
        </Badge>
      ) : null}
    </span>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </div>
  )
}

const num = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/** `/utils/leave` — the CCS (Leave) Rules, 1972 leave calculator. */
export default function LeavePage() {
  const { t, language } = useT()
  const today = istDay()

  const [doj, setDoj] = useState('2015-07-01')
  const [asOf, setAsOf] = useState(today)
  const [elTaken, setElTaken] = useState('0')
  const [hplTaken, setHplTaken] = useState('0')
  const [clTaken, setClTaken] = useState('0')
  const [rhTaken, setRhTaken] = useState('0')
  const [basicPlusDa, setBasicPlusDa] = useState('')

  const asOfValid = isIsoDate(asOf) && isIsoDate(doj) && doj <= asOf

  const balances = useMemo(() => {
    if (!asOfValid) return null
    return calculateLeaveBalances(
      {
        doj,
        elTaken: num(elTaken),
        hplTaken: num(hplTaken),
        clTakenThisYear: num(clTaken),
        rhTakenThisYear: num(rhTaken),
      },
      asOf,
    )
  }, [asOfValid, doj, asOf, elTaken, hplTaken, clTaken, rhTaken])

  const basic = num(basicPlusDa)
  const elEncashment = balances && basic > 0 ? cashEquivalent(basic, balances.el.encashable) : null
  const ltcEncashment = basic > 0 ? cashEquivalent(basic, LTC_ENCASHMENT_DAYS) : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('utils.leave.title')} subtitle={t('utils.leave.subtitle')} />

      <SectionCard active className="p-4">
        <h2 className="mb-3 text-sm font-semibold">{t('utils.leave.inputsTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label htmlFor="leave-doj" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('utils.leave.doj')}
            </label>
            <input
              id="leave-doj"
              type="date"
              value={doj}
              onChange={(event) => setDoj(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          <div>
            <label htmlFor="leave-asof" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('utils.leave.asOf')}
            </label>
            <input
              id="leave-asof"
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          <NumberField
            id="leave-basic"
            label={t('utils.leave.basicPlusDa')}
            value={basicPlusDa}
            onChange={setBasicPlusDa}
          />
          <NumberField
            id="leave-el-taken"
            label={t('utils.leave.elTaken')}
            value={elTaken}
            onChange={setElTaken}
          />
          <NumberField
            id="leave-hpl-taken"
            label={t('utils.leave.hplTaken')}
            value={hplTaken}
            onChange={setHplTaken}
          />
          <NumberField
            id="leave-cl-taken"
            label={t('utils.leave.clTaken')}
            value={clTaken}
            onChange={setClTaken}
          />
          <NumberField
            id="leave-rh-taken"
            label={t('utils.leave.rhTaken')}
            value={rhTaken}
            onChange={setRhTaken}
          />
        </div>
        {!asOfValid ? <p className="mt-2 text-xs text-destructive">{t('utils.leave.dateError')}</p> : null}
      </SectionCard>

      {balances ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <StatCard
              label={t('utils.leave.el')}
              value={t('utils.leave.days', { count: balances.el.balance })}
              hint={t('utils.leave.encashableHint', { count: balances.el.encashable })}
            />
            <StatCard
              label={t('utils.leave.hpl')}
              value={t('utils.leave.days', { count: Math.floor(balances.hpl.balance * 100) / 100 })}
              hint={t('utils.leave.commutableHint', { count: balances.hpl.commutable })}
            />
            <StatCard
              label={t('utils.leave.cl')}
              value={t('utils.leave.days', { count: balances.cl.balance })}
            />
            <StatCard
              label={t('utils.leave.rh')}
              value={t('utils.leave.days', { count: balances.rh.balance })}
            />
          </div>

          <SectionCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('utils.leave.el')}</h2>
              <Citation citation={EL_CITATION} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('utils.leave.hpl')}</h3>
              <Citation citation={HPL_CITATION} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('utils.leave.cl')}</h3>
              <Citation citation={CL_CITATION} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('utils.leave.rh')}</h3>
              <Citation citation={RH_CITATION} />
            </div>
          </SectionCard>

          <SectionCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('utils.leave.encashmentTitle')}</h2>
              <Citation citation={EL_ENCASHMENT_CITATION} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('utils.leave.encashmentHelp')}</p>
            <p className="font-display mt-2 text-xl">
              {elEncashment !== null ? formatRupees(elEncashment, language) : '—'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('utils.leave.encashmentDays', {
                count: balances.el.encashable,
                max: EL_ENCASHMENT_MAX_DAYS,
              })}
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">{t('utils.leave.ltcEncashmentTitle')}</h3>
              <Citation citation={LTC_ENCASHMENT_CITATION} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('utils.leave.ltcEncashmentHelp', { days: LTC_ENCASHMENT_DAYS })}
            </p>
            <p className="font-display mt-2 text-xl">
              {ltcEncashment !== null ? formatRupees(ltcEncashment, language) : '—'}
            </p>
          </SectionCard>

          <SectionCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('utils.leave.ltcBlockTitle')}</h2>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {LTC_BLOCK_YEARS.map((block) => (
                <li key={block.block} className="flex items-center justify-between">
                  <span>{block.block}</span>
                  <span
                    className={`text-xs ${
                      today >= `${block.startYear}-01-01` && today <= `${block.endYear}-12-31`
                        ? 'font-semibold text-marigold-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {today >= `${block.startYear}-01-01` && today <= `${block.endYear}-12-31`
                      ? t('utils.leave.currentBlock')
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t('utils.leave.ltcBlockHelp')}</p>
          </SectionCard>

          <SectionCard className="border-dashed p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('utils.leave.eolTitle')}</h2>
              <Citation citation={EOL_CITATION} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('utils.leave.eolHelp')}</p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">{t('utils.leave.preparatoryTitle')}</h3>
              <Citation citation={LEAVE_PREPARATORY_TO_RETIREMENT_CITATION} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('utils.leave.preparatoryHelp')}</p>
          </SectionCard>
        </>
      ) : null}

      <Disclaimer />
    </div>
  )
}
