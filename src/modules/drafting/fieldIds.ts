import type { Lang } from '@/lib/drafting/types'

/**
 * The DOM id of a field's control, derived from the field id rather than from
 * `useId`.
 *
 * Two things depend on it being predictable: the body toolbar moves focus to
 * the Enclosures and Copy-to boxes by id when it adds a line to them, and the
 * Playwright suite addresses a field without depending on a React-generated
 * `:r3:`. A split field has one id per side.
 *
 * It lives in its own module rather than beside the components that use it so
 * that `FormFields.tsx` exports components and nothing else — which is what
 * keeps fast refresh working for the whole form.
 */
export const controlId = (fieldId: string, side?: Lang): string =>
  side ? `draft-field-${fieldId}-${side}` : `draft-field-${fieldId}`
