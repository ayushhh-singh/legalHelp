import { ArrowLeft, BookmarkPlus, Eraser, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { A4Preview } from './components/A4Preview'
import { BodyEditor } from './components/BodyEditor'
import { ChecklistButton, ChecklistDrawer } from './components/ChecklistDrawer'
import { EditingLanguage, FieldRow } from './components/FormFields'
import { ExportBar } from './components/ExportBar'
import { draftingAiAvailable } from './ai-seam'
import { clearDefaults, saveDefaults } from './drafts'
import { draftParamsToSearch, parseDraftParams, type Pane, type PreviewView } from './url'
import { useDraft } from './useDraft'
import { useTemplate } from './useDraftingData'
import { asText, blankValues, collapseIdentical, documentFields, readValue } from './values'

import { useAi } from '@/ai/useAi'
import { useAppStore } from '@/app/store'
import { DataVersion } from '@/components/common/DataVersion'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, Chip, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { evaluateChecklist } from '@/lib/drafting/checklist'
import { render, renderDocument, sampleValues } from '@/lib/drafting/engine'
import type { DraftValues } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'
import type { DocTemplate, TemplateField } from './schema'

/**
 * The AI panel is `lazy` and is mounted only when `useAi().enabled`, so a
 * reader with AI off never downloads it. That is the AI layer's standing rule
 * and it is a privacy property rather than a performance one (`docs/AI.md`):
 * the code that could reach the network must not be on a device that has not
 * asked for it. `useAi` itself is safe to import eagerly — it reads
 * `src/ai/flags.ts`, which has no runtime imports at all.
 */
const AiDraftPanel = lazy(() =>
  import('./components/AiDraftPanel').then((module) => ({ default: module.AiDraftPanel })),
)

/**
 * The editor: guided form on the left, live A4 preview on the right.
 *
 * The two halves are the same document twice. Nothing in the preview is
 * computed here — `renderDocument` turns the template plus the officer's values
 * into blocks, and `evaluateChecklist` reads those blocks back. Every rule
 * about the shape of a Central Secretariat document lives in the data or in the
 * engine, which is what lets a fifteenth form be a fifteenth JSON file
 * (ADR-020).
 *
 * Below `lg` the two halves do not fit side by side, so they become two tabs.
 * That state is in the URL along with the preview language and the draft's id:
 * a reload lands on the same screen, and the back button works. What is NOT in
 * the URL is a single character the officer typed — a URL gets pasted into
 * e-mail, and this app's promise is that a draft never leaves the device.
 */
export default function EditorPage() {
  const { t } = useT()
  const { type = '' } = useParams()
  const template = useTemplate(type)

  if (template.status === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('draft.editor.unknownType')} subtitle={t('draft.editor.unknownTypeBody')} />
        <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={template.retry} />
        <div>
          <Button asChild variant="outline">
            <Link to="/draft">{t('draft.editor.backToForms')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (template.status === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-2/3 max-w-md" />
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard className="space-y-3 p-5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-32 w-full" />
          </SectionCard>
          <SectionCard className="space-y-3 p-5">
            <Skeleton className="h-64 w-full" />
          </SectionCard>
        </div>
        <p className="sr-only" aria-live="polite">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return <Editor template={template.data} />
}

function Editor({ template }: { template: DocTemplate }) {
  const { t, language } = useT()
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const [params, setParams] = useSearchParams()

  const parsed = useMemo(() => parseDraftParams(params, language), [params, language])
  const [editing, setEditing] = useState(language)
  const [notice, setNotice] = useState('')

  const write = useCallback(
    (next: Partial<ReturnType<typeof parseDraftParams>>) => {
      setParams(draftParamsToSearch({ ...parsed, ...next }, language), { replace: true })
    },
    [parsed, setParams, language],
  )

  /**
   * `useCallback` with a ref-free body: `useDraft` calls this once, when it has
   * created a row, and a new identity on every render would make its `save`
   * closure churn.
   */
  const onCreated = useCallback(
    (id: string) => {
      const next = new URLSearchParams(window.location.search)
      next.set('d', id)
      setParams(next, { replace: true })
    },
    [setParams],
  )

  const ai = useAi()
  /* Two conditions, read in one place: ADR-021 point 2, ADR-032. */
  const aiAvailable = draftingAiAvailable(ai.enabled)
  /**
   * The field an officer pressed "Improve wording" on. It is state here rather
   * than in the panel because the button is on the FORM: the panel does the
   * asking and shows the diff, and this is the one value that has to cross
   * between them.
   */
  const [improveField, setImproveField] = useState<TemplateField | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  const draft = useDraft({ template, draftId: parsed.draftId, lang: editing, onCreated })
  /*
    Memoised so that the empty-object fallback is a STABLE reference. Written
    inline it is a new `{}` on every render, which makes every `useMemo` below
    it re-render the whole document — the preview, both languages, and the
    checklist — on any state change at all, including a keystroke in a field
    that is still loading.
  */
  const values: DraftValues = useMemo(() => draft.values ?? {}, [draft.values])

  /**
   * Rendered twice, always — the preview may be showing one language but the
   * checklist and the export need whichever the officer is looking at, and the
   * bilingual view needs both. `render` is pure and cheap over a form's worth
   * of fields; memoising on the values is enough.
   */
  const bilingual = useMemo(
    () => render(template, values, 'bilingual', { devanagariDigits }),
    [template, values, devanagariDigits],
  )
  const single = useMemo(
    () =>
      parsed.view === 'both' ? null : renderDocument(template, values, parsed.view, { devanagariDigits }),
    [template, values, parsed.view, devanagariDigits],
  )

  /**
   * The checklist runs against ONE rendering, and it is the one on screen —
   * or, in the side-by-side view, the officer's own language. A checklist that
   * silently mixed the two would report an English body as failing the
   * third-person rule because the Hindi one does.
   */
  const checklistResult = parsed.view === 'both' ? bilingual[language] : (single ?? bilingual[language])
  const checklist = useMemo(() => evaluateChecklist(template, checklistResult), [template, checklistResult])

  const issues = new Map(
    checklistResult.issues
      .filter((issue) => issue.field)
      .map((issue) => [issue.field, issue.message[language]]),
  )

  const bodyField = template.fields.find((field) => field.type === 'paras')
  const formFields = template.fields.filter((field) => field !== bodyField && field.id !== 'urgency')
  const urgencyField = template.fields.find((field) => field.id === 'urgency')

  const fileNumberField = template.fields.find((field) => field.id === 'fileNumber')
  const fileNumber = fileNumberField ? asText(readValue(values, fileNumberField, language)) : ''

  const loading = draft.values === null

  return (
    <div className="flex flex-col gap-4">
      <div data-print-hide className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link to="/draft">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t('draft.editor.backToForms')}
          </Link>
        </Button>

        <PageHeader
          title={template.name[language]}
          subtitle={template.whenToUse[language]}
          actions={<ChecklistButton results={checklist} onOpen={() => write({ checklistOpen: true })} />}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="neutral">{t(`draft.picker.person.${template.person}`)}</Chip>
          <Chip tone="neutral" className="tabular-nums">
            {t('draft.picker.csmop', { paras: template.csmopRef.paras.join(', ') })}
          </Chip>
          {/*
            Seven of the fourteen forms are documents CSMOP prescribes no format
            for. Saying so, with the form whose format it borrows, is the whole
            difference between "the manual says this" and "this is how it is
            done" (ADR-020) — and it belongs on screen, not only in the data.
          */}
          {template.verify ? (
            <Badge tone="warning">
              {template.csmopRef.chassis
                ? t('draft.picker.notInManualHint', { chassis: template.csmopRef.chassis })
                : t('draft.picker.notInManual')}
            </Badge>
          ) : null}
        </div>

        <PrivacyBanner />

        {template.csmopRef.note ? (
          <p className="text-sm text-muted-foreground">{template.csmopRef.note[language]}</p>
        ) : null}
      </div>

      {/* Two tabs below lg, two columns from lg up. */}
      <div data-print-hide className="lg:hidden">
        <PaneTabs value={parsed.pane} onChange={(pane) => write({ pane })} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section
          aria-label={t('draft.editor.formHeading')}
          data-print-hide
          className={cn('flex min-w-0 flex-col gap-4', parsed.pane === 'preview' && 'hidden lg:flex')}
        >
          {aiAvailable ? (
            <Suspense fallback={null}>
              <AiDraftPanel
                /*
                  Remounts when the officer opens a different draft, which is
                  what makes the panel's acknowledgement per DOCUMENT: the gate,
                  and any suggestion still on screen, belong to the draft they
                  were asked about.
                */
                key={parsed.draftId ?? 'new'}
                template={template}
                values={values}
                lang={parsed.view === 'both' ? 'bilingual' : parsed.view}
                editing={editing}
                devanagariDigits={devanagariDigits}
                ai={ai}
                checklist={checklist}
                onApplyValues={draft.setValues}
                open={aiOpen}
                onOpenChange={setAiOpen}
                improveField={improveField}
                onImproveHandled={() => setImproveField(null)}
              />
            </Suspense>
          ) : null}

          <SectionCard active className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <EditingLanguage lang={editing} onChange={setEditing} />
              <SaveIndicator state={draft.saveState} />
            </div>

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <>
                {urgencyField ? (
                  <FieldRow
                    field={urgencyField}
                    values={values}
                    lang={editing}
                    issue={issues.get(urgencyField.id)}
                    onChange={draft.setValues}
                  />
                ) : null}

                {bodyField ? (
                  <BodyEditor
                    template={template}
                    field={bodyField}
                    values={values}
                    lang={editing}
                    issue={issues.get(bodyField.id)}
                    onChange={draft.setValues}
                    {...(aiAvailable
                      ? {
                          onImprove: () => {
                            setImproveField(bodyField)
                            setAiOpen(true)
                          },
                        }
                      : {})}
                  />
                ) : null}

                {formFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    values={values}
                    lang={editing}
                    issue={issues.get(field.id)}
                    onChange={draft.setValues}
                    {...(aiAvailable
                      ? {
                          onImprove: () => {
                            setImproveField(field)
                            setAiOpen(true)
                          },
                        }
                      : {})}
                  />
                ))}

                <FormActions
                  template={template}
                  values={values}
                  onReplace={draft.replaceValues}
                  onNotice={setNotice}
                />
              </>
            )}
          </SectionCard>
        </section>

        <section
          aria-label={t('draft.preview.heading')}
          className={cn('min-w-0', parsed.pane === 'form' && 'hidden lg:block')}
        >
          <div className="flex flex-col gap-3">
            <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
              <ViewTabs value={parsed.view} onChange={(view) => write({ view })} />
            </div>

            <A4Preview view={parsed.view} single={single} bilingual={bilingual} />

            <ExportBar
              view={parsed.view}
              single={single}
              bilingual={bilingual}
              checklist={checklist}
              fileNumber={fileNumber}
              fallbackName={template.name[language]}
              onOpenChecklist={() => write({ checklistOpen: true })}
            />
          </div>
        </section>
      </div>

      <p aria-live="polite" data-print-hide className="text-xs text-muted-foreground">
        {notice || (draft.appliedDefaults ? t('draft.editor.defaultsApplied') : '')}
      </p>

      <DataVersion dataset="drafting-templates" className="print:hidden" />

      {parsed.checklistOpen ? (
        <ChecklistDrawer results={checklist} onClose={() => write({ checklistOpen: false })} />
      ) : null}
    </div>
  )
}

/**
 * The banner the brief asks for on every editor, and it is the plainest thing
 * on the page on purpose.
 *
 * It is not the marigold `Disclaimer` (which is about the accuracy of data),
 * and it is not a warning tone (which readers learn to skip). It states a fact
 * about where the text goes, and an instruction about what must not be typed.
 */
function PrivacyBanner() {
  const { t } = useT()
  return (
    <aside className="flex items-start gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong className="font-semibold">{t('draft.privacy.title')}</strong> {t('draft.privacy.body')}
      </p>
    </aside>
  )
}

function FormActions({
  template,
  values,
  onReplace,
  onNotice,
}: {
  template: DocTemplate
  values: DraftValues
  onReplace: (next: DraftValues) => void
  onNotice: (message: string) => void
}) {
  const { t, language } = useT()

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onReplace(collapseIdentical(sampleValues(template)))}
        title={t('draft.editor.fillSampleHint')}
      >
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        {t('draft.editor.fillSample')}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (window.confirm(t('draft.editor.clearConfirm'))) onReplace(blankValues(template))
        }}
      >
        <Eraser aria-hidden="true" className="h-4 w-4" />
        {t('draft.editor.clear')}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        title={t('draft.editor.saveDefaultsHint')}
        onClick={() => {
          void saveDefaults(template.id, template.name[language], values, documentFields(template))
            .then(() => onNotice(t('draft.editor.defaultsSaved')))
            .catch(() => onNotice(t('draft.editor.saveFailed')))
        }}
      >
        <BookmarkPlus aria-hidden="true" className="h-4 w-4" />
        {t('draft.editor.saveDefaults')}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void clearDefaults(template.id).then(() => onNotice(t('draft.editor.defaultsCleared')))
        }}
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        {t('draft.editor.clearDefaults')}
      </Button>
    </div>
  )
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const { t } = useT()
  if (state === 'idle') return null
  return (
    <p
      aria-live="polite"
      className={cn('text-xs', state === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground')}
    >
      {state === 'saving'
        ? t('draft.editor.saving')
        : state === 'saved'
          ? t('draft.editor.saved')
          : t('draft.editor.saveFailed')}
    </p>
  )
}

function PaneTabs({ value, onChange }: { value: Pane; onChange: (pane: Pane) => void }) {
  const { t } = useT()
  return (
    <Tabs
      label={t('draft.editor.tabs.label')}
      value={value}
      options={[
        { value: 'form' as const, label: t('draft.editor.tabs.form') },
        { value: 'preview' as const, label: t('draft.editor.tabs.preview') },
      ]}
      onChange={onChange}
    />
  )
}

function ViewTabs({ value, onChange }: { value: PreviewView; onChange: (view: PreviewView) => void }) {
  const { t } = useT()
  return (
    <Tabs
      label={t('draft.preview.view.label')}
      value={value}
      options={[
        { value: 'en' as const, label: t('draft.preview.view.en') },
        { value: 'hi' as const, label: t('draft.preview.view.hi') },
        { value: 'both' as const, label: t('draft.preview.view.both') },
      ]}
      onChange={onChange}
    />
  )
}

function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
              selected
                ? 'border-action bg-action font-semibold text-action-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
