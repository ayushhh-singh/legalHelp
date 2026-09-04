import { describe, expect, it } from 'vitest'

import { buildPlan, dailyBudget, DEFAULT_DAILY_MINUTES, MAX_PLAN_DAYS, SPRINT_FRACTION } from './plan'

import type { StudyGoalRow } from '@/db'
import { learningRow, makeMcqs, makeProfile, reviewRow, statesOf } from '@/test/exam-fixtures'

const NOW = new Date('2026-09-04T06:00:00.000Z') // 11:30 IST on 2026-09-04

const profile = makeProfile([
  {
    id: 'p1',
    marks: 150,
    units: [
      { id: 'conduct', weight: 0.4, acts: ['ccs-conduct'] },
      { id: 'leave', weight: 0.3, acts: ['ccs-leave'] },
      { id: 'gfr', weight: 0.2, acts: ['gfr'] },
      { id: 'outside', weight: 0.1, acts: null },
    ],
  },
  {
    id: 'p2',
    marks: 200,
    objective: false,
    units: [{ id: 'writing', weight: 1, acts: null }],
  },
])

const catalogue = [...makeMcqs('ccs-conduct', 30), ...makeMcqs('ccs-leave', 30), ...makeMcqs('gfr', 30)]

const WORKS = ['ccs-conduct', 'ccs-leave', 'gfr']

const plan = (targetDate: string, extra: Partial<Parameters<typeof buildPlan>[0]> = {}) =>
  buildPlan({
    profile,
    catalogue,
    states: new Map(),
    now: NOW,
    targetDate,
    libraryWorkIds: WORKS,
    ...extra,
  })

describe('buildPlan', () => {
  it('runs from today to the examination, inclusive of both', () => {
    const built = plan('2026-09-13')
    expect(built.from).toBe('2026-09-04')
    expect(built.to).toBe('2026-09-13')
    expect(built.days).toHaveLength(10)
    expect(built.days[0]?.day).toBe('2026-09-04')
    expect(built.days.at(-1)?.day).toBe('2026-09-13')
  })

  it('is DETERMINISTIC for a fixed clock', () => {
    // The property the screen rests on: a plan that reshuffled itself on every
    // visit is a plan nobody follows.
    expect(plan('2026-11-30')).toEqual(plan('2026-11-30'))
  })

  it('covers every non-external unit that has cards', () => {
    const built = plan('2026-11-30')
    const touched = new Set(
      built.days.flatMap((day) => day.tasks.map((task) => task.unitKey).filter(Boolean)),
    )
    expect(touched).toEqual(new Set(['p1:conduct', 'p1:leave', 'p1:gfr']))
    expect(built.notReached).toEqual([])
  })

  it('never puts an external unit on the plan', () => {
    const built = plan('2026-11-30')
    const keys = built.days.flatMap((day) => day.tasks.map((task) => task.unitKey))
    expect(keys).not.toContain('p1:outside')
    expect(keys).not.toContain('p2:writing')
  })

  it('puts the revision sprint in the final 15% and never earlier', () => {
    const built = plan('2026-12-03') // 91 days
    const sprintDays = built.days.filter((day) => day.phase === 'revision')
    expect(sprintDays).toHaveLength(Math.round(91 * SPRINT_FRACTION))
    // Contiguous, and at the end.
    const firstSprint = built.days.findIndex((day) => day.phase === 'revision')
    expect(built.days.slice(firstSprint).every((day) => day.phase === 'revision')).toBe(true)
    expect(built.sprintFrom).toBe(built.days[firstSprint]?.day)
  })

  it('introduces nothing during the sprint', () => {
    const built = plan('2026-12-03')
    for (const day of built.days.filter((d) => d.phase === 'revision')) {
      for (const task of day.tasks) {
        expect(['revise', 'mock']).toContain(task.kind)
      }
    }
  })

  it('makes a one-day window a revision day, not a build day', () => {
    // The day before an examination is not the day to meet a new rule.
    const built = plan('2026-09-04')
    expect(built.days).toHaveLength(1)
    expect(built.days[0]?.phase).toBe('revision')
  })

  it('gives a two-day window one of each', () => {
    const built = plan('2026-09-05')
    expect(built.days.map((day) => day.phase)).toEqual(['build', 'revision'])
  })

  it('reports a window that has already passed rather than drawing a plan', () => {
    const built = plan('2026-08-30')
    expect(built.expired).toBe(true)
    expect(built.days).toEqual([])
  })

  it('caps an absurd date rather than drawing ten thousand days', () => {
    const built = plan('2046-09-04')
    expect(built.days.length).toBe(MAX_PLAN_DAYS)
  })

  it('interleaves units rather than blocking them', () => {
    // A reader who gets four consecutive days of the CCA Rules stops.
    const built = plan('2026-10-04')
    const buildKeys = built.days.filter((day) => day.phase === 'build').map((day) => day.tasks[0]?.unitKey)
    const runs = buildKeys.filter((key, at) => at > 0 && key === buildKeys[at - 1]).length
    expect(runs).toBeLessThan(buildKeys.length / 2)
  })

  it('spends more days on the unit with more marks at stake', () => {
    const built = plan('2026-11-30')
    const count = (key: string) =>
      built.days.filter((day) => day.phase === 'build' && day.tasks[0]?.unitKey === key).length
    expect(count('p1:conduct')).toBeGreaterThan(count('p1:gfr'))
  })

  it('lets progress change the ordering — a unit already held drops down', () => {
    const held = statesOf(makeMcqs('ccs-conduct', 30).map((card) => reviewRow(card.id, 60)))
    const fresh = plan('2026-11-30')
    const after = plan('2026-11-30', { states: held })
    const days = (built: typeof fresh, key: string) =>
      built.days.filter((day) => day.phase === 'build' && day.tasks[0]?.unitKey === key).length
    expect(days(after, 'p1:conduct')).toBeLessThan(days(fresh, 'p1:conduct'))
  })

  it('reports units the window was too short to reach rather than dropping them', () => {
    // Two build days, three units. A plan that quietly covered two of three
    // looks exactly like a plan that covered the syllabus.
    const built = plan('2026-09-06')
    expect(built.notReached.length).toBeGreaterThan(0)
    for (const key of built.notReached) expect(key.startsWith('p1:')).toBe(true)
  })

  it('emits a read task only where the Library actually has the work', () => {
    const withoutWorks = plan('2026-10-04', { libraryWorkIds: [] })
    expect(withoutWorks.days.flatMap((day) => day.tasks).some((task) => task.kind === 'read')).toBe(false)

    const withWorks = plan('2026-10-04')
    const reads = withWorks.days.flatMap((day) => day.tasks).filter((task) => task.kind === 'read')
    expect(reads.length).toBeGreaterThan(0)
    for (const read of reads) expect(WORKS).toContain(read.workId)
  })

  it('never asks for more cards than the unit actually has', () => {
    const thin = buildPlan({
      profile,
      catalogue: makeMcqs('ccs-conduct', 3),
      states: new Map(),
      now: NOW,
      targetDate: '2026-10-04',
      libraryWorkIds: WORKS,
    })
    for (const task of thin.days.flatMap((day) => day.tasks)) {
      if (task.kind === 'drill') expect(task.cards).toBeLessThanOrEqual(3)
    }
  })

  it('schedules a mock inside the sprint but never on the last day', () => {
    const built = plan('2026-12-03')
    const sprint = built.days.filter((day) => day.phase === 'revision')
    expect(sprint.some((day) => day.tasks.some((task) => task.kind === 'mock'))).toBe(true)
    expect(sprint.at(-1)?.tasks.some((task) => task.kind === 'mock')).toBe(false)
  })

  it('points a mock at an objective paper, never at the writing paper', () => {
    const built = plan('2026-12-03')
    for (const task of built.days.flatMap((day) => day.tasks)) {
      if (task.kind === 'mock') expect(task.paperId).toBe('p1')
    }
  })

  it('keeps every day inside its minute budget', () => {
    const built = plan('2026-11-30', { dailyMinutes: 40 })
    for (const day of built.days.filter((d) => d.phase === 'build')) {
      expect(day.minutes).toBeLessThanOrEqual(40)
    }
  })

  it('draws nothing at all for a profile whose units are all external', () => {
    const nothing = makeProfile([{ id: 'p', units: [{ id: 'u', weight: 1, acts: null }] }])
    const built = buildPlan({
      profile: nothing,
      catalogue,
      states: new Map(),
      now: NOW,
      targetDate: '2026-10-04',
    })
    expect(built.days.every((day) => day.tasks.length === 0)).toBe(true)
  })

  it('does not put a unit whose cards are all unapproved on the plan', () => {
    const built = buildPlan({
      profile,
      catalogue: [...makeMcqs('ccs-conduct', 5)],
      states: new Map(),
      now: NOW,
      targetDate: '2026-10-04',
      libraryWorkIds: WORKS,
    })
    const keys = new Set(built.days.flatMap((day) => day.tasks.map((task) => task.unitKey)))
    expect(keys.has('p1:conduct')).toBe(true)
    expect(keys.has('p1:gfr')).toBe(false)
  })
})

describe('dailyBudget', () => {
  const goal = (id: string, minutesPerWeek: number): StudyGoalRow => ({
    id,
    minutesPerWeek,
    updatedAt: '2026-09-01T00:00:00.000Z',
  })

  it('falls back to the default when the reader has set no goal', () => {
    expect(dailyBudget({ profile })).toBe(DEFAULT_DAILY_MINUTES)
  })

  it('takes the largest weekly goal on a work this examination draws on', () => {
    expect(dailyBudget({ profile, goals: [goal('ccs-conduct', 210), goal('ccs-leave', 140)] })).toBe(30)
  })

  it('ignores a goal on a work the examination does not draw on', () => {
    // A reader with a 700-minute goal on the BNS is not thereby promising ten
    // hours a week to a Section Officers' examination that never mentions it.
    expect(dailyBudget({ profile, goals: [goal('bns', 700)] })).toBe(DEFAULT_DAILY_MINUTES)
  })

  it('lets an explicit figure win over every goal', () => {
    expect(dailyBudget({ profile, goals: [goal('ccs-conduct', 700)], dailyMinutes: 25 })).toBe(25)
  })

  it('clamps an absurd figure rather than believing it', () => {
    expect(dailyBudget({ profile, dailyMinutes: 5000 })).toBeLessThanOrEqual(240)
    expect(dailyBudget({ profile, dailyMinutes: 1 })).toBeGreaterThanOrEqual(10)
  })

  it('ignores a goal that sets units per week and no minutes', () => {
    expect(dailyBudget({ profile, goals: [{ id: 'ccs-conduct', unitsPerWeek: 5, updatedAt: 'x' }] })).toBe(
      DEFAULT_DAILY_MINUTES,
    )
  })
})

describe('the plan against a partly-learnt schedule', () => {
  it('still reaches every unit when one is in learning and one is held', () => {
    const states = statesOf([
      learningRow('ccs-conduct-q1'),
      ...makeMcqs('gfr', 30).map((card) => reviewRow(card.id, 40)),
    ])
    const built = plan('2026-11-30', { states })
    const touched = new Set(built.days.flatMap((d) => d.tasks.map((t) => t.unitKey).filter(Boolean)))
    expect(touched).toEqual(new Set(['p1:conduct', 'p1:leave', 'p1:gfr']))
  })
})
