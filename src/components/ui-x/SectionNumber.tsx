import { cn } from '@/lib/utils'

/**
 * Half of the signature: a law section number or a pay level, set in the body
 * face with tabular numerals so a column of them aligns. Used sparingly — this
 * is the chip that says "this is a citation", not decoration.
 */
export function SectionNumber({ className, ...props }: React.ComponentPropsWithRef<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm bg-muted px-2 py-0.5 text-sm font-semibold text-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  )
}
