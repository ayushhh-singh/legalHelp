import { AlertTriangle, Check, Info, X } from 'lucide-react'

import { Badge, Chip } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { LintFinding, LintSeverity } from '@/lib/drafting/lint'
import type { ChecklistResult } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'

/**
 * The two checks, side by side and clearly distinguished.
 *
 * A **checklist item** is a claim the template makes about itself, with its
 * CSMOP paragraph beside it — "an Office Memorandum is written in the third
 * person, 8.4(3)". A **lint finding** is about writing and holds for every form
 * — "this paragraph is 140 words long". They are separated because an officer
 * has to be able to tell "the manual requires this" from "this reads badly",
 * and a single merged list makes that impossible.
 *
 * ### One small round icon token, never a filled card
 *
 * The checklist row used to wrap a FAILING item in a full `bg-coral/15` card —
 * which reads calmly for one failure and as a wall of colour for four or five,
 * exactly the "confusing" complaint this pass exists to fix. `ChecklistDrawer`
 * (the older form engine's own checklist panel) already solved this: colour
 * lives in a small `h-5 w-5 rounded-full` token plus a trailing `Badge`/`Chip`,
 * and every row — passing or not — sits on the SAME plain background. Nothing
 * is removed; a failing item still carries its `why` and its CSMOP citation.
 * This file adopts that pattern rather than inventing a second one, and reuses
 * `ChecklistDrawer`'s own `draft.checklist.*` strings so the two screens read
 * as one design rather than two.
 *
 * Nothing here is colour alone: a passing item has a check mark AND the word
 * "Passed"; a failing one has a cross AND "Not yet" AND a severity chip.
 */

const LINT_ICONS: Record<LintSeverity, typeof Info> = {
  error: X,
  warning: AlertTriangle,
  hint: Info,
}

const LINT_TOKEN: Record<LintSeverity, string> = {
  error: 'bg-coral/15 text-coral-foreground',
  warning: 'bg-marigold/15 text-marigold-foreground',
  hint: 'bg-muted text-muted-foreground',
}

export function ReviewPanel({
  checklist,
  findings,
  language,
}: {
  checklist: readonly ChecklistResult[]
  findings: readonly LintFinding[]
  language: 'en' | 'hi'
}) {
  const { t } = useT()
  const counts = {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    hint: findings.filter((finding) => finding.severity === 'hint').length,
  }
  const failing = checklist.filter((item) => !item.passed)
  const must = failing.filter((item) => item.severity === 'must').length
  const should = failing.length - must

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="review-checklist">
        <h2 id="review-checklist" className="mb-2 text-sm font-semibold">
          {t('draft.review.checklist')}
        </h2>
        {/*
          One summary line, not a summary per row — an officer typing with this
          panel open should hear "2 required items still failing" become "1",
          not hear every row re-announce itself per keystroke.
        */}
        <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
          {failing.length === 0
            ? t('draft.checklist.allPassed')
            : [
                must > 0 ? t('draft.checklist.summary', { count: must }) : null,
                should > 0 ? t('draft.checklist.shouldSummary', { count: should }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 p-2.5 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  item.passed
                    ? 'bg-tulsi/15 text-tulsi-foreground'
                    : item.severity === 'must'
                      ? 'bg-coral/15 text-coral-foreground'
                      : 'bg-marigold/15 text-marigold-foreground',
                )}
              >
                {item.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{item.label}</span>
                {item.passed ? null : (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.why}</span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.passed ? 'success' : item.severity === 'must' ? 'danger' : 'warning'}>
                    {item.passed ? t('draft.checklist.passed') : t('draft.checklist.failed')}
                  </Badge>
                  {item.passed ? null : (
                    <Chip tone="neutral">
                      {item.severity === 'must' ? t('draft.checklist.must') : t('draft.checklist.should')}
                    </Chip>
                  )}
                  {item.csmopRef ? <Chip tone="neutral">CSMOP {item.csmopRef}</Chip> : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="review-lint">
        <h2 id="review-lint" className="mb-2 text-sm font-semibold">
          {t('draft.review.lint')}
        </h2>
        <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
          {findings.length === 0
            ? t('draft.review.allClear')
            : [
                counts.error ? t('draft.review.errors', { count: counts.error }) : '',
                counts.warning ? t('draft.review.warnings', { count: counts.warning }) : '',
                counts.hint ? t('draft.review.hints', { count: counts.hint }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
        {findings.length === 0 ? null : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {findings.map((finding) => {
              const Icon = LINT_ICONS[finding.severity]
              return (
                <li key={finding.id} className="flex items-start gap-2.5 p-2.5 text-sm">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                      LINT_TOKEN[finding.severity],
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{t(`draft.review.severity.${finding.severity}`)}: </span>
                    {finding.message[language]}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
