import { NumberField, ToggleRow } from './Fields'
import { CityPicker } from './Pickers'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge, SectionCard, StatCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import {
  BENEFITS_ARE_INDICATIVE,
  computePrivate,
  governmentBenefits,
  type PrivateInput,
} from '@/lib/pay/compare'
import { computePay } from '@/lib/pay/engine'
import { formatDelta, formatRupees } from '@/lib/pay/format'
import { toPayInput, type PayScenario } from '@/lib/pay/scenario'
import type { PayTables } from '@/lib/pay/tables'

/**
 * A private package against a government pay slip.
 *
 * It states no opinion, and the shape of the panel is what enforces that. The
 * numbers are cash on both sides; the benefits the government side carries are
 * listed with their sources and are NEVER added into a total, because the worth
 * of a lifetime health scheme to a particular officer is not a figure this app
 * has. Every assumption behind the private figure is an editable field with its
 * default written next to it, and the assumptions are printed under the answer
 * rather than hidden behind a disclosure.
 */

export function PrivatePanel({
  tables,
  scenario,
  input,
  onChange,
}: {
  tables: PayTables
  scenario: PayScenario
  input: PrivateInput
  onChange: (patch: Partial<PrivateInput>) => void
}) {
  const { t, language } = useT()
  const govt = computePay(toPayInput(scenario), tables)
  const private_ = computePrivate(input, tables)
  const benefits = governmentBenefits(govt, tables)

  return (
    <div className="space-y-4">
      <SectionCard className="space-y-4 p-5">
        <h2 className="text-base font-semibold">{t('pay.private.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('pay.private.intro')}</p>

        <NumberField
          label={t('pay.private.ctc')}
          hint={t('pay.private.ctcHint')}
          value={input.annualCtc}
          prefix="₹"
          step={50_000}
          onChange={(value) => onChange({ annualCtc: value })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('pay.private.basicShare')}
            hint={t('pay.private.basicShareHint')}
            value={input.basicShare}
            min={1}
            max={100}
            suffix="%"
            onChange={(value) => onChange({ basicShare: value })}
          />
          <NumberField
            label={t('pay.private.hraShare')}
            hint={t('pay.private.hraShareHint')}
            value={input.hraShare}
            max={100}
            suffix="%"
            onChange={(value) => onChange({ hraShare: value })}
          />
        </div>

        <ToggleRow
          label={t('pay.private.includesEmployer')}
          hint={t('pay.private.includesEmployerHint')}
          checked={input.ctcIncludesEmployerContributions}
          onChange={(value) => onChange({ ctcIncludesEmployerContributions: value })}
        />

        <CityPicker
          tables={tables}
          selectedId={input.cityId}
          onSelect={(city) => onChange({ cityId: city.id })}
          onClear={() => onChange({ cityId: null })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('pay.inputs.rent')}
            value={input.rentPaidMonthly}
            prefix="₹"
            step={500}
            onChange={(value) => onChange({ rentPaidMonthly: value })}
          />
          <NumberField
            label={t('pay.private.professionalTax')}
            hint={t('pay.private.professionalTaxHint')}
            value={input.professionalTaxMonthly}
            prefix="₹"
            step={50}
            onChange={(value) => onChange({ professionalTaxMonthly: value })}
          />
        </div>
      </SectionCard>

      <SectionCard className="space-y-4 p-5">
        <h2 className="text-base font-semibold">{t('pay.private.sideBySide')}</h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label={t('pay.private.govtNet')}
            value={formatRupees(govt.netMonthly, language)}
            hint={t('pay.perMonth')}
          />
          <StatCard
            label={t('pay.private.privateTakeHome')}
            value={formatRupees(private_.takeHome, language)}
            hint={t('pay.perMonth')}
          />
          <StatCard
            label={t('pay.private.difference')}
            value={formatDelta(private_.takeHome - govt.netMonthly, language)}
            hint={t('pay.private.differenceHint')}
          />
        </div>

        <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={t('pay.private.sideBySide')}>
          <table className="w-full min-w-[30rem] text-sm">
            <tbody>
              {/*
                The figures are POSITIVE. Every one of these rows whose label
                begins "Less …" used to carry a negative number as well, which
                reads as a double negative — "less the employer's Provident
                Fund, −₹7,200" — and put an ASCII hyphen in a column whose
                differences elsewhere use a real minus sign.
              */}
              {[
                { label: t('pay.private.monthlyCtc'), value: private_.monthlyCtc },
                { label: t('pay.private.employerPf'), value: private_.employerPf },
                { label: t('pay.private.gratuity'), value: private_.gratuityAccrual },
                { label: t('pay.private.cashGross'), value: private_.cashGross },
                { label: t('pay.private.employeePf'), value: private_.employeePf },
                { label: t('pay.private.incomeTax'), value: private_.tax },
              ].map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="py-2 text-right tabular-nums">{formatRupees(row.value, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="space-y-1 text-xs text-muted-foreground">
          {private_.assumptions.map((assumption, index) => (
            <li key={index}>· {assumption[language]}</li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard className="space-y-4 p-5">
        <h2 className="text-base font-semibold">{t('pay.private.benefitsTitle')}</h2>
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          {BENEFITS_ARE_INDICATIVE[language]}
        </p>
        <ul className="divide-y divide-border">
          {benefits.map((benefit) => (
            <li key={benefit.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{benefit.label[language]}</h3>
                {benefit.monthly === null ? (
                  <Badge tone="neutral">{t('pay.private.noFigure')}</Badge>
                ) : (
                  <span className="text-sm font-semibold tabular-nums">
                    {formatRupees(benefit.monthly, language)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {t('pay.perMonth')}
                    </span>
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{benefit.body[language]}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {benefit.source ? <SourceChip name={benefit.source.name} url={benefit.source.url} /> : null}
                {benefit.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}
