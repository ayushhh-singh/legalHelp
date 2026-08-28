import { AlertTriangle, CalendarClock, Info, TriangleAlert } from 'lucide-react'

import type { SectionNote } from '../types'

import { SourceChip } from '@/components/common/SourceChip'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * A curated warning — the number-swap traps above all.
 *
 * These are the highest-value thing in the module and the only content in it
 * a human wrote rather than a source stated, so each one carries its own source
 * link (`data/law/overlays/traps-and-transitional.json`, ADR-012).
 *
 * A `trap` is `role="alert"`-worthy in the ordinary sense of the word but is
 * NOT given that role: it is present when the card renders rather than
 * appearing in response to something, and an alert that fires on every card
 * teaches readers to ignore alerts. The tint, the icon and the heading carry it.
 */

const KIND: Record<SectionNote['kind'], { icon: typeof Info; className: string }> = {
  trap: { icon: TriangleAlert, className: 'border-coral bg-coral/15 text-coral-foreground' },
  caution: { icon: AlertTriangle, className: 'border-marigold bg-marigold/15 text-marigold-foreground' },
  transitional: { icon: CalendarClock, className: 'border-marigold bg-marigold/15 text-marigold-foreground' },
  context: { icon: Info, className: 'border-border bg-muted text-muted-foreground' },
}

export function NoteBanner({ note, className }: { note: SectionNote; className?: string }) {
  const { language } = useT()
  const style = KIND[note.kind] ?? KIND.context
  const Icon = style.icon

  return (
    <aside className={cn('rounded-md border-l-[3px] px-3 py-2.5 text-sm', style.className, className)}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold">{note.title[language] || note.title.en}</p>
          <p>{note.body[language] || note.body.en}</p>
          {note.source ? (
            <SourceChip
              name={note.source.name[language] || note.source.name.en}
              url={note.source.url}
              className="mt-1"
            />
          ) : null}
        </div>
      </div>
    </aside>
  )
}
