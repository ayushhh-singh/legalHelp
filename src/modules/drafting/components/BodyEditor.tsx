import { ArrowLeftRight, BookMarked, Paperclip, Quote, Send } from 'lucide-react'
import { useRef, useState } from 'react'

import { GlossarySheet } from './GlossarySheet'
import { PhraseSheet } from './PhraseSheet'
import { controlId } from '../fieldIds'
import { asText, fromText, insertAt, isSplit, mergeField, readValue, setValue, splitField } from '../values'

import { useT } from '@/i18n/useT'
import type { DraftValues, Lang } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'
import { useGlossary } from '@/modules/utils/glossary/useGlossaryData'
import { useGlossarySuggest, type GlossaryMatch } from '@/modules/utils/glossary/useGlossarySuggest'
import type { DocTemplate, TemplateField } from '../schema'

/**
 * The body: one paragraph per line, with the toolbar that puts CSMOP's own
 * wording into it.
 *
 * **Para-per-line is the whole editing model**, and it is the model because
 * `data/drafting/templates/*.json` stores body paragraphs as a list of strings
 * and the engine numbers them (`numberFrom` — unnumbered first paragraph for a
 * letter or an O.M., numbered from 1 for a note and an I.D. note). A rich-text
 * editor here would have to invent a mapping back to that list, and would let
 * an officer produce a paragraph break the numbering could not see.
 *
 * The number in front of each paragraph is therefore **not typed and not
 * editable** — it appears in the preview because the engine put it there. The
 * gutter down the left of the box shows what each line will be numbered, so
 * the connection is visible while typing rather than only after.
 *
 * ### The caret
 *
 * Every insertion goes in at the caret and puts the caret after what it
 * inserted. A toolbar that appends to the end of the document, or that throws
 * the caret to position zero, is a toolbar an officer stops using after the
 * second paragraph — so `insertAt` returns the new caret and this restores it
 * after React has re-rendered.
 */

export function BodyEditor({
  template,
  field,
  values,
  lang,
  issue,
  onChange,
}: {
  template: DocTemplate
  field: TemplateField
  values: DraftValues
  lang: Lang
  issue?: string
  onChange: (next: DraftValues) => void
}) {
  const { t, language } = useT()
  const [sheet, setSheet] = useState<'phrase' | 'glossary' | null>(null)
  const boxes = useRef(new Map<Lang, HTMLTextAreaElement | null>())
  /** Which box an insertion goes into when the field has been split. */
  const [side, setSide] = useState<Lang>(lang)
  const caret = useRef(0)

  const split = isSplit(values[field.id])
  const target: Lang = split ? side : lang
  const text = asText(readValue(values, field, target))
  const paragraphs = text.split('\n').filter((line) => line.trim())

  /**
   * English terms with a known Hindi equivalent, found in whichever box the
   * officer is actually writing Hindi in. Gated on `target === 'hi'`: the
   * glossary is ~700 KB, and loading it for an English-only field would hand
   * every reader a download for a suggestion nobody in that field can use.
   */
  const glossary = useGlossary(target === 'hi')
  const suggestions = useGlossarySuggest(text, glossary.status === 'ready' ? glossary.data : null)

  const errorId = `${controlId(field.id)}-error`
  const hintId = `${controlId(field.id)}-hint`

  /**
   * Put `insert` in at the caret and leave the caret after it.
   *
   * The selection is restored in a microtask, not synchronously: React has not
   * re-rendered the textarea with the new value yet, and setting
   * `selectionStart` on the old value clamps it to the old length — which
   * silently moves the caret to the wrong place for any insertion longer than
   * the text after it.
   */
  const put = (insert: string) => {
    const box = boxes.current.get(target)
    const at = box ? box.selectionStart : caret.current
    const next = insertAt(text, at, insert)
    onChange(setValue(values, field, target, fromText(next.text, field)))
    caret.current = next.caret
    queueMicrotask(() => {
      const settled = boxes.current.get(target)
      if (!settled) return
      settled.focus()
      settled.setSelectionRange(next.caret, next.caret)
    })
  }

  /** Add an empty line to a list field and send the officer to it. */
  const addLineTo = (fieldId: string) => {
    const listField = template.fields.find((candidate) => candidate.id === fieldId)
    if (!listField) return
    const current = asText(readValue(values, listField, target))
    const appended = current.trim() ? `${current.replace(/\n+$/, '')}\n` : ''
    onChange(setValue(values, listField, target, fromText(appended, listField)))
    queueMicrotask(() => {
      const box = document.getElementById(
        isSplit(values[listField.id]) ? controlId(fieldId, target) : controlId(fieldId),
      )
      if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
        box.focus()
        const end = box.value.length
        box.setSelectionRange(end, end)
      }
    })
  }

  /** Swap one found English term for its Hindi equivalent, in place. */
  const replaceSuggestion = (match: GlossaryMatch) => {
    const next = `${text.slice(0, match.start)}${match.term.hi}${text.slice(match.end)}`
    onChange(setValue(values, field, target, fromText(next, field)))
  }

  const urgency = template.fields.find((candidate) => candidate.id === 'urgency')
  const hasEnclosures = template.fields.some((candidate) => candidate.id === 'enclosures')
  const hasCopyTo = template.fields.some((candidate) => candidate.id === 'copyTo')

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label
          className="text-sm font-medium"
          htmlFor={split ? controlId(field.id, 'en') : controlId(field.id)}
        >
          {field.label[language]}
          {field.required ? (
            <>
              {' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({t('draft.editor.required')})
              </span>
            </>
          ) : null}
        </label>
        <button
          type="button"
          aria-label={`${split ? t('draft.editor.mergeLanguages') : t('draft.editor.splitLanguages')} — ${field.label[language]}`}
          onClick={() => onChange(split ? mergeField(values, field, lang) : splitField(values, field))}
          className="inline-flex min-h-11 items-center rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {split ? t('draft.editor.mergeLanguages') : t('draft.editor.splitLanguages')}
        </button>
      </div>

      <div
        role="toolbar"
        aria-label={t('draft.body.toolbar')}
        aria-controls={split ? controlId(field.id, target) : controlId(field.id)}
        className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted p-1.5"
      >
        <ToolButton icon={Quote} label={t('draft.body.insertPhrase')} onClick={() => setSheet('phrase')} />
        <ToolButton
          icon={BookMarked}
          label={t('draft.body.insertTerm')}
          onClick={() => setSheet('glossary')}
        />

        {/*
          The urgency grading is a marker on the DOCUMENT, not a word in the
          body — CSMOP 6.13 puts it at the head, and the template renders it as
          the first block. So this control writes the same `urgency` field the
          form above does rather than inserting text, which is why it is a
          select and not a button.
        */}
        {urgency ? (
          <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{urgency.label[language]}</span>
            <select
              value={asText(readValue(values, urgency, target))}
              onChange={(event) => onChange(setValue(values, urgency, target, event.target.value))}
              className="h-9 rounded-md border border-input bg-card px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {(urgency.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label[language]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {hasEnclosures ? (
          <ToolButton
            icon={Paperclip}
            label={t('draft.body.insertEnclosure')}
            onClick={() => addLineTo('enclosures')}
          />
        ) : null}
        {hasCopyTo ? (
          <ToolButton icon={Send} label={t('draft.body.insertCopyTo')} onClick={() => addLineTo('copyTo')} />
        ) : null}
      </div>

      {split ? (
        <div className="grid gap-2 lg:grid-cols-2">
          {(['en', 'hi'] as const).map((each) => (
            <div key={each} className="min-w-0">
              <label
                htmlFor={controlId(field.id, each)}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t(`draft.preview.view.${each}`)}
              </label>
              <Box
                id={controlId(field.id, each)}
                value={asText(readValue(values, field, each))}
                invalid={Boolean(issue)}
                describedBy={`${hintId}${issue ? ` ${errorId}` : ''}`}
                onFocus={() => setSide(each)}
                onChange={(next) => onChange(setValue(values, field, each, fromText(next, field)))}
                register={(node) => boxes.current.set(each, node)}
              />
            </div>
          ))}
        </div>
      ) : (
        <Box
          id={controlId(field.id)}
          value={text}
          invalid={Boolean(issue)}
          describedBy={`${hintId}${issue ? ` ${errorId}` : ''}`}
          onChange={(next) => onChange(setValue(values, field, lang, fromText(next, field)))}
          register={(node) => boxes.current.set(lang, node)}
        />
      )}

      <p id={hintId} className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{field.hint?.[language] ?? t('draft.body.paraHint')}</span>
        <span className="tabular-nums">{t('draft.body.paraCount', { count: paragraphs.length })}</span>
      </p>

      {issue ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-destructive">
          {issue}
        </p>
      ) : null}

      {target === 'hi' && suggestions.length > 0 ? (
        <div
          role="group"
          aria-label={t('draft.body.glossarySuggestions')}
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          {suggestions.map((match, index) => (
            <button
              key={`${match.start}-${index}`}
              type="button"
              title={t('draft.body.replaceWith', { english: match.matchedText, hindi: match.term.hi })}
              onClick={() => replaceSuggestion(match)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-marigold/40 bg-marigold/15 px-2.5 py-1 text-xs text-marigold-foreground transition-colors hover:bg-marigold/25"
            >
              <ArrowLeftRight aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="line-through decoration-marigold-foreground/50">{match.matchedText}</span>
              <span aria-hidden="true">→</span>
              <span className="font-medium">{match.term.hi}</span>
            </button>
          ))}
        </div>
      ) : null}

      {sheet === 'phrase' ? (
        <PhraseSheet
          templateId={template.id}
          onInsert={(phrase) => {
            put(phrase)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'glossary' ? (
        <GlossarySheet
          onInsert={(term) => {
            put(term)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  )
}

function Box({
  id,
  value,
  invalid,
  describedBy,
  onChange,
  onFocus,
  register,
}: {
  id: string
  value: string
  invalid: boolean
  describedBy: string
  onChange: (next: string) => void
  onFocus?: () => void
  register: (node: HTMLTextAreaElement | null) => void
}) {
  const lines = value.split('\n')

  return (
    <div className="flex min-w-0 overflow-hidden rounded-lg border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
      {/*
        The numbering gutter. It is `aria-hidden` and it is not a list: the
        numbers are a preview of what the ENGINE will print, and a screen
        reader hearing "1 2 3" beside a textarea learns nothing it cannot get
        from the preview, where the numbers are attached to their paragraphs.
      */}
      <div
        aria-hidden="true"
        className="shrink-0 border-r border-border bg-muted px-2 py-2 text-right font-mono text-xs leading-relaxed text-muted-foreground tabular-nums select-none"
      >
        {lines.map((line, index) => (
          <div key={index} className="h-[1.625em]">
            {line.trim() ? index + 1 : '·'}
          </div>
        ))}
      </div>
      <textarea
        id={id}
        ref={register}
        value={value}
        rows={Math.min(Math.max(lines.length + 1, 6), 20)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 resize-y bg-card px-3 py-2 text-sm leading-relaxed focus-visible:outline-none"
      />
    </div>
  )
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Quote
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
