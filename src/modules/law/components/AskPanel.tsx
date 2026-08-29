import { Check, Copy, Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { useLawAsk, UNGROUNDED_CODES, type LawAskState } from '../useLawAsk'

import type { LawAnswerResult, LawCitation, LawStep } from '@/ai/agents/law'
import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { Badge, Chip, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * "Ask" — the Law Converter's AI surface, and the second one this app ships.
 *
 * Four things about it are decisions rather than layout, and each is recorded
 * in ADR-035:
 *
 *  1. **It renders nothing unless `useAi().enabled`.** `ConverterPage` mounts
 *     it behind `React.lazy` and `lawAiAvailable(...)`, so a reader with AI off
 *     never downloads it — the rule the whole layer follows, for the reason
 *     `docs/AI.md` gives: laziness here is a privacy property.
 *
 *  2. **The citations are the interface, not a footnote.** Every `[n]` mark in
 *     the answer and every entry in the source list is a button that opens that
 *     section's own card in the converter below. An answer whose numbers a
 *     reader cannot check in one press is an answer they have to take on
 *     trust, which is the one thing this surface must never ask for.
 *
 *  3. **"Copy answer with citations" copies the citations too.** A citation
 *     pasted into a note loses every piece of UI around it, so the marks travel
 *     with a numbered source list and the disclaimer travels with the answer —
 *     the rule `shareText()` already follows for a single section.
 *
 *  Both kinds of citation control name themselves with `aria-label` rather than
 *  a visible label plus an `sr-only` suffix. The accessible-name algorithm
 *  flattens and TRIMS each node, so a separator written as a leading space — or
 *  even as an explicit `{' '}` — is dropped and the name comes out as
 *  "BNS 318— open BNS 318". The visible label WCAG 2.5.3 asks for is still
 *  inside the name ("open BNS 318" contains "BNS 318"), which is the constraint
 *  that actually matters.
 *
 *  4. **When it cannot answer, it says which rule stopped it.** `ungrounded`
 *     and `invalid_citation` are the grounding rule working, not a crash, and
 *     a reader told only "that did not finish" learns nothing from a refusal
 *     that was, in fact, the feature.
 */

export interface AskPanelProps {
  ai: UseAi
  /** The converter's offence-date field, so the date rule is about this matter. */
  offenceDate: string | null
  /** Opens the cited section's card in the converter below. */
  onOpenCitation: (citation: LawCitation) => void
}

export function AskPanel({ ai, offenceDate, onOpenCitation }: AskPanelProps) {
  const { t, language } = useT()
  const [question, setQuestion] = useState('')

  const agent = useLawAsk({
    language,
    offenceDate,
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
          {t('law.ask.title')}
        </h2>
        {ai.budget && ai.budget.exhausted ? <Badge tone="warning">{t('law.ask.budgetSpent')}</Badge> : null}
      </div>

      <AiBanner />

      {!ai.ready ? (
        <p className="text-sm text-muted-foreground">{t('law.ask.notReady')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="law-ask">
              {t('law.ask.label')}
            </label>
            <textarea
              id="law-ask"
              rows={2}
              value={question}
              disabled={agent.busy}
              aria-describedby="law-ask-hint"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t('law.ask.placeholder')}
              className="min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            />
            <p id="law-ask-hint" className="text-xs text-muted-foreground">
              {offenceDate ? t('law.ask.hintWithDate', { date: offenceDate }) : t('law.ask.hint')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={agent.busy || question.trim().length === 0}
                onClick={() => agent.ask(question)}
              >
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                {t('law.ask.run')}
              </Button>
              {agent.busy ? (
                <Button type="button" size="sm" variant="outline" onClick={agent.cancel}>
                  <X aria-hidden="true" className="h-4 w-4" />
                  {t('law.ask.cancel')}
                </Button>
              ) : null}
            </div>
          </div>

          <Result state={agent.state} onOpenCitation={onOpenCitation} onDismiss={agent.reset} />
        </>
      )}
    </SectionCard>
  )
}

/**
 * The tools that have a plain-language line, spelled out rather than built from
 * the tool name at the call site: `t()` is typed against the catalogue, so a
 * tool whose label nobody wrote is a compile error here rather than a raw key
 * on screen. Anything not listed falls through to "Working…".
 */
const STEP_KEYS = {
  search_sections: 'law.ask.step.search_sections',
  get_section: 'law.ask.step.get_section',
  compare_old_new: 'law.ask.step.compare_old_new',
  get_classification: 'law.ask.step.get_classification',
  format_citation: 'law.ask.step.format_citation',
  dataset_versions: 'law.ask.step.dataset_versions',
  today_in_india: 'law.ask.step.today_in_india',
} as const

/**
 * The steps in plain language, and the answer as it arrives.
 *
 * The answer pass returns structured output, so there is no plain-text stream
 * to show — `partialAnswerText` pulls the answer string out of the half-arrived
 * JSON instead. It is rendered as ordinary text with the citation marks still
 * in it: they resolve to buttons only once the run has finished and the
 * snippets are known, and a mark that moved under the reader's cursor mid-
 * stream would be worse than one that waits.
 */
function Progress({ steps, partial }: { steps: readonly LawStep[]; partial: string }) {
  const { t } = useT()
  const lines = steps.map((step) =>
    step.tool
      ? t(STEP_KEYS[step.tool as keyof typeof STEP_KEYS] ?? 'law.ask.step.other')
      : t(`law.ask.phase.${step.phase}`),
  )
  const latest = lines.at(-1) ?? t('law.ask.phase.researching')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3">
      <p className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {latest}
      </p>
      {partial ? (
        <p className="text-sm whitespace-pre-wrap">{partial}</p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {lines.slice(0, -1).map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Result({
  state,
  onOpenCitation,
  onDismiss,
}: {
  state: LawAskState
  onOpenCitation: (citation: LawCitation) => void
  onDismiss: () => void
}) {
  const { t, language } = useT()

  switch (state.kind) {
    case 'idle':
      return null

    case 'running':
      return <Progress steps={state.steps} partial={state.partial} />

    case 'refused':
      return (
        <div
          role="alert"
          className="rounded-lg border-l-[3px] border-coral bg-coral/15 px-3 py-2 text-sm text-coral-foreground"
        >
          <p className="font-semibold">{t('law.ask.refused.title')}</p>
          <p>{state.refusal.message[language]}</p>
        </div>
      )

    case 'error': {
      const ungrounded = UNGROUNDED_CODES.includes(state.code)
      return (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-sm"
        >
          <p className="font-semibold">
            {ungrounded ? t('law.ask.error.ungroundedTitle') : t('law.ask.error.title')}
          </p>
          {ungrounded ? <p>{t('law.ask.error.ungroundedBody')}</p> : null}
          <p className="text-muted-foreground">{state.message}</p>
          {state.toolsCalled.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('law.ask.error.read', { tools: state.toolsCalled.join(', ') })}
            </p>
          ) : null}
          <div>
            <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
              {t('law.ask.dismiss')}
            </Button>
          </div>
        </div>
      )
    }

    case 'answer':
      return <Answer result={state.result} onOpenCitation={onOpenCitation} onDismiss={onDismiss} />
  }
}

function Answer({
  result,
  onOpenCitation,
  onDismiss,
}: {
  result: LawAnswerResult
  onOpenCitation: (citation: LawCitation) => void
  onDismiss: () => void
}) {
  const { t, language } = useT()
  const [copied, setCopied] = useState(0)

  const copy = async () => {
    const { copyableAnswer } = await import('@/ai/agents/law')
    await navigator.clipboard.writeText(copyableAnswer(result, language))
    // Keyed on a counter so an identical repeat message is a real DOM
    // insertion and is announced again — the `/utils/portals` lesson.
    setCopied((current) => current + 1)
  }

  return (
    <section
      aria-label={t('law.ask.answer.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <AnswerText
        text={result.answer[language]}
        snippets={result.snippets}
        citations={result.citations}
        onOpenCitation={onOpenCitation}
      />

      {result.citations.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('law.ask.answer.citations')}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {result.citations.map((citation) => (
              <li key={`${citation.act}-${citation.section}`}>
                <button
                  type="button"
                  onClick={() => onOpenCitation(citation)}
                  aria-label={t('law.ask.answer.openSection', { name: citation.citation[language] })}
                  className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Chip
                    tone="action"
                    className="cursor-pointer"
                    title={citation.heading?.[language] || citation.heading?.en || undefined}
                  >
                    {citation.citation[language]}
                  </Chip>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        {result.caveats.map((caveat, index) => (
          <li key={`${index}-${caveat.en.slice(0, 24)}`}>{caveat[language]}</li>
        ))}
      </ul>

      {result.problems.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('law.ask.answer.problems')}</summary>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-muted-foreground tabular-nums">
        {t('law.ask.spend', {
          tokens: (result.usage.inputTokens + result.usage.outputTokens).toLocaleString(),
          cost: result.cost.toFixed(4),
        })}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied > 0 ? (
            <Check aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Copy aria-hidden="true" className="h-4 w-4" />
          )}
          {t('law.ask.answer.copy')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          {t('law.ask.dismiss')}
        </Button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {copied > 0 ? <span key={copied}>{t('law.ask.answer.copied')}</span> : null}
      </p>
    </section>
  )
}

const MARK = /\[(\d{1,3})\]/g

/** The section alone, so `"318(4)"` and `"318"` are the same provision here. */
const baseOf = (section: string): string => section.split('(')[0]?.trim() ?? section

/**
 * The citation a snippet's section belongs to — exactly first, then at
 * section level.
 *
 * The fallback is needed in one direction and wrong in the other: a
 * `get_classification` snippet is about `318` while the answer cites `318(4)`,
 * so the two have to meet at the section. Matching by `startsWith` — the
 * obvious version — silently pairs a snippet about section 31 with a citation
 * of 318, because one string really does begin with the other.
 */
function citationFor(
  citations: readonly LawCitation[],
  ref: NonNullable<LawAnswerResult['snippets'][number]['ref']>,
): LawCitation | undefined {
  return (
    citations.find((entry) => entry.act === ref.act && entry.section === ref.section) ??
    citations.find((entry) => entry.act === ref.act && baseOf(entry.section) === baseOf(ref.section))
  )
}

/**
 * The answer, with each `[n]` mark rendered as the source it points at.
 *
 * A mark whose snippet names a section becomes a button that opens that
 * section's card below; one that does not — `dataset_versions`, say — stays a
 * plain superscript. Either way the reader can see WHAT supported the sentence
 * without leaving it, which is the difference between a citation and a
 * decoration.
 */
function AnswerText({
  text,
  snippets,
  citations,
  onOpenCitation,
}: {
  text: string
  snippets: LawAnswerResult['snippets']
  citations: readonly LawCitation[]
  onOpenCitation: (citation: LawCitation) => void
}) {
  const { t, language } = useT()
  const parts: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of text.matchAll(MARK)) {
    const at = match.index
    if (at > cursor) parts.push(text.slice(cursor, at))
    cursor = at + match[0].length

    const index = Number(match[1])
    const snippet = snippets.find((entry) => entry.index === index)
    const citation = snippet?.ref ? citationFor(citations, snippet.ref) : undefined
    const label = snippet?.label[language] || snippet?.label.en || String(index)

    if (citation) {
      parts.push(
        <button
          key={`mark-${key++}`}
          type="button"
          onClick={() => onOpenCitation(citation)}
          aria-label={t('law.ask.answer.openSection', { name: label })}
          className={cn(
            'mx-0.5 rounded-sm px-1 align-super text-[0.65rem] font-semibold',
            'bg-accent text-accent-foreground hover:underline',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          {label}
        </button>,
      )
    } else {
      parts.push(
        <sup key={`mark-${key++}`} className="mx-0.5 text-[0.65rem] text-muted-foreground">
          <span className="sr-only">{t('law.ask.answer.source', { name: label })}</span>
          <span aria-hidden="true">{label}</span>
        </sup>,
      )
    }
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{parts}</p>
}

export default AskPanel
