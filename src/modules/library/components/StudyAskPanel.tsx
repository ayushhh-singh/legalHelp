import { Check, Copy, Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { PHASE_LABELS, labelFor } from '../askLabels'
import { useStudyAsk, UNGROUNDED_CODES } from '../useStudyAsk'

import type { StudyAnswerResult, StudyIntent, StudyStep } from '@/ai/agents/study'
import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * "Ask about this" — the Library's AI surface, and the LAST thing in the rail.
 *
 * Where it sits is the point. Above it are four affordances that cost nothing
 * and reach no network: the precomputed study aid, the reader's own
 * explanation, the chapter quiz drawn from approved cards, and the related
 * units. This one is the only thing on the page that sends anything anywhere,
 * so it is the only thing on the page that says so — `library.study.ask.offer`
 * is rendered before the box, not after the answer.
 *
 * Three further decisions, all in ADR-040:
 *
 *  1. **"Let it read my own notes" is OFF until it is ticked**, and the hint
 *     beside it says what ticking it does. Everything else the agent reads is
 *     published statute or an aid this repository ships; a note is the one
 *     thing in its reach that the officer wrote and nobody else has seen.
 *  2. **A cited snippet that IS the reader's own note is rendered as theirs.**
 *     `misattributesPersonal()` fails the run in code when the answer treats
 *     one as law, and the source list marks it a second time so the reader can
 *     see which is which without reading the prose carefully.
 *  3. **Every answer carries an "AI-generated" marker.** Not a disclaimer at
 *     the bottom — a marker beside the answer, because the four things above it
 *     in the rail are not AI-generated and the difference has to be visible at
 *     a glance.
 */

export interface StudyAskPanelProps {
  ai: UseAi
  workId: string
  unitId: string | null
  nodeId: string | null
  /** Scrolls to a unit on this page, when the citation names one. */
  onOpenCitation: (href: string) => void
  className?: string
}

const INTENTS = [
  { id: 'simpler', key: 'library.study.ask.intent.simpler', prompt: 'Explain this provision more simply.' },
  {
    id: 'example',
    key: 'library.study.ask.intent.example',
    prompt: 'Give me another example of this provision.',
  },
  {
    id: 'difference',
    key: 'library.study.ask.intent.difference',
    prompt: 'What is the difference between this provision and the ones near it?',
  },
  {
    id: 'whatIf',
    key: 'library.study.ask.intent.whatIf',
    prompt: 'What happens if this provision is not followed?',
  },
  { id: 'summarise', key: 'library.study.ask.intent.summarise', prompt: 'Summarise this chapter.' },
  { id: 'quiz', key: 'library.study.ask.intent.quiz', prompt: 'Quiz me on this provision.' },
] as const satisfies readonly { id: StudyIntent; key: string; prompt: string }[]

export function StudyAskPanel({ ai, workId, unitId, nodeId, onOpenCitation, className }: StudyAskPanelProps) {
  const { t, language } = useT()
  const [question, setQuestion] = useState('')
  const [includeNotes, setIncludeNotes] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  const agent = useStudyAsk({
    language,
    workId,
    unitId,
    nodeId,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled) return null

  // `ready` is synchronous (it reads the settings row); `provider` lands a tick
  // later. Without the second condition there is a window on first paint where
  // pressing Ask throws "The AI provider is not ready" into a red alert — an
  // error for a condition that resolves on its own.
  const canAsk = ai.ready && Boolean(ai.provider) && !agent.busy

  const run = (text: string, intent: StudyIntent) => {
    setCopied(null)
    if (!text.trim()) return
    agent.ask(text.trim(), intent, includeNotes)
  }

  return (
    <SectionCard className={cn('flex flex-col gap-3 p-5', className)} data-print-hide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('library.study.ask.title')}
        </h2>
        {ai.tier === 'local' ? <Badge tone="neutral">{t('library.study.ask.onDevice')}</Badge> : null}
      </div>

      <AiBanner />
      <p className="text-xs text-muted-foreground">{t('library.study.ask.offer')}</p>

      <ul className="flex flex-wrap gap-2">
        {INTENTS.map((intent) => (
          <li key={intent.id}>
            <button
              type="button"
              disabled={!canAsk}
              onClick={() => run(intent.prompt, intent.id)}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-medium transition-colors hover:border-input hover:bg-accent/50 disabled:opacity-50"
            >
              {t(intent.key)}
            </button>
          </li>
        ))}
      </ul>

      <textarea
        aria-label={t('library.study.ask.title')}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={t('library.study.ask.placeholder')}
        rows={2}
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm"
      />

      <div className="flex items-start gap-2 text-sm">
        <input
          id="study-ask-notes"
          type="checkbox"
          checked={includeNotes}
          onChange={(event) => setIncludeNotes(event.target.checked)}
          className="mt-1 h-4 w-4"
          aria-describedby="study-ask-notes-hint"
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor="study-ask-notes">{t('library.study.ask.useNotes')}</label>
          <span id="study-ask-notes-hint" className="text-xs text-muted-foreground">
            {t('library.study.ask.useNotesHint')}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!canAsk || !question.trim()} onClick={() => run(question, 'custom')}>
          {t('library.study.ask.send')}
        </Button>
        {agent.busy ? (
          <Button type="button" variant="outline" onClick={agent.cancel}>
            <X aria-hidden="true" />
            {t('library.study.ask.cancel')}
          </Button>
        ) : null}
      </div>

      {agent.state.kind === 'running' ? (
        <Progress steps={agent.state.steps} partial={agent.state.partial} />
      ) : null}

      {agent.state.kind === 'refused' ? (
        <div role="alert" className="rounded-lg border border-border bg-coral/15 p-3 text-sm">
          <p className="font-semibold">{t('library.study.ask.refused')}</p>
          <p>{agent.state.refusal.message[language]}</p>
        </div>
      ) : null}

      {agent.state.kind === 'error' ? (
        <div role="alert" className="rounded-lg border border-border bg-muted p-3 text-sm">
          <p className="font-semibold">{t('library.study.ask.failed')}</p>
          {UNGROUNDED_CODES.includes(agent.state.code) ? (
            <p className="text-muted-foreground">{t('library.study.ask.whyNot')}</p>
          ) : (
            <p className="text-muted-foreground">{agent.state.message}</p>
          )}
        </div>
      ) : null}

      {agent.state.kind === 'answer' ? (
        <Answer
          result={agent.state.result}
          onOpenCitation={onOpenCitation}
          copied={copied}
          setCopied={setCopied}
        />
      ) : null}
    </SectionCard>
  )
}

function Progress({ steps, partial }: { steps: readonly StudyStep[]; partial: string }) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-2">
      <ol role="status" aria-live="polite" className="flex flex-col gap-1 text-sm text-muted-foreground">
        {steps.map((step, at) => (
          <li key={at} className="flex items-center gap-2">
            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            {(() => {
              // An unlabelled tool falls back to the phase it is part of, which
              // is always true and never a raw key.
              const label = step.tool ? labelFor(step.tool) : null
              return t(label ?? PHASE_LABELS[step.phase])
            })()}
          </li>
        ))}
      </ol>
      {partial ? <p className="text-sm leading-relaxed whitespace-pre-wrap opacity-70">{partial}</p> : null}
    </div>
  )
}

function Answer({
  result,
  onOpenCitation,
  copied,
  setCopied,
}: {
  result: StudyAnswerResult
  onOpenCitation: (href: string) => void
  copied: 'ok' | 'failed' | null
  setCopied: (value: 'ok' | 'failed' | null) => void
}) {
  const { t, language } = useT()

  // Every copy affordance in this app wraps the clipboard in a try/catch: a
  // browser that refuses it (insecure origin, denied permission, a locked-down
  // managed device) would otherwise give an unhandled rejection and a button
  // that silently does nothing, so the reader pastes whatever was there before.
  const copy = async () => {
    const lines = [
      result.answer[language],
      '',
      `${t('library.study.ask.sources')}:`,
      ...result.snippets.map(
        (snippet) =>
          `[${snippet.index}] ${snippet.label[language]}${
            snippet.personal ? ` (${t('library.study.ask.personalSource')})` : ''
          }`,
      ),
      '',
      ...result.caveats.map((caveat) => caveat[language]),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Badge tone="neutral">{t('library.study.ask.aiMarked')}</Badge>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.answer[language]}</p>

      {result.snippets.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
            {t('library.study.ask.sources')}
          </h3>
          <ol className="flex flex-col gap-1">
            {result.snippets.map((snippet) => (
              <li key={snippet.index} className="text-sm">
                {snippet.href ? (
                  <button
                    type="button"
                    onClick={() => onOpenCitation(snippet.href ?? '')}
                    className="text-left text-primary hover:underline"
                  >
                    [{snippet.index}] {snippet.label[language]}
                  </button>
                ) : (
                  <span>
                    [{snippet.index}] {snippet.label[language]}
                  </span>
                )}
                {snippet.personal ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({t('library.study.ask.personalSource')})
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.aidNote ? <p className="text-xs text-muted-foreground">{result.aidNote[language]}</p> : null}
      {result.personalNote ? (
        <p className="text-xs text-muted-foreground">{result.personalNote[language]}</p>
      ) : null}

      {result.caveats.map((caveat, at) => (
        <p key={at} className="text-xs text-muted-foreground">
          {caveat[language]}
        </p>
      ))}

      {result.problems.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('library.study.ask.problems')}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {result.problems.map((problem, at) => (
              <li key={at}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied === 'ok' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t('library.study.ask.copy')}
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {copied === 'ok' ? t('library.study.ask.copied') : null}
          {copied === 'failed' ? t('library.study.ask.copyFailed') : null}
        </span>
      </div>
    </div>
  )
}
