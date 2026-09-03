import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { createPattern, deletePattern, listIssues, listPatterns, savePattern } from './numberingStore'

import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  NUMBER_TOKENS,
  RESET_POLICIES,
  previewNumber,
  validatePattern,
  type NumberPattern,
} from '@/lib/drafting/numbering'

const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

/**
 * The reference-number schemes.
 *
 * The preview under the pattern box is not decoration: it is
 * `previewNumber(pattern, …)`, which is the same `expandNumber` the issue path
 * runs, so what an officer checks before pressing "Issue number" is exactly
 * what the button produces.
 */
export default function NumberingPage() {
  const { t, language } = useT()
  const patterns = useLiveQuery(() => listPatterns(), []) ?? []
  const [draft, setDraft] = useState<NumberPattern | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const year = new Date().getFullYear()

  const value = draft
  const issues = useLiveQuery(() => (value ? listIssues(value.id) : Promise.resolve([])), [value?.id]) ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('draft.numbering.heading')} subtitle={t('draft.numbering.lead')} />

      <div>
        <Button onClick={() => setDraft(createPattern(year))}>
          <Plus aria-hidden="true" className="mr-1 size-4" />
          {t('draft.numbering.add')}
        </Button>
      </div>

      {value ? (
        <SectionCard className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.numbering.name')}</span>
            <input
              className={field}
              value={value.name}
              onChange={(event) => setDraft({ ...value, name: event.target.value })}
            />
          </label>
          {/*
            The hint is a SIBLING of the label and is linked with
            `aria-describedby`. Nested inside the label it becomes part of the
            input's accessible name — "Pattern Tokens: {FILE} {SEQ} {YEAR}…" —
            which reads badly and made the field unfindable by its own name in
            `tests/e2e/draft-editor.spec.ts`'s first browser run.
          */}
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('draft.numbering.pattern')}</span>
              <input
                className={field}
                aria-describedby="numbering-pattern-hint"
                value={value.pattern}
                onChange={(event) => setDraft({ ...value, pattern: event.target.value })}
              />
            </label>
            <span id="numbering-pattern-hint" className="text-xs text-muted-foreground">
              {t('draft.numbering.patternHint', {
                tokens: NUMBER_TOKENS.map((token) => `{${token}}`).join(' '),
              })}
            </span>
          </div>

          <ul className="flex flex-col gap-1 text-sm">
            {validatePattern(value.pattern).map((issue, index) => (
              <li
                key={index}
                className="rounded-lg border border-marigold/40 bg-marigold/15 p-2 text-marigold-foreground"
              >
                {issue.message[language]}
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.numbering.file')}</span>
              <input
                className={field}
                value={value.file}
                onChange={(event) => setDraft({ ...value, file: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.numbering.section')}</span>
              <input
                className={field}
                value={value.section}
                onChange={(event) => setDraft({ ...value, section: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.numbering.resetPolicy')}</span>
              <select
                className={field}
                value={value.resetPolicy}
                onChange={(event) =>
                  setDraft({ ...value, resetPolicy: event.target.value as NumberPattern['resetPolicy'] })
                }
              >
                {RESET_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {t(`draft.numbering.reset.${policy}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.numbering.seqPad')}</span>
              <input
                type="number"
                min={1}
                max={6}
                className={field}
                value={value.seqPad}
                onChange={(event) =>
                  setDraft({ ...value, seqPad: Math.max(1, Number(event.target.value) || 1) })
                }
              />
            </label>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('draft.numbering.preview', {
              number: previewNumber(value, t('draft.picker.heading'), year).number,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {value.lastIssued
              ? t('draft.numbering.lastIssued', {
                  number: value.lastIssued,
                  date: (value.lastIssuedAt ?? '').slice(0, 10),
                })
              : t('draft.numbering.neverIssued')}
          </p>

          <div className="flex gap-2">
            <Button
              onClick={() =>
                void savePattern(value).then(() => {
                  setDraft(null)
                })
              }
            >
              {t('draft.numbering.save')}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('draft.addressBook.cancel')}
            </Button>
          </div>

          {issues.length > 0 ? (
            <section>
              <h3 className="mb-1 text-sm font-semibold">{t('draft.numbering.register')}</h3>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {issues.slice(0, 20).map((issue) => (
                  <li key={issue.id}>
                    {issue.number} — {issue.issuedAt.slice(0, 10)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </SectionCard>
      ) : null}

      <ul className="flex flex-col gap-2">
        {patterns.map((pattern) => (
          <li
            key={pattern.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-sm"
          >
            <span className="min-w-0">
              <span className="block font-medium">{pattern.name || pattern.pattern}</span>
              <span className="block font-mono text-xs text-muted-foreground">{pattern.pattern}</span>
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(pattern)}>
                {t('draft.addressBook.edit')}
              </Button>
              {/*
                Two presses. Deleting a scheme does NOT delete its issued
                numbers — `numberIssues` is the register, and an audit trail
                that a tidy-up can erase is not one. But the scheme itself
                carries the running serial, and one press used to take it with
                no confirmation.
              */}
              {pendingDelete === pattern.id ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void deletePattern(pattern.id).then(() => {
                        setPendingDelete(null)
                      })
                    }
                  >
                    {t('draft.numbering.delete')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                    {t('draft.addressBook.cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('draft.numbering.delete')}
                  onClick={() => setPendingDelete(pattern.id)}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
