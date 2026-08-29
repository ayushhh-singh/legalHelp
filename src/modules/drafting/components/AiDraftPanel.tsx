import { Loader2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { SuggestionDiff } from './SuggestionDiff'
import { useDraftingAi, type DraftingAiState } from '../useDraftingAi'
import { asText, fromText, readValue, setValue } from '../values'

import type { InterviewAnswer, SuggestionKind } from '@/ai/agents/drafting'
import type { DraftingStep } from '@/ai/agents/drafting'
import { AiBanner } from '@/components/ai/AiBanner'
import type { UseAi } from '@/ai/useAi'
import { Badge, Chip, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { ChecklistResult, DraftValues, Lang } from '@/lib/drafting/types'
import type { DocTemplate, TemplateField } from '../schema'

/**
 * "Draft with AI" — the Drafting Studio's AI surface, and the first one this
 * app ships.
 *
 * Four things about it are decisions rather than layout, and each is recorded
 * in ADR-032:
 *
 *  1. **It renders nothing unless `useAi().enabled`.** `EditorPage` mounts it
 *     behind `React.lazy` and that flag, so a reader with AI off never
 *     downloads it — the same rule the whole layer follows, for the same
 *     reason (`docs/AI.md`: laziness here is a privacy property).
 *
 *  2. **A per-draft acknowledgement gates the brief box.** `<AiBanner/>` is
 *     permanent and says what leaves the device; the gate is a separate,
 *     active confirmation that THIS draft contains nothing official, sensitive
 *     or classified. It is asked once per draft rather than once per device,
 *     because the fact it asserts is about the document and not about the
 *     reader. ADR-021 called for a modal; an inline gate that must be pressed
 *     before the textarea exists at all is stronger — a modal over the editor
 *     is dismissible with Escape, and a dialog that appears every time an
 *     officer opens a panel is a dialog they learn to dismiss without reading.
 *
 *  3. **Nothing is applied silently.** A result arrives as a word-level diff
 *     per changed field, accept and reject per change, and the officer presses
 *     Apply on each field they want. `SuggestionDiff` was built and tested in
 *     Session 8 for exactly this moment.
 *
 *  4. **The checklist shown is the engine's.** `runDraftingAgent` evaluates it
 *     over the values it is returning, so what this panel reports is a fact
 *     about the draft rather than the model's opinion of its own work.
 */

export interface AiDraftPanelProps {
  template: DocTemplate
  values: DraftValues
  /** The preview's language — which issue(s) of the document to draft. */
  lang: Lang | 'bilingual'
  /** The language the officer is typing in. */
  editing: Lang
  devanagariDigits: boolean
  ai: UseAi
  checklist: readonly ChecklistResult[]
  onApplyValues: (next: DraftValues) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The field an officer pressed "Improve wording" on, if any. The panel does
   * NOT run it on arrival: it offers the four rewrites CSMOP justifies and
   * waits to be told which. That is one press more than an automatic run, and
   * it buys two things — the officer picks the change rather than being handed
   * one, and this component needs no effect that fires a paid request off the
   * back of a prop changing.
   */
  improveField: TemplateField | null
  onImproveHandled: () => void
}

/**
 * The acknowledgement below is per DRAFT, and what makes it so is the `key` on
 * this component in `EditorPage` — switching drafts remounts the panel, which
 * clears both the gate and any result on screen. An effect that watched the id
 * and reset the state would do the same thing later, after a render in which
 * one draft's suggestion was showing over another draft's form.
 */
export function AiDraftPanel(props: AiDraftPanelProps) {
  const { t, language } = useT()
  const { template, values, lang, editing, devanagariDigits, ai, checklist, onApplyValues } = props
  const { open, onOpenChange } = props

  const [acknowledged, setAcknowledged] = useState(false)
  const [brief, setBrief] = useState('')

  const agent = useDraftingAi({
    template,
    values,
    lang,
    editing,
    language,
    devanagariDigits,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled) return null

  return (
    <SectionCard className="flex flex-col gap-3 p-5" data-print-hide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('draft.ai.title')}
        </h2>
        <Button
          type="button"
          variant={open ? 'ghost' : 'outline'}
          size="sm"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          {open ? t('draft.ai.close') : t('draft.ai.open')}
        </Button>
      </div>

      {!open ? <p className="text-sm text-muted-foreground">{t('draft.ai.summary')}</p> : null}

      {open ? (
        <>
          <AiBanner />

          {!ai.ready ? (
            <p className="text-sm text-muted-foreground">{t('draft.ai.notReady')}</p>
          ) : !acknowledged ? (
            <Gate onConfirm={() => setAcknowledged(true)} />
          ) : (
            <>
              {props.improveField ? (
                <ImproveRequest
                  field={props.improveField}
                  template={template}
                  busy={agent.busy}
                  onRun={(kind) => {
                    if (props.improveField) agent.improve(props.improveField, kind)
                    props.onImproveHandled()
                  }}
                  onCancel={props.onImproveHandled}
                />
              ) : null}

              <BriefBox
                brief={brief}
                busy={agent.busy}
                onChange={setBrief}
                onRun={() => agent.draft(brief)}
                onCancel={agent.cancel}
              />

              <Result
                state={agent.state}
                template={template}
                values={values}
                editing={editing}
                onApplyValues={onApplyValues}
                onAnswer={agent.answer}
                onDismiss={agent.reset}
              />

              <FailingChecklist
                checklist={checklist}
                busy={agent.busy}
                onExplain={(id) => agent.explain(id)}
              />
            </>
          )}
        </>
      ) : null}
    </SectionCard>
  )
}

/**
 * The four rewrites, offered rather than guessed at.
 *
 * `person` is offered first on the body of a form written in the third person,
 * because that is the one rule officers are actually marked down on and the
 * one CSMOP's own checklist calls a `must`. `translate` is offered only when
 * there is another issue to translate into — on an English-only draft it would
 * be a button that produces text nothing renders.
 */
const KINDS: readonly SuggestionKind[] = ['concise', 'person', 'translate', 'replyDate']

function kindsFor(field: TemplateField, template: DocTemplate): SuggestionKind[] {
  const ordered =
    field.type === 'paras' && template.person === 'third'
      ? (['person', 'concise', 'replyDate', 'translate'] as const)
      : KINDS
  return [...ordered]
}

function ImproveRequest({
  field,
  template,
  busy,
  onRun,
  onCancel,
}: {
  field: TemplateField
  template: DocTemplate
  busy: boolean
  onRun: (kind: SuggestionKind) => void
  onCancel: () => void
}) {
  const { t, language } = useT()
  return (
    <section
      aria-label={t('draft.ai.improve.title')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3"
    >
      <h3 className="text-sm font-semibold">
        {t('draft.ai.improve.heading', { field: field.label[language] })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {kindsFor(field, template).map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRun(kind)}
          >
            {t(`draft.ai.improve.kind.${kind}`)}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('draft.ai.dismiss')}
        </Button>
      </div>
    </section>
  )
}

function Gate({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">
      <p className="flex items-start gap-2">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong className="font-semibold">{t('draft.ai.gate.title')}</strong> {t('draft.ai.gate.body')}
        </span>
      </p>
      <div>
        <Button type="button" size="sm" onClick={onConfirm}>
          {t('draft.ai.gate.confirm')}
        </Button>
      </div>
    </div>
  )
}

function BriefBox({
  brief,
  busy,
  onChange,
  onRun,
  onCancel,
}: {
  brief: string
  busy: boolean
  onChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="ai-brief">
        {t('draft.ai.brief.label')}
      </label>
      <textarea
        id="ai-brief"
        rows={3}
        value={brief}
        disabled={busy}
        aria-describedby="ai-brief-hint"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('draft.ai.brief.placeholder')}
        className="min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      />
      <p id="ai-brief-hint" className="text-xs text-muted-foreground">
        {t('draft.ai.brief.hint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || brief.trim().length === 0} onClick={onRun}>
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('draft.ai.run')}
        </Button>
        {busy ? (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            <X aria-hidden="true" className="h-4 w-4" />
            {t('draft.ai.cancel')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The tools that have a plain-language line, spelled out rather than built from
 * the tool name at the call site: `t()` is typed against the catalogue, so a
 * tool whose label nobody wrote is a compile error here rather than a raw key
 * on screen. Anything not listed falls through to "Working…".
 */
const STEP_KEYS = {
  list_draft_templates: 'draft.ai.step.list_draft_templates',
  get_draft_template: 'draft.ai.step.get_draft_template',
  list_draft_phrases: 'draft.ai.step.list_draft_phrases',
  lookup_admin_term: 'draft.ai.step.lookup_admin_term',
  lookup_glossary_term: 'draft.ai.step.lookup_glossary_term',
  render_draft: 'draft.ai.step.render_draft',
  check_draft: 'draft.ai.step.check_draft',
  dataset_versions: 'draft.ai.step.dataset_versions',
  today_in_india: 'draft.ai.step.today_in_india',
} as const

/** The steps, in plain language, as a live region. */
function Progress({ steps }: { steps: readonly DraftingStep[] }) {
  const { t } = useT()
  const lines = steps.map((step) =>
    step.tool
      ? t(STEP_KEYS[step.tool as keyof typeof STEP_KEYS] ?? 'draft.ai.step.other')
      : t(`draft.ai.phase.${step.phase}`),
  )
  const latest = lines.at(-1) ?? t('draft.ai.phase.planning')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3">
      <p className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {latest}
      </p>
      <ol className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {lines.slice(0, -1).map((line, index) => (
          <li key={`${line}-${index}`}>{line}</li>
        ))}
      </ol>
    </div>
  )
}

function Result({
  state,
  template,
  values,
  editing,
  onApplyValues,
  onAnswer,
  onDismiss,
}: {
  state: DraftingAiState
  template: DocTemplate
  values: DraftValues
  editing: Lang
  onApplyValues: (next: DraftValues) => void
  onAnswer: (answers: readonly InterviewAnswer[]) => void
  onDismiss: () => void
}) {
  const { t, language } = useT()

  switch (state.kind) {
    case 'idle':
      return null

    case 'running':
      return <Progress steps={state.steps} />

    case 'refused':
      return (
        <div
          role="alert"
          className="rounded-lg border-l-[3px] border-coral bg-coral/15 px-3 py-2 text-sm text-coral-foreground"
        >
          <p className="font-semibold">{t('draft.ai.refused.title')}</p>
          <p>{state.refusal.message[language]}</p>
        </div>
      )

    case 'error':
      return (
        <div role="alert" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          <p className="font-semibold">{t('draft.ai.error.title')}</p>
          <p className="text-muted-foreground">{state.message}</p>
        </div>
      )

    case 'questions':
      return <Questions state={state} onAnswer={onAnswer} onDismiss={onDismiss} />

    case 'explanation':
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <h3 className="text-sm font-semibold">{t('draft.ai.explain.title')}</h3>
          <p className="text-sm whitespace-pre-wrap">{state.text}</p>
          <Spend tokens={state.usage} cost={state.cost} />
          <div>
            <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
              {t('draft.ai.dismiss')}
            </Button>
          </div>
        </div>
      )

    case 'suggestion': {
      const field = template.fields.find((entry) => entry.id === state.fieldId)
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{state.note[language]}</p>
          <SuggestionDiff
            before={state.before}
            after={state.after}
            {...(state.csmopRef ? { csmopRef: state.csmopRef } : {})}
            onApply={(text) => {
              if (field) onApplyValues(setValue(values, field, editing, fromText(text, field)))
              onDismiss()
            }}
            onCancel={onDismiss}
          />
          <Spend tokens={state.usage} cost={state.cost} />
        </div>
      )
    }

    case 'draft':
      return (
        <Draft
          result={state.result}
          template={template}
          values={values}
          editing={editing}
          onApplyValues={onApplyValues}
          onDismiss={onDismiss}
        />
      )
  }
}

function Questions({
  state,
  onAnswer,
  onDismiss,
}: {
  state: Extract<DraftingAiState, { kind: 'questions' }>
  onAnswer: (answers: readonly InterviewAnswer[]) => void
  onDismiss: () => void
}) {
  const { t, language } = useT()
  const [answers, setAnswers] = useState<Record<string, string>>({})

  return (
    <section
      aria-label={t('draft.ai.questions.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">{t('draft.ai.questions.title')}</h3>
        <p className="text-xs text-muted-foreground">{state.result.rationale[language]}</p>
      </div>

      {state.result.questions.map((question, index) => {
        const id = `ai-question-${index}`
        return (
          <div key={`${question.field}-${index}`} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm">
              {question[language]}
            </label>
            <input
              id={id}
              type="text"
              value={answers[question.field] ?? ''}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.field]: event.target.value }))
              }
              className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
        )
      })}

      <p className="text-xs text-muted-foreground">{t('draft.ai.questions.hint')}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onAnswer(
              state.result.questions.map((question) => ({
                field: question.field,
                answer: answers[question.field] ?? '',
              })),
            )
          }
        >
          {t('draft.ai.questions.continue')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {t('draft.ai.dismiss')}
        </Button>
      </div>
      <Spend tokens={state.result.usage} cost={state.result.cost} />
    </section>
  )
}

function Draft({
  result,
  template,
  values,
  editing,
  onApplyValues,
  onDismiss,
}: {
  result: Extract<DraftingAiState, { kind: 'draft' }>['result']
  template: DocTemplate
  values: DraftValues
  editing: Lang
  onApplyValues: (next: DraftValues) => void
  onDismiss: () => void
}) {
  const { t, language } = useT()
  const [applied, setApplied] = useState<string[]>([])

  /**
   * Only the fields that would actually change.
   *
   * A diff of a field against itself renders "No change is suggested" and asks
   * the officer to press Apply on it anyway, fifteen times. Comparing the TEXT
   * the editor shows — not the stored shape — is what makes a `paras` list and
   * the same list typed by hand compare equal.
   */
  const changed = useMemo(
    () =>
      template.fields
        .map((field) => ({
          field,
          before: asText(readValue(values, field, editing)),
          after: asText(readValue(result.fieldValues, field, editing)),
        }))
        .filter((entry) => entry.after.trim().length > 0 && entry.after !== entry.before),
    [template, values, result.fieldValues, editing],
  )

  const failing = result.checklist.items.filter((item) => !item.passed)

  return (
    <section
      aria-label={t('draft.ai.result.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm">{result.rationale[language]}</p>
        {result.revised ? <Badge tone="info">{t('draft.ai.result.revised')}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={result.checklist.passed ? 'success' : 'warning'}>
          {result.checklist.passed
            ? t('draft.ai.result.checklistPassed')
            : t('draft.ai.result.checklistFailing', { count: failing.length })}
        </Badge>
        {result.blanks.length > 0 ? (
          <Badge tone="warning">{t('draft.ai.result.blanks', { count: result.blanks.length })}</Badge>
        ) : null}
      </div>

      {result.blanks.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('draft.ai.result.blanksHint', {
            fields: result.blanks
              .map((id) => template.fields.find((field) => field.id === id)?.label[language] ?? id)
              .join(', '),
          })}
        </p>
      ) : null}

      {result.suggestedPhrases.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-muted-foreground">{t('draft.ai.result.phrases')}</h4>
          <ul className="flex flex-wrap gap-1.5">
            {result.suggestedPhrases.map((phrase) => (
              <li key={phrase.id}>
                <Chip tone="neutral">{phrase[language]}</Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {changed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('draft.ai.result.noChanges')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {changed.map(({ field, before, after }) => (
            <li key={field.id} className="flex flex-col gap-1">
              <h4 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {field.label[language]}
                {applied.includes(field.id) ? (
                  <Badge tone="success">{t('draft.ai.result.applied')}</Badge>
                ) : null}
              </h4>
              <SuggestionDiff
                before={before}
                after={after}
                onApply={(text) => {
                  onApplyValues(setValue(values, field, editing, fromText(text, field)))
                  setApplied((current) => (current.includes(field.id) ? current : [...current, field.id]))
                }}
                onCancel={() => setApplied((current) => current.filter((id) => id !== field.id))}
              />
            </li>
          ))}
        </ul>
      )}

      {result.problems.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('draft.ai.result.problems')}</summary>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <Spend tokens={result.usage} cost={result.cost} />

      <div>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {t('draft.ai.dismiss')}
        </Button>
      </div>
    </section>
  )
}

/**
 * Failing checklist items, each with an "Explain" button.
 *
 * It reads the EDITOR's checklist rather than the agent's, so it is there
 * before any run has happened — which is when an officer actually wants it.
 */
function FailingChecklist({
  checklist,
  busy,
  onExplain,
}: {
  checklist: readonly ChecklistResult[]
  busy: boolean
  onExplain: (id: string) => void
}) {
  const { t } = useT()
  const failing = checklist.filter((item) => !item.passed)
  if (failing.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{t('draft.ai.explain.heading')}</h3>
      <ul className="flex flex-col gap-1.5">
        {failing.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm">{item.label}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onExplain(item.id)}
            >
              {t('draft.ai.explain.button')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What the run cost. Shown after every run, not hidden behind a settings
 * screen: a BYOK reader is paying Anthropic directly for each of these, and a
 * feature that spends someone's money without saying how much is a feature
 * they stop trusting.
 */
function Spend({ tokens, cost }: { tokens: { inputTokens: number; outputTokens: number }; cost: number }) {
  const { t } = useT()
  const total = tokens.inputTokens + tokens.outputTokens
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {t('draft.ai.spend', { tokens: total.toLocaleString(), cost: cost.toFixed(4) })}
    </p>
  )
}
