import { Plus, Trash2 } from 'lucide-react'
import { cloneElement, isValidElement, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { isoDateValue } from '@/lib/drafting/format'
import {
  URGENCIES,
  type Addressee,
  type DocMeta,
  type OfficialDoc,
  type VarValue,
} from '@/lib/drafting/model'
import type { AddressBookEntry } from '@/lib/drafting/profile'
import { addresseeFromEntry } from '@/lib/drafting/profile'
import type { TemplateVariable } from '@/modules/drafting/schema'

/**
 * The document's chrome: the number, the date, the subject, who it goes to,
 * what is enclosed, the references and the signature block.
 *
 * Everything the template's LAYOUT interpolates is here, and everything its
 * `bodySkeleton` interpolates is in the "this form's own fields" section at the
 * foot. That is the `meta` / `vars` split ADR-041 §4 describes, on screen.
 */

const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

/**
 * A labelled control with an optional hint.
 *
 * The hint sits OUTSIDE the `<label>` and is linked with `aria-describedby`,
 * not nested inside it. A hint inside the label becomes part of the control's
 * accessible name — "Pattern Tokens: {FILE} {SEQ} {YEAR}…" — which reads
 * badly to a screen reader and, as the first browser run of
 * `tests/e2e/draft-editor.spec.ts` found, makes the field unfindable by its own
 * name. A name says what the control is; a description says what to put in it.
 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const hintId = useId()
  // `cloneElement` rather than a render prop, so all sixteen call sites stay
  // ordinary JSX. The control is always a single element here — an input, a
  // textarea or a select — and there is one place that has to know it.
  const control =
    hint && isValidElement(children)
      ? cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': hintId,
        })
      : children
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        {control}
      </label>
      {hint ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

function AddresseeList({
  title,
  people,
  book,
  onChange,
  onSaveToBook,
}: {
  title: string
  people: Addressee[]
  book: readonly AddressBookEntry[]
  onChange: (next: Addressee[]) => void
  onSaveToBook: (person: Addressee) => void
}) {
  const { t } = useT()
  const [picking, setPicking] = useState(false)

  const set = (index: number, patch: Partial<Addressee>) =>
    onChange(people.map((person, position) => (position === index ? { ...person, ...patch } : person)))

  return (
    <fieldset className="rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="flex flex-col gap-3">
        {people.map((person, index) => (
          <div key={person.id} className="grid gap-2 rounded-lg border border-border/70 p-2 sm:grid-cols-2">
            <Row label={t('draft.addressBook.name')}>
              <input
                className={field}
                value={person.name.en}
                onChange={(event) => set(index, { name: { ...person.name, en: event.target.value } })}
              />
            </Row>
            <Row label={`${t('draft.addressBook.name')} (हिंदी)`}>
              <input
                lang="hi"
                className={field}
                value={person.name.hi}
                onChange={(event) => set(index, { name: { ...person.name, hi: event.target.value } })}
              />
            </Row>
            <Row label={t('draft.addressBook.designation')}>
              <input
                className={field}
                value={person.designation.en}
                onChange={(event) =>
                  set(index, { designation: { ...person.designation, en: event.target.value } })
                }
              />
            </Row>
            <Row label={t('draft.addressBook.organisation')}>
              <input
                className={field}
                value={person.organisation.en}
                onChange={(event) =>
                  set(index, { organisation: { ...person.organisation, en: event.target.value } })
                }
              />
            </Row>
            <Row label={t('draft.addressBook.address')}>
              <textarea
                rows={2}
                className={field}
                value={person.address.join('\n')}
                onChange={(event) => set(index, { address: event.target.value.split('\n') })}
              />
            </Row>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onSaveToBook(person)}>
                {t('draft.meta.saveToBook')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('draft.meta.remove')}
                onClick={() => onChange(people.filter((_, position) => position !== index))}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...people,
                {
                  id: `p-${people.length + 1}-${Date.now().toString(36)}`,
                  bookId: null,
                  name: { en: '', hi: '' },
                  designation: { en: '', hi: '' },
                  organisation: { en: '', hi: '' },
                  address: [],
                  phone: '',
                  email: '',
                },
              ])
            }
          >
            <Plus aria-hidden="true" className="mr-1 size-4" />
            {t('draft.meta.addAddressee')}
          </Button>
          {book.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPicking((open) => !open)}
              aria-expanded={picking}
            >
              {t('draft.meta.fromBook')}
            </Button>
          ) : null}
        </div>

        {picking ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-border p-2">
            {book.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange([...people, addresseeFromEntry(entry, `p-${Date.now().toString(36)}`)])
                    setPicking(false)
                  }}
                >
                  {entry.name.en || entry.name.hi}
                  {entry.designation.en ? ` — ${entry.designation.en}` : ''}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </fieldset>
  )
}

export function MetaPanel({
  doc,
  variables,
  book,
  numberControl,
  onChange,
  onSaveToBook,
  onFillFromProfile,
}: {
  doc: OfficialDoc
  variables: readonly TemplateVariable[]
  book: readonly AddressBookEntry[]
  /** The "Issue number" control, rendered by the page which owns the patterns. */
  numberControl?: React.ReactNode
  onChange: (next: OfficialDoc) => void
  onSaveToBook: (person: Addressee) => void
  /** Re-take the profile snapshot for THIS document, on request. */
  onFillFromProfile: () => void
}) {
  const { t, language } = useT()
  const meta = doc.meta
  const setMeta = (patch: Partial<DocMeta>) => onChange({ ...doc, meta: { ...meta, ...patch } })
  const setVar = (key: string, value: VarValue) => onChange({ ...doc, vars: { ...doc.vars, [key]: value } })

  const varText = (key: string): string => {
    const value = doc.vars[key]
    if (value === undefined) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.join('\n')
    return value[language] || value.en || value.hi
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('draft.meta.heading')}</h2>
        {/*
          The explicit half of "a profile change never rewrites a document".
          The snapshot rule (ADR-041 §5) is right — February's minutes must not
          be re-signed with March's designation — but an officer who has just
          corrected a typo in their own designation needs SOME way to bring it
          into the document in front of them. This is it, and it is a button
          rather than an automatic sync for exactly that reason.
        */}
        <Button variant="outline" size="sm" onClick={onFillFromProfile}>
          {t('draft.meta.fillFromProfile')}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label={t('draft.meta.number')}>
          <input
            className={field}
            value={meta.number}
            onChange={(event) => setMeta({ number: event.target.value })}
          />
        </Row>
        <div className="flex items-end">{numberControl}</div>
        <Row label={t('draft.meta.date')}>
          <input
            type="date"
            className={field}
            value={isoDateValue(meta.date)}
            onChange={(event) => setMeta({ date: event.target.value })}
          />
        </Row>
        <Row label={t('draft.meta.place')}>
          <input
            className={field}
            value={meta.place}
            onChange={(event) => setMeta({ place: event.target.value })}
          />
        </Row>
        <Row label={t('draft.meta.subject')}>
          <input
            className={field}
            value={meta.subject.en}
            onChange={(event) => setMeta({ subject: { ...meta.subject, en: event.target.value } })}
          />
        </Row>
        <Row label={t('draft.meta.subjectHi')}>
          <input
            lang="hi"
            className={field}
            value={meta.subject.hi}
            onChange={(event) => setMeta({ subject: { ...meta.subject, hi: event.target.value } })}
          />
        </Row>
        <Row label={t('draft.meta.urgency')}>
          <select
            className={field}
            value={meta.urgency}
            onChange={(event) => setMeta({ urgency: event.target.value as DocMeta['urgency'] })}
          >
            {URGENCIES.map((value) => (
              <option key={value} value={value}>
                {value === 'none' ? '—' : value}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('draft.editor.status.label')}>
          <select
            className={field}
            value={doc.status}
            onChange={(event) => onChange({ ...doc, status: event.target.value as OfficialDoc['status'] })}
          >
            <option value="draft">{t('draft.editor.status.draft')}</option>
            <option value="final">{t('draft.editor.status.final')}</option>
            <option value="sent">{t('draft.editor.status.sent')}</option>
          </select>
        </Row>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={meta.futureDateIntended}
          onChange={(event) => setMeta({ futureDateIntended: event.target.checked })}
        />
        {t('draft.meta.dateFutureIntended')}
      </label>

      <AddresseeList
        title={t('draft.meta.to')}
        people={meta.to}
        book={book}
        onChange={(to) => setMeta({ to })}
        onSaveToBook={onSaveToBook}
      />
      <AddresseeList
        title={t('draft.meta.copyTo')}
        people={meta.copyTo}
        book={book}
        onChange={(copyTo) => setMeta({ copyTo })}
        onSaveToBook={onSaveToBook}
      />

      <Row label={t('draft.meta.tags')}>
        <input
          className={field}
          value={doc.tags.join(', ')}
          onChange={(event) =>
            onChange({
              ...doc,
              tags: event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </Row>

      <Row label={t('draft.meta.enclosures')} hint={t('draft.meta.enclosuresHint')}>
        <textarea
          rows={3}
          className={field}
          value={meta.enclosures.join('\n')}
          onChange={(event) => setMeta({ enclosures: event.target.value.split('\n') })}
        />
      </Row>

      <fieldset className="rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-semibold">{t('draft.meta.references')}</legend>
        <p className="mb-2 text-xs text-muted-foreground">{t('draft.meta.referencesHint')}</p>
        <div className="flex flex-col gap-2">
          {meta.referenceLines.map((line, index) => (
            <div key={line.id} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <input
                className={field}
                aria-label={t('draft.meta.refNumber')}
                placeholder={t('draft.meta.refNumber')}
                value={line.number}
                onChange={(event) =>
                  setMeta({
                    referenceLines: meta.referenceLines.map((entry, position) =>
                      position === index ? { ...entry, number: event.target.value } : entry,
                    ),
                  })
                }
              />
              <input
                type="date"
                className={field}
                aria-label={t('draft.meta.refDate')}
                value={isoDateValue(line.date)}
                onChange={(event) =>
                  setMeta({
                    referenceLines: meta.referenceLines.map((entry, position) =>
                      position === index ? { ...entry, date: event.target.value } : entry,
                    ),
                  })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('draft.meta.remove')}
                onClick={() =>
                  setMeta({ referenceLines: meta.referenceLines.filter((_, position) => position !== index) })
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setMeta({
                  referenceLines: [
                    ...meta.referenceLines,
                    {
                      id: `ref-${meta.referenceLines.length + 1}-${Date.now().toString(36)}`,
                      number: '',
                      date: '',
                    },
                  ],
                })
              }
            >
              <Plus aria-hidden="true" className="mr-1 size-4" />
              {t('draft.meta.addReference')}
            </Button>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-semibold">{t('draft.meta.signature')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label={t('draft.meta.signatureName')}>
            <input
              className={field}
              value={meta.signature.name.en}
              onChange={(event) =>
                setMeta({
                  signature: { ...meta.signature, name: { ...meta.signature.name, en: event.target.value } },
                })
              }
            />
          </Row>
          <Row label={t('draft.meta.signatureDesignation')}>
            <input
              className={field}
              value={meta.signature.designation.en}
              onChange={(event) =>
                setMeta({
                  signature: {
                    ...meta.signature,
                    designation: { ...meta.signature.designation, en: event.target.value },
                  },
                })
              }
            />
          </Row>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={meta.signature.showSd}
            onChange={(event) => setMeta({ signature: { ...meta.signature, showSd: event.target.checked } })}
          />
          {t('draft.meta.signatureSd')}
        </label>
        <Row label={t('draft.meta.signatureLayout')}>
          <select
            className={field}
            value={meta.signature.layout}
            onChange={(event) =>
              setMeta({
                signature: {
                  ...meta.signature,
                  layout: event.target.value as DocMeta['signature']['layout'],
                },
              })
            }
          >
            <option value="right">right</option>
            <option value="left">left</option>
            <option value="centre">centre</option>
          </select>
        </Row>
      </fieldset>

      {variables.length > 0 ? (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t('draft.meta.variables')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {variables.map((variable) => (
              <Row
                key={variable.key}
                label={variable.label[language]}
                hint={variable.hint?.[language] ?? variable.patternHint?.[language]}
              >
                {variable.type === 'select' ? (
                  <select
                    className={field}
                    value={varText(variable.key)}
                    onChange={(event) => setVar(variable.key, event.target.value)}
                  >
                    <option value="">—</option>
                    {(variable.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label[language]}
                      </option>
                    ))}
                  </select>
                ) : variable.type === 'textarea' ||
                  variable.type === 'enclosures' ||
                  variable.type === 'copyTo' ? (
                  <textarea
                    rows={3}
                    className={field}
                    value={varText(variable.key)}
                    onChange={(event) =>
                      setVar(
                        variable.key,
                        variable.type === 'textarea' ? event.target.value : event.target.value.split('\n'),
                      )
                    }
                  />
                ) : (
                  <input
                    type={variable.type === 'date' ? 'date' : variable.type === 'number' ? 'number' : 'text'}
                    className={field}
                    value={varText(variable.key)}
                    onChange={(event) => setVar(variable.key, event.target.value)}
                    {...(variable.pattern ? { pattern: variable.pattern } : {})}
                  />
                )}
              </Row>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}
