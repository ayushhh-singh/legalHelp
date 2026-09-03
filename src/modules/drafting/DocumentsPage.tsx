import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

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
  onDeleted,
  onDuplicated,
}: {
  row: DocumentRow
  language: 'en' | 'hi'
  onDeleted: (bundle: Awaited<ReturnType<typeof deleteDocument>>) => void
  onDuplicated: () => void
}) {
  const { t } = useT()
  const title = row.title || t('draft.editor.untitled')
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <Link to={`/draft/d/${row.id}`} className="flex min-w-0 items-center gap-2 text-sm hover:underline">
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
