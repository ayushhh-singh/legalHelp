import { ArrowLeft, Bookmark, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'
import { useLibraryIndex } from '../useLibrary'
import { usePersonalWorks, useStudyRows } from '../useAnnotations'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { setBookmarkLabel } from '@/lib/library'

/**
 * `/library/bookmarks` — every unit the reader has marked, newest first.
 *
 * It loads NO corpus. A bookmark row carries its work id and unit id and
 * nothing else, and the shelf index (11 KB) is enough to name the book — so
 * this screen is readable on a train without pulling a single megabyte of
 * statute. The unit's own heading is deliberately not shown for that reason;
 * the number and the book are what a reader recognises a bookmark by, and the
 * label they wrote is what tells them why.
 */

export default function BookmarksPage() {
  const { t, language } = useT()
  const rows = useStudyRows()
  const index = useLibraryIndex()
  const personal = usePersonalWorks()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const nameOf = useMemo(() => {
    const names = new Map<string, string>()
    for (const work of index.data?.works ?? []) names.set(work.id, work.shortTitle[language])
    for (const work of personal ?? []) names.set(work.id, work.title)
    return names
  }, [index.data, personal, language])

  if (rows === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('library.bookmark.title')}
        subtitle={t('library.bookmark.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/library">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
            </Link>
          </Button>
        }
      />

      {rows.bookmarks.length === 0 ? (
        <EmptyState title={t('library.bookmark.title')} body={t('library.bookmark.none')} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('library.bookmark.count', { count: rows.bookmarks.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {rows.bookmarks.map((row) => (
              <li key={row.id}>
                <SectionCard>
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-start gap-3">
                      <SectionNumber className="mt-0.5 shrink-0 text-xs">{row.unitId}</SectionNumber>
                      <Link
                        to={toUnitHref(row.workId, row.unitId)}
                        className="min-w-0 flex-1 text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {nameOf.get(row.workId) ?? row.workId}
                      </Link>
                    </div>

                    {editing === row.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`library-bookmark-${row.id}`} className="sr-only">
                          {t('library.bookmark.label')}
                        </label>
                        <input
                          id={`library-bookmark-${row.id}`}
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder={t('library.bookmark.labelPlaceholder')}
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            void setBookmarkLabel(row.workId, row.unitId, draft)
                            setEditing(null)
                          }}
                        >
                          {t('library.bookmark.save')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {row.label ? <p className="flex-1 text-sm">{row.label}</p> : null}
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(row.label ?? '')
                            setEditing(row.id)
                          }}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          {row.label ? t('library.bookmark.edit') : t('library.bookmark.label')}
                        </button>
                      </div>
                    )}
                  </div>
                </SectionCard>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
        {t('library.polish.keys.b')}
      </p>
    </div>
  )
}
