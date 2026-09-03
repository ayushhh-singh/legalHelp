import { Loader2, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useTutorAi } from '../useTutorAi'

import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { Card } from '../schema'

/**
 * "Explain" and "Give me a scenario on this rule" — the Trainer's two
 * per-card AI actions, mounted below `CardView` once it has revealed an
 * answer. Renders nothing unless `useAi().enabled`, the same rule every AI
 * surface in this app follows.
 *
 * `wrongAnswer` gates "Explain": it exists only after the reader has actually
 * answered incorrectly (`CardView`'s `onAnswered`), never merely because a
 * card is on screen — asking a model to explain an answer nobody got wrong
 * would be answering a question the reader did not ask.
 */
export interface CardAiActionsProps {
  ai: UseAi
  card: Card
  wrongAnswer: { picked: string; correctText: string } | null
}

export function CardAiActions({ ai, card, wrongAnswer }: CardAiActionsProps) {
  const { t, language } = useT()
  const tutor = useTutorAi({
    language,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  if (!ai.enabled) return null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <AiBanner />

      {!ai.ready ? (
        <p className="text-sm text-muted-foreground">{t('trainer.ai.notReady')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {wrongAnswer ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={tutor.busy}
                onClick={() =>
                  tutor.explain({
                    act: card.act,
                    rule: card.rule,
                    qId: card.id,
                    pickedAnswer: wrongAnswer.picked,
                    correctAnswer: wrongAnswer.correctText,
                  })
                }
              >
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                {t('trainer.ai.explain.button')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={tutor.busy}
              onClick={() => tutor.scenario({ act: card.act, rule: card.rule })}
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              {t('trainer.ai.scenario.button')}
            </Button>
            {tutor.busy ? (
              <Button type="button" size="sm" variant="ghost" onClick={tutor.cancel}>
                {t('trainer.ai.cancel')}
              </Button>
            ) : null}
          </div>

          <Result state={tutor.state} onDismiss={tutor.reset} />
        </>
      )}
    </div>
  )
}

function Result({
  state,
  onDismiss,
}: {
  state: ReturnType<typeof useTutorAi>['state']
  onDismiss: () => void
}) {
  const { t } = useT()

  switch (state.kind) {
    case 'idle':
      return null

    case 'running':
      return (
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t('trainer.ai.thinking')}
        </p>
      )

    case 'error':
      return (
        <div role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <p className="font-semibold">{t('trainer.ai.error.title')}</p>
          <p className="text-muted-foreground">{state.message}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('trainer.ai.dismiss')}
          </Button>
        </div>
      )

    case 'explain':
      return (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="whitespace-pre-wrap">{state.text}</p>
          <Spend tokens={state.usage} cost={state.cost} />
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('trainer.ai.dismiss')}
          </Button>
        </div>
      )

    case 'scenario':
      return (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="whitespace-pre-wrap">{state.text}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('trainer.ai.scenario.unreviewed')}{' '}
            <Link to={state.reviewQueueUrl} className="underline underline-offset-2">
              {t('trainer.ai.scenario.reviewLink')}
            </Link>
          </p>
          <Spend tokens={state.usage} cost={state.cost} />
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('trainer.ai.dismiss')}
          </Button>
        </div>
      )

    case 'focusPlan':
      return null
  }
}

function Spend({ tokens, cost }: { tokens: { inputTokens: number; outputTokens: number }; cost: number }) {
  const { t } = useT()
  const total = tokens.inputTokens + tokens.outputTokens
  if (total === 0) return null
  return (
    <p className="mt-2 text-xs text-muted-foreground tabular-nums">
      {t('trainer.ai.spend', { tokens: total.toLocaleString(), cost: cost.toFixed(4) })}
    </p>
  )
}
