import { ExternalLink, GraduationCap } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { toLawSearchHref, toPractiseHref, toUnitHref } from '../url'

import { SectionCard, SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import {
  lawCrossReferences,
  tocPath,
  unitLabel,
  type LibraryCorpus,
  type LibraryUnit,
  type ReaderWork,
} from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * What else points at the unit on screen — three sources, each of which is
 * either already in memory or free to compute, and none of which loads a
 * dataset this page was not going to load anyway.
 *
 * 1. **Nearby in this work** — the units in the same table-of-contents branch,
 *    which for a law work is the same chapter and for a flat rule book is the
 *    handful either side. From the corpus already parsed.
 * 2. **Cross-references into the criminal codes** — six of them exist across
 *    all twelve rule books, all written out in full by the document itself
 *    (`src/lib/library/crossRefs.ts` says why nothing looser is matched), and
 *    for a LAW unit the repealed-Act provisions the corpus already records.
 *    Both link into the Law Converter by QUERY, naming the Act.
 * 3. **The Trainer cards that cite this unit** — matched on `ruleRef.textId`,
 *    which every one of the 2,807 cards carries. `cardCount` is passed in
 *    rather than looked up here: the reader page owns whether `data/rules/
 *    cards` is worth loading at all, and on a law work it never is.
 */

const NEARBY_LIMIT = 6

interface RelatedRailProps {
  work: ReaderWork
  corpus: LibraryCorpus
  unit: LibraryUnit
  /** Trainer cards whose `ruleRef.textId` is this unit. */
  cardCount: number
  className?: string
}

export function RelatedRail({ work, corpus, unit, cardCount, className }: RelatedRailProps) {
  const { t, language } = useT()

  const nearby = useMemo(() => {
    /**
     * The BRANCH, meaning the node above the leaf — which for a law work is the
     * chapter and for a flat rule book does not exist at all.
     *
     * The committed version fell back to `path.at(-1)`, the leaf itself, whose
     * `unitIds` is the one unit the reader is already on. Siblings came out
     * empty and this section rendered nothing for eleven of the fifteen works:
     * every rule book except the three Sanhitas and CSMOP, which is where an
     * officer actually reads. The fallback has to be the whole work.
     */
    const path = tocPath(work, unit.id)
    const branch = path.length > 1 ? path.at(-2) : undefined
    const siblings = (branch?.unitIds ?? work.readingOrder).filter((id) => id !== unit.id)

    // Centred on the reader's position rather than taken from the top: the
    // sections around section 300 are the useful ones, not sections 1-6.
    // `corpus.order.indexOf(unit.id)` is hoisted: computing it inside the
    // predicate made this quadratic over a 531-section chapter for no reason.
    const here = corpus.order.indexOf(unit.id)
    const at = siblings.findIndex((id) => corpus.order.indexOf(id) > here)
    const from = Math.max(0, (at < 0 ? siblings.length : at) - Math.floor(NEARBY_LIMIT / 2))
    return siblings
      .slice(from, from + NEARBY_LIMIT)
      .map((id) => corpus.units.get(id))
      .filter((candidate): candidate is LibraryUnit => candidate !== undefined)
  }, [work, corpus, unit])

  // The body alone: `unit.parts` re-segments the same text, and scanning both
  // would find every citation twice (the dedup inside `lawCrossReferences`
  // hides that, which is exactly why it is worth not relying on).
  const crossRefs = useMemo(() => lawCrossReferences(unit.body.en.join(' ')), [unit])

  const chapterLabel = unit.chapter?.title[language] || unit.chapter?.title.en || ''
  const nearbyHeading = unit.chapter
    ? `${t('library.rail.sameChapter')}${chapterLabel ? ` — ${chapterLabel}` : ''}`
    : t('library.rail.nearby')

  const nothing =
    nearby.length === 0 && crossRefs.length === 0 && unit.repealedRefs.length === 0 && cardCount === 0

  return (
    <SectionCard className={className} aria-labelledby="library-rail-heading">
      <div className="border-b border-border px-4 py-3">
        <h2 id="library-rail-heading" className="text-sm font-semibold">
          {t('library.rail.title')}
        </h2>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {nothing ? <p className="text-sm text-muted-foreground">{t('library.rail.none')}</p> : null}

        {nearby.length > 0 ? (
          <section aria-label={nearbyHeading}>
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {nearbyHeading}
            </h3>
            <ul className="flex flex-col gap-1">
              {nearby.map((sibling) => (
                <li key={sibling.id}>
                  <Link
                    to={toUnitHref(work.id, sibling.id)}
                    className="flex min-h-11 items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/50"
                  >
                    <SectionNumber className="mt-0.5 shrink-0 text-xs">{sibling.number}</SectionNumber>
                    {/* One decision about a missing heading, in one place. */}
                    {(() => {
                      const shown = unitLabel(sibling.heading, sibling.excerpt, language)
                      return (
                        <span
                          lang={shown.lang}
                          className={cn('min-w-0 flex-1', shown.isExcerpt && 'text-muted-foreground italic')}
                        >
                          {shown.text}
                        </span>
                      )
                    })()}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {unit.repealedRefs.length > 0 ? (
          <section aria-label={t('library.rail.repealed')}>
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.rail.repealed')}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {unit.repealedRefs.slice(0, 8).map((ref) => (
                <li key={`${ref.act}:${ref.section}`}>
                  <Link
                    to={toLawSearchHref(`${ref.act} ${ref.section}`)}
                    className="inline-flex min-h-9 items-center rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground tabular-nums transition-colors hover:border-input"
                  >
                    {ref.act} {ref.section}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {crossRefs.length > 0 ? (
          <section aria-label={t('library.rail.lawRefs')}>
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.rail.lawRefs')}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {crossRefs.map((ref) => (
                <li key={`${ref.act}:${ref.section}`}>
                  <Link
                    to={toLawSearchHref(ref.query)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground tabular-nums transition-colors hover:border-input"
                  >
                    {ref.act} {ref.section}
                    <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {cardCount > 0 ? (
          <section aria-label={t('library.rail.cards')}>
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.rail.cards')}
            </h3>
            <p className="mb-2 text-sm text-muted-foreground">
              {t('library.rail.cardsCount', { count: cardCount })}
            </p>
            <Link
              to={toPractiseHref(work.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-action px-4 text-sm font-medium text-action-foreground transition-colors hover:bg-action/90"
            >
              <GraduationCap aria-hidden="true" className="h-4 w-4" />
              {t('library.rail.practise')}
            </Link>
          </section>
        ) : null}
      </div>
    </SectionCard>
  )
}
