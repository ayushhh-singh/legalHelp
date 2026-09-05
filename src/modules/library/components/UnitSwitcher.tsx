import { ChevronDown } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'

import { SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { unitLabel, type LibraryCorpus, type ReaderWork } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * The focus bar's centre: which provision this is, and a way to any other.
 *
 * It replaces two things the reader used to carry as separate furniture — the
 * work link and a `SectionNumber` chip beside the heading — with one control
 * that both NAMES where you are and takes you somewhere else. That is the whole
 * argument for it: a bar that says "Rule 1 · Short title and commencement" and
 * cannot be pressed is a label, and a label is a poor use of the one row an
 * officer can always see.
 *
 * ### The list is not the table of contents
 *
 * `WorkPage`'s `TocTree` is the tree, with chapters, read ticks and counts. This
 * is the FLAT reading order, filtered by a plain substring over the number and
 * the heading, capped, and it deliberately does not load, index or rank
 * anything: fuse.js is already gated behind `isSearchable` on the work page for
 * a corpus that reaches 531 sections, and a switcher an officer opens to jump
 * two rules forward must not pay for a search index. Anything cleverer than
 * "does this contain what I typed" is what the work page's own search box is.
 */

/** As many rows as fit a phone screen twice. Beyond that, type more. */
const MAX_ROWS = 60

export function UnitSwitcher({
  work,
  corpus,
  currentUnitId,
  number,
  heading,
  open,
  onOpenChange,
}: {
  work: ReaderWork
  corpus: LibraryCorpus | null
  currentUnitId: string
  /** The current unit's printed number — "3", "F.R. 9", "103". */
  number: string
  /** What the heading line reads, already resolved for the language. */
  heading: string
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const { t, language } = useT()
  const [query, setQuery] = useState('')

  /*
    Escape shuts the list, and does NOT leave the provision.

    `FocusLayout`'s own Escape handler is on `window` in the capture phase, so
    it runs before this one whatever this one does — stopping propagation is
    necessary and not sufficient. `data-focus-overlay` on the open panel is what
    that handler reads to know something nearer owns the press.
  */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onOpenChange])
  /*
    Deferred, because typing here filters a list that can be 531 rows long and
    the reader is holding the key down. React keeps the input responsive and
    lets the list catch up; nothing below depends on the value being current.
  */
  const deferred = useDeferredValue(query)

  const rows = useMemo(() => {
    if (!corpus) return []
    const needle = deferred.trim().toLowerCase()
    const out: { id: string; number: string; label: string; lang: string; isExcerpt: boolean }[] = []
    for (const id of corpus.order) {
      const unit = corpus.units.get(id)
      if (!unit) continue
      const shown = unitLabel(unit.heading, unit.excerpt, language)
      if (needle && !`${unit.number} ${shown.text}`.toLowerCase().includes(needle)) continue
      out.push({
        id,
        number: unit.number,
        label: shown.text,
        lang: shown.lang,
        isExcerpt: shown.isExcerpt,
      })
      if (out.length >= MAX_ROWS) break
    }
    return out
  }, [corpus, deferred, language])

  return (
    <div className="relative flex min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="reader-unit-switcher"
        onClick={() => onOpenChange(!open)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <SectionNumber className="shrink-0 text-xs">{number}</SectionNumber>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{heading}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">{t('library.reader.switchUnit')}</span>
      </button>

      <div
        id="reader-unit-switcher"
        hidden={!open}
        {...(open ? { 'data-focus-overlay': '' } : {})}
        className="absolute start-0 top-12 z-50 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg"
      >
        <label className="flex flex-col gap-1 p-1 text-xs text-muted-foreground">
          {t('library.reader.jumpTo')}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('library.reader.jumpPlaceholder')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>

        {corpus === null ? (
          <p className="p-2 text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">{t('library.search.none')}</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  to={toUnitHref(work.id, row.id)}
                  aria-current={row.id === currentUnitId ? 'page' : undefined}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    'flex min-h-11 items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                    row.id === currentUnitId
                      ? 'bg-accent font-semibold text-accent-foreground'
                      : 'text-foreground hover:bg-accent/50',
                  )}
                >
                  <SectionNumber className="mt-0.5 shrink-0 text-xs">{row.number}</SectionNumber>
                  <span
                    lang={row.lang}
                    className={cn('min-w-0 flex-1', row.isExcerpt && 'text-muted-foreground italic')}
                  >
                    {row.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
