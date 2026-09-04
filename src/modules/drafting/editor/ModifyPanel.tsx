import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useModifyAi } from './useModifyAi'
import { AiProgress, AiSpend } from '../components/AiProgress'
import { DocSuggestion } from '../components/DocSuggestion'

import { QUICK_ACTIONS, type ModifyPhase, type QuickAction } from '@/ai/agents/modify-actions'
import type { UseAi } from '@/ai/useAi'
import { AiBanner } from '@/components/ai/AiBanner'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { lintDocument } from '@/lib/drafting/lint'
import { renderOfficialDoc } from '@/lib/drafting/renderDoc'
import { applyProposal, type Decisions } from '@/lib/drafting/proposal'
import type { OfficialDoc } from '@/lib/drafting/model'
import type { Lang } from '@/lib/drafting/types'
import type { DocTemplate } from '../schema'

/**
 * The editor's "Change" tab.
 *
 * ### The eight quick actions are seven instructions and one that is not AI
 *
 * "Formal tone", "Shorter", "Plainer", "Hindi", "English", "Add closing" and
 * "Renumber references" each expand to a `QUICK_ACTIONS` sentence and run the
 * agent. **"Check consistency" runs no model at all** — it calls
 * `lintDocument`, which is Session 29's eight deterministic format checks, and
 * explains what it found. It is on this row rather than somewhere else because
 * it answers the same question an officer is asking when they reach for the
 * others ("is this right?"), and putting the free, offline, always-correct
 * answer beside the paid ones is the ordering `docs/AI.md` §13 asks for.
 *
 * ### Applying is one act, and it snapshots first
 *
 * `onApply` takes a version snapshot BEFORE writing, so the state the officer
 * was in is recoverable even after they accept. That is the same non-destructive
 * rule `restoreVersion` follows, and it is why the confirmation says the change
 * can be undone rather than just saying it was applied.
 */

export interface ModifyPanelProps {
  doc: OfficialDoc
  template: DocTemplate
  lang: Lang
  devanagariDigits: boolean
  ai: UseAi
  /** Block indices the officer has selected, if any. */
  selection?: ReadonlySet<number>
  /** Applies the accepted changes. Snapshots a version first — see above. */
  onApply: (next: OfficialDoc) => Promise<void> | void
}

const QUICK_ORDER: QuickAction[] = ['formal', 'shorter', 'plainer', 'hindi', 'english', 'closing', 'renumber']

export function ModifyPanel({
  doc,
  template,
  lang,
  devanagariDigits,
  ai,
  selection,
  onApply,
}: ModifyPanelProps) {
  const { t, language } = useT()
  const [instruction, setInstruction] = useState('')
  const [scoped, setScoped] = useState(false)
  const [notice, setNotice] = useState('')
  const [consistency, setConsistency] = useState<string[] | null>(null)

  const agent = useModifyAi({
    doc,
    template,
    lang,
    language,
    devanagariDigits,
    provider: ai.provider,
    tier: ai.tier,
    budgetLimit: ai.settings.monthlyTokenBudget,
    onSpent: () => void ai.refreshBudget(),
  })

  const scope = scoped && selection && selection.size > 0 ? selection : undefined

  const start = (text: string) => {
    if (!text.trim()) return
    setNotice('')
    setConsistency(null)
    agent.run({ instruction: text, ...(scope ? { scope } : {}) })
  }

  /**
   * The one quick action that is not a model.
   *
   * `lintDocument` takes the glossary as an argument (ADR-041 §6) and is called
   * here WITHOUT one, deliberately: the terminology check is the only one of
   * the eight that needs `data/glossary.json`, and 970 KB is not a fair price
   * for a button on this tab. The other seven run, which is what the officer
   * gets — and this is the caller CLAUDE.md says that argument was owed.
   */
  const checkConsistency = () => {
    setConsistency(
      lintDocument({
        doc,
        template,
        lang,
        result: renderOfficialDoc(doc, template, lang, { devanagariDigits }),
        now: new Date().toISOString(),
      }).map((issue) => issue.message[language]),
    )
    agent.reset()
  }

  const apply = async (decisions: Decisions) => {
    if (agent.state.kind !== 'proposal') return
    const applied = applyProposal(doc, agent.state.result.proposal, decisions, lang, new Date().toISOString())
    if (applied.acceptedBlocks === 0 && applied.acceptedFields === 0) {
      setNotice(t('draft.modify.appliedNone'))
      return
    }
    await onApply(applied.doc)
    setNotice(
      applied.flattened.length > 0
        ? `${t('draft.modify.applied')} ${t('draft.modify.flattened')}`
        : t('draft.modify.applied'),
    )
    agent.reset()
  }

  const labelsFor = useMemo(
    () => (ids: readonly string[]) =>
      ids
        .map((id) => template.checklist.find((item) => item.id === id)?.label[language] ?? id)
        .filter(Boolean),
    [template, language],
  )

  if (!ai.enabled) {
    /*
      With AI off the tab is not empty: the consistency check is the half of it
      that never needed a model, and hiding it would make turning AI off cost
      the officer a deterministic feature. `src/modules/library/ai-seam.ts`
      states the same rule for the study rail.
    */
    return (
      <div className="flex flex-col gap-4">
        <ConsistencyCard issues={consistency} onCheck={checkConsistency} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="size-4" />
          {t('draft.modify.heading')}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('draft.modify.lead')}</p>
        <AiBanner />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.modify.instruction')}</span>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={3}
            className="w-full rounded-[10px] border border-input bg-card p-3 text-sm"
            aria-describedby="modify-hint"
          />
        </label>
        {/* A sibling with `aria-describedby`, never nested in the label: a hint
            inside a label becomes part of the control's accessible NAME, which
            makes the field unfindable by its own name (ADR-041's addendum). */}
        <p id="modify-hint" className="text-xs text-muted-foreground">
          {t('draft.modify.instructionHint')}
        </p>

        {selection && selection.size > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={scoped}
              onChange={(event) => setScoped(event.target.checked)}
            />
            <span>
              {t('draft.modify.scopeSelection')}{' '}
              <span className="text-muted-foreground">({t('draft.modify.scopeSelectionHint')})</span>
            </span>
          </label>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!ai.provider || agent.busy || instruction.trim().length === 0}
            onClick={() => start(instruction)}
          >
            {t('draft.modify.run')}
          </Button>
          {!ai.provider ? (
            <span className="self-center text-xs text-muted-foreground">{t('draft.ai.notReady')}</span>
          ) : null}
        </div>

        <div>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('draft.modify.quick')}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {QUICK_ORDER.map((action) => (
              <li key={action}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ai.provider || agent.busy}
                  onClick={() => start(QUICK_ACTIONS[action])}
                >
                  {t(`draft.modify.quickAction.${action}`)}
                </Button>
              </li>
            ))}
            <li>
              <Button size="sm" variant="outline" onClick={checkConsistency}>
                {t('draft.modify.quickAction.consistency')}
              </Button>
            </li>
          </ul>
        </div>
      </SectionCard>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {consistency !== null ? <ConsistencyCard issues={consistency} onCheck={checkConsistency} /> : null}

      {agent.state.kind === 'running' ? (
        <AiProgress<ModifyPhase>
          steps={agent.state.steps}
          label={(phase) => t(`draft.modify.step.${phase}`)}
          onCancel={agent.cancel}
        />
      ) : null}

      {agent.state.kind === 'refused' ? (
        <div
          role="alert"
          className="rounded-lg border border-coral/40 bg-coral/15 p-3 text-sm text-coral-foreground"
        >
          <p className="font-medium">{t('draft.modify.refused')}</p>
          <p className="mt-1">{agent.state.refusal.message[language]}</p>
        </div>
      ) : null}

      {agent.state.kind === 'error' ? (
        <div
          role="alert"
          className="rounded-lg border border-coral/40 bg-coral/15 p-3 text-sm text-coral-foreground"
        >
          <p className="font-medium">{t('draft.modify.failed')}</p>
          <p className="mt-1">{agent.state.message}</p>
        </div>
      ) : null}

      {agent.state.kind === 'proposal' ? (
        <div className="flex flex-col gap-3">
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold">{t('draft.modify.rationale')}</h3>
            <p className="mt-1 text-sm">{agent.state.result.rationale[language]}</p>
            {agent.state.result.citations.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {agent.state.result.citations.map((citation) => (
                  <li key={citation.id}>
                    {citation.href ? (
                      <a href={citation.href} className="text-primary underline">
                        {citation.citation}
                      </a>
                    ) : (
                      citation.citation
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {agent.state.result.problems.length > 0 ? (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('draft.modify.problems')}</summary>
                <ul className="mt-1 list-disc ps-5">
                  {agent.state.result.problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <AiSpend usage={agent.state.result.usage} cost={agent.state.result.cost} />
          </SectionCard>

          <DocSuggestion
            proposal={agent.state.result.proposal}
            fixed={labelsFor(agent.state.result.checklist.fixed)}
            broken={labelsFor(agent.state.result.checklist.broken)}
            onApply={(decisions) => void apply(decisions)}
            onDiscard={agent.reset}
          />
        </div>
      ) : null}
    </div>
  )
}

function ConsistencyCard({ issues, onCheck }: { issues: string[] | null; onCheck: () => void }) {
  const { t } = useT()
  return (
    <SectionCard className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">{t('draft.modify.consistencyTitle')}</h2>
      {issues === null ? null : issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('draft.modify.consistencyNone')}</p>
      ) : (
        <ul className="list-disc ps-5 text-sm">
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={onCheck}>
          {t('draft.modify.quickAction.consistency')}
        </Button>
      </div>
    </SectionCard>
  )
}
