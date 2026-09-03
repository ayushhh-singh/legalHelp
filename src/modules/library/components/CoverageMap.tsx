import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { db } from '@/db'
import { allHighlights, allNotes } from '@/lib/library'
import { coverageOf, summariseCoverage } from '@/lib/study'
import type { TocNode } from '@/schemas/library'
import type { Card } from '@/modules/trainer/schema'
import { cn } from '@/lib/utils'

export interface CoverageMapProps {
  workId: string
  unitIds: readonly string[]
  /**
   * The work's table of contents — the source of each square's accessible
   * name. Deliberately NOT the corpus: that is 8 KB-1.9 MB and is loaded only
   * once a search worth running has been typed (ADR-038 §2), and a coverage
   * grid is not a reason to download a statute.
   */
  toc: readonly TocNode[]
  cards: readonly Card[] | null
  className?: string
}

/**
 * The coverage heat-map: one square per unit, painted by DEPTH.
 *
 * Read / annotated / quizzed are three independent facts, kept independent —
 * `readNotQuizzed` is the figure an officer preparing for a departmental
 * examination actually wants, and a single "progress" score would hide it.
 *
 * The colour is never the only signal: each square carries a title and an
 * `aria-label` naming the unit and what is true of it, because "darker means
 * more" is not something a screen reader can convey and not something a reader
 * with low vision can rely on.
 */
export function CoverageMap({ workId, unitIds, toc, cards, className }: CoverageMapProps) {
  const { t, language } = useT()

  const unitLabels = useMemo(() => {
    const labels = new Map<string, string>()
    const walk = (nodes: readonly TocNode[]) => {
      for (const node of nodes) {
        const heading = node.heading[language] || node.heading.en
        for (const unitId of node.unitIds) {
          labels.set(unitId, heading ? `${node.number} ${heading}` : node.number)
        }
        if (node.children) walk(node.children)
      }
    }
    walk(toc)
    return labels
  }, [language, toc])

  const progress = useLiveQuery(() => db.libraryProgress.where('workId').equals(workId).toArray(), [workId])
  const highlights = useLiveQuery(() => allHighlights(), [])
  const notes = useLiveQuery(() => allNotes(), [])
  const reviewLog = useLiveQuery(() => db.reviewLog.toArray(), [])

  const cardUnits = useMemo(() => {
    const map = new Map<string, string>()
    for (const card of cards ?? []) map.set(card.id, card.ruleRef.textId)
    return map
  }, [cards])

  const units = useMemo(
    () =>
      coverageOf({
        unitIds,
        progress: progress ?? [],
        highlights: (highlights ?? []).filter((row) => row.workId === workId),
        notes: (notes ?? []).filter((row) => row.workId === workId),
        cardUnits,
        reviewLog: reviewLog ?? [],
      }),
    [cardUnits, highlights, notes, progress, reviewLog, unitIds, workId],
  )
  const summary = useMemo(() => summariseCoverage(units), [units])

  const TINT = ['bg-muted', 'bg-action/25', 'bg-action/55', 'bg-action/85'] as const

  return (
    <SectionCard className={className} aria-labelledby="coverage-heading">
      <div className="border-b border-border px-4 py-3">
        <h2 id="coverage-heading" className="text-sm font-semibold">
          {t('library.study.coverage.title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('library.study.coverage.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Badge tone="neutral">
              {t('library.study.coverage.read')}: {summary.read}/{summary.total}
            </Badge>
          </li>
          <li>
            <Badge tone="neutral">
              {t('library.study.coverage.annotated')}: {summary.annotated}
            </Badge>
          </li>
          <li>
            <Badge tone="neutral">
              {t('library.study.coverage.quizzed')}: {summary.quizzed}
            </Badge>
          </li>
          <li>
            <Badge tone="warning">
              {t('library.study.coverage.readNotQuizzed', { count: summary.readNotQuizzed })}
            </Badge>
          </li>
        </ul>

        {/*
            ONE image, not 358 links — and a `<div>`, not a `<ul>`.

            `role="img"` on a `<ul>` takes the list's semantics away and orphans
            every `<li>`, which axe reports as a serious `listitem` violation
            once per square. That is the same mistake `HolidaysPage`'s
            `ScrollStrip` records in CLAUDE.md, arriving in a new file: a
            heat-map is a picture, so it is built out of elements that were
            never claiming to be a list.

            The first version made every square a `<Link>` to its unit, and both
            costs were real: a reader tabbing past the grid on the BNSS would
            pass 531 focusable elements to reach the next control, and each
            square's accessible name repeated its table-of-contents entry two
            sections up the page — the same destination, announced twice, which
            is noise rather than navigation. (It also made
            `library.edge.test.tsx`'s "open the first branch" query ambiguous,
            which is how it was found.)

            So the grid is a single `role="img"` with a name that states the
            summary in words, and the squares inside it are decoration. Nothing
            is lost: the counts above are visible text, the units themselves are
            in the contents list, and `title` still names a square on hover.
            "Darker means more of the three" is a visual aid, and the figures it
            is an aid TO are on the page in text.
        */}
        <div
          role="img"
          aria-label={t('library.study.coverage.unitState', {
            unit: `${summary.total}`,
            states: [
              `${t('library.study.coverage.read')}: ${summary.read}`,
              `${t('library.study.coverage.annotated')}: ${summary.annotated}`,
              `${t('library.study.coverage.quizzed')}: ${summary.quizzed}`,
              `${t('library.study.coverage.untouched')}: ${summary.untouched}`,
            ].join(', '),
          })}
          className="flex flex-wrap gap-1"
        >
          {units.map((unit) => {
            const states = [
              unit.read ? t('library.study.coverage.read') : null,
              unit.annotated ? t('library.study.coverage.annotated') : null,
              unit.quizzed ? t('library.study.coverage.quizzed') : null,
            ].filter(Boolean)
            return (
              <span
                key={unit.unitId}
                title={t('library.study.coverage.unitState', {
                  unit: unitLabels.get(unit.unitId) ?? unit.unitId,
                  states: states.length > 0 ? states.join(', ') : t('library.study.coverage.untouched'),
                })}
                className={cn('block h-4 w-4 rounded-sm border border-border', TINT[Math.min(3, unit.depth)])}
              />
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground">{t('library.study.coverage.legend')}</p>
      </div>
    </SectionCard>
  )
}
