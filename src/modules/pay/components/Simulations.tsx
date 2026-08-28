import { useState } from 'react'

import { ChipGroup, SelectField } from './Fields'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge, SectionCard, StatCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { computePay } from '@/lib/pay/engine'
import { formatDelta, formatPercent, formatRupees } from '@/lib/pay/format'
import { toPayInput, type PayScenario } from '@/lib/pay/scenario'
import { fixOnPromotion, nextIncrement, projectEighthCpc, type IncrementDate } from '@/lib/pay/simulate'
import { cellPay, levelFor, LEVEL_IDS, levelRank, type PayTables } from '@/lib/pay/tables'

/**
 * The four what-ifs.
 *
 * Three of them apply rules that exist — the annual increment, FR 22 fixation
 * on promotion, and a change in the Dearness Allowance rate. The fourth does
 * not: there is no 8th CPC pay matrix, no notified fitment factor and no date
 * of effect. Its panel is therefore built differently on purpose — the banner
 * is not dismissible, the five things nobody knows are rendered in full rather
 * than behind a disclosure, and every fitment factor on the slider carries the
 * name of whoever floated it.
 */

type SimulationTab = 'increment' | 'promotion' | 'cpc8' | 'da'

export function Simulations({ tables, scenario }: { tables: PayTables; scenario: PayScenario }) {
  const { t } = useT()
  const [tab, setTab] = useState<SimulationTab>('increment')

  return (
    <div className="space-y-4">
      <ChipGroup<SimulationTab>
        label={t('pay.sim.title')}
        value={tab}
        options={[
          { value: 'increment', label: t('pay.sim.increment') },
          { value: 'promotion', label: t('pay.sim.promotion') },
          { value: 'cpc8', label: t('pay.sim.cpc8') },
          { value: 'da', label: t('pay.sim.da') },
        ]}
        onChange={setTab}
      />

      {tab === 'increment' ? <IncrementPanel tables={tables} scenario={scenario} /> : null}
      {tab === 'promotion' ? <PromotionPanel tables={tables} scenario={scenario} /> : null}
      {tab === 'cpc8' ? <EighthCpcPanel tables={tables} scenario={scenario} /> : null}
      {tab === 'da' ? <DaPanel tables={tables} scenario={scenario} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function IncrementPanel({ tables, scenario }: { tables: PayTables; scenario: PayScenario }) {
  const { t, language } = useT()
  const [on, setOn] = useState<IncrementDate>('07-01')
  const result = nextIncrement(scenario.level, scenario.cellIndex, on, tables)

  const before = computePay(toPayInput(scenario), tables)
  const after = computePay(toPayInput({ ...scenario, cellIndex: result.toCellIndex, basic: null }), tables)

  return (
    <SectionCard className="space-y-4 p-5">
      <h2 className="text-base font-semibold">{t('pay.sim.incrementTitle')}</h2>
      <ChipGroup<IncrementDate>
        label={t('pay.sim.incrementOn')}
        value={on}
        options={[
          { value: '01-01', label: t('pay.sim.jan') },
          { value: '07-01', label: t('pay.sim.jul') },
        ]}
        onChange={setOn}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('pay.sim.basicNow')} value={formatRupees(result.fromBasic, language)} />
        <StatCard
          label={t('pay.sim.basicAfter')}
          value={formatRupees(result.toBasic, language)}
          hint={t('pay.sim.cellMove', { from: result.fromCellIndex + 1, to: result.toCellIndex + 1 })}
        />
        <StatCard
          label={t('pay.sim.netAfter')}
          value={formatRupees(after.netMonthly, language)}
          hint={formatDelta(after.netMonthly - before.netMonthly, language)}
        />
      </div>

      {result.stagnant ? <Badge tone="warning">{t('pay.sim.stagnant')}</Badge> : null}
      <p className="text-sm text-muted-foreground">{result.note[language]}</p>
      <SourceChip
        name={tables.matrix.levels[0]?.source.name ?? ''}
        url={tables.matrix.levels[0]?.source.url ?? ''}
      />
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ */

function PromotionPanel({ tables, scenario }: { tables: PayTables; scenario: PayScenario }) {
  const { t, language } = useT()
  const higher = LEVEL_IDS(tables.matrix).filter((id) => levelRank(id) > levelRank(scenario.level))
  const [target, setTarget] = useState(higher[0] ?? scenario.level)
  const level = higher.includes(target) ? target : (higher[0] ?? scenario.level)
  const result = fixOnPromotion(scenario.level, scenario.cellIndex, level, tables)

  const before = computePay(toPayInput(scenario), tables)
  const after = computePay(
    toPayInput({ ...scenario, level, cellIndex: result.toCellIndex, basic: null }),
    tables,
  )

  return (
    <SectionCard className="space-y-4 p-5">
      <h2 className="text-base font-semibold">{t('pay.sim.promotionTitle')}</h2>

      <SelectField
        label={t('pay.sim.targetLevel')}
        value={level}
        options={higher.map((id) => {
          const entry = levelFor(tables.matrix, id)
          return {
            value: id,
            label: entry?.gradePay
              ? t('pay.inputs.levelWithGradePay', { level: id, gradePay: entry.gradePay })
              : t('pay.inputs.levelNoGradePay', { level: id, band: entry?.payBand.name ?? '' }),
          }
        })}
        onChange={setTarget}
      />

      <ol className="space-y-2 text-sm">
        <li className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <span className="text-muted-foreground">{t('pay.sim.step1')}</span>
          <span className="font-semibold tabular-nums">{formatRupees(result.fromBasic, language)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <span className="text-muted-foreground">{t('pay.sim.step2')}</span>
          <span className="font-semibold tabular-nums">{formatRupees(result.afterIncrement, language)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            {t('pay.sim.step3', { level, cell: result.toCellIndex + 1 })}
          </span>
          <span className="font-semibold tabular-nums">{formatRupees(result.toBasic, language)}</span>
        </li>
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={t('pay.sim.basicIncrease')} value={formatRupees(result.increase, language)} />
        <StatCard
          label={t('pay.sim.netAfter')}
          value={formatRupees(after.netMonthly, language)}
          hint={formatDelta(after.netMonthly - before.netMonthly, language)}
        />
      </div>

      <p className="text-sm text-muted-foreground">{result.note[language]}</p>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ */

function EighthCpcPanel({ tables, scenario }: { tables: PayTables; scenario: PayScenario }) {
  const { t, language } = useT()
  const basic = scenario.basic ?? cellPay(tables.matrix, scenario.level, scenario.cellIndex) ?? 0
  const [fitment, setFitment] = useState(2.57)
  const projection = projectEighthCpc(basic, fitment, tables)
  const commission = tables.cpc8.commission

  return (
    <SectionCard className="space-y-4 p-5">
      {/* Not dismissible, and first on the card. */}
      <p className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm font-semibold text-marigold-foreground">
        {projection.banner[language]}
      </p>

      <h2 className="text-base font-semibold">{t('pay.sim.cpc8Title')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('pay.sim.cpc8Status', {
          constituted: commission.constitutedOn,
          resolution: commission.resolutionNumber,
          due: commission.reportDue.notBefore,
        })}
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="cpc8-fitment">
          {t('pay.sim.fitment', { value: formatPercent(projection.fitment * 100, language) })}
        </label>
        <input
          id="cpc8-fitment"
          type="range"
          min={projection.range.low}
          max={projection.range.high}
          step={0.01}
          value={projection.fitment}
          onChange={(event) => setFitment(Number(event.target.value))}
          className="h-11 w-full accent-[var(--action)]"
          aria-valuetext={String(projection.fitment)}
        />
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {projection.range.low} – {projection.range.high}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={t('pay.sim.basicNow')} value={formatRupees(projection.fromBasic, language)} />
        <StatCard
          label={t('pay.sim.cpc8Projected')}
          value={formatRupees(projection.projectedBasic, language)}
          hint={t('pay.sim.cpc8ProjectedHint')}
        />
      </div>

      <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
        {projection.daResetNote[language]}
      </p>

      <div>
        <h3 className="text-sm font-semibold">{t('pay.sim.fitmentSources')}</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {projection.options.map((option) => (
            <li key={option.value} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">{option.value}</span>
              <span className="text-muted-foreground">{option.attributedTo[language]}</span>
              <SourceChip name={option.source.name} url={option.source.url} />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t('pay.sim.notKnown')}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {projection.whatIsNotKnown.map((item, index) => (
            <li key={index}>{item[language]}</li>
          ))}
        </ul>
      </div>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ */

function DaPanel({ tables, scenario }: { tables: PayTables; scenario: PayScenario }) {
  const { t, language } = useT()
  const rates = [...new Set([0, 50, 55, 58, 60, 63, 70])].sort((a, b) => a - b)
  const current = computePay(toPayInput(scenario), tables)

  return (
    <SectionCard className="space-y-4 p-5">
      <h2 className="text-base font-semibold">{t('pay.sim.daTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('pay.sim.daIntro')}</p>

      <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={t('pay.sim.daTitle')}>
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('pay.sim.daRate')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t('pay.slip.gross')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t('pay.slip.net')}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t('pay.sim.change')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => {
              const result = computePay(toPayInput({ ...scenario, daRate: rate }), tables)
              const isCurrent = rate === scenario.daRate
              return (
                <tr key={rate} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className={isCurrent ? 'font-semibold' : undefined}>{rate}%</span>
                    {isCurrent ? (
                      <Badge tone="info" className="ml-2">
                        {t('pay.sim.currentRate')}
                      </Badge>
                    ) : null}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatRupees(result.gross, language)}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">
                    {formatRupees(result.netMonthly, language)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatDelta(result.netMonthly - current.netMonthly, language)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{t('pay.sim.daFootnote')}</p>
    </SectionCard>
  )
}
