import { Info } from 'lucide-react'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { PayLine } from '@/lib/pay/engine'
import type { Bilingual } from '@/lib/pay/tables'
import { cn } from '@/lib/utils'

/**
 * The "why is this figure what it is" disclosure on every derived line.
 *
 * A `<details>`, not a floating popover. Three reasons, and the first is the
 * one that decided it: it PRINTS. The brief asks for an A4 print of the pay
 * slip, and a popover anchored to a button is empty on paper. It also needs no
 * focus trap, no outside-click handler and no positioning library, and a screen
 * reader announces it as expandable without a line of ARIA.
 *
 * What it shows is not prose about the allowance. It is the formula the engine
 * used, the values that went into it, the conditions the order attaches, and
 * the order itself — the four things an officer would need to check the figure
 * against the file.
 */
export function InfoPopover({
  line,
  formulaLabel,
  className,
}: {
  line: PayLine
  formulaLabel: string
  className?: string
}) {
  const { t, language } = useT()
  const entries = Object.entries(line.inputs)

  return (
    <details className={cn('group', className)} data-print-open>
      <summary
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        aria-label={t('pay.line.explain', { line: line.label[language] })}
      >
        <Info aria-hidden="true" className="h-4 w-4" />
      </summary>

      <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted p-3 text-xs">
        <div>
          <p className="font-semibold text-foreground">{formulaLabel}</p>
          <p className="mt-1 font-mono text-[11px] break-words text-muted-foreground">{line.formula}</p>
        </div>

        {entries.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="font-medium tabular-nums">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {line.conditions.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {line.conditions.map((condition: Bilingual, index) => (
              <li key={index}>{condition[language]}</li>
            ))}
          </ul>
        ) : null}

        {line.note ? <p className="text-muted-foreground">{line.note[language]}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {line.source ? <SourceChip name={line.source.name} url={line.source.url} /> : null}
          {line.source?.reference ? (
            <span className="text-muted-foreground">{line.source.reference}</span>
          ) : null}
          {line.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
        </div>
      </div>
    </details>
  )
}
