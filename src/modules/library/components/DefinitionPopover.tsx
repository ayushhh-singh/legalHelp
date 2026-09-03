import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import { toUnitHref } from '../url'

import { Badge } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import type { DefinedTermRecord } from '@/schemas/library'

/**
 * What a term means, where it says so, and how sure this app is.
 *
 * The confidence is on the FACE of it, not buried: a term read out of a clause
 * whose quotation marks were lost in extraction is offered with a Verify badge
 * and a sentence saying to check it against the provision. A definitions parser
 * that presented every reading as equally certain would be worse than none,
 * because the reader would stop checking.
 */

interface DefinitionPopoverProps {
  term: DefinedTermRecord
  at: { top: number; left: number } | null
  workId: string
  /** The unit that defines it — the popover's "read it in full" link. */
  definitionsUnitId: string | null
  /** True when it was read here, from the reader's own document. */
  extractedHere: boolean
  onClose: () => void
}

export function DefinitionPopover({
  term,
  at,
  workId,
  definitionsUnitId,
  extractedHere,
  onClose,
}: DefinitionPopoverProps) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={term.term}
      data-print-hide
      style={
        at
          ? {
              position: 'fixed',
              top: Math.min(at.top + 8, (globalThis.innerHeight || 800) - 240),
              left: Math.max(8, Math.min(at.left, (globalThis.innerWidth || 800) - 340)),
              maxWidth: 320,
            }
          : undefined
      }
      className="z-40 flex max-h-60 flex-col gap-2 overflow-auto rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">
          {term.marker ? `${term.marker} ` : ''}
          {term.term}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('library.terms.close')}
          className="-mt-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm">{term.definition}</p>

      {term.verify ? (
        <div className="flex flex-col gap-1">
          <Badge tone="warning">{t('common.verifyWithDdo')}</Badge>
          <p className="text-xs text-muted-foreground">{t('library.terms.verify')}</p>
        </div>
      ) : null}

      {extractedHere ? (
        <p className="text-xs text-muted-foreground">{t('library.terms.autoExtracted')}</p>
      ) : null}

      {definitionsUnitId ? (
        <Link
          to={toUnitHref(workId, definitionsUnitId)}
          onClick={onClose}
          className="text-xs text-primary underline underline-offset-4"
        >
          {t('library.terms.read')}
        </Link>
      ) : null}
    </div>
  )
}
