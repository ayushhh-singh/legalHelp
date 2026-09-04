import type { PayScenario } from '@/lib/pay/scenario'
import { db, getSetting, setSetting, SETTING_KEYS, type PayScenarioRow } from '@/db'

/**
 * Named pay scenarios, on the device.
 *
 * Two different things are stored, and only one of them is the reader's:
 *
 *  - **The last scenario**, in `settings.pay`. It is a convenience — reopening
 *    `/tools/salary` puts back the form as it was left — and it is overwritten silently.
 *  - **Named scenarios**, in `payScenarios`. These the reader created
 *    deliberately, so nothing here ever deletes one to make room. When the
 *    limit is reached `saveScenario` REFUSES and says so; evicting the oldest
 *    would be this app quietly throwing away something a reader saved on
 *    purpose, which no amount of convenience justifies.
 */

/** The brief's limit. Ten named scenarios is a comparison set, not an archive. */
export const MAX_SCENARIOS = 10

export type SaveResult = { ok: true; row: PayScenarioRow } | { ok: false; reason: 'full' | 'empty-name' }

const now = () => new Date().toISOString()

/**
 * An id derived from the name, so saving under a name that already exists
 * updates that scenario instead of making a second one the reader cannot tell
 * apart. Falls back to a timestamp for a name with no usable characters.
 */
export function scenarioId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    // `\p{M}` as well as `\p{L}`: Devanagari vowel signs are combining MARKS,
    // so "दिल्ली पोस्टिंग" was reduced to "द-ल-ल-प-स-ट-ग" — every matra gone,
    // and two different names much likelier to collide on one id.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || `scenario-${Date.now()}`
}

export async function listScenarios(): Promise<PayScenarioRow[]> {
  const rows = await db.payScenarios.orderBy('updatedAt').reverse().toArray()
  return rows
}

export async function saveScenario(name: string, scenario: PayScenario): Promise<SaveResult> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'empty-name' }

  const id = scenarioId(trimmed)
  const existing = await db.payScenarios.get(id)
  if (!existing && (await db.payScenarios.count()) >= MAX_SCENARIOS) {
    return { ok: false, reason: 'full' }
  }

  const row: PayScenarioRow = {
    id,
    name: trimmed,
    // Structured-cloned into IndexedDB, so it must be a plain object. It is:
    // `PayScenario` holds only strings, numbers, booleans and arrays of them.
    scenario: { ...scenario, allowances: scenario.allowances.map((choice) => ({ ...choice })) },
    jobId: scenario.jobId,
    level: scenario.level,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  }
  await db.payScenarios.put(row)
  return { ok: true, row }
}

export async function deleteScenario(id: string): Promise<void> {
  await db.payScenarios.delete(id)
}

/**
 * The last scenario, for reopening the route where it was left.
 *
 * A row written by an earlier release is untrusted input: the shape may have
 * changed, and IndexedDB has no schema to stop it. Anything that does not look
 * like a scenario is dropped rather than merged, because a half-restored form
 * is worse than an empty one.
 */
export async function readLastScenario(): Promise<PayScenario | null> {
  return asScenario(await getSetting<unknown>(SETTING_KEYS.pay))
}

export async function writeLastScenario(scenario: PayScenario): Promise<void> {
  await setSetting(SETTING_KEYS.pay, scenario)
}

export function asScenario(value: unknown): PayScenario | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.level !== 'string') return null
  if (typeof record.daRate !== 'number') return null
  if (!Array.isArray(record.allowances)) return null
  // Every entry, not just the array. A row from an older release can hold
  // anything, and a `null` in here used to reach the engine and throw.
  const wellFormed = record.allowances.every(
    (choice) =>
      Boolean(choice) && typeof choice === 'object' && typeof (choice as { id?: unknown }).id === 'string',
  )
  if (!wellFormed) return null
  return value as PayScenario
}
