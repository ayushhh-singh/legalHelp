import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}

/**
 * Page masthead. The <h1> inherits --font-heading from the base layer, so a
 * Latin title renders in Poppins and a Devanagari one falls through to Noto
 * Sans Devanagari glyph-by-glyph (Poppins carries no Devanagari — tokens.css).
 *
 * Deliberately a <div>, not a <header>: this sits inside <main>, where a
 * <header> is only a generic element per the HTML-AAM scoping rule. Some tooling
 * ignores that rule and reports a second `banner` landmark, so the ambiguity is
 * removed at the source. The <h1> carries the semantics.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4', className)}
    >
      <div className="space-y-1">
        <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">{title}</h1>
        {subtitle ? <p className="font-sans text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
