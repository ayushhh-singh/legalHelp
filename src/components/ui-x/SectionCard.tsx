import { cn } from '@/lib/utils'

interface SectionCardProps extends React.ComponentPropsWithRef<'section'> {
  /**
   * Draws the file tab — a 3px --marigold index tab on the card's top edge.
   * THE signature element. One card per screen at most: a page of tabbed cards
   * is a page with no emphasis.
   */
  active?: boolean
}

/**
 * The standard content container: a card with an optional index tab.
 *
 * `overflow-hidden` is what lets the tab sit flush inside the rounded corner
 * instead of overhanging it — and it is applied ONLY when there is a tab to
 * clip. A card without one has no reason to clip its children, and clipping
 * them unconditionally cut the bottom off every combobox listbox on the Pay
 * form: the popup is absolutely positioned inside the card, so the card's own
 * bounds became the popup's, and a list of sixty posts showed two.
 */
export function SectionCard({ active = false, className, children, ...props }: SectionCardProps) {
  return (
    <section
      className={cn(
        'relative rounded-lg border border-border bg-card',
        active && 'overflow-hidden',
        className,
      )}
      {...props}
    >
      {active ? (
        <span aria-hidden="true" className="absolute top-0 left-5 h-[3px] w-12 rounded-b-sm bg-marigold" />
      ) : null}
      {children}
    </section>
  )
}
