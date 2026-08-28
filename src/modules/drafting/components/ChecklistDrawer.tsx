import { Check, ListChecks, X } from 'lucide-react'

import { Sheet } from './Sheet'

import { Badge, Chip } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { ChecklistResult } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'

/**
 * CSMOP's own checklist, live against the document as it stands.
 *
 * Every item comes out of the template — "an Office Memorandum is written in
 * the third person, 8.4(3)" — and is evaluated by `src/lib/drafting/checklist.ts`
 * against the RENDERED document rather than against the form. That split is
 * ADR-020's and it is why this panel can be trusted: the claim about the manual
 * and the rule about text are separately reviewable, and an unimplemented rule
 * throws instead of quietly passing.
 *
 * Two severities, and they mean different things to the export:
 *
 *  - **`must`** — a failing one BLOCKS the export. These are the things that
 *    make a document the wrong document: an O.M. written in the first person,
 *    a draft with `{{signatoryName}}` still in it, paragraphs numbered wrongly.
 *  - **`should`** — a failing one lets the export through behind a second
 *    press. These are the things a competent officer would fix and a busy one
 *    might reasonably not: a copy not endorsed to the guard file, an opening
 *    that does not use the manual's exact phrase.
 *
 * Nothing here is colour alone. A passing item has a check mark AND the word
 * "Passed"; a failing one has a cross AND "Not yet" AND a severity badge. The
 * panel survives a monochrome print and a reader who cannot distinguish the
 * tulsi green from the coral.
 */

export function ChecklistButton({ results, onOpen }: { results: ChecklistResult[]; onOpen: () => void }) {
  const { t } = useT()
  const failing = results.filter((item) => !item.passed)
  const must = failing.filter((item) => item.severity === 'must').length
  const should = failing.length - must

  return (
    <button
      type="button"
      onClick={onOpen}
      data-print-hide
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ListChecks aria-hidden="true" className="h-4 w-4" />
      {t('draft.checklist.title')}
      {/*
        The count is the live signal — it is why this is a button with a badge
        rather than a menu item. `aria-label` spells out what the number means,
        because "3" beside "Checklist" is ambiguous between "3 items" and
        "3 failures".
      */}
      {must > 0 ? (
        <Badge tone="danger" aria-label={t('draft.checklist.summary', { count: must })}>
          {must}
        </Badge>
      ) : should > 0 ? (
        <Badge tone="warning" aria-label={t('draft.checklist.shouldSummary', { count: should })}>
          {should}
        </Badge>
      ) : (
        <Badge tone="success" aria-label={t('draft.checklist.allPassed')}>
          <Check aria-hidden="true" className="h-3 w-3" />
        </Badge>
      )}
    </button>
  )
}

export function ChecklistDrawer({ results, onClose }: { results: ChecklistResult[]; onClose: () => void }) {
  const { t } = useT()
  const failing = results.filter((item) => !item.passed)
  const must = failing.filter((item) => item.severity === 'must').length
  const should = failing.length - must

  return (
    <Sheet
      title={t('draft.checklist.title')}
      subtitle={t('draft.checklist.subtitle')}
      placement="end"
      onClose={onClose}
    >
      <div className="border-b border-border px-4 py-3">
        {/*
          `aria-live` on the summary, not on every row. An officer typing in the
          form with the drawer open should hear "2 required items still failing"
          become "1", not hear ten rows re-announce themselves per keystroke.
        */}
        <p aria-live="polite" className="text-sm font-medium">
          {failing.length === 0
            ? t('draft.checklist.allPassed')
            : [
                must > 0 ? t('draft.checklist.summary', { count: must }) : null,
                should > 0 ? t('draft.checklist.shouldSummary', { count: should }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {results.map((item) => (
          <li key={item.id} className="p-4">
            <div className="flex items-start gap-3">
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
                {item.passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </span>

              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.why}</p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <Badge tone={item.passed ? 'success' : item.severity === 'must' ? 'danger' : 'warning'}>
                    {item.passed ? t('draft.checklist.passed') : t('draft.checklist.failed')}
                  </Badge>
                  <Chip tone="neutral">
                    {item.severity === 'must' ? t('draft.checklist.must') : t('draft.checklist.should')}
                  </Chip>
                  {item.csmopRef ? <Chip tone="neutral">{item.csmopRef}</Chip> : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
