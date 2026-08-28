import type { LucideIcon } from 'lucide-react'

import { SectionCard } from './SectionCard'

import { cn } from '@/lib/utils'

interface InfoCardProps {
  title: string
  description?: string
  icon?: LucideIcon
  /** Draws the file tab. See SectionCard. */
  active?: boolean
  footer?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

/** Titled card: the common "heading + body + optional footer" shape. */
export function InfoCard({
  title,
  description,
  icon: Icon,
  active,
  footer,
  children,
  className,
}: InfoCardProps) {
  return (
    <SectionCard active={active} className={cn('p-5', className)}>
      <div className="flex items-start gap-3">
        {Icon ? <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      {footer ? <div className="mt-4 border-t border-border pt-3">{footer}</div> : null}
    </SectionCard>
  )
}
