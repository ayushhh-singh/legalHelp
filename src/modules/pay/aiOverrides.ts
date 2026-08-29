import type { PayScenario } from '@/lib/pay/scenario'

/**
 * A `PayScenario` reshaped into the `overrides` object
 * `compute_pay_for_job`/`compare_jobs`/`explain_pay_line` (`src/ai/tools/pay.ts`)
 * accept — so "explain what I'm looking at" asks the agent to compute exactly
 * the scenario on screen, not the post's bare defaults.
 *
 * One field does not round-trip: `overrides` has no `basic` — a reader who
 * TYPED a custom basic pay instead of picking a cell gets the cell-derived
 * figure explained instead of their typed one. The tool schema would need a
 * `basic` override to close this; left as-is rather than widening
 * `src/ai/tools/pay.ts` for an edge case this session did not touch otherwise.
 */
export function overridesFromScenario(scenario: PayScenario): Record<string, unknown> {
  return {
    level: scenario.level,
    cell: scenario.cellIndex + 1,
    ...(scenario.cityId ? { cityId: scenario.cityId } : {}),
    daRate: scenario.daRate,
    quarters: scenario.quarters,
    pensionScheme: scenario.pensionScheme,
    regime: scenario.regime,
    children: scenario.children,
    npa: scenario.npa,
    allowances: scenario.allowances.map((choice) => ({
      id: choice.id,
      enabled: choice.enabled,
      ...(choice.rateKey ? { rateKey: choice.rateKey } : {}),
    })),
  }
}
