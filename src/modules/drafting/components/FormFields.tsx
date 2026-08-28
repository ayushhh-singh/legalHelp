import { Languages, Link2 } from 'lucide-react'

import { controlId } from '../fieldIds'
import { asText, fromText, isSplit, mergeField, readValue, setValue, splitField } from '../values'

import { useT } from '@/i18n/useT'
import type { DraftValues, Lang } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'
import type { TemplateField } from '../schema'

/**
 * One field of the guided form.
 *
 * Every control here is a real `<label>` bound by id, a 44px target, a visible
 * `--ring` focus state, and an inline error tied to the input with
 * `aria-describedby` — which is what makes "inline validation" a thing a
 * screen reader hears rather than a red border a sighted user infers.
 *
 * The one idea that is not standard form work is the **link control**. A
 * bilingual document has two issues, and most of what goes in them is the same
 * string twice: a file number, a telephone number, an e-mail address, a name.
 * So a field holds one shared value until the officer presses "Write Hindi
 * separately", at which point it becomes an `{ en, hi }` pair and gets two
 * boxes. See `src/modules/drafting/values.ts` for why that shape is the right
 * one for the engine, and note what it buys: nobody has to type
 * `011-2309 2590` twice to satisfy equal bilingual footing.
 *
 * Dates and selects never get the control. A date is normalised by the engine
 * and rendered per language; a select's options already carry both labels.
 */

const LINKABLE = new Set(['text', 'textarea', 'paras', 'list'])

export interface FieldProps {
  field: TemplateField
  values: DraftValues
  /** Which language the officer is typing in. */
  lang: Lang
  /** The engine's message for this field, in `lang`, if it has one. */
  issue?: string
  onChange: (next: DraftValues) => void
}

export function FieldRow({ field, values, lang, issue, onChange }: FieldProps) {
  const { t, language } = useT()
  const id = controlId(field.id)
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const split = isSplit(values[field.id])
  const canLink = LINKABLE.has(field.type)

  const describedBy = [field.hint ? hintId : null, issue ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label className="text-sm font-medium" htmlFor={split ? controlId(field.id, 'en') : id}>
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

        {canLink ? (
          <button
            type="button"
            /*
              The accessible name says WHICH field. Fifteen buttons all called
              "Write Hindi separately" leave a screen-reader user counting rows
              to know which one is in focus — the same defect the recent-drafts
              list had, and the same fix.
            */
            aria-label={`${split ? t('draft.editor.mergeLanguages') : t('draft.editor.splitLanguages')} — ${field.label[language]}`}
            onClick={() => onChange(split ? mergeField(values, field, lang) : splitField(values, field))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {split ? (
              <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Languages aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {split ? t('draft.editor.mergeLanguages') : t('draft.editor.splitLanguages')}
          </button>
        ) : null}
      </div>

      {split ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {(['en', 'hi'] as const).map((side) => (
            <div key={side} className="min-w-0">
              <label
                htmlFor={controlId(field.id, side)}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t(`draft.preview.view.${side}`)}
              </label>
              <Control
                id={controlId(field.id, side)}
                field={field}
                value={asText(readValue(values, field, side))}
                describedBy={describedBy}
                invalid={Boolean(issue)}
                onChange={(text) => onChange(setValue(values, field, side, fromText(text, field)))}
              />
            </div>
          ))}
        </div>
      ) : (
        <Control
          id={id}
          field={field}
          value={asText(readValue(values, field, lang))}
          describedBy={describedBy}
          invalid={Boolean(issue)}
          onChange={(text) => onChange(setValue(values, field, lang, fromText(text, field)))}
        />
      )}

      {field.hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {field.hint[language]}
        </p>
      ) : null}

      {/*
        The message carries its own icon-free wording and `--destructive` as
        TEXT, which is the one accent this palette allows as a text colour
        because it is defined to clear 4.5:1 on all three surfaces (ADR-010).
      */}
      {issue ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-destructive">
          {issue}
        </p>
      ) : null}

      {canLink && !split && field.type !== 'text' ? (
        <p className="sr-only">{t('draft.editor.splitHint')}</p>
      ) : null}
    </div>
  )
}

const INPUT =
  'w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[invalid=true]:border-destructive'

function Control({
  id,
  field,
  value,
  describedBy,
  invalid,
  onChange,
}: {
  id: string
  field: TemplateField
  value: string
  describedBy: string
  invalid: boolean
  onChange: (text: string) => void
}) {
  const { language } = useT()
  const shared = {
    id,
    value,
    'aria-invalid': invalid,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  }

  if (field.type === 'select') {
    return (
      <select {...shared} onChange={(event) => onChange(event.target.value)} className={cn(INPUT, 'h-11')}>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label[language]}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'date') {
    return (
      <input
        {...shared}
        type="date"
        onChange={(event) => onChange(event.target.value)}
        className={cn(INPUT, 'h-11 tabular-nums')}
      />
    )
  }

  if (field.type === 'textarea' || field.type === 'list') {
    return (
      <textarea
        {...shared}
        rows={field.type === 'list' ? 3 : 2}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INPUT, 'py-2 leading-relaxed')}
      />
    )
  }

  return (
    <input
      {...shared}
      type="text"
      onChange={(event) => onChange(event.target.value)}
      className={cn(INPUT, 'h-11')}
    />
  )
}

/** The language the officer types in, when a field has not been split. */
export function EditingLanguage({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{t('draft.editor.editingIn')}</span>
      <div role="radiogroup" aria-label={t('draft.editor.editingIn')} className="flex gap-1.5">
        {(['en', 'hi'] as const).map((option) => {
          const selected = option === lang
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                selected
                  ? 'border-action bg-action font-semibold text-action-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {t(`draft.preview.view.${option}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
