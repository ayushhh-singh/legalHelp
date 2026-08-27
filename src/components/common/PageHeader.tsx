import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}

/**
 * Page masthead. The title uses the display face (Tiro Devanagari Hindi) so
 * Hindi and English headings share one typographic voice; the subtitle drops to
 * the UI face.
 *
 * Deliberately a <div>, not a <header>: this sits inside <main>, where a
 * <header> is only a generic element per the HTML-AAM scoping rule. Some
 * tooling ignores that rule and reports a second `banner` landmark, so the
 * ambiguity is removed at the source. The <h1> carries the semantics.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4', className)}
    >
      <div className="space-y-1">
        <h1 className="font-display text-2xl leading-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="font-sans text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
