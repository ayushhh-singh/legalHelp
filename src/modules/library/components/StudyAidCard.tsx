import { Lightbulb } from 'lucide-react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'

import { Badge, SectionCard, SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { unitLabel, type LibraryCorpus } from '@/lib/library'
import type { StudyAid } from '@/schemas/library'

/**
 * The precomputed study aid — FIRST in the reader's rail, offline, no key, no
 * network, no consent.
 *
 * That position is the session brief's own ordering and it is the whole point
 * of `docs/AI.md` §13: the thing that costs nothing and works on every device
 * comes before the thing that costs money and works on some. A reader who never
 * turns AI on gets this, in full, forever.
 *
 * It carries a badge on every render. An aid is Sahayak's own writing —
 * reviewed against the provision's text, but published by no Ministry — and the
 * one place a reader could mistake it for the rule is right here, under the
 * rule. The same marigold treatment the Law Converter gives curated Hindi.
 */
interface StudyAidCardProps {
  aid: StudyAid
  corpus: LibraryCorpus | null
  workId: string
  className?: string
}

export function StudyAidCard({ aid, corpus, workId, className }: StudyAidCardProps) {
  const { t, language } = useT()

  const connected = (aid.connects ?? [])
    .map((unitId) => {
      const unit = corpus?.units.get(unitId)
      return unit ? { unitId, unit } : null
    })
    .filter((entry): entry is { unitId: string; unit: NonNullable<typeof entry>['unit'] } => entry !== null)

  return (
    <SectionCard className={className} aria-labelledby="study-aid-heading">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Lightbulb aria-hidden="true" className="h-4 w-4 shrink-0 text-marigold-foreground" />
        <h2 id="study-aid-heading" className="text-sm font-semibold">
          {t('library.study.aid.title')}
        </h2>
        <Badge tone="warning">{t('library.study.aid.badge')}</Badge>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm leading-relaxed">{aid.explanation[language]}</p>

        <section aria-label={t('library.study.aid.example')}>
          <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
            {t('library.study.aid.example')}
          </h3>
          <p className="text-sm leading-relaxed">{aid.example[language]}</p>
        </section>

        {aid.misconception ? (
          <section
            aria-label={t('library.study.aid.misconception')}
            className="rounded-lg border border-border bg-coral/15 px-3 py-2"
          >
            <h3 className="mb-1 font-sans text-xs font-semibold text-coral-foreground uppercase">
              {t('library.study.aid.misconception')}
            </h3>
            <p className="text-sm leading-relaxed">{aid.misconception[language]}</p>
          </section>
        ) : null}

        {aid.examRelevance ? (
          <section aria-label={t('library.study.aid.examRelevance')}>
            <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.study.aid.examRelevance')}
            </h3>
            <p className="text-sm leading-relaxed">{aid.examRelevance[language]}</p>
          </section>
        ) : null}

        {aid.mnemonic ? (
          <section
            aria-label={t('library.study.aid.mnemonic')}
            className="rounded-lg border border-border bg-marigold/15 px-3 py-2"
          >
            <h3 className="mb-1 font-sans text-xs font-semibold text-marigold-foreground uppercase">
              {t('library.study.aid.mnemonic')}
            </h3>
            <p className="text-sm leading-relaxed">{aid.mnemonic[language]}</p>
          </section>
        ) : null}

        {connected.length > 0 ? (
          <section aria-label={t('library.study.aid.connects')}>
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.study.aid.connects')}
            </h3>
            <ul className="flex flex-col gap-1">
              {connected.map(({ unitId, unit }) => {
                const shown = unitLabel(unit.heading, unit.excerpt, language)
                return (
                  <li key={unitId}>
                    <Link
                      to={toUnitHref(workId, unitId)}
                      className="flex min-h-11 items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/50"
                    >
                      <SectionNumber className="mt-0.5 shrink-0 text-xs">{unit.number}</SectionNumber>
                      <span lang={shown.lang} className="min-w-0 flex-1">
                        {shown.text}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          {t('library.study.aid.disclaimer')}
        </p>
      </div>
    </SectionCard>
  )
}
