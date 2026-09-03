import { describe, expect, it } from 'vitest'

import {
  clampPomodoro,
  completedPomodoros,
  DEFAULT_POMODORO,
  endSession,
  focusedMinutes,
  formatDuration,
  MAX_SESSION_MINUTES,
  phaseAt,
  POMODORO_BREAK_MINUTES,
  POMODORO_WORK_MINUTES,
} from './sessions'
import type { StudySessionRow } from './types'

/**
 * The timer, against a frozen clock.
 *
 * Every function here is wall-clock arithmetic over `startedAt`, which is what
 * makes it testable at all: a counter that ticked would need fake timers, and
 * a test that installs fake timers and then times out never restores the clock
 * (CLAUDE.md's own note from Session 27).
 */

const START = '2026-09-03T09:00:00.000Z'
const at = (minutes: number): Date => new Date(Date.parse(START) + minutes * 60_000)

const session = (over: Partial<StudySessionRow> = {}): StudySessionRow => ({
  id: 's1',
  workId: 'rti',
  nodeId: null,
  mode: 'pomodoro',
  startedAt: START,
  endedAt: null,
  minutes: 0,
  pomodoros: 0,
  ...over,
})

describe('clampPomodoro', () => {
  it('defaults to 25/5', () => {
    expect(clampPomodoro(undefined)).toEqual({ workMinutes: 25, breakMinutes: 5 })
    expect(DEFAULT_POMODORO.workMinutes).toBe(POMODORO_WORK_MINUTES)
    expect(DEFAULT_POMODORO.breakMinutes).toBe(POMODORO_BREAK_MINUTES)
  })

  it('clamps rather than rejecting, so a corrupt row cannot break the timer', () => {
    expect(clampPomodoro({ workMinutes: 0, breakMinutes: 0 })).toEqual({ workMinutes: 5, breakMinutes: 1 })
    expect(clampPomodoro({ workMinutes: 999, breakMinutes: 999 })).toEqual({
      workMinutes: 90,
      breakMinutes: 30,
    })
  })

  it('refuses a non-number and falls back', () => {
    expect(clampPomodoro({ workMinutes: NaN })).toEqual({ workMinutes: 25, breakMinutes: 5 })
    expect(clampPomodoro({ workMinutes: 'x' as unknown as number })).toEqual({
      workMinutes: 25,
      breakMinutes: 5,
    })
  })

  it('rounds a fractional value', () => {
    expect(clampPomodoro({ workMinutes: 25.6 }).workMinutes).toBe(26)
  })
})

describe('phaseAt', () => {
  it('has no phases in free mode', () => {
    const phase = phaseAt(session({ mode: 'free' }), at(90))
    expect(phase).toEqual({ phase: 'work', completed: 0, remainingSeconds: 0, elapsedSeconds: 5400 })
  })

  it('counts down the work interval', () => {
    expect(phaseAt(session(), at(0))).toMatchObject({ phase: 'work', completed: 0, remainingSeconds: 1500 })
    expect(phaseAt(session(), at(10))).toMatchObject({ phase: 'work', remainingSeconds: 900 })
  })

  it('switches to the break exactly at the work boundary', () => {
    expect(phaseAt(session(), at(24.99)).phase).toBe('work')
    expect(phaseAt(session(), at(25)).phase).toBe('break')
    expect(phaseAt(session(), at(25)).completed).toBe(1)
  })

  it('starts the second work interval at the end of the cycle', () => {
    expect(phaseAt(session(), at(30)).phase).toBe('work')
    expect(phaseAt(session(), at(30)).completed).toBe(1)
  })

  it('degrades an unreadable timestamp to "just started" rather than NaN', () => {
    const phase = phaseAt(session({ startedAt: 'not a date' }), at(10))
    expect(phase.elapsedSeconds).toBe(0)
    expect(Number.isNaN(phase.remainingSeconds)).toBe(false)
  })

  it('never reports a negative remaining time when the clock has gone backwards', () => {
    expect(phaseAt(session(), at(-30)).elapsedSeconds).toBe(0)
  })
})

describe('focusedMinutes', () => {
  it('counts every minute in free mode', () => {
    expect(focusedMinutes(session({ mode: 'free' }), at(47))).toBe(47)
  })

  it('excludes break time in pomodoro mode', () => {
    // 30 minutes of wall clock is 25 focused and 5 on a break.
    expect(focusedMinutes(session(), at(30))).toBe(25)
    // 60 minutes is two full work intervals plus five minutes into the third.
    expect(focusedMinutes(session(), at(65))).toBe(55)
  })

  it('counts a partial work interval', () => {
    expect(focusedMinutes(session(), at(10))).toBe(10)
  })

  it('caps a forgotten timer at four hours', () => {
    // A session left running overnight is a forgotten timer, not a night of
    // study, and letting it into the weekly total makes every other number on
    // that screen meaningless.
    expect(focusedMinutes(session({ mode: 'free' }), at(60 * 24))).toBe(MAX_SESSION_MINUTES)
    expect(focusedMinutes(session(), at(60 * 24))).toBe(MAX_SESSION_MINUTES)
  })
})

describe('completedPomodoros', () => {
  it('is always zero in free mode', () => {
    expect(completedPomodoros(session({ mode: 'free' }), at(200))).toBe(0)
  })

  it('counts a work interval as complete the moment it ends', () => {
    expect(completedPomodoros(session(), at(24))).toBe(0)
    expect(completedPomodoros(session(), at(25))).toBe(1)
    expect(completedPomodoros(session(), at(55))).toBe(2)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [9, '00:09'],
    [90, '01:30'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('%i → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('never renders a negative time', () => {
    expect(formatDuration(-30)).toBe('00:00')
  })
})

describe('endSession', () => {
  it('stamps the end and writes the focused minutes', () => {
    const { row, keep } = endSession(session(), at(30))
    expect(keep).toBe(true)
    expect(row.endedAt).toBe(at(30).toISOString())
    expect(row.minutes).toBe(25)
    expect(row.pomodoros).toBe(1)
  })

  it('discards a session under a minute rather than logging a zero', () => {
    const { keep } = endSession(session({ mode: 'free' }), at(0.5))
    expect(keep).toBe(false)
  })

  it('keeps a session of exactly one minute', () => {
    expect(endSession(session({ mode: 'free' }), at(1)).keep).toBe(true)
  })

  it('preserves everything else on the row', () => {
    const { row } = endSession(session({ nodeId: 'ch-1' }), at(30))
    expect(row.id).toBe('s1')
    expect(row.workId).toBe('rti')
    expect(row.nodeId).toBe('ch-1')
    expect(row.startedAt).toBe(START)
  })
})
