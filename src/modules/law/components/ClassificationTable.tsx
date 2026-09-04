import type { Classification } from '../types'

import { Badge } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * Cognizable · bailable · compoundable · triable by, from the BNSS First
 * Schedule and BNSS section 359.
 *
 * A real `<table>` with real headers, not a grid of divs. These four values are
 * the ones an officer reads across a row and down a column — BNS 318 has four
 * sub-sections that differ on every one of them — and a table is the only
 * structure a screen reader can navigate that way.
 *
 * Every value is `{ en, hi }` in the dataset and 201 of the BNS punishments
 * have no Hindi yet (`docs/DATA-GAPS.md` #16), so each cell falls back to
 * English rather than rendering blank. That is a visible gap, not a silent one:
 * the card's own "curated Hindi" notice says which parts are not statutory.
 */
export function ClassificationTable({ rows }: { rows: readonly Classification[] }) {
  const { t, language } = useT()
  const pick = (value: { en: string; hi: string } | undefined) => value?.[language] || value?.en || '—'

  return (
    /*
      A horizontally scrollable region has to be reachable by keyboard, or the
      only way to see the columns past the edge is a mouse (axe
      `scrollable-region-focusable`). It became scrollable when the card moved
      into a narrower pane beside the result list — the table is seven columns
      wide and does not fold.
    */
    <div
      tabIndex={0}
      role="region"
      aria-label={t('law.card.classification')}
      className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">{t('law.card.classification')}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.clause')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.offence')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.punishment')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.cognizable')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.bailable')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('law.card.compoundable')}
            </th>
            <th scope="col" className="py-2 font-semibold">
              {t('law.card.triableBy')}
            </th>
          </tr>
        </thead>
        <tbody>
          {/*
            Keyed on the clause AND the position, because a clause is not
            unique here. The BNSS First Schedule grades some offences by
            circumstance and puts each limb on its own row under one section
            number — BNS 77 and 78(2) each carry a "Second or subsequent
            conviction" row that is non-bailable where the first conviction is
            bailable. Two rows keyed `77` is a duplicate React key, which
            reconciles the wrong cells onto the wrong row.
          */}
          {rows.map((row, index) => (
            <tr key={`${row.clause}#${index}`} className="border-b border-border align-top last:border-0">
              <th scope="row" className="py-2 pr-3 font-semibold whitespace-nowrap tabular-nums">
                {row.clause}
              </th>
              <td className="py-2 pr-3">{pick(row.offence)}</td>
              <td className="py-2 pr-3">{pick(row.punishment)}</td>
              <td className="py-2 pr-3">
                <Badge tone={row.cognizable === 'cognizable' ? 'warning' : 'neutral'}>
                  {t(`law.value.${row.cognizable}`)}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                <Badge tone={row.bailable === 'non-bailable' ? 'danger' : 'neutral'}>
                  {t(`law.value.${row.bailable}`)}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                <span className="block">{t(`law.value.${row.compoundable}`)}</span>
                {row.compoundableBy && pick(row.compoundableBy) !== '—' ? (
                  <span className="block text-xs text-muted-foreground">
                    {t('law.card.compoundableBy')}: {pick(row.compoundableBy)}
                  </span>
                ) : null}
              </td>
              <td className="py-2">{pick(row.triableBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
