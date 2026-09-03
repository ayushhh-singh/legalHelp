import { AlertTriangle, Palette, StickyNote, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { NoteBody, type WikiTarget } from './NoteBody'
import { NoteEditor } from './NoteEditor'

import { Badge, SectionCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import {
  colourOf,
  deleteHighlight,
  HIGHLIGHT_COLOURS,
  setHighlightColour,
  type HighlightColour,
  type ResolvedHighlight,
} from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryNoteRow } from '@/db'

/**
 * Everything the reader has written on this unit, under the text.
 *
 * It is not a duplicate of the marks on the page: it is the only place where a
 * highlight under a citation can be recoloured or removed (a control cannot
 * nest inside another control — see `AnnotatedBody`), and the only place a
 * highlight the corpus has moved out from under can be seen at all.
 *
 * A LOST HIGHLIGHT IS SHOWN HERE, NEVER DROPPED. `resolveAnchor` could find it
 * by neither offset nor quote, which almost always means the dataset was
 * refreshed under it. What the officer marked is still theirs; they get the
 * words back, told plainly what happened, and the choice of what to do.
 */

const SWATCH: Readonly<Record<HighlightColour, string>> = {
  marigold: 'bg-marigold/15 text-marigold-foreground border-marigold/40',
  tulsi: 'bg-tulsi/15 text-tulsi-foreground border-tulsi/40',
  violet: 'bg-violet/15 text-violet-foreground border-violet/40',
  coral: 'bg-coral/15 text-coral-foreground border-coral/40',
}

interface AnnotationsPanelProps {
  workId: string
  unitId: string
  highlights: readonly ResolvedHighlight[]
  notes: readonly LibraryNoteRow[]
  resolveWiki: (workId: string, unitId: string) => WikiTarget | null
  /** Which highlight the reader just pressed, so its editor opens here. */
  openNoteFor: string | null
  onOpenNoteFor: (id: string | null) => void
  className?: string
}

export function AnnotationsPanel({
  workId,
  unitId,
  highlights,
  notes,
  resolveWiki,
  openNoteFor,
  onOpenNoteFor,
  className,
}: AnnotationsPanelProps) {
  const { t } = useT()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const noteFor = (highlightId: string) => notes.find((note) => note.highlightId === highlightId) ?? null
  const unitNotes = notes.filter((note) => !note.highlightId)

  if (highlights.length === 0 && notes.length === 0 && !adding && !openNoteFor) {
    return (
      <SectionCard className={className}>
        <div className="flex flex-col items-start gap-2 p-4">
          <p className="text-sm text-muted-foreground">{t('library.highlight.none')}</p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <StickyNote aria-hidden="true" className="h-4 w-4" />
            {t('library.note.add')}
          </button>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard className={className} aria-labelledby="library-annotations-heading">
      <div className="border-b border-border px-4 py-3">
        <h2 id="library-annotations-heading" className="text-sm font-semibold">
          {t('library.highlight.title')}
        </h2>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {highlights.map(({ row, resolution }) => {
          const colour = colourOf(row)
          const note = noteFor(row.id)
          const lost = resolution.status === 'lost'

          return (
            <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <blockquote className={cn('rounded-md border-l-[3px] px-3 py-1.5 text-sm', SWATCH[colour])}>
                {row.quote}
              </blockquote>

              {lost ? (
                <div className="flex flex-col gap-1">
                  <Badge tone="warning">
                    <AlertTriangle aria-hidden="true" className="mr-1 inline h-3 w-3" />
                    {t('library.highlight.needsAttention')}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{t('library.highlight.lostExplain')}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1">
                <span className="sr-only" id={`library-colour-${row.id}`}>
                  {t('library.highlight.changeColour')}
                </span>
                <div role="group" aria-labelledby={`library-colour-${row.id}`} className="flex gap-1">
                  {HIGHLIGHT_COLOURS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={colour === option}
                      aria-label={t(`library.select.colour.${option}`)}
                      onClick={() => void setHighlightColour(row.id, option)}
                      className={cn(
                        'h-8 w-8 rounded-md border text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        SWATCH[option],
                        colour === option && 'ring-2 ring-action',
                      )}
                    >
                      {t(`library.select.colour.${option}`).slice(0, 1)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenNoteFor(null)
                    setEditing(editing === row.id ? null : row.id)
                  }}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <StickyNote aria-hidden="true" className="h-3.5 w-3.5" />
                  {note ? t('library.note.edit') : t('library.highlight.addNote')}
                </button>

                <button
                  type="button"
                  onClick={() => void deleteHighlight(row.id)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('library.highlight.delete')}
                </button>
              </div>

              {editing === row.id || openNoteFor === row.id ? (
                <NoteEditor
                  workId={workId}
                  unitId={unitId}
                  note={note}
                  stored={note ?? undefined}
                  highlightId={row.id}
                  quote={row.quote}
                  focusOnOpen
                  onClose={() => {
                    setEditing(null)
                    onOpenNoteFor(null)
                  }}
                />
              ) : note ? (
                <NoteBody
                  body={note.body}
                  resolveWiki={resolveWiki}
                  unresolvedLabel={t('library.note.unresolved')}
                  className="rounded-md bg-muted/40 p-2"
                />
              ) : null}
            </div>
          )
        })}

        {unitNotes.map((note) =>
          editing === note.id ? (
            <NoteEditor
              key={note.id}
              workId={workId}
              unitId={unitId}
              note={note}
              stored={note}
              focusOnOpen
              onClose={() => setEditing(null)}
            />
          ) : (
            <div key={note.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <NoteBody
                body={note.body}
                resolveWiki={resolveWiki}
                unresolvedLabel={t('library.note.unresolved')}
              />
              <button
                type="button"
                onClick={() => setEditing(note.id)}
                className="self-start text-xs text-primary underline underline-offset-4"
              >
                {t('library.note.edit')}
              </button>
            </div>
          ),
        )}

        {adding ? (
          <NoteEditor
            workId={workId}
            unitId={unitId}
            note={null}
            stored={undefined}
            focusOnOpen
            onClose={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Palette aria-hidden="true" className="h-4 w-4" />
            {t('library.note.add')}
          </button>
        )}
      </div>
    </SectionCard>
  )
}
