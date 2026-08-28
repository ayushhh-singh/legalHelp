import { useMemo, useState } from 'react'

import { Sheet } from './Sheet'
import { useStructureTerms } from '../useDraftingData'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge, Chip, QueryErrorState, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { StructureTerm } from '../schema'

/**
 * The Hindi administrative glossary.
 *
 * Seventy-eight terms out of `data/drafting/structure-terms.json`, and the
 * reason this is worth a sheet of its own rather than a tooltip is what it
 * says: **the manual's Hindi is not the Hindi anyone would guess.** CSMOP 2022
 * prints `परम अग्रता` for Top Priority, not `सर्वोच्च अग्रता`; `अर्ध-सरकारी पत्र`
 * for a demi-official letter, not `अर्ध-शासकीय पत्र`; and `अंतर-विभागीय टिप्पणी`
 * for what every section still calls the `अशासकीय टिप्पणी` (ADR-020).
 *
 * All three of the forms an officer will actually meet are carried in `alsoHi`
 * so that searching for one finds the term — and the row then shows which
 * rendering this app prints and which it merely recognises. A glossary that
 * silently returned the expected word would be teaching the wrong one.
 *
 * ### Session 10's hook
 *
 * The brief asks for a stub. This is the working version instead, because the
 * data it needs is already committed and tested: the "stub" would have been
 * this component with the list removed. What Session 10 adds is the glossary as
 * its OWN destination under Utilities, with the full Rajbhasha Shabdavali
 * behind it; this sheet is the drafting-side entry point and will read whatever
 * that session leaves in `structure-terms.json`, unchanged.
 */

const CATEGORIES = ['form', 'part', 'urgency', 'designation', 'process', 'phraseElement'] as const

export function GlossarySheet({
  onInsert,
  onClose,
}: {
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const { t, language } = useT()
  const [query, setQuery] = useState('')
  const terms = useStructureTerms(true)

  const matches = useMemo(() => {
    if (terms.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    if (!needle) return terms.data.terms
    return terms.data.terms.filter((term) =>
      `${term.en} ${term.hi} ${(term.alsoHi ?? []).join(' ')} ${term.csmopRef ?? ''}`
        .toLowerCase()
        .includes(needle),
    )
  }, [terms, query])

  const groups = useMemo(
    () =>
      CATEGORIES.map(
        (category) => [category, matches.filter((term) => term.category === category)] as const,
      ).filter(([, entries]) => entries.length > 0),
    [matches],
  )

  return (
    <Sheet title={t('draft.glossary.title')} subtitle={t('draft.glossary.subtitle')} onClose={onClose}>
      <div className="border-b border-border p-4">
        <label className="sr-only" htmlFor="draft-glossary-search">
          {t('draft.glossary.search')}
        </label>
        <input
          id="draft-glossary-search"
          data-autofocus
          type="search"
          value={query}
          placeholder={t('draft.glossary.search')}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {terms.status === 'error' ? (
          <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={terms.retry} />
        ) : null}

        {terms.status === 'loading' ? (
          <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : null}

        {terms.status === 'ready' && matches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('draft.glossary.empty')}</p>
        ) : null}

        <div className="space-y-5">
          {groups.map(([category, entries]) => (
            <section key={category} aria-labelledby={`glossary-${category}`}>
              <h3
                id={`glossary-${category}`}
                className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t(`draft.glossary.category.${category}`)}
              </h3>
              <ul className="space-y-2">
                {entries.map((term) => (
                  <TermRow key={term.id} term={term} onInsert={onInsert} language={language} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

function TermRow({
  term,
  onInsert,
  language,
}: {
  term: StructureTerm
  onInsert: (text: string) => void
  language: 'en' | 'hi'
}) {
  const { t } = useT()

  return (
    <li className="rounded-lg border border-border p-3 transition-colors hover:border-input">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium">{term.en}</p>
        <p className="text-sm font-medium">{term.hi}</p>
      </div>

      {term.alsoHi && term.alsoHi.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('draft.glossary.alsoKnown')}: {term.alsoHi.join(', ')}
        </p>
      ) : null}

      {term.note ? <p className="mt-1 text-xs text-muted-foreground">{term.note[language]}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => onInsert(term.hi)}>
          {t('draft.glossary.insert')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onInsert(term.en)}>
          {t('draft.glossary.insertEnglish')}
        </Button>
        {term.csmopRef ? <Chip tone="neutral">{term.csmopRef}</Chip> : null}
        {/*
          Twenty-eight of the seventy-eight terms are NOT in the manual — they
          come from the Department of Official Language's simplified glossary
          and carry `verify: true`. `docs/DATA-GAPS.md` #39 records that such a
          term owes the reader the same marigold banner the Law Converter shows
          for curated Hindi, and this is it: an officer must never mistake a
          glossary's word for the manual's.
        */}
        {term.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
        <SourceChip name={term.source.name} url={term.source.url} />
      </div>
    </li>
  )
}
