import { Check, Printer, Share2 } from 'lucide-react'
import { useState } from 'react'

import { InfoPopover } from './InfoPopover'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { Badge, SectionCard, SectionNumber } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import type { PayLine, PayResult } from '@/lib/pay/engine'
import { formatRupees } from '@/lib/pay/format'
import type { PayScenario } from '@/lib/pay/scenario'
import { jobFor, type PayTables } from '@/lib/pay/tables'
import { cn } from '@/lib/utils'

/**
 * The pay slip.
 *
 * Two decisions here are worth stating, because both departed from the brief
 * after measurement rather than by preference:
 *
 * **The numerals are Inter with `tabular-nums`, not IBM Plex Mono.** The design
 * system already settled the numeral question — scoreboard figures are Inter
 * 800 with tabular numerals, and `tests/e2e/typography.spec.ts` reads back the
 * fonts Chromium actually used. Adding a fourth self-hosted family for a column
 * of rupees would put ~25 KB of woff2 into every offline install to buy an
 * alignment that Inter's tabular figures already give. See ADR-018.
 *
 * **Every line label carries both languages.** A government pay slip does, and
 * the reader's language decides which is the larger of the two rather than
 * which one exists. The e2e language switch still passes — the Hindi label
 * becomes the primary — and an officer showing the slip to a colleague in the
 * other language does not have to toggle anything.
 */

interface PayslipProps {
  result: PayResult
  scenario: PayScenario
  tables: PayTables
  onShare: () => void
  shareMessage: string
}

/** The order the lines appear in on a Central Government pay slip. */
const EARNINGS_ORDER = [
  'basic',
  'non-practising-allowance',
  'running-allowance-railways',
  'dearness-allowance',
  'house-rent-allowance',
  'transport-allowance',
  'da-on-ta',
]

const DEDUCTIONS_ORDER = ['pension', 'cghs', 'cgegis', 'tax']

export function Payslip({ result, scenario, tables, onShare, shareMessage }: PayslipProps) {
  const { t, language } = useT()
  const job = jobFor(tables.jobs, scenario.jobId)
  const [printing, setPrinting] = useState(false)

  const byId = new Map(result.lines.map((line) => [line.id, line]))
  const earnings = [
    ...EARNINGS_ORDER.map((id) => byId.get(id)).filter((line): line is PayLine => Boolean(line)),
    ...result.lines.filter(
      (line) =>
        line.kind === 'allowance' &&
        !EARNINGS_ORDER.includes(line.id) &&
        !line.unpriced &&
        !line.needsChoice &&
        line.amount > 0,
    ),
  ]
  const deductions = DEDUCTIONS_ORDER.map((id) => byId.get(id)).filter((line): line is PayLine =>
    Boolean(line),
  )

  const print = () => {
    setPrinting(true)
    // The A4 rules in index.css are what shape the printed page; this only
    // marks the card as the print root so the chrome around it drops out.
    window.print()
    setPrinting(false)
  }

  return (
    <SectionCard active className="p-5 sm:p-6" data-print-root>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{job ? job.title[language] : t('pay.slip.customPost')}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <SectionNumber>
              {t('pay.slip.levelCell', { level: result.level, cell: result.cellIndex + 1 })}
            </SectionNumber>
            {result.gradePay ? <span>{t('pay.slip.gradePay', { gradePay: result.gradePay })}</span> : null}
            <span>{t('pay.slip.cityClass', { class: result.cityClass })}</span>
            <span>{t('pay.slip.daRate', { rate: result.daRate })}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          <Button type="button" variant="outline" size="sm" onClick={onShare}>
            {shareMessage ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
            {t('pay.slip.share')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={print} disabled={printing}>
            <Printer aria-hidden="true" />
            {t('pay.slip.print')}
          </Button>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {shareMessage}
      </p>

      {scenario.daProjected ? (
        <p className="mt-4 rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground">
          {t('pay.slip.projectedDa')}
        </p>
      ) : null}

      {result.verify ? (
        <p className="mt-4 rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground">
          {t('pay.slip.verifyBanner')}
        </p>
      ) : null}

      {result.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          {result.warnings.map((warning, index) => (
            <li key={index}>· {warning[language]}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <LineTable
          caption={t('pay.slip.earnings')}
          lines={earnings}
          total={result.gross}
          totalLabel={t('pay.slip.gross')}
          language={language}
        />
        <LineTable
          caption={t('pay.slip.deductions')}
          lines={deductions}
          total={result.deductions.total}
          totalLabel={t('pay.slip.totalDeductions')}
          language={language}
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-muted p-4">
        <p className="text-xs font-medium text-muted-foreground">{t('pay.slip.net')}</p>
        <p className="font-display mt-1 text-3xl sm:text-4xl">{formatRupees(result.netMonthly, language)}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('pay.slip.annualCtc')}</dt>
            <dd className="font-semibold tabular-nums">{formatRupees(result.annualCtc, language)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('pay.slip.employerPension')}</dt>
            <dd className="font-semibold tabular-nums">{formatRupees(result.employerPension, language)}</dd>
          </div>
        </dl>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={result.regime === result.taxComputation.recommended ? 'success' : 'warning'}>
            {t(result.regime === 'new' ? 'pay.tax.newRegime' : 'pay.tax.oldRegime')}
          </Badge>
          <span className="text-muted-foreground">
            {t('pay.slip.taxComparison', {
              old: formatRupees(result.taxComputation.old.total, language),
              new: formatRupees(result.taxComputation.new.total, language),
              saving: formatRupees(result.taxComputation.saving, language),
            })}
          </span>
        </p>
      </div>

      <Disclaimer className="mt-5" />
      <DataVersion dataset="pay-matrix" className="mt-3" />
    </SectionCard>
  )
}

function LineTable({
  caption,
  lines,
  total,
  totalLabel,
  language,
}: {
  caption: string
  lines: PayLine[]
  total: number
  totalLabel: string
  language: Language
}) {
  const { t } = useT()
  const other: Language = language === 'en' ? 'hi' : 'en'

  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {caption}
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{t('pay.slip.lineHeader')}</th>
          <th scope="col">{t('pay.slip.amountHeader')}</th>
          <th scope="col">{t('pay.slip.explainHeader')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-b border-border last:border-0">
            <th scope="row" className="py-2 pr-3 text-left font-normal">
              <span className="block">{line.label[language]}</span>
              <span className="block text-xs text-muted-foreground">{line.label[other]}</span>
            </th>
            <td className="py-2 text-right font-medium whitespace-nowrap tabular-nums">
              {formatRupees(line.amount, language)}
            </td>
            <td className="w-9 py-1 pl-1 align-middle" data-print-hide>
              <InfoPopover line={line} formulaLabel={t('pay.line.formula')} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={cn('border-t-2 border-foreground/20')}>
          <th scope="row" className="py-2 pr-3 text-left font-semibold">
            {totalLabel}
          </th>
          <td className="py-2 text-right font-semibold whitespace-nowrap tabular-nums">
            {formatRupees(total, language)}
          </td>
          <td data-print-hide />
        </tr>
      </tfoot>
    </table>
  )
}
