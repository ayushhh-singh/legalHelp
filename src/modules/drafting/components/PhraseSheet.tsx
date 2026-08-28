import { useMemo, useState } from 'react'

import { Sheet } from './Sheet'
import { usePhrases } from '../useDraftingData'

import { SourceChip } from '@/components/common/SourceChip'
import { Chip, QueryErrorState, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { Phrase } from '../schema'

/**
 * The phrase library, filtered to the form being written.
 *
 * `data/drafting/phrases.json` is 48 KB and forty-nine phrases, and each one
 * declares the templates it belongs to — `appliesTo: ["office-memorandum",
 * "circular"]`, or `["*"]` for the handful that fit anything. Showing an
 * officer writing a leave application the openings for a notification would be
 * worse than showing nothing, so the filter is not a nicety.
 *
 * The library loads only when this sheet is mounted (`usePhrases(enabled)`),
 * which is the point of the sheet being a component that unmounts rather than
 * a panel that hides. Most drafts are written without opening it.
 *
 * Every phrase shows its CSMOP paragraph. That is what separates this from a
 * snippet box: an officer is not being handed a form of words someone liked,
 * they are being handed the form of words the manual prints, with the
 * reference to check it against.
 */

/**
 * `{number}` and `{date}` in the stored text — the officer fills these in.
 *
 * Deliberately NOT a global regex. `RegExp.test` on a `/g` pattern advances
 * `lastIndex` and resumes from there on the next call, so a shared global
 * pattern tested once per row reports true, false, true, false down a list —
 * which is exactly the bug, and exactly the shape of bug nobody sees in
 * review.
 */
const PLACEHOLDER = /\{[a-zA-Z]+\}/

export function PhraseSheet({
  templateId,
  onInsert,
  onClose,
}: {
  templateId: string
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const { t, language } = useT()
  const [query, setQuery] = useState('')
  const library = usePhrases(true)

  const phrases = useMemo(() => {
    if (library.status !== 'ready') return []
    const mine = library.data.phrases.filter(
      (phrase) => phrase.appliesTo.includes(templateId) || phrase.appliesTo.includes('*'),
    )
    const needle = query.trim().toLowerCase()
    if (!needle) return mine
    return mine.filter((phrase) =>
      `${phrase.text.en} ${phrase.text.hi} ${phrase.kind} ${phrase.tags?.join(' ') ?? ''}`
        .toLowerCase()
        .includes(needle),
    )
  }, [library, query, templateId])

  /** Grouped by kind so an opening is not buried among nine closings. */
  const groups = useMemo(() => {
    const byKind = new Map<Phrase['kind'], Phrase[]>()
    for (const phrase of phrases) {
      byKind.set(phrase.kind, [...(byKind.get(phrase.kind) ?? []), phrase])
    }
    return [...byKind.entries()]
  }, [phrases])

  return (
    <Sheet title={t('draft.phrases.title')} subtitle={t('draft.phrases.subtitle')} onClose={onClose}>
      <div className="border-b border-border p-4">
        <label className="sr-only" htmlFor="draft-phrase-search">
          {t('draft.phrases.search')}
        </label>
        <input
          id="draft-phrase-search"
          data-autofocus
          type="search"
          value={query}
          placeholder={t('draft.phrases.search')}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {library.status === 'error' ? (
          <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={library.retry} />
        ) : null}

        {library.status === 'loading' ? (
          <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : null}

        {library.status === 'ready' && phrases.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('draft.phrases.empty')}</p>
        ) : null}

        <div className="space-y-5">
          {groups.map(([kind, entries]) => (
            <section key={kind} aria-labelledby={`phrase-${kind}`}>
              <h3
                id={`phrase-${kind}`}
                className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t(`draft.phrases.kind.${kind}`)}
              </h3>
              <ul className="space-y-2">
                {entries.map((phrase) => (
                  <li
                    key={phrase.id}
                    className="rounded-lg border border-border p-3 transition-colors hover:border-input"
                  >
                    <p className="text-sm">{phrase.text[language]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {phrase.text[language === 'en' ? 'hi' : 'en']}
                    </p>

                    {PLACEHOLDER.test(phrase.text[language]) ? (
                      <p className="mt-1 text-xs text-marigold-foreground">
                        {t('draft.phrases.placeholderNote')}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" onClick={() => onInsert(phrase.text[language])}>
                        {t('draft.phrases.insert')}
                      </Button>
                      {phrase.csmopRef ? <Chip tone="neutral">{phrase.csmopRef}</Chip> : null}
                      <SourceChip name={phrase.source.name} url={phrase.source.url} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
