/**
 * One rounding rule, applied at every line.
 *
 * The Dearness Allowance order states it in terms — "fractions of 50 paise and
 * above are rounded to the next higher rupee; less than 50 paise is ignored" —
 * and `data/pay/allowances.json` carries that sentence as a condition on the DA
 * record. A DDO applies it line by line, not once at the bottom, so a pay slip
 * that rounds only the net differs from the one an officer is actually paid.
 *
 * `Math.round` is half-up for non-negative values, which is what the order
 * says. Every figure this module rounds is non-negative; `rupees` asserts
 * nothing about negatives because there are none to assert about.
 */
export const rupees = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0)

/** A percentage of an amount, rounded to the rupee. */
export const percentOf = (amount: number, rate: number): number => rupees((amount * rate) / 100)

/**
 * Section 288A: total income is rounded to the nearest ten rupees before tax is
 * computed on it. Kept separate from `rupees` because it is a different rule
 * from a different statute, and collapsing the two would hide that.
 */
export const nearestTen = (value: number): number =>
  Number.isFinite(value) ? Math.round(value / 10) * 10 : 0
