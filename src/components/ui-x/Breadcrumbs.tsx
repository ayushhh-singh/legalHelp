import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: string
  /** Omitted on the last crumb, which is the current page. */
  to?: string
}

/**
 * The separator is a decorative icon inside the <li>, not CSS `content` — a
 * pseudo-element separator is read out by some screen readers as a glyph.
 */
export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  const { t } = useT()

  // An empty trail would leave a labelled but empty navigation landmark, which
  // is noise for anyone listing landmarks.
  if (items.length === 0) return null

  return (
    <nav aria-label={t('a11y.breadcrumbs')} className={cn('text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="rounded-sm text-primary hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="font-medium text-foreground">
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
