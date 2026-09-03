import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { deleteAddressee, listAddressees, newAddressee, putAddressee, searchAddressees } from './profileStore'

import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { AddressBookEntry } from '@/lib/drafting/profile'

const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

/**
 * The address book.
 *
 * Deleting an entry does NOT touch the documents that named them — the lead
 * paragraph says so and the confirmation says how many. A document holds a
 * snapshot, and a document already sent has to render tomorrow as it rendered
 * the day it went out (ADR-041 §5).
 */
export default function AddressBookPage() {
  const { t } = useT()
  const rows = useLiveQuery(() => listAddressees(), [])
  const entries = useMemo(() => rows ?? [], [rows])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AddressBookEntry | null>(null)
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [undo, setUndo] = useState<AddressBookEntry | null>(null)

  const shown = useMemo(() => searchAddressees(entries, query), [entries, query])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('draft.addressBook.heading')} subtitle={t('draft.addressBook.lead')} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.addressBook.search')}</span>
          <input
            data-module-search
            className={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button onClick={() => setEditing(newAddressee())}>
          <Plus aria-hidden="true" className="mr-1 size-4" />
          {t('draft.addressBook.add')}
        </Button>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {undo ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{t('draft.editor.deleted', { title: undo.name.en || undo.name.hi })}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void putAddressee(undo).then(() => {
                setUndo(null)
              })
            }
          >
            {t('draft.editor.undo')}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <SectionCard className="flex flex-col gap-3 p-4">
          {(
            [
              ['name', t('draft.addressBook.name')],
              ['designation', t('draft.addressBook.designation')],
              ['organisation', t('draft.addressBook.organisation')],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{label}</span>
                <input
                  className={field}
                  value={editing[key].en}
                  onChange={(event) =>
                    setEditing({ ...editing, [key]: { ...editing[key], en: event.target.value } })
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{label} (हिंदी)</span>
                <input
                  lang="hi"
                  className={field}
                  value={editing[key].hi}
                  onChange={(event) =>
                    setEditing({ ...editing, [key]: { ...editing[key], hi: event.target.value } })
                  }
                />
              </label>
            </div>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.addressBook.address')}</span>
            <textarea
              rows={3}
              className={field}
              value={editing.address.join('\n')}
              onChange={(event) => setEditing({ ...editing, address: event.target.value.split('\n') })}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.addressBook.phone')}</span>
              <input
                className={field}
                value={editing.phone}
                onChange={(event) => setEditing({ ...editing, phone: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.addressBook.email')}</span>
              <input
                type="email"
                className={field}
                value={editing.email}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex flex-col gap-1">
                <span className="font-medium">{t('draft.addressBook.tags')}</span>
                <input
                  className={field}
                  aria-describedby="address-tags-hint"
                  value={editing.tags.join(', ')}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      tags: event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <span id="address-tags-hint" className="text-xs text-muted-foreground">
                {t('draft.addressBook.tagsHint')}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void putAddressee(editing).then(() => {
                  setEditing(null)
                  setNotice(t('draft.addressBook.save'))
                })
              }
            >
              {t('draft.addressBook.save')}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('draft.addressBook.cancel')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {entries.length === 0 ? t('draft.addressBook.none') : t('draft.addressBook.noMatches')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-sm"
            >
              <span className="min-w-0">
                <span className="block font-medium">{entry.name.en || entry.name.hi}</span>
                <span className="block text-xs text-muted-foreground">
                  {[entry.designation.en, entry.organisation.en].filter(Boolean).join(', ')}
                </span>
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(entry)}>
                  {t('draft.addressBook.edit')}
                </Button>
                {/*
                  Deleting asks first, and then hands back an undo.

                  It used to do neither: one press removed the row and the
                  CONFIRMATION string was then shown as a past-tense notice —
                  "Delete Shri X?" after Shri X was already gone. Every other
                  destructive control in this app is undoable (a draft, a
                  document, a Trainer card), and an address book is a list an
                  officer builds over years.
                */}
                {pendingDelete === entry.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs">
                      {t('draft.addressBook.deleteConfirm', { name: entry.name.en || entry.name.hi })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void deleteAddressee(entry.id).then((result) => {
                          setPendingDelete(null)
                          setUndo(result.entry)
                          setNotice(
                            result.referencedBy > 0
                              ? t('draft.addressBook.deleteReferenced', { count: result.referencedBy })
                              : '',
                          )
                        })
                      }
                    >
                      {t('draft.addressBook.delete')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                      {t('draft.addressBook.cancel')}
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('draft.addressBook.delete')}
                    onClick={() => setPendingDelete(entry.id)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
