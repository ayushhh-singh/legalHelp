import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'

import { SectionNumber } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { unitLabel, type ReaderWork } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { TocNode } from '@/schemas/library'

/**
 * A work's table of contents, collapsible where the work has chapters.
 *
 * Two things it does that a plain tree would not:
 *
 * 1. **A node with no heading in the reader's language falls back to the
 *    work's own excerpt, then to the number alone.** Four of the twelve rule
 *    books publish no heading this repository could extract, so an English
 *    table of contents over FR/SR would otherwise be a column of bare numbers
 *    — and 71 of the 87 law chapter titles have no Hindi at all. Nothing is
 *    invented to fill either: `unitLabel()` (`src/lib/library/label.ts`) is the
 *    one place that decides, and it reports which language it actually
 *    returned so the markup can say so (docs/DATA-GAPS.md #70, #71).
 *
 * 2. **A read unit carries a tick AND a heavier label**, never a colour alone.
 */

interface UnitRowProps {
  node: TocNode
  work: ReaderWork
  read: boolean
  current: boolean
}

function UnitRow({ node, work, read, current }: UnitRowProps) {
  const { t, language } = useT()
  const unitId = node.unitIds[0] ?? ''
  const shown = unitLabel(node.heading, node.excerpt, language)

  return (
    <li>
      <Link
        to={toUnitHref(work.id, unitId)}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          current ? 'bg-accent font-semibold text-accent-foreground' : 'text-foreground hover:bg-accent/50',
        )}
      >
        <SectionNumber className="mt-0.5 shrink-0 text-xs">{node.number}</SectionNumber>
        <span
          lang={shown.lang}
          className={cn('min-w-0 flex-1', shown.isExcerpt && 'text-muted-foreground italic')}
        >
          {shown.text}
        </span>
        {read ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-tulsi-foreground">
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">{t('library.toc.read')}</span>
          </span>
        ) : null}
      </Link>
    </li>
  )
}

interface ChapterProps {
  node: TocNode
  work: ReaderWork
  readIds: ReadonlySet<string>
  currentUnitId?: string
  defaultOpen: boolean
}

function Chapter({ node, work, readIds, currentUnitId, defaultOpen }: ChapterProps) {
  const { t, language } = useT()
  const [open, setOpen] = useState(defaultOpen)
  const children = node.children ?? []
  const shown = unitLabel(node.heading, node.excerpt, language)
  const name = shown.text ? `${node.number} — ${shown.text}` : node.number
  const readHere = node.unitIds.filter((id) => readIds.has(id)).length

  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? t('library.toc.collapse', { name }) : t('library.toc.expand', { name })}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-accent/50"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        )}
        <SectionNumber className="shrink-0 text-xs">{node.number}</SectionNumber>
        <span lang={shown.lang} className="min-w-0 flex-1">
          {shown.text}
        </span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
          {t('library.readCount', { read: readHere, total: node.unitIds.length })}
        </span>
      </button>
      {open ? (
        <ul className="border-t border-border p-1">
          {children.map((child) => (
            <UnitRow
              key={child.id}
              node={child}
              work={work}
              read={readIds.has(child.unitIds[0] ?? '')}
              current={currentUnitId !== undefined && child.unitIds.includes(currentUnitId)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

interface TocTreeProps {
  work: ReaderWork
  readIds: ReadonlySet<string>
  /** Opens (and marks) the branch the reader is in. */
  currentUnitId?: string
  className?: string
}

export function TocTree({ work, readIds, currentUnitId, className }: TocTreeProps) {
  const { t } = useT()
  const hasChapters = work.toc.some((node) => (node.children ?? []).length > 0)

  return (
    <nav aria-label={t('library.toc.title')} className={className}>
      {work.tocSource !== 'chapters' ? (
        <p className="mb-3 rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-xs text-marigold-foreground">
          {work.tocSource === 'flat' ? t('library.toc.flatNotice') : t('library.toc.numberingNotice')}
        </p>
      ) : null}

      <ul className={cn('flex flex-col', hasChapters ? 'gap-2' : 'gap-0.5')}>
        {work.toc.map((node) =>
          (node.children ?? []).length > 0 ? (
            <Chapter
              key={node.id}
              node={node}
              work={work}
              readIds={readIds}
              currentUnitId={currentUnitId}
              // The branch the reader is in opens; on a first visit the first
              // chapter opens so the list is not fifteen closed rows.
              defaultOpen={
                currentUnitId !== undefined
                  ? node.unitIds.includes(currentUnitId)
                  : node.id === work.toc[0]?.id
              }
            />
          ) : (
            <UnitRow
              key={node.id}
              node={node}
              work={work}
              read={readIds.has(node.unitIds[0] ?? '')}
              current={currentUnitId !== undefined && node.unitIds.includes(currentUnitId)}
            />
          ),
        )}
      </ul>
    </nav>
  )
}
