import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, FileText, FileUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { BatchExportBar } from './batch/BatchExportBar'
import { deleteDocument, duplicateDocument, listDocuments, restoreDocument } from './documents'
import { migrateAllDrafts, pendingMigrationCount } from './migrateDrafts'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { DocumentRow } from '@/db'

/**
 * Every document on the device, and the one-time migration of the older drafts.
 *
 * The migration banner is deliberately not automatic. Bringing sixty drafts
 * across writes sixty rows, and a write an officer did not ask for is a write
 * that happens while their storage is nearly full. It is offered, it says
 * exactly what it will do, and it never deletes the originals.
 */
export default function DocumentsPage() {
  const { t, language } = useT()
  const documents = useLiveQuery(() => listDocuments(), []) ?? []
  const pending = useLiveQuery(() => pendingMigrationCount(), []) ?? 0
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof deleteDocument>>>(null)
  /*
    Selection is a `Set` of ids and NOT a flag on the row.

    `documents` is a live query: a document edited in another tab, or deleted
    from this page, re-renders the whole list. A flag carried on the row would
    be thrown away by that render, and a selection that silently empties itself
    while an officer is choosing thirty documents is worse than no selection at
    all. Ids that are no longer in the list are filtered on read rather than
    pruned on write, so a deletion cannot leave a phantom in the count.
  */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const chosen = documents.filter((row) => selected.has(row.id)).map((row) => row.id)

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('draft.editor.documents')} />

      {pending > 0 ? (
        <SectionCard className="p-4">
          <h2 className="text-sm font-semibold">{t('draft.migration.heading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('draft.migration.pending', { count: pending })}
          </p>
          <div className="mt-3">
            <Button
              size="sm"
              onClick={() =>
                void migrateAllDrafts().then((report) =>
                  setNotice(
                    [
                      t('draft.migration.done', { count: report.migrated }),
                      report.skipped ? t('draft.migration.skipped', { count: report.skipped }) : '',
                      report.failed.length
                        ? t('draft.migration.failed', { count: report.failed.length })
                        : '',
                      report.keptAsVars.length
                        ? t('draft.migration.keptFields', { fields: report.keptAsVars.join(', ') })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                  ),
                )
              }
            >
              {t('draft.migration.run')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {documents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/draft/import">
              <FileUp aria-hidden="true" className="mr-1 size-4" />
              {t('draft.export.imported')}
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSelected((current) =>
                current.size === documents.length ? new Set() : new Set(documents.map((row) => row.id)),
              )
            }
          >
            {t('draft.batch.selectAll')}
          </Button>
        </div>
      ) : null}

      {chosen.length > 0 ? <BatchExportBar ids={chosen} onClear={() => setSelected(new Set())} /> : null}

      {undo ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{t('draft.editor.deleted', { title: undo.row.title || t('draft.editor.untitled') })}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void restoreDocument(undo).then(() => {
                setUndo(null)
              })
            }
          >
            {t('draft.editor.undo')}
          </Button>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('draft.editor.noDocuments')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((row) => (
            <DocumentRowItem
              key={row.id}
              row={row}
              language={language}
              selected={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
              onDeleted={(bundle) => setUndo(bundle)}
              onDuplicated={() => setNotice('')}
            />
          ))}
        </ul>
      )}

      <div>
        <Button asChild variant="outline">
          <Link to="/draft">{t('draft.editor.newDocument')}</Link>
        </Button>
      </div>
    </div>
  )
}

function DocumentRowItem({
  row,
  language,
  selected,
  onToggle,
  onDeleted,
  onDuplicated,
}: {
  row: DocumentRow
  language: 'en' | 'hi'
  selected: boolean
  onToggle: () => void
  onDeleted: (bundle: Awaited<ReturnType<typeof deleteDocument>>) => void
  onDuplicated: () => void
}) {
  const { t } = useT()
  const title = row.title || t('draft.editor.untitled')
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        /* The document's own title, so a screen reader hears which row this
           selects rather than "Select, Select, Select" thirty times. */
        aria-label={`${t('draft.batch.select')}: ${title}`}
        className="size-4 shrink-0"
      />
      <Link
        to={`/draft/d/${row.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
      >
        <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">
            {new Date(row.updatedAt).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN')}
          </span>
        </span>
      </Link>
      <span className="flex items-center gap-2">
        <Badge tone={row.status === 'sent' ? 'success' : row.status === 'final' ? 'info' : 'neutral'}>
          {t(
            `draft.editor.status.${row.status === 'sent' ? 'sent' : row.status === 'final' ? 'final' : 'draft'}`,
          )}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('draft.editor.duplicate')}
          onClick={() => void duplicateDocument(row.id, `${title} (2)`).then(onDuplicated)}
        >
          <Copy aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('draft.editor.delete')}
          onClick={() => void deleteDocument(row.id).then(onDeleted)}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </span>
    </li>
  )
}
