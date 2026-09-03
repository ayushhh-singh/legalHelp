import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ClipboardCopy, Download, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { getLetterhead } from '../letterheadStore'
import {
  buildDocxOptions,
  defaultExportSettings,
  docxLetterhead,
  documentsFor,
  letterheadWarning,
  nameFor,
  saveBlob,
  type ExportSettings,
} from '../exportDoc'

import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { serialise, serialiseBilingual } from '@/lib/drafting/engine'
import { placeholderFields, type BodyDoc, type OfficialDoc } from '@/lib/drafting/model'
import { defaultPageSetup, isPageSize, PAGE_SIZES } from '@/lib/drafting/print'
import type { BilingualRenderResult, ChecklistResult, RenderResult } from '@/lib/drafting/types'

/**
 * Export, for the document editor.
 *
 * ### The gate, unchanged from Session 8
 *
 * A failing **required** checklist item blocks the export. That is the one
 * piece of this module that says no to an officer, and it is deliberate: the
 * items in that class are the ones that make a document the wrong document — an
 * Office Memorandum written in the first person, or a `{{signatoryName}}` still
 * sitting in the signature block. A failing **recommended** item does not
 * block; it asks once, and the second press goes through.
 *
 * "Copy as text" is outside the gate, always. An app that holds an officer's
 * own words hostage to its own checklist is not what a checklist is for.
 *
 * ### An unfilled placeholder is not just refused, it is FOUND
 *
 * `{{fileNumber}}` in the middle of page two blocks the export, and an officer
 * told only "a required item is failing" has to read their own document
 * looking for it. Every unfilled placeholder is listed by name with a control
 * that takes them to the text, which is the difference between a gate and an
 * obstacle.
 */
export function DocExportPanel({
  doc,
  single,
  bilingual,
  checklist,
  lintBlocked,
  fallbackName,
  onGoToText,
  onOpenChecklist,
}: {
  doc: OfficialDoc
  single: RenderResult | null
  bilingual: BilingualRenderResult | null
  checklist: readonly ChecklistResult[]
  lintBlocked: boolean
  fallbackName: string
  onGoToText: () => void
  onOpenChecklist: () => void
}) {
  const { t, language } = useT()
  const [settings, setSettings] = useState<ExportSettings>(() => defaultExportSettings())
  const [view, setView] = useState<'en' | 'hi' | 'both'>(doc.lang === 'bilingual' ? 'both' : language)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [override, setOverride] = useState(false)

  const letterheadRow = useLiveQuery(() => getLetterhead(), [])

  const failing = checklist.filter((item) => !item.passed)
  const must = failing.filter((item) => item.severity === 'must').length
  const should = failing.length - must
  const blocked = must > 0 || lintBlocked
  const needsOverride = !blocked && should > 0 && !override

  const placeholders = useMemo(() => {
    const body: BodyDoc = doc.bodyHi ? doc.bodyHi : doc.body
    return [...new Set([...placeholderFields(doc.body), ...placeholderFields(body)])]
  }, [doc])

  const documents = documentsFor(
    view,
    single?.document ?? null,
    bilingual ? { en: bilingual.en.document, hi: bilingual.hi.document } : null,
  )

  const download = async () => {
    if (documents.length === 0) return
    setBusy(true)
    setMessage('')
    try {
      const { strippedCharacters, toDocxBlob, DEVANAGARI_STACK } = await import('@/lib/drafting/docx')
      const letterhead = await docxLetterhead(settings.letterhead ? (letterheadRow ?? null) : null)
      const blob = await toDocxBlob(
        documents,
        buildDocxOptions({
          doc,
          lang: view === 'both' ? 'en' : view,
          settings,
          letterhead,
          labels: {
            pageOf: t('draft.print.pageOf'),
            columnEn: t('draft.preview.columnEn'),
            columnHi: t('draft.preview.columnHi'),
          },
        }),
      )
      saveBlob(blob, nameFor(doc, fallbackName, view === 'both' ? 'EN-HI' : view.toUpperCase(), new Set()))
      const stripped = strippedCharacters(documents)
      const removed = stripped.bidi + stripped.pictographs
      setMessage(
        removed > 0
          ? t('draft.export.stripped', { count: removed })
          : t('draft.export.fontNote', {
              font: DEVANAGARI_STACK[0],
              alternatives: DEVANAGARI_STACK.slice(1).join(', '),
            }),
      )
    } catch {
      setMessage(t('draft.export.failed'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    /*
      Which language is copied comes from `documents`, not from `single`.
      `single` is rendered in the APP language, so copying with the Hindi view
      selected used to put the English text on the clipboard — the same defect
      as the download, one function along.
    */
    const text =
      view === 'both' && bilingual
        ? serialiseBilingual(bilingual)
        : documents[0]
          ? serialise(documents[0])
          : ''
    try {
      await navigator.clipboard.writeText(text)
      setMessage(t('draft.export.copied'))
    } catch {
      setMessage(t('draft.export.copyFailed'))
    }
  }

  return (
    <div data-print-hide className="flex flex-col gap-4">
      {blocked ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-coral/30 bg-coral/15 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-coral-foreground">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {t('draft.export.blockedTitle')}
          </p>
          <p className="text-sm text-coral-foreground">{t('draft.export.blockedBody')}</p>
          {/*
            The card SAYS "open the checklist to see which", so there has to be
            something here that opens it. The first version of this panel said
            the sentence and offered no control — a refusal an officer cannot
            act on, which is the failure family this project keeps finding: a
            surface that promises something and cannot deliver it. The browser
            run is what caught it, because the export button was simply disabled
            with nowhere to go.
          */}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onOpenChecklist}>
              {t('draft.export.openChecklist')}
            </Button>
          </div>
        </div>
      ) : null}

      {placeholders.length > 0 ? (
        <SectionCard className="p-4">
          <h3 className="text-sm font-semibold">
            {t('draft.review.placeholders', { count: placeholders.length })}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {placeholders.map((field) => (
              <li key={field}>
                <code className="rounded bg-muted px-2 py-1 text-xs">{`{{${field}}}`}</code>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onGoToText}>
              {t('draft.review.goToText')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {needsOverride ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-[3px] border-marigold bg-marigold/15 px-3 py-2"
        >
          <p className="text-sm text-marigold-foreground">{t('draft.export.anywayHint')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOverride(true)}>
            {t('draft.export.anyway')}
          </Button>
        </div>
      ) : null}

      {letterheadWarning(letterheadRow, settings.letterhead) === 'svg' ? (
        <p
          role="status"
          className="rounded-lg border-l-[3px] border-marigold bg-marigold/15 p-3 text-sm text-marigold-foreground"
        >
          {t('draft.letterhead.svgNote')}
        </p>
      ) : null}

      <SectionCard className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">{t('draft.export.options')}</h3>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.export.language')}</span>
            <select
              value={view}
              onChange={(event) => setView(event.target.value as 'en' | 'hi' | 'both')}
              className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="en">{t('draft.preview.columnEn')}</option>
              <option value="hi">{t('draft.preview.columnHi')}</option>
              <option value="both">{t('draft.print.viewBoth')}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.export.pageSize')}</span>
            <select
              value={settings.page.size}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  page: defaultPageSetup(isPageSize(event.target.value) ? event.target.value : 'A4'),
                }))
              }
              className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
            >
              {PAGE_SIZES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(entry === 'A4' ? 'draft.print.a4' : 'draft.print.letter')}
                </option>
              ))}
            </select>
          </label>

          {view === 'both' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.export.bilingualMode')}</span>
              <select
                value={settings.bilingual}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    bilingual: event.target.value === 'sideBySide' ? 'sideBySide' : 'sequential',
                  }))
                }
                className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="sequential">{t('draft.export.sequential')}</option>
                <option value="sideBySide">{t('draft.export.sideBySide')}</option>
              </select>
            </label>
          ) : null}
        </div>

        <Toggle
          checked={settings.wordNumbering}
          onChange={(next) => setSettings((current) => ({ ...current, wordNumbering: next }))}
          label={t('draft.export.wordNumbering')}
          hint={t('draft.export.wordNumberingHint')}
        />
        <Toggle
          checked={settings.letterhead}
          onChange={(next) => setSettings((current) => ({ ...current, letterhead: next }))}
          label={t('draft.export.includeLetterhead')}
        />
        <Toggle
          checked={settings.pageNumbers}
          onChange={(next) => setSettings((current) => ({ ...current, pageNumbers: next }))}
          label={t('draft.export.pageNumbers')}
        />
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void download()}
          disabled={busy || blocked || needsOverride || documents.length === 0}
        >
          <Download aria-hidden="true" className="mr-1 size-4" />
          {busy ? t('draft.export.building') : t('draft.export.docx')}
        </Button>

        <Button asChild variant="outline">
          <Link to={`/draft/d/${doc.id}/print`}>
            <Printer aria-hidden="true" className="mr-1 size-4" />
            {t('draft.export.printRoute')}
          </Link>
        </Button>

        <Button type="button" variant="outline" onClick={() => void copy()}>
          <ClipboardCopy aria-hidden="true" className="mr-1 size-4" />
          {t('draft.export.copy')}
        </Button>
      </div>

      <p aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="font-medium">{label}</span>
      </label>
      {hint ? <p className="pl-6 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
