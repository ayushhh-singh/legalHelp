import type { LucideIcon } from 'lucide-react'
import { FileQuestion } from 'lucide-react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  body: string
  icon?: LucideIcon
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ title, body, icon: Icon = FileQuestion, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/60 px-6 py-12 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
