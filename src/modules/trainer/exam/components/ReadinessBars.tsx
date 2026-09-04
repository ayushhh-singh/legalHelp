import { Chip, ProgressBar, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { Readiness, UnitReadiness } from '@/lib/exam'

const pct = (value: number) => Math.round(value * 100)

/**
 * Per-unit readiness, grouped by paper.
 *
 * Three numbers per unit and not one, because they answer different questions:
 * `mastery` is about the reader, `coverage` is about the app, and the bar is
 * the product. A reader whose bar is short can see which half is short, which
 * is the difference between "study more" and "this app cannot help you here".
 *
 * A plain list, and NOT a `<dl>`. The first version was a definition list —
 * each row is a name and a value, which is what a `dl` is for — and axe failed
 * it `serious` on both `definition-list` and `dlitem`, because the `dt` and
 * `dd` sat inside a flex wrapper and so were grandchildren of the `dl` rather
 * than children. Flattening the markup to satisfy the rule would have meant
 * giving up the layout; the pairing buys nothing here that the bar's own
 * `aria-label` does not already say, so the `dl` went instead. Only a real
 * browser found this — `tests/e2e/exam.spec.ts` is where.
 */
export function ReadinessBars({
  readiness,
  papers,
}: {
  readiness: Readiness
  papers: { id: string; name: { en: string; hi: string }; marks: number }[]
}) {
  const { t, language } = useT()

  return (
    <div className="flex flex-col gap-4">
      {papers.map((paper) => {
        const units = readiness.units.filter((unit) => unit.paper.id === paper.id)
        if (units.length === 0) return null
        return (
          <SectionCard key={paper.id} className="p-4">
            <h3 className="text-sm font-semibold">
              {paper.name[language] || paper.name.en}
              <span className="ml-2 font-normal text-muted-foreground">
                {t('trainer.exam.readiness.marks', { marks: paper.marks })}
              </span>
            </h3>
            <ul className="mt-3 flex flex-col gap-4">
              {units.map((unit) => (
                <UnitRow key={unit.key} unit={unit} />
              ))}
            </ul>
          </SectionCard>
        )
      })}
    </div>
  )
}

function UnitRow({ unit }: { unit: UnitReadiness }) {
  const { t, language } = useT()
  const name = unit.unit.name[language] || unit.unit.name.en

  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{name}</span>
        <span className="font-display text-sm text-muted-foreground tabular-nums">
          {t('trainer.exam.readiness.marks', { marks: unit.marks })}
        </span>
      </div>
      <div className="mt-1.5">
        <ProgressBar
          value={pct(unit.ready)}
          label={t('trainer.exam.readiness.unitBar', { name, percent: pct(unit.ready) })}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {unit.external ? (
          <Chip tone="marigold">{t('trainer.exam.externalLabel')}</Chip>
        ) : (
          <>
            <span className="font-display tabular-nums">{pct(unit.ready)}%</span>
            <span>
              {t('trainer.exam.readiness.mastery')} {pct(unit.mastery)}%
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t('trainer.exam.readiness.coverage')} {pct(unit.coverage)}%
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {unit.servedCards === 0
                ? t('trainer.exam.readiness.noCards')
                : t('trainer.exam.readiness.cards', {
                    served: unit.servedCards,
                    unseen: unit.unseenCards,
                  })}
            </span>
          </>
        )}
      </div>
    </li>
  )
}
