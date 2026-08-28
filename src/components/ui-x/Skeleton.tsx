import { cn } from '@/lib/utils'

/**
 * Loading placeholder. `animate-pulse` is the one animation in the app, and the
 * prefers-reduced-motion rule in index.css stops it — a skeleton that has
 * stopped pulsing still reads as "not here yet" because of its shape.
 */
export function Skeleton({ className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
