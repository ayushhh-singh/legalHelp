import { Sparkles } from 'lucide-react'
import { useState } from 'react'

import { useIntakeAi } from './useIntakeAi'
import { AiProgress, AiSpend } from '../components/AiProgress'

import type { UseAi } from '@/ai/useAi'
import type { IntakePhase } from '@/ai/agents/intake'
import { AiBanner } from '@/components/ai/AiBanner'
import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { IntakeAnalysis, ResolvedProvision } from '@/lib/drafting/intake'
import type { RetrievedSnippet } from '@/lib/retrieval'

/**
 * "Analyse this letter" — the reply screen's one AI affordance, at the bottom
 * of the screen and off by default.
 *
 * ### The confirmation says exactly what leaves the device
 *
 * The letter is somebody else's writing, addressed to this office, and sending
 * it is the single most consequential thing this screen can do. So the gate is
 * a two-step confirmation that names the thing being sent — "the whole letter
 * goes to the AI provider you configured" — rather than a general warning about
 * AI. `<AiBanner/>` is above it and permanent; this is the specific act.
 *
 * It is asked once per letter, and the `key` on this component in `ReplyPage`
 * is the letter's text, so pasting a second letter asks again. That is the
 * per-draft acknowledgement pattern ADR-032 §5 established, applied to the
 * thing that actually varies here.
 */

export interface IntakeAiPanelProps {
  text: string
  extracted: IntakeAnalysis
  provisions: readonly ResolvedProvision[]
  snippets: readonly RetrievedSnippet[]
  ai: UseAi
  templateIds: readonly string[]
  onSuggestType: (templateId: string) => void
}

export function IntakeAiPanel(props: IntakeAiPanelProps) {
  const { t, language } = useT()
  const { text, extracted, provisions, snippets, ai, templateIds, onSuggestType } = props
  const [confirmed, setConfirmed] = useState(false)

  const agent = useIntakeAi({
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    language,
    templateIds,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled) return null

  return (
    <SectionCard className="flex flex-col gap-3 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles aria-hidden="true" className="size-4" />
        {t('draft.intakeAi.title')}
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">{t('draft.intakeAi.summary')}</p>
      <AiBanner />

      {!confirmed ? (
        <div className="rounded-lg border border-marigold/40 bg-marigold/15 p-3">
          <p className="text-sm font-medium text-marigold-foreground">{t('draft.intakeAi.confirmTitle')}</p>
          <p className="mt-1 text-sm text-marigold-foreground">{t('draft.intakeAi.confirmBody')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirmed(true)}>
              {t('draft.intakeAi.confirm')}
            </Button>
          </div>
        </div>
      ) : null}

      {confirmed && agent.state.kind === 'idle' ? (
        <div>
          <Button
            size="sm"
            /*
              `ai.provider` and not only `ai.enabled`: `ready` is synchronous
              and `provider` lands a tick later, so without this there is a
              window on first paint where pressing the button throws "The AI
              provider is not ready" into a red alert — an error for a condition
              that resolves on its own, which is how a working feature comes to
              look flaky (CLAUDE.md records this from the law session).
            */
            disabled={!ai.provider || agent.busy}
            onClick={() => agent.analyse({ text, extracted, provisions, snippets })}
          >
            {t('draft.intakeAi.run')}
          </Button>
          {!ai.provider ? (
            <p className="mt-2 text-xs text-muted-foreground">{t('draft.ai.notReady')}</p>
          ) : null}
        </div>
      ) : null}

      {agent.state.kind === 'running' ? (
        <AiProgress<IntakePhase>
          steps={agent.state.steps}
          label={(phase) => t(`draft.intakeAi.step.${phase}`)}
          onCancel={agent.cancel}
        />
      ) : null}

      {agent.state.kind === 'refused' ? (
        <div
          role="alert"
          className="rounded-lg border border-coral/40 bg-coral/15 p-3 text-sm text-coral-foreground"
        >
          <p className="font-medium">{t('draft.intakeAi.refused')}</p>
          <p className="mt-1">{agent.state.refusal.message[language]}</p>
        </div>
      ) : null}

      {agent.state.kind === 'error' ? (
        <div
          role="alert"
          className="rounded-lg border border-coral/40 bg-coral/15 p-3 text-sm text-coral-foreground"
        >
          <p className="font-medium">{t('draft.intakeAi.failed')}</p>
          <p className="mt-1">{agent.state.message}</p>
        </div>
      ) : null}

      {agent.state.kind === 'analysis' ? (
        <Result
          result={agent.state.result}
          language={language}
          onSuggestType={onSuggestType}
          onAgain={agent.reset}
        />
      ) : null}
    </SectionCard>
  )
}

function Result({
  result,
  language,
  onSuggestType,
  onAgain,
}: {
  result: Extract<ReturnType<typeof useIntakeAi>['state'], { kind: 'analysis' }>['result']
  language: 'en' | 'hi'
  onSuggestType: (templateId: string) => void
  onAgain: () => void
}) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t('draft.intakeAi.result')}</h3>
      <p className="text-sm">{result.summary[language]}</p>

      {result.whatIsAsked.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('draft.intakeAi.whatIsAsked')}
          </h4>
          <ul className="mt-1 list-disc ps-5 text-sm">
            {result.whatIsAsked.map((item, index) => (
              <li key={index}>{item[language]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.deadline ? (
        <p className="text-sm">
          <Badge tone="warning">{t('draft.intakeAi.deadline')}</Badge>{' '}
          <span className="tabular-nums">{result.deadline}</span>
        </p>
      ) : null}

      {result.citedProvisions.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('draft.intakeAi.citedProvisions')}
          </h4>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {result.citedProvisions.map((provision) => (
              <li key={provision.snippetId}>
                {/* The citation is the SNIPPET's, re-derived by the agent — never
                    the string the model wrote (ADR-035). */}
                <a href={provision.href} className="text-primary underline">
                  {provision.citation}
                </a>{' '}
                — {provision.relevance[language]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.risks.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('draft.intakeAi.risks')}
          </h4>
          <ul className="mt-1 list-disc ps-5 text-sm">
            {result.risks.map((item, index) => (
              <li key={index}>{item[language]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.nextSteps.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('draft.intakeAi.nextSteps')}
          </h4>
          <ol className="mt-1 list-decimal ps-5 text-sm">
            {result.nextSteps.map((item, index) => (
              <li key={index}>{item[language]}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.problems.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('draft.intakeAi.problems')}</summary>
          <ul className="mt-1 list-disc ps-5">
            {result.problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {result.suggestedType ? (
          <Button size="sm" variant="outline" onClick={() => onSuggestType(result.suggestedType)}>
            {t('draft.intake.chooseForm')}: {result.suggestedType}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onAgain}>
          {t('draft.intakeAi.run')}
        </Button>
      </div>

      <AiSpend usage={result.usage} cost={result.cost} />
    </div>
  )
}
