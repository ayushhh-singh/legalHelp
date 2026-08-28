import { InfoPopover } from './InfoPopover'
import { ToggleRow } from './Fields'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { PayResult } from '@/lib/pay/engine'
import { formatRupees } from '@/lib/pay/format'
import type { PayScenario } from '@/lib/pay/scenario'
import { allowanceFor, jobFor, type PayTables } from '@/lib/pay/tables'

/**
 * The allowances a post carries, each with its amount, its conditions, its
 * source and — where it has one — the choice the reader still has to make.
 *
 * The three standing components of every pay slip (Dearness Allowance, House
 * Rent Allowance, Transport Allowance) are NOT here. They are on the inputs
 * panel, because they are not optional and their controls are the city and the
 * DA rate rather than a switch.
 *
 * Two states are drawn differently from an ordinary row, and both are honest
 * answers rather than errors:
 *
 *  - **`needsChoice`** — the order has several rates and which one applies
 *    turns on a fact this app cannot know (which cell of the Risk and Hardship
 *    Matrix a posting falls in, which uniform an officer wears). The row shows
 *    the choices and no figure until one is picked.
 *  - **`unpriced`** — there is no published figure the calculator can use, as
 *    with Ration Money, notified per day by the Ministry of Home Affairs. The
 *    row says so rather than showing ₹0, which would read as "nil".
 */

const STANDING = new Set(['dearness-allowance', 'house-rent-allowance', 'transport-allowance'])

export function AllowanceList({
  tables,
  scenario,
  result,
  onToggle,
  onRate,
}: {
  tables: PayTables
  scenario: PayScenario
  result: PayResult
  onToggle: (id: string, enabled: boolean) => void
  onRate: (id: string, rateKey: string) => void
}) {
  const { t, language } = useT()

  const job = jobFor(tables.jobs, scenario.jobId)
  /**
   * A picked post lists what that post carries, in the dataset's own order. A
   * custom scenario lists every current allowance — there is no post to narrow
   * it, and hiding two-thirds of them behind a search would make the reader
   * guess what exists.
   */
  const ids = job
    ? job.allowances.map((entry) => entry.id)
    : tables.allowances.allowances
        .filter((allowance) => allowance.status === 'current')
        .map((allowance) => allowance.id)

  const rows = ids
    .filter((id) => !STANDING.has(id))
    .map((id) => {
      const allowance = allowanceFor(tables.allowances, id)
      if (!allowance) return null
      const choice = scenario.allowances.find((entry) => entry.id === id)
      const line = result.lines.find((entry) => entry.id === id)
      const jobNote = job?.allowances.find((entry) => entry.id === id)?.note ?? null
      return { allowance, enabled: choice?.enabled ?? false, rateKey: choice?.rateKey, line, jobNote }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  return (
    <SectionCard className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{t('pay.allowances.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('pay.allowances.count', { count: rows.length })}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('pay.allowances.intro')}</p>

      <ul className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.allowance.id} className="py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <ToggleRow
                  label={row.allowance.name[language]}
                  hint={row.allowance.appliesTo[language]}
                  checked={row.enabled}
                  onChange={(next) => onToggle(row.allowance.id, next)}
                />

                {row.enabled ? (
                  <div className="mt-2 space-y-2">
                    {row.line?.needsChoice ? (
                      <RateChoice
                        id={row.allowance.id}
                        choices={row.line.choices ?? []}
                        value={row.rateKey ?? ''}
                        onChange={(key) => onRate(row.allowance.id, key)}
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {row.line?.unpriced ? (
                        <Badge tone="neutral">{t('pay.allowances.unpriced')}</Badge>
                      ) : row.line?.needsChoice ? (
                        <Badge tone="warning">{t('pay.allowances.chooseRate')}</Badge>
                      ) : (
                        <span className="font-semibold tabular-nums">
                          {formatRupees(row.line?.amount ?? 0, language)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {t('pay.perMonth')}
                          </span>
                        </span>
                      )}
                      <SourceChip name={row.allowance.source.name} url={row.allowance.source.url} />
                      {row.allowance.verify ? (
                        <Badge tone="warning">{t('common.verifyWithDdo')}</Badge>
                      ) : null}
                      {row.allowance.taxable ? null : (
                        <Badge tone="success">
                          {t('pay.allowances.exempt', { section: row.allowance.taxSection ?? '10(14)' })}
                        </Badge>
                      )}
                    </div>

                    {row.jobNote ? (
                      <p className="text-xs text-muted-foreground">{row.jobNote[language]}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {row.line ? <InfoPopover line={row.line} formulaLabel={t('pay.line.formula')} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function RateChoice({
  id,
  choices,
  value,
  onChange,
}: {
  id: string
  choices: ReadonlyArray<{ key: string; when: { en: string; hi: string } }>
  value: string
  onChange: (key: string) => void
}) {
  const { t, language } = useT()
  const selectId = `${id}-rate`

  return (
    <div>
      <label className="mb-1 block text-xs font-medium" htmlFor={selectId}>
        {t('pay.allowances.whichRate')}
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <option value="">{t('pay.allowances.chooseRate')}</option>
        {choices.map((choice) => (
          <option key={choice.key} value={choice.key}>
            {choice.when[language]}
          </option>
        ))}
      </select>
    </div>
  )
}
