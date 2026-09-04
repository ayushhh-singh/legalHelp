import { createPortal } from 'react-dom'

import { useFocusHost, type FocusHost } from './focusSlots'

/**
 * Render this page's own controls into the focus bar.
 *
 * A portal rather than a node stored in state, for the reason `focusSlots.tsx`
 * gives at length: an element is a new object on every render, so an effect
 * that depended on one would set state, re-render, and fire again. A portal
 * also keeps the controls in the PAGE's React tree — its state, its handlers,
 * no stale closures — while putting them in the BAR's DOM, in reading order,
 * which is what makes the tab order right.
 *
 * Renders nothing at all outside a `FocusLayout`: a page mounted bare by a test
 * renderer, or reachable at another level, loses the bar controls rather than
 * throwing.
 */
export function FocusSlot({ host, children }: { host: FocusHost; children: React.ReactNode }) {
  const element = useFocusHost(host)
  return element ? createPortal(children, element) : null
}
