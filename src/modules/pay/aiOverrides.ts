import { scenarioForJob, type PayScenario } from '@/lib/pay/scenario'
import type { PayTables } from '@/lib/pay/tables'

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

/**
 * True when a scenario has moved off the post's own standard entry point —
 * Level, cell and city — which is exactly what `compare_jobs` falls back to
 * when only `{ daRate }` is forwarded (`PayCompareAiPanel`, since that tool
 * applies its one `overrides` object to BOTH posts and a per-side level/cell
 * cannot be forwarded through it without corrupting the other side). A
 * scenario with no `jobId` is never "customised" in this sense — there is no
 * post default for it to have moved away from.
 */
export function isCustomisedScenario(scenario: PayScenario, tables: PayTables): boolean {
  if (!scenario.jobId) return false
  const entryDefault = scenarioForJob(scenario.jobId, tables, { daRate: scenario.daRate })
  return scenario.level !== entryDefault.level || scenario.cellIndex !== 0 || scenario.cityId !== null
}
