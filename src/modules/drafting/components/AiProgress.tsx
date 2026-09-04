import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { TokenUsage } from '@/ai/types'

/**
 * What a run looks like while it is running: the steps it has taken, how long
 * it has been going, what it cost, and a way to stop it.
 *
 * One component for the intake analysis and for modify-by-instruction, and it
 * is deliberately driven by the AGENT'S OWN phase list rather than by a
 * timeline this file invents. Every step here was reported by `onProgress` from
 * inside the run, so a progress list that stops moving means the run has
 * stopped moving — which is the only honest thing a progress indicator can be.
 *
 * ### Why the label comes from a map the caller supplies
 *
 * `steps` are phase ids (`screening`, `reading`, `changing`) and the label for
 * each lives in `src/i18n`. The caller passes a `label` function rather than
 * this component reading `draft.modify.step.<phase>` itself, because the two
 * agents have different phases and a component that guessed the key would
 * render a raw key for a phase somebody added later. A missing label is a
 * compile error at the call site instead.
 *
 * ### The elapsed clock
 *
 * A second-resolution counter, started when the component mounts, which is when
 * the run started — the panel renders this only while `running`. It is here
 * rather than in the hook because it is presentation: the hook has no business
 * re-rendering a panel once a second, and a run that is cancelled or that
 * finishes unmounts this and takes its interval with it.
 */

export interface AiProgressProps<Phase extends string> {
  steps: readonly { phase: Phase; tool?: string }[]
  label: (phase: Phase) => string
  /** A tool's own label, when a step named one. */
  toolLabel?: (tool: string) => string
  onCancel: () => void
  /** Shown once the run has finished, if the caller has the numbers. */
  usage?: TokenUsage
  cost?: number
}

export function AiProgress<Phase extends string>({
  steps,
  label,
  toolLabel,
  onCancel,
}: AiProgressProps<Phase>) {
  const { t } = useT()
  const seconds = useElapsedSeconds()

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/*
          One live region for the whole list, and the list is what it announces.
          A region per step would announce five times and a region that only
          held the LATEST step would say "Done." with no account of what
          happened — `tests/e2e/keyboard.spec.ts` asserts every confirmation in
          this app is inside a live region, and this is the one for a run.
        */}
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {steps.length > 0 ? label(steps[steps.length - 1]?.phase as Phase) : t('common.loading')}
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">{seconds}s</span>
      </div>

      <ol aria-live="polite" className="flex flex-col gap-1 text-xs text-muted-foreground">
        {steps.map((step, index) => (
          <li key={`${step.phase}-${index}`}>
            {label(step.phase)}
            {step.tool && toolLabel ? ` — ${toolLabel(step.tool)}` : ''}
          </li>
        ))}
      </ol>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('draft.ai.cancel')}
        </Button>
      </div>
    </div>
  )
}

/** Seconds since this component mounted, which is when the run started. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000)
    return () => clearInterval(timer)
  }, [])
  return seconds
}

/** The token and cost line every run ends with. Shown after, not during. */
export function AiSpend({ usage, cost }: { usage: TokenUsage; cost: number }) {
  const { t } = useT()
  return (
    <p className="text-xs text-muted-foreground">
      {t('draft.ai.spend', {
        tokens: (usage.inputTokens + usage.outputTokens).toLocaleString(),
        cost: cost.toFixed(4),
      })}
    </p>
  )
}
