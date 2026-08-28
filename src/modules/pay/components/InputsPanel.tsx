import { ChipGroup, NumberField, SelectField, Stepper, ToggleRow } from './Fields'
import { CityPicker, JobPicker } from './Pickers'

import { SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { formatRupees } from '@/lib/pay/format'
import type { PayScenario } from '@/lib/pay/scenario'
import {
  cellPay,
  latestNotifiedDa,
  levelFor,
  LEVEL_IDS,
  projectedDa,
  type Group,
  type PayTables,
  type PensionScheme,
} from '@/lib/pay/tables'

/**
 * Everything the reader chooses, in the order a pay slip is built up.
 *
 * The post comes first because picking one fills in five of the fields below
 * it. Every one of those stays editable afterwards: `data/pay/jobs.json` is
 * almost entirely unconfirmed (ADR-016), so a picked post is a starting point
 * for a form the officer then checks, never an authority — and a field the app
 * had filled in and locked would be exactly the wrong way round.
 */

interface InputsPanelProps {
  tables: PayTables
  scenario: PayScenario
  onChange: (patch: Partial<PayScenario>) => void
  onPickJob: (jobId: string | null) => void
}

export function InputsPanel({ tables, scenario, onChange, onPickJob }: InputsPanelProps) {
  const { t, language } = useT()

  const level = levelFor(tables.matrix, scenario.level)
  const cells = level?.cells.length ?? 1
  const basic = scenario.basic ?? cellPay(tables.matrix, scenario.level, scenario.cellIndex) ?? 0

  const notified = latestNotifiedDa(tables.da)
  const projected = projectedDa(tables.da)

  const daOptions = [
    ...tables.da.rates
      .filter((rate) => rate.status === 'notified' && !rate.supersededBy)
      .slice(-4)
      .reverse()
      .map((rate) => ({
        value: `${rate.rate}`,
        label: t('pay.inputs.daNotified', { rate: rate.rate, from: rate.effectiveFrom }),
      })),
    // The projection is offered and LABELLED as one. `data/pay/da-history.json`
    // marks it `status: projected` with a range of 62 to 64 and no order behind
    // it; showing it unlabelled beside four notified rates would be the single
    // most misleading thing this form could do.
    ...(projected
      ? [
          {
            value: `p:${projected.rate}`,
            label: t('pay.inputs.daProjected', {
              rate: projected.rate,
              from: projected.effectiveFrom,
              low: projected.range?.low ?? projected.rate,
              high: projected.range?.high ?? projected.rate,
            }),
          },
        ]
      : []),
  ]

  const daValue = scenario.daProjected ? `p:${scenario.daRate}` : `${scenario.daRate}`
  const daHasOption = daOptions.some((option) => option.value === daValue)

  return (
    <div className="space-y-4">
      <SectionCard className="space-y-4 p-5">
        <JobPicker
          tables={tables}
          selectedId={scenario.jobId}
          onSelect={(option) => onPickJob(option.job.id)}
          onClear={() => onPickJob(null)}
        />
        {scenario.jobId ? <p className="text-xs text-muted-foreground">{t('pay.inputs.jobFilled')}</p> : null}
      </SectionCard>

      <SectionCard className="space-y-4 p-5">
        <h2 className="text-base font-semibold">{t('pay.inputs.payTitle')}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
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
            hint={t('pay.inputs.cellHint')}
          />
        </div>

        <NumberField
          label={t('pay.inputs.basicOverride')}
          hint={t('pay.inputs.basicOverrideHint')}
          value={scenario.basic ?? basic}
          min={0}
          step={100}
          prefix="₹"
          onChange={(value) => onChange({ basic: value > 0 ? value : null })}
        />

        <CityPicker
          tables={tables}
          selectedId={scenario.cityId}
          onSelect={(city) => onChange({ cityId: city.id })}
          onClear={() => onChange({ cityId: null })}
        />

        <SelectField
          label={t('pay.inputs.daRate')}
          hint={
            scenario.daProjected
              ? t('pay.inputs.daProjectedHint')
              : t('pay.inputs.daNotifiedHint', { rate: notified?.rate ?? 0 })
          }
          value={daHasOption ? daValue : `${scenario.daRate}`}
          options={
            daHasOption
              ? daOptions
              : [{ value: `${scenario.daRate}`, label: `${scenario.daRate}%` }, ...daOptions]
          }
          onChange={(value) => {
            const isProjected = value.startsWith('p:')
            onChange({
              daRate: Number(isProjected ? value.slice(2) : value),
              daProjected: isProjected,
            })
          }}
        />

        <ToggleRow
          label={t('pay.inputs.quarters')}
          hint={t('pay.inputs.quartersHint')}
          checked={scenario.quarters}
          onChange={(value) => onChange({ quarters: value })}
        />
      </SectionCard>

      <SectionCard className="space-y-4 p-5">
        <h2 className="text-base font-semibold">{t('pay.inputs.deductionsTitle')}</h2>

        <ChipGroup<PensionScheme>
          label={t('pay.inputs.pension')}
          value={scenario.pensionScheme}
          options={[
            { value: 'nps', label: t('pay.inputs.nps') },
            { value: 'ups', label: t('pay.inputs.ups') },
            { value: 'gpf', label: t('pay.inputs.gpf') },
          ]}
          onChange={(value) => onChange({ pensionScheme: value })}
        />
        {scenario.pensionScheme === 'gpf' ? (
          <NumberField
            label={t('pay.inputs.gpfRate')}
            hint={t('pay.inputs.gpfRateHint')}
            value={scenario.gpfRate}
            min={6}
            max={100}
            suffix="%"
            onChange={(value) => onChange({ gpfRate: value })}
          />
        ) : null}

        <ChipGroup<Group>
          label={t('pay.inputs.group')}
          value={scenario.group}
          options={[
            { value: 'A', label: t('pay.inputs.groupA') },
            { value: 'B', label: t('pay.inputs.groupB') },
            { value: 'C', label: t('pay.inputs.groupC') },
          ]}
          onChange={(value) => onChange({ group: value })}
        />

        <ChipGroup<'auto' | 'old' | 'new'>
          label={t('pay.inputs.regime')}
          value={scenario.regime}
          options={[
            { value: 'auto', label: t('pay.inputs.regimeAuto') },
            { value: 'new', label: t('pay.tax.newRegime') },
            { value: 'old', label: t('pay.tax.oldRegime') },
          ]}
          onChange={(value) => onChange({ regime: value })}
        />

        <NumberField
          label={t('pay.inputs.otherDeductions')}
          hint={t('pay.inputs.otherDeductionsHint')}
          value={scenario.otherDeductions}
          prefix="₹"
          step={100}
          onChange={(value) => onChange({ otherDeductions: value })}
        />
      </SectionCard>

      <SectionCard className="space-y-3 p-5">
        <h2 className="text-base font-semibold">{t('pay.inputs.circumstancesTitle')}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('pay.inputs.children')}
            hint={t('pay.inputs.childrenHint')}
            value={scenario.children}
            max={10}
            onChange={(value) => onChange({ children: value })}
          />
          <NumberField
            label={t('pay.inputs.hostellers')}
            hint={t('pay.inputs.hostellersHint')}
            value={scenario.hostellers}
            max={10}
            onChange={(value) => onChange({ hostellers: value })}
          />
        </div>

        <ToggleRow
          label={t('pay.inputs.npa')}
          hint={t('pay.inputs.npaHint')}
          checked={scenario.npa}
          onChange={(value) => onChange({ npa: value })}
        />
        <ToggleRow
          label={t('pay.inputs.runningStaff')}
          hint={t('pay.inputs.runningStaffHint')}
          checked={scenario.runningStaff}
          onChange={(value) => onChange({ runningStaff: value })}
        />
      </SectionCard>

      <SectionCard className="p-5">
        <details>
          <summary className="cursor-pointer text-base font-semibold">
            {t('pay.inputs.oldRegimeTitle')}
          </summary>
          <p className="mt-1 text-sm text-muted-foreground">{t('pay.inputs.oldRegimeIntro')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('pay.inputs.rent')}
              hint={t('pay.inputs.rentHint')}
              value={scenario.oldRegime.rentPaidMonthly ?? 0}
              prefix="₹"
              step={500}
              onChange={(value) => onChange({ oldRegime: { ...scenario.oldRegime, rentPaidMonthly: value } })}
            />
            <NumberField
              label={t('pay.inputs.section80c')}
              hint={t('pay.inputs.section80cHint')}
              value={scenario.oldRegime.section80c ?? 0}
              prefix="₹"
              step={1000}
              onChange={(value) => onChange({ oldRegime: { ...scenario.oldRegime, section80c: value } })}
            />
            <NumberField
              label={t('pay.inputs.section80ccd1b')}
              value={scenario.oldRegime.section80ccd1b ?? 0}
              prefix="₹"
              step={1000}
              onChange={(value) => onChange({ oldRegime: { ...scenario.oldRegime, section80ccd1b: value } })}
            />
            <NumberField
              label={t('pay.inputs.section80d')}
              value={scenario.oldRegime.section80d ?? 0}
              prefix="₹"
              step={1000}
              onChange={(value) => onChange({ oldRegime: { ...scenario.oldRegime, section80d: value } })}
            />
            <NumberField
              label={t('pay.inputs.homeLoanInterest')}
              value={scenario.oldRegime.homeLoanInterest ?? 0}
              prefix="₹"
              step={1000}
              onChange={(value) =>
                onChange({ oldRegime: { ...scenario.oldRegime, homeLoanInterest: value } })
              }
              className="sm:col-span-2"
            />
          </div>
        </details>
      </SectionCard>
    </div>
  )
}
