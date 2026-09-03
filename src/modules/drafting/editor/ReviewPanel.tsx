import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

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
 */

const ICONS: Record<LintSeverity, typeof Info> = {
  error: XCircle,
  warning: AlertTriangle,
  hint: Info,
}

/**
 * The three tones, and why `error` is coral rather than destructive.
 *
 * `--destructive-foreground` is white on light and navy on dark: it is the
 * colour for text on SOLID destructive, not on a tint of it. Painting
 * `bg-destructive/10` and putting `text-destructive-foreground` on top failed
 * axe's `color-contrast` on fourteen elements the first time this panel was
 * swept in a real browser. The marigold / tulsi / coral trio is the one that
 * carries a paired `-foreground` FOR its own /15 tint, which is exactly what a
 * tinted row needs (tokens.css, and the `EraseSection` note in CLAUDE.md).
 */
const TONE: Record<LintSeverity, string> = {
  error: 'border-coral/40 bg-coral/15 text-coral-foreground',
  warning: 'border-marigold/40 bg-marigold/15 text-marigold-foreground',
  hint: 'border-border bg-muted/50 text-foreground',
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

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="review-checklist">
        <h2 id="review-checklist" className="mb-2 text-sm font-semibold">
          {t('draft.review.checklist')}
        </h2>
        <ul className="flex flex-col gap-2">
          {checklist.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-2 rounded-lg border p-2 text-sm',
                item.passed ? 'border-border bg-card' : TONE[item.severity === 'must' ? 'error' : 'warning'],
              )}
            >
              {item.passed ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tulsi" />
              ) : (
                <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="font-medium">{item.label}</span>
                {/*
                  No `opacity-*` here. Fading a row dims its text along with
                  everything else, and a hint that is already at the tokens'
                  contrast floor goes under it — the lesson `UtilsHubPage`'s
                  "coming later" cards recorded (CLAUDE.md).
                */}
                {item.passed ? null : <span className="block text-xs">{item.why}</span>}
                {item.csmopRef ? (
                  <span
                    className={cn(
                      'mt-0.5 block text-xs',
                      // `--muted-foreground` is paired with `--card` and
                      // `--muted`, not with a coral or marigold /15 tint: on a
                      // failing row it measures below AA and axe says so. A
                      // tinted row's text is the tint's own paired foreground,
                      // which the row already sets — so this inherits.
                      item.passed && 'text-muted-foreground',
                    )}
                  >
                    CSMOP {item.csmopRef}
                  </span>
                ) : null}
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
          {findings.length === 0 && failing.length === 0
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
          <ul className="flex flex-col gap-2">
            {findings.map((finding) => {
              const Icon = ICONS[finding.severity]
              return (
                <li
                  key={finding.id}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-2 text-sm',
                    TONE[finding.severity],
                  )}
                >
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
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
