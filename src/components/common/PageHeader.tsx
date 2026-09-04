import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
  /**
   * The heading level this masthead claims.
   *
   * `h1` — the default — is a page that IS the subject: a detail page, the
   * Home screen, a work in the reader. `h2` is a page rendered INSIDE a
   * section, where `TabLayout` has already put the section's own `<h1>` above
   * the sub-tab strip (ADR-046). Four sub-tabs of one section each claiming to
   * be the top of the document is exactly the flatness the restructure removed,
   * and a screen-reader user moving by heading level is who notices.
   */
  as?: 'h1' | 'h2'
}

/**
 * Page masthead. The heading inherits --font-heading from the base layer, so a
 * Latin title renders in Poppins and a Devanagari one falls through to Noto
 * Sans Devanagari glyph-by-glyph (Poppins carries no Devanagari — tokens.css).
 *
 * Deliberately a <div>, not a <header>: this sits inside <main>, where a
 * <header> is only a generic element per the HTML-AAM scoping rule. Some tooling
 * ignores that rule and reports a second `banner` landmark, so the ambiguity is
 * removed at the source. The heading carries the semantics.
 */
export function PageHeader({ title, subtitle, actions, className, as = 'h1' }: PageHeaderProps) {
  const Heading = as
  return (
    <div
      className={cn('flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4', className)}
    >
      <div className="space-y-1">
        <Heading
          className={cn(
            'leading-tight font-semibold',
            as === 'h1' ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl',
          )}
        >
          {title}
        </Heading>
        {subtitle ? <p className="font-sans text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
