import { cardsForUnit } from './coverage'
import { readinessFor, type UnitReadiness } from './readiness'
import { paperUnits } from './types'

import type { StudyGoalRow } from '@/db'
import { addIstDays, compareStrings, istDay, type IstDay, type SrsCardRow } from '@/lib/srs'
import { MAX_SESSION_MINUTES } from '@/lib/study'
import type { ExamProfile } from '@/schemas/exam'
import type { Card } from '@/modules/trainer/schema'

/**
 * The day-by-day study plan.
 *
 * Pure, deterministic, and given its clock. The same inputs produce the same
 * plan on two devices, which is the property the whole screen rests on: a plan
 * that reshuffled itself on every visit is a plan nobody follows.
 *
 * **The plan is never stored.** `examChoices` holds the profile, the target
 * date and the daily budget — the reader's CHOICES — and this function rebuilds
 * the plan from them and from the schedule as it stands now. That is the
 * important design decision here, and it is the one that makes the plan useful:
 * a stored plan is out of date the moment a card is graded, and a reader who
 * has raced ahead on the Leave Rules should not be sent back to them on
 * Thursday because a plan written on Monday said so.
 *
 * ## The ordering
 *
 * `priority = marks × (1 − ready)` — the marks still to be won. Not accuracy: a
 * unit worth thirty marks the reader is half-ready on is worth more of a
 * limited evening than one worth eight they have not started. Time remaining
 * enters as the number of days there are to allocate, not as a factor in the
 * ordering, which is the honest place for it — it decides how much fits, not
 * what matters.
 *
 * ## The revision sprint
 *
 * The last 15% of the window (at least one day, and at least one day of build
 * before it) stops introducing anything and cycles every mapped unit in weight
 * order, heaviest first. `SPRINT_FRACTION` is the brief's figure.
 */

/** The tail of the window that is revision rather than new ground. */
export const SPRINT_FRACTION = 0.15

/** No plan is drawn beyond this. A date further out is a typo, not a plan. */
export const MAX_PLAN_DAYS = 400

/** What a day gets when nothing else says otherwise. Two study sessions. */
export const DEFAULT_DAILY_MINUTES = 50

/** Minutes a plan will ever put on one day. `src/lib/study`'s own session cap. */
export const MAX_DAILY_MINUTES = MAX_SESSION_MINUTES

/** Rough minutes per card, used to turn a time budget into a card count. */
const MINUTES_PER_CARD = 0.5
/** A reading task's share of a day, before the drill takes the rest. */
const READ_MINUTES = 20
/** A revision-sprint task: one printable sheet, read through. */
const REVISE_MINUTES = 25

export type PlanPhase = 'build' | 'revision'

export type PlanTaskKind = 'read' | 'drill' | 'revise' | 'mock'

export interface PlanTask {
  kind: PlanTaskKind
  /** `<paperId>:<unitId>`. Null only on a `mock` task, which is the whole paper. */
  unitKey: string | null
  paperId: string | null
  unitId: string | null
  /** The act to open in the Trainer, and the Library work of the same id. */
  actId: string | null
  /** Null unless the act is one of the works the caller said the Library has. */
  workId: string | null
  minutes: number
  /** Cards to aim at, on a `drill`. Zero on every other kind. */
  cards: number
}

export interface PlanDay {
  day: IstDay
  phase: PlanPhase
  tasks: PlanTask[]
  minutes: number
}

export interface Plan {
  days: PlanDay[]
  /** IST day the plan starts on — today, or the target date if it is sooner. */
  from: IstDay
  to: IstDay
  /** Where the sprint begins. Equal to `to` where the window is one day. */
  sprintFrom: IstDay
  dailyMinutes: number
  /**
   * Mapped units the window was too short to reach, worst-priority last.
   *
   * Reported rather than dropped: a plan that silently covers eleven of
   * nineteen units looks exactly like a plan that covers the syllabus, and the
   * screen says how many it could not fit and what they were.
   */
  notReached: string[]
  /** Null when the target date has already passed — there is no plan to draw. */
  expired: boolean
}

export interface PlanInput {
  profile: ExamProfile
  catalogue: readonly Card[]
  states: ReadonlyMap<string, SrsCardRow>
  now: Date
  targetDate: IstDay
  /**
   * The reader's Session 28 study goals, one per Library work.
   *
   * The plan's daily budget is the LARGEST weekly minutes goal the reader has
   * set on any work this examination draws on, divided by seven — because a
   * goal is a promise the reader made about their own week and a plan that
   * ignores it is a plan that argues with them every evening. Where they have
   * set none, `dailyMinutes` falls back to `DEFAULT_DAILY_MINUTES`.
   */
  goals?: readonly StudyGoalRow[]
  /** An explicit budget, which always wins over the goals. */
  dailyMinutes?: number
  /** Library work ids the caller knows exist, so `read` tasks point somewhere real. */
  libraryWorkIds?: readonly string[]
}

/** The daily minute budget, from the explicit figure or from the goals. */
export function dailyBudget(input: Pick<PlanInput, 'goals' | 'dailyMinutes' | 'profile'>): number {
  if (input.dailyMinutes !== undefined && Number.isFinite(input.dailyMinutes)) {
    return Math.min(MAX_DAILY_MINUTES, Math.max(10, Math.round(input.dailyMinutes)))
  }
  const acts = new Set<string>()
  for (const { unit } of paperUnits(input.profile)) {
    if (!Array.isArray(unit.coverage)) continue
    for (const ref of unit.coverage) acts.add(ref.act)
  }
  let best = 0
  for (const goal of input.goals ?? []) {
    if (!acts.has(goal.id)) continue
    if (goal.minutesPerWeek && goal.minutesPerWeek > best) best = goal.minutesPerWeek
  }
  if (best === 0) return DEFAULT_DAILY_MINUTES
  return Math.min(MAX_DAILY_MINUTES, Math.max(10, Math.round(best / 7)))
}

/**
 * Days allocated to each unit, by priority, with a floor of one each.
 *
 * Largest-remainder over `priority`, then a pass that guarantees every unit at
 * least one day by taking days from the units that were given the most. Without
 * that second pass a reader who is strong on eight units and weak on one gets a
 * plan that never opens the other eight at all — and "cover every non-external
 * unit" is the claim `plan.test.ts` makes.
 */
function allocateDays(units: readonly UnitReadiness[], days: number): Map<string, number> {
  const out = new Map<string, number>()
  if (days <= 0 || units.length === 0) return out

  const ranked = [...units].sort((a, b) => b.gapMarks - a.gapMarks || compareStrings(a.key, b.key))
  const reachable = ranked.slice(0, days)

  const totalPriority = reachable.reduce((sum, unit) => sum + Math.max(unit.gapMarks, 0.001), 0)
  const exact = reachable.map((unit) => ({
    key: unit.key,
    share: (Math.max(unit.gapMarks, 0.001) / totalPriority) * days,
  }))

  let assigned = 0
  for (const entry of exact) {
    const floor = Math.max(1, Math.floor(entry.share))
    out.set(entry.key, floor)
    assigned += floor
  }

  // Hand out what the flooring left over, largest fractional part first; take
  // back what the floor-of-one overspent, from whoever holds the most.
  const remainders = exact
    .map((entry) => ({ key: entry.key, frac: entry.share - Math.floor(entry.share) }))
    .sort((a, b) => b.frac - a.frac || compareStrings(a.key, b.key))
  let index = 0
  while (assigned < days && remainders.length > 0) {
    const entry = remainders[index % remainders.length]!
    out.set(entry.key, (out.get(entry.key) ?? 0) + 1)
    assigned += 1
    index += 1
  }
  while (assigned > days) {
    const richest = [...out.entries()].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))[0]
    if (!richest || richest[1] <= 1) break
    out.set(richest[0], richest[1] - 1)
    assigned -= 1
  }
  return out
}

export function buildPlan(input: PlanInput): Plan {
  const today = istDay(input.now)
  const dailyMinutes = dailyBudget(input)
  const works = new Set(input.libraryWorkIds ?? [])

  const readiness = readinessFor({
    profile: input.profile,
    catalogue: input.catalogue,
    states: input.states,
    now: input.now,
    targetDate: input.targetDate,
  })

  const empty = (expired: boolean): Plan => ({
    days: [],
    from: today,
    to: input.targetDate,
    sprintFrom: input.targetDate,
    dailyMinutes,
    notReached: [],
    expired,
  })

  if (input.targetDate < today) return empty(true)

  const total = Math.min((readiness.daysRemaining ?? 0) + 1, MAX_PLAN_DAYS)
  if (total <= 0) return empty(true)

  // The sprint takes the tail, but never the whole window: with two days there
  // is one of each, and with one day the single day is a revision day, because
  // the day before an examination is not the day to meet a new rule.
  const sprintDays = total === 1 ? 1 : Math.max(1, Math.min(total - 1, Math.round(total * SPRINT_FRACTION)))
  const buildDays = total - sprintDays

  const mapped = readiness.units.filter((unit) => !unit.external && unit.servedCards > 0)
  const allocation = allocateDays(mapped, buildDays)
  const notReached = mapped
    .filter((unit) => !allocation.has(unit.key))
    .sort((a, b) => b.gapMarks - a.gapMarks || compareStrings(a.key, b.key))
    .map((unit) => unit.key)

  // Interleave rather than block: a reader who gets four consecutive days of
  // the CCA Rules stops. Each unit's days are spread across the build phase by
  // taking one from each unit in priority order, round after round.
  const byKey = new Map(mapped.map((unit) => [unit.key, unit]))
  const order = [...allocation.entries()].sort(
    (a, b) =>
      (byKey.get(b[0])?.gapMarks ?? 0) - (byKey.get(a[0])?.gapMarks ?? 0) || compareStrings(a[0], b[0]),
  )
  const queue: string[] = []
  const left = new Map(order)
  while (queue.length < buildDays) {
    let placed = false
    for (const [key] of order) {
      const remaining = left.get(key) ?? 0
      if (remaining <= 0) continue
      queue.push(key)
      left.set(key, remaining - 1)
      placed = true
      if (queue.length >= buildDays) break
    }
    if (!placed) break
  }

  const days: PlanDay[] = []

  for (let offset = 0; offset < total; offset += 1) {
    const day = addIstDays(today, offset)
    const phase: PlanPhase = offset >= buildDays ? 'revision' : 'build'
    const tasks =
      phase === 'build'
        ? buildDayTasks(queue[offset], byKey, input, works, dailyMinutes)
        : revisionDayTasks(offset - buildDays, sprintDays, mapped, input, works)
    days.push({ day, phase, tasks, minutes: tasks.reduce((sum, task) => sum + task.minutes, 0) })
  }

  return {
    days,
    from: today,
    to: input.targetDate,
    sprintFrom: addIstDays(today, buildDays),
    dailyMinutes,
    notReached,
    expired: false,
  }
}

function taskFor(
  kind: PlanTaskKind,
  unit: UnitReadiness | undefined,
  works: ReadonlySet<string>,
  minutes: number,
  cards: number,
): PlanTask {
  const actId = unit && Array.isArray(unit.unit.coverage) ? (unit.unit.coverage[0]?.act ?? null) : null
  return {
    kind,
    unitKey: unit?.key ?? null,
    paperId: unit?.paper.id ?? null,
    unitId: unit?.unit.id ?? null,
    actId,
    workId: actId && works.has(actId) ? actId : null,
    minutes,
    cards,
  }
}

function buildDayTasks(
  key: string | undefined,
  byKey: ReadonlyMap<string, UnitReadiness>,
  input: PlanInput,
  works: ReadonlySet<string>,
  dailyMinutes: number,
): PlanTask[] {
  const unit = key ? byKey.get(key) : undefined
  if (!unit) return []

  const tasks: PlanTask[] = []
  // Read first, drill second — the order the study layer already teaches, and
  // the order that makes the drill worth anything. Reading is dropped where the
  // Library has no work for the act, rather than pointing at a dead route: a
  // `read` task whose `workId` is null is a card on a plan with nowhere to go.
  const reading = taskFor('read', unit, works, Math.min(READ_MINUTES, dailyMinutes), 0)
  if (reading.workId) tasks.push(reading)

  const drillMinutes = Math.max(10, dailyMinutes - (tasks[0]?.minutes ?? 0))
  const wanted = Math.round(drillMinutes / MINUTES_PER_CARD)
  const available = cardsForUnit(unit.unit, input.catalogue).served.length
  tasks.push(taskFor('drill', unit, works, drillMinutes, Math.min(wanted, available)))
  return tasks
}

function revisionDayTasks(
  index: number,
  sprintDays: number,
  mapped: readonly UnitReadiness[],
  input: PlanInput,
  works: ReadonlySet<string>,
): PlanTask[] {
  // A mock on the first sprint day and, where the sprint is long enough, again
  // two-thirds of the way through it. Never on the last day: an examination
  // candidate's last evening is for revision, and a bad mock the night before
  // buys nothing but doubt.
  const isLast = index === sprintDays - 1
  const mockDays = new Set<number>()
  if (sprintDays >= 2) mockDays.add(0)
  if (sprintDays >= 5) mockDays.add(Math.floor(sprintDays * 0.66))
  mockDays.delete(sprintDays - 1)

  // A mock is only worth a day where there is a paper it can actually draw
  // questions for: an objective paper with at least one mapped unit that has
  // approved cards. Without this the all-external case put a "sit a mock" day
  // on a plan whose mock would have opened with zero questions on it.
  const drawable = new Set(mapped.map((unit) => unit.paper.id))
  const paper = input.profile.papers.find((candidate) => candidate.objective && drawable.has(candidate.id))

  if (paper && mockDays.has(index)) {
    return [
      {
        kind: 'mock',
        unitKey: null,
        paperId: paper.id,
        unitId: null,
        actId: null,
        workId: null,
        minutes: paper.durationMinutes,
        cards: 0,
      },
    ]
  }

  // Heaviest unit first, cycling. `index` walks the sprint, so a long sprint
  // comes round to the heaviest units more than once, which is what a sprint is.
  const byWeight = [...mapped].sort((a, b) => b.marks - a.marks || compareStrings(a.key, b.key))
  if (byWeight.length === 0) return []
  const perDay = isLast ? 3 : 2
  const tasks: PlanTask[] = []
  for (let n = 0; n < perDay; n += 1) {
    const unit = byWeight[(index * perDay + n) % byWeight.length]
    tasks.push(taskFor('revise', unit, works, REVISE_MINUTES, 0))
  }
  return tasks
}
