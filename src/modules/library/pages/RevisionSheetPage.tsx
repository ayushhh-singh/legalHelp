import { ArrowLeft, Printer } from 'lucide-react'
import { useMemo } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'

import { useWork, useWorkCorpus } from '../useLibrary'
import { useChapters, useStudyAids } from '../useStudy'
import { toUnitHref, toWorkHref } from '../url'

import { Badge, QueryErrorState, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Disclaimer } from '@/components/common/Disclaimer'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { allHighlights, allNotes, isWorkId, loadQuickRef } from '@/lib/library'
import { sheetFor, hasContent, type SheetMode } from '@/lib/study'
import { useAsync } from '@/lib/useAsync'
import { useLiveQuery } from 'dexie-react-hooks'
import { isAidServed } from '@/schemas/library'

/**
 * `/library/:workId/sheet/:nodeId` — one printable page per chapter.
 *
 * NOTHING HERE IS NEW WRITING. A sheet is the chapter's aids, the reader's own
 * highlights and notes, and the quick-reference rows extracted from the same
 * text, arranged so a chapter can be revised from one page.
 *
 * `?mode=24h` is a DIFFERENT sheet rather than a shorter one: what drops out is
 * the explanation and the example, which are most of a full sheet, and what
 * survives is what an officer with one evening left actually needs — the trap,
 * the number, and what they themselves wrote down.
 *
 * It prints against the named `library-a4` page box the reader already uses
 * (ADR-038), so the chrome drops off the printed page and the margins are
 * CSMOP's rather than the app's.
 */
export default function RevisionSheetPage() {
  const { t, language } = useT()
  const params = useParams<{ workId: string; nodeId: string }>()
  const [search] = useSearchParams()
  const workId = params.workId ?? ''
  const nodeId = params.nodeId ?? ''
  const mode: SheetMode = search.get('mode') === '24h' ? 'twentyFourHour' : 'full'

  const work = useWork(isWorkId(workId) ? workId : undefined)
  const corpus = useWorkCorpus(work.data)
  const chapters = useChapters(work.data)
  const chapter = useMemo(() => chapters.find((entry) => entry.nodeId === nodeId) ?? null, [chapters, nodeId])
  const aids = useStudyAids(isWorkId(workId) ? workId : undefined)

  const quickRef = useAsync(
    useMemo(() => () => loadQuickRef(workId), [workId]),
    `quickref:${workId}`,
    isWorkId(workId),
  )

  // `undefined` while Dexie answers, and NOT blocked on: a sheet with the aids
  // and none of the annotations is still a sheet, and a device whose storage is
  // refused would otherwise sit on a skeleton for ever (the Session 27 lesson).
  const highlights = useLiveQuery(() => allHighlights(), [])
  const notes = useLiveQuery(() => allNotes(), [])

  const sheet = useMemo(() => {
    if (!chapter || !corpus.data) return null
    return sheetFor({
      chapter,
      units: corpus.data.units,
      aids: aids.status === 'ready' ? aids.data.aids.filter(isAidServed) : [],
      highlights: (highlights ?? []).filter((row) => row.workId === workId),
      notes: (notes ?? []).filter((row) => row.workId === workId),
      quickRef: quickRef.status === 'ready' ? quickRef.data.rows : [],
      language,
      mode,
    })
  }, [aids, chapter, corpus.data, highlights, language, mode, notes, quickRef, workId])

  if (!isWorkId(workId)) return <Navigate to="/study/read" replace />
  if (work.status === 'error') return <QueryErrorState onRetry={work.retry} />
  if (work.status === 'loading' || corpus.status === 'loading') return <Skeleton className="h-96 w-full" />
  if (corpus.status === 'error') return <QueryErrorState onRetry={corpus.retry} />
  if (!chapter || !sheet) return <Navigate to={toWorkHref(workId)} replace />

  const heading = chapter.heading[language] || chapter.heading.en || chapter.number
  const other: SheetMode = mode === 'full' ? 'twentyFourHour' : 'full'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <nav data-print-hide className="flex flex-wrap items-center gap-3">
        <Link
          to={toWorkHref(workId)}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t('library.backToWork', { work: work.data.shortTitle[language] || work.data.shortTitle.en })}
        </Link>
        <Link
          to={`?${other === 'twentyFourHour' ? 'mode=24h' : ''}`}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm transition-colors hover:border-input"
        >
          {t(`library.study.sheet.${other}`)}
        </Link>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t('library.study.sheet.print')}
        </Button>
      </nav>

      {/*
          The reader's own `library-a4` page box, not the Drafting Studio's
          `a4-page`.

          `a4-page` paints fixed white paper with `#111` text in both themes,
          because it is a FACSIMILE — what a Government letter looks like when
          it comes off the printer. A revision sheet is not a facsimile of
          anything; it is a study page an officer may also print. Using the
          drafting surface put `--muted-foreground` on white in the dark theme
          and failed `color-contrast` on four elements, which is what found it.
      */}
      <SectionCard className="library-print-root library-print-page">
        <div className="flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1 border-b border-border pb-3">
            <h1 className="font-display text-lg font-semibold">
              {t('library.study.sheet.titleFor', { chapter: heading })}
            </h1>
            <p className="text-xs text-muted-foreground">{work.data.title[language] || work.data.title.en}</p>
            {mode === 'twentyFourHour' ? (
              <p data-print-hide className="text-xs text-muted-foreground">
                {t('library.study.sheet.twentyFourHourHint')}
              </p>
            ) : null}
          </header>

          {!hasContent(sheet) ? (
            <p className="text-sm text-muted-foreground">{t('library.study.sheet.empty')}</p>
          ) : null}

          {sheet.entries.map((entry) => (
            <section key={entry.unitId} aria-label={entry.heading} className="flex flex-col gap-2">
              <h2 className="flex items-start gap-2 text-sm font-semibold">
                <SectionNumber className="mt-0.5 shrink-0 text-xs">{entry.number}</SectionNumber>
                <Link
                  to={toUnitHref(workId, entry.unitId)}
                  lang={entry.headingLang}
                  className={entry.headingIsExcerpt ? 'italic' : undefined}
                >
                  {entry.heading}
                </Link>
              </h2>

              {mode === 'full' && entry.aid ? (
                <p className="text-sm leading-relaxed">{entry.aid.explanation[language]}</p>
              ) : null}

              {entry.aid?.misconception ? (
                <p className="rounded-lg border border-border bg-coral/15 px-3 py-2 text-sm leading-relaxed">
                  <span className="font-semibold">{t('library.study.aid.misconception')}: </span>
                  {entry.aid.misconception[language]}
                </p>
              ) : null}

              {mode === 'full' && entry.aid?.mnemonic ? (
                <p className="rounded-lg border border-border bg-marigold/15 px-3 py-2 text-sm">
                  <span className="font-semibold">{t('library.study.aid.mnemonic')}: </span>
                  {entry.aid.mnemonic[language]}
                </p>
              ) : null}

              {entry.quickRef.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
                    {t('library.study.sheet.limits')}
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {entry.quickRef.map((row, at) => (
                      <li key={at}>
                        <Badge tone="neutral">{row.value}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.highlights.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
                    {t('library.study.sheet.yourHighlights')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {entry.highlights.map((row) => (
                      <li key={row.id} className="border-l-2 border-marigold pl-2 text-sm italic">
                        {row.quote}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.notes.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
                    {t('library.study.sheet.yourNotes')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {entry.notes.map((row) => (
                      <li key={row.id} className="text-sm leading-relaxed whitespace-pre-wrap">
                        {row.body}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))}

          <footer className="flex flex-col gap-2 border-t border-border pt-3">
            {sheet.skipped > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('library.study.sheet.skipped', { count: sheet.skipped })}
              </p>
            ) : null}
            <Disclaimer />
          </footer>
        </div>
      </SectionCard>
    </div>
  )
}
