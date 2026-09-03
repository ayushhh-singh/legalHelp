import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'

import { Badge, SectionCard, SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'
import type { QuickRefRecord } from '@/schemas/library'

/**
 * "All time limits in the RTI Act", as a table an officer can sort.
 *
 * IT IS AN INDEX, AND SAYS SO. Every row links to the unit it came from and
 * quotes the words it was read out of, because a number lifted out of its
 * provision is exactly the kind of fact somebody acts on and gets wrong. A row
 * the extraction was less sure of — a period with no deadline lead-in, a figure
 * written in words — carries a Verify badge rather than being hidden, which is
 * the same treatment `verify: true` gets everywhere else in this app.
 *
 * The three kinds are separate tables because their sort keys are not
 * comparable: days, rupees and a name. One table with a mixed column would sort
 * "thirty days" against "Rs. 25 lakh".
 */

type Kind = 'time' | 'money' | 'authority'
type Column = 'unit' | 'value'

const KINDS: readonly Kind[] = ['time', 'money', 'authority']

/** Unit numbers sort as numbers where they are numbers — "11" after "9". */
const unitKey = (row: QuickRefRecord): number | string => {
  const numeric = Number.parseFloat(row.unitNumber.replace(/^\D+/, ''))
  return Number.isFinite(numeric) ? numeric : row.unitNumber
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  // Never `localeCompare`: ICU collation is a property of the runtime, and this
  // project's own rule (src/lib/srs/types.ts#compareStrings) is that a
  // comparison must not depend on which one you are on.
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

interface QuickRefTablesProps {
  workId: string
  rows: readonly QuickRefRecord[]
  counts: { time: number; money: number; authority: number }
  /** True when the rows were read here, from the reader's own document. */
  extractedHere: boolean
  className?: string
}

export function QuickRefTables({ workId, rows, counts, extractedHere, className }: QuickRefTablesProps) {
  const { t } = useT()
  const [kind, setKind] = useState<Kind>('time')
  const [column, setColumn] = useState<Column>('unit')
  const [ascending, setAscending] = useState(true)

  const shown = useMemo(() => {
    const filtered = rows.filter((row) => row.kind === kind)
    const sorted = [...filtered].sort((a, b) =>
      column === 'unit' ? compare(unitKey(a), unitKey(b)) : compare(a.sortKey, b.sortKey),
    )
    return ascending ? sorted : sorted.reverse()
  }, [rows, kind, column, ascending])

  const header = (which: Column, label: string) => (
    <th
      scope="col"
      aria-sort={column === which ? (ascending ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2 text-left text-xs font-semibold"
    >
      <button
        type="button"
        onClick={() => {
          if (column === which) setAscending((value) => !value)
          else {
            setColumn(which)
            setAscending(true)
          }
        }}
        aria-label={t('library.quickref.sortBy', { column: label })}
        className="inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
        {column === which ? (
          ascending ? (
            <ArrowUp aria-hidden="true" className="h-3 w-3" />
          ) : (
            <ArrowDown aria-hidden="true" className="h-3 w-3" />
          )
        ) : null}
      </button>
    </th>
  )

  return (
    <section aria-labelledby="library-quickref-heading" className={cn('flex flex-col gap-3', className)}>
      <div>
        <h2 id="library-quickref-heading" className="text-lg font-semibold">
          {t('library.quickref.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('library.quickref.subtitle')}</p>
      </div>

      <p className="text-xs text-muted-foreground">{t('library.quickref.autoExtracted')}</p>
      {extractedHere ? (
        <p className="text-xs text-muted-foreground">{t('library.terms.autoExtracted')}</p>
      ) : null}

      <div
        role="group"
        aria-label={t('library.quickref.title')}
        className="flex rounded-md border border-input p-0.5"
      >
        {KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            className={cn(
              'min-h-9 flex-1 rounded-sm px-3 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              kind === option
                ? 'bg-action font-semibold text-action-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {t(`library.quickref.${option}`)} ({counts[option]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('library.quickref.none')}</p>
      ) : (
        <SectionCard>
          {/* Wide content scrolls inside its own container; the page body never
              scrolls sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">
                {t(`library.quickref.${kind}`)} — {t('library.quickref.rowsCount', { count: shown.length })}
              </caption>
              <thead>
                <tr className="border-b border-border">
                  {header('unit', t('library.quickref.colUnit'))}
                  {header('value', t('library.quickref.colValue'))}
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold">
                    {t('library.quickref.colQuote')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr
                    key={`${row.unitId}-${row.kind}-${index}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 align-top">
                      <Link
                        to={toUnitHref(workId, row.unitId)}
                        className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                      >
                        <SectionNumber className="text-xs">{row.unitNumber}</SectionNumber>
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-medium tabular-nums">{row.value}</span>
                      {row.verify ? (
                        <span className="ml-2 inline-block align-middle">
                          <Badge tone="warning">{t('common.verifyWithDdo')}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">{row.quote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </section>
  )
}
