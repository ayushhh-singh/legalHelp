import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { diffDocuments, type DocVersion } from '@/lib/drafting/versions'
import type { OfficialDoc } from '@/lib/drafting/model'
import type { Lang } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'

/**
 * The version list, a block-then-word diff, and a non-destructive restore.
 *
 * "Non-destructive" is a claim about what happens, not a reassurance: the live
 * document is snapshotted with reason `restore` BEFORE the version is written
 * over it, so an officer who restores the wrong version can restore back.
 * `restoreVersion` in `documents.ts` is where that ordering lives.
 */
export function VersionsPanel({
  live,
  versions,
  language,
  onSaveVersion,
  onRestore,
  notice,
}: {
  live: OfficialDoc
  versions: readonly DocVersion[]
  language: Lang
  onSaveVersion: (label: string) => void
  onRestore: (id: string) => void
  notice: string
}) {
  const { t } = useT()
  const [label, setLabel] = useState('')
  const [left, setLeft] = useState<string>('')
  const [right, setRight] = useState<string>('current')

  const docFor = (id: string): OfficialDoc | null =>
    id === 'current' ? live : (versions.find((entry) => entry.id === id)?.doc ?? null)

  const diff = useMemo(() => {
    const a = docFor(left)
    const b = docFor(right)
    return a && b ? diffDocuments(a, b, language) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, versions, live, language])

  const field = 'rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.versions.label')}</span>
          <input
            className={cn(field, 'w-full')}
            placeholder={t('draft.versions.labelPlaceholder')}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <Button
          onClick={() => {
            onSaveVersion(label.trim())
            setLabel('')
          }}
        >
          {t('draft.versions.save')}
        </Button>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('draft.versions.none')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {version.label || t(`draft.versions.reason.${version.reason}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(version.at).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN')}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLeft(version.id)}>
                    {t('draft.versions.compare')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onRestore(version.id)}>
                    {t('draft.versions.restore')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.versions.compare')}</span>
              <select className={field} value={left} onChange={(event) => setLeft(event.target.value)}>
                <option value="">—</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label || t(`draft.versions.reason.${version.reason}`)} ·{' '}
                    {new Date(version.at).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN')}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.versions.compareWith')}</span>
              <select className={field} value={right} onChange={(event) => setRight(event.target.value)}>
                <option value="current">{t('draft.versions.current')}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label || t(`draft.versions.reason.${version.reason}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {diff ? <DiffView diff={diff} /> : null}
        </>
      )}
    </div>
  )
}

function DiffView({ diff }: { diff: ReturnType<typeof diffDocuments> }) {
  const { t } = useT()
  if (!diff.changed) return <p className="text-sm text-muted-foreground">{t('draft.versions.noChange')}</p>

  return (
    <div className="flex flex-col gap-3">
      {diff.meta.length > 0 ? (
        <section>
          <h4 className="mb-1 text-sm font-semibold">{t('draft.versions.metaChanged')}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {diff.meta.map((entry) => (
              <li key={entry.field}>
                <span className="font-medium">{entry.field}: </span>
                <del className="text-destructive">{entry.before || '—'}</del>{' '}
                <ins className="text-tulsi no-underline">{entry.after || '—'}</ins>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="flex flex-col gap-1 text-sm">
        {diff.blocks.map((block) => {
          if (block.kind === 'unchanged') {
            return (
              <li key={block.index} className="text-muted-foreground">
                {block.text}
              </li>
            )
          }
          if (block.kind === 'added') {
            return (
              <li key={block.index} className="rounded bg-tulsi/15 px-2 py-1 text-tulsi-foreground">
                <span className="sr-only">{t('draft.versions.added')}: </span>
                {block.text}
              </li>
            )
          }
          if (block.kind === 'removed') {
            return (
              <li key={block.index} className="rounded bg-destructive/10 px-2 py-1 line-through">
                <span className="sr-only">{t('draft.versions.removed')}: </span>
                {block.text}
              </li>
            )
          }
          return (
            <li key={block.index} className="rounded border border-border px-2 py-1">
              <span className="sr-only">{t('draft.versions.changed')}: </span>
              {block.words === null ? (
                <span className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('draft.versions.tooLongToDiff')}</span>
                  <del className="text-destructive">{block.before}</del>
                  <ins className="text-tulsi no-underline">{block.after}</ins>
                </span>
              ) : (
                block.words.map((part, index) => (
                  <span
                    key={index}
                    className={cn(
                      part.op === 'insert' && 'bg-tulsi/20 text-tulsi-foreground',
                      part.op === 'delete' && 'bg-destructive/10 line-through',
                    )}
                  >
                    {part.tokens.join(' ')}{' '}
                  </span>
                ))
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
