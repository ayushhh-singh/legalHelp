import type { StudySessionRow } from './types'

/**
 * The study session timer.
 *
 * Everything here is WALL-CLOCK ARITHMETIC over `startedAt`, never a counter
 * that ticks. A counter dies with the tab, and a reader who closes a laptop for
 * lunch would come back to a session that thinks it has been running for four
 * hours or for none. The row carries only the instant the session began; how
 * far into it the reader is, which pomodoro phase they are in, and how many
 * focused minutes have accrued are all computed from that instant and the
 * current one — which is also what makes the whole file pure and testable
 * against a frozen clock.
 */

/** The Pomodoro shape the brief names, and the only one this app offers. */
export const POMODORO_WORK_MINUTES = 25
export const POMODORO_BREAK_MINUTES = 5

const MS_PER_MINUTE = 60_000

export type SessionMode = StudySessionRow['mode']

export interface PomodoroConfig {
  workMinutes: number
  breakMinutes: number
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  workMinutes: POMODORO_WORK_MINUTES,
  breakMinutes: POMODORO_BREAK_MINUTES,
}

/**
 * A stored or typed configuration is untrusted. Clamped rather than rejected:
 * a corrupt row must not make the timer unopenable, and a work interval of zero
 * would divide by zero in `phaseAt`.
 */
export function clampPomodoro(value: Partial<PomodoroConfig> | undefined): PomodoroConfig {
  const clamp = (n: unknown, fallback: number, min: number, max: number): number => {
    const value = typeof n === 'number' ? Math.round(n) : NaN
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  }
  return {
    workMinutes: clamp(value?.workMinutes, POMODORO_WORK_MINUTES, 5, 90),
    breakMinutes: clamp(value?.breakMinutes, POMODORO_BREAK_MINUTES, 1, 30),
  }
}

export interface SessionPhase {
  phase: 'work' | 'break'
  /** How many complete work intervals are behind this moment. */
  completed: number
  /** Seconds left in the current phase. Never negative. */
  remainingSeconds: number
  /** Seconds since the session began. */
  elapsedSeconds: number
}

const elapsedMs = (session: Pick<StudySessionRow, 'startedAt'>, now: Date): number => {
  const started = Date.parse(session.startedAt)
  // An unreadable timestamp degrades to "just started" rather than to NaN
  // arithmetic that would render "NaN:NaN" on the timer.
  if (Number.isNaN(started)) return 0
  return Math.max(0, now.getTime() - started)
}

/**
 * Where a running session is right now.
 *
 * In free mode there are no phases: the reader is working until they stop, and
 * `remainingSeconds` is zero because nothing is counting down.
 */
export function phaseAt(
  session: Pick<StudySessionRow, 'startedAt' | 'mode'>,
  now: Date,
  config: PomodoroConfig = DEFAULT_POMODORO,
): SessionPhase {
  const elapsed = elapsedMs(session, now)
  const elapsedSeconds = Math.floor(elapsed / 1000)
  if (session.mode === 'free') {
    return { phase: 'work', completed: 0, remainingSeconds: 0, elapsedSeconds }
  }

  const { workMinutes, breakMinutes } = clampPomodoro(config)
  const cycle = (workMinutes + breakMinutes) * MS_PER_MINUTE
  const intoCycle = elapsed % cycle
  const cycles = Math.floor(elapsed / cycle)
  const workMs = workMinutes * MS_PER_MINUTE

  if (intoCycle < workMs) {
    return {
      phase: 'work',
      completed: cycles,
      remainingSeconds: Math.ceil((workMs - intoCycle) / 1000),
      elapsedSeconds,
    }
  }
  return {
    phase: 'break',
    completed: cycles + 1,
    remainingSeconds: Math.ceil((cycle - intoCycle) / 1000),
    elapsedSeconds,
  }
}

/**
 * The FOCUSED minutes a session is worth — which in Pomodoro mode is not the
 * same as the minutes it lasted.
 *
 * Break time is not study time, and counting it would make the weekly review a
 * report on how long the app was open. In free mode the two are the same, and
 * the session is capped at four hours: a session left running overnight is a
 * forgotten timer, not a night of study, and letting it into the weekly total
 * would make every other number on that screen meaningless.
 */
export const MAX_SESSION_MINUTES = 240

export function focusedMinutes(
  session: Pick<StudySessionRow, 'startedAt' | 'mode'>,
  now: Date,
  config: PomodoroConfig = DEFAULT_POMODORO,
): number {
  const elapsed = elapsedMs(session, now)
  if (session.mode === 'free') {
    return Math.min(MAX_SESSION_MINUTES, Math.floor(elapsed / MS_PER_MINUTE))
  }

  const { workMinutes, breakMinutes } = clampPomodoro(config)
  const cycle = (workMinutes + breakMinutes) * MS_PER_MINUTE
  const cycles = Math.floor(elapsed / cycle)
  const intoCycle = elapsed % cycle
  const partial = Math.min(intoCycle, workMinutes * MS_PER_MINUTE)
  const minutes = Math.floor((cycles * workMinutes * MS_PER_MINUTE + partial) / MS_PER_MINUTE)
  return Math.min(MAX_SESSION_MINUTES, minutes)
}

/** Completed work intervals. Zero in free mode, where there are none to complete. */
export function completedPomodoros(
  session: Pick<StudySessionRow, 'startedAt' | 'mode'>,
  now: Date,
  config: PomodoroConfig = DEFAULT_POMODORO,
): number {
  if (session.mode === 'free') return 0
  const { workMinutes, breakMinutes } = clampPomodoro(config)
  const cycle = (workMinutes + breakMinutes) * MS_PER_MINUTE
  const elapsed = elapsedMs(session, now)
  const cycles = Math.floor(elapsed / cycle)
  const intoCycle = elapsed % cycle
  return cycles + (intoCycle >= workMinutes * MS_PER_MINUTE ? 1 : 0)
}

/** `mm:ss`, or `h:mm:ss` past an hour. Tabular, for the timer. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

/**
 * Close a running session.
 *
 * A session that produced under a minute of focused time is DISCARDED rather
 * than stored as zero: the log is what the weekly review is built from, and a
 * page opened and closed is not a study session. The caller is told, so it can
 * say so rather than silently appearing to have saved something.
 */
export function endSession(
  session: StudySessionRow,
  now: Date,
  config: PomodoroConfig = DEFAULT_POMODORO,
): { row: StudySessionRow; keep: boolean } {
  const minutes = focusedMinutes(session, now, config)
  return {
    row: {
      ...session,
      endedAt: now.toISOString(),
      minutes,
      pomodoros: completedPomodoros(session, now, config),
    },
    keep: minutes >= 1,
  }
}
