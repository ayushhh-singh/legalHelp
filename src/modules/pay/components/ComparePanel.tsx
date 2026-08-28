import { CityPicker, JobPicker } from './Pickers'
import { SelectField, Stepper } from './Fields'

import { SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { diffResults } from '@/lib/pay/compare'
import { computePay } from '@/lib/pay/engine'
import { formatDelta, formatRupees } from '@/lib/pay/format'
import { toPayInput, type PayScenario } from '@/lib/pay/scenario'
import { cellPay, levelFor, LEVEL_IDS, type PayTables } from '@/lib/pay/tables'

/**
 * Two posts, side by side, with the difference in its own column.
 *
 * Each side keeps its own picker and its own city, because the two questions
 * an officer actually asks are "the same post in two cities" and "two posts in
 * the same city", and a shared control would answer only one of them. The
 * Dearness Allowance rate is shared, because a comparison across two different
 * DA rates is not a comparison of the posts.
 */

export function ComparePanel({
  tables,
  a,
  b,
  onChangeA,
  onChangeB,
  onPickA,
  onPickB,
}: {
  tables: PayTables
  a: PayScenario
  b: PayScenario
  onChangeA: (patch: Partial<PayScenario>) => void
  onChangeB: (patch: Partial<PayScenario>) => void
  onPickA: (jobId: string | null) => void
  onPickB: (jobId: string | null) => void
}) {
  const { t, language } = useT()

  const resultA = computePay(toPayInput(a), tables)
  const resultB = computePay(toPayInput({ ...b, daRate: a.daRate, daProjected: a.daProjected }), tables)
  const diff = diffResults(resultA, resultB)

  const rows = diff.rows.filter((row) => row.a !== 0 || row.b !== 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          tables={tables}
          scenario={a}
          heading={t('pay.compare.postA')}
          onChange={onChangeA}
          onPick={onPickA}
        />
        <Side
          tables={tables}
          scenario={b}
          heading={t('pay.compare.postB')}
          onChange={onChangeB}
          onPick={onPickB}
          daNote={t('pay.compare.sharedDa', { rate: a.daRate })}
        />
      </div>

      <SectionCard className="p-5">
        <h2 className="text-base font-semibold">{t('pay.compare.title')}</h2>
        <div className="mt-4 overflow-x-auto" role="region" tabIndex={0} aria-label={t('pay.compare.title')}>
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('pay.slip.lineHeader')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('pay.compare.postA')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('pay.compare.postB')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('pay.compare.difference')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {row.label[language]}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatRupees(row.a, language)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatRupees(row.b, language)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatDelta(row.delta, language)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[diff.gross, diff.deductions, diff.net, diff.annualCtc].map((row) => (
                <tr key={row.id} className="border-t-2 border-foreground/20">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold">
                    {row.label[language]}
                  </th>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                    {formatRupees(row.a, language)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                    {formatRupees(row.b, language)}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatDelta(row.delta, language)}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

function Side({
  tables,
  scenario,
  heading,
  onChange,
  onPick,
  daNote,
}: {
  tables: PayTables
  scenario: PayScenario
  heading: string
  onChange: (patch: Partial<PayScenario>) => void
  onPick: (jobId: string | null) => void
  daNote?: string
}) {
  const { t, language } = useT()
  const cells = levelFor(tables.matrix, scenario.level)?.cells.length ?? 1

  return (
    <SectionCard className="space-y-4 p-5">
      <h2 className="text-base font-semibold">{heading}</h2>
      <JobPicker
        tables={tables}
        selectedId={scenario.jobId}
        onSelect={(option) => onPick(option.job.id)}
        onClear={() => onPick(null)}
      />
      <SelectField
        label={t('pay.inputs.level')}
        value={scenario.level}
        options={LEVEL_IDS(tables.matrix).map((id) => {
          const entry = levelFor(tables.matrix, id)
          return {
            value: id,
            label: entry?.gradePay
              ? t('pay.inputs.levelWithGradePay', { level: id, gradePay: entry.gradePay })
              : t('pay.inputs.levelNoGradePay', { level: id, band: entry?.payBand.name ?? '' }),
          }
        })}
        onChange={(value) => onChange({ level: value, cellIndex: 0, basic: null })}
      />
      <Stepper
        label={t('pay.inputs.cell')}
        value={scenario.cellIndex}
        max={cells - 1}
        onChange={(value) => onChange({ cellIndex: value, basic: null })}
        display={t('pay.inputs.cellDisplay', {
          cell: scenario.cellIndex + 1,
          of: cells,
          basic: formatRupees(cellPay(tables.matrix, scenario.level, scenario.cellIndex) ?? 0, language),
        })}
        decreaseLabel={t('pay.inputs.cellDown')}
        increaseLabel={t('pay.inputs.cellUp')}
      />
      <CityPicker
        tables={tables}
        selectedId={scenario.cityId}
        onSelect={(city) => onChange({ cityId: city.id })}
        onClear={() => onChange({ cityId: null })}
      />
      {daNote ? <p className="text-xs text-muted-foreground">{daNote}</p> : null}
    </SectionCard>
  )
}
