import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import ExamChecklistPage from './ExamChecklistPage'
import ExamHubPage from './ExamHubPage'
import ExamMockPage from './ExamMockPage'
import ExamPlanPage from './ExamPlanPage'
import { EXAM_PROFILE_IDS, loadExamIndex, loadExamProfile } from './data'

import { ExamModeSection } from '@/modules/settings/components/ExamModeSection'
import { clearAllData } from '@/db'
import { setActiveExam, setTargetDate } from '@/lib/exam'

/**
 * The edge-case pass over Session 32's surfaces.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written. The family is the one CLAUDE.md names most often and this
 * session hit twice: **a branch that is reachable in the library and dead from
 * the only place that calls it.** `take-mock` had its kind, its i18n key and its
 * slot, and the hub passed `elapsedFraction: null` on every render.
 */

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn/exam" element={<ExamHubPage />} />
        <Route path="/learn/exam/plan" element={<ExamPlanPage />} />
        <Route path="/learn/exam/mock" element={<ExamMockPage />} />
        <Route path="/learn/exam/checklist" element={<ExamChecklistPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await clearAllData()
  await Promise.all([loadExamIndex(), ...EXAM_PROFILE_IDS.map(loadExamProfile)])
})

describe('a stored profile this build does not have', () => {
  /*
    Reachable three ways: a backup restored from a later release, a profile
    withdrawn because its notification was superseded, and a row surviving a
    build that renamed one. `normaliseScenario`'s stale `jobId` is the same
    hazard in the Pay module, and CLAUDE.md records it costing that module a
    silent "nothing picked" state.

    What it did here was worse than silent: `useExamProfile` refuses an id the
    loader map does not have, so `useAsync` was left disabled and its status
    never moved off `loading` — every exam screen rendered a skeleton for ever,
    with no picker, no error and no way back.
  */
  const GONE = 'gone-in-a-later-build'

  it('sends the reader back to the picker rather than to a permanent skeleton', async () => {
    await setActiveExam(GONE)
    at('/learn/exam')
    expect(await screen.findByRole('heading', { name: 'Which examination?' })).toBeInTheDocument()
  })

  it('offers a way out from every other exam screen too', async () => {
    await setActiveExam(GONE)
    await setTargetDate(GONE, '2027-01-01')
    for (const path of ['/learn/exam/plan', '/learn/exam/mock', '/learn/exam/checklist']) {
      const view = at(path)
      expect(await screen.findByRole('link', { name: 'Which examination?' }), path).toBeInTheDocument()
      view.unmount()
    }
  })
})

describe('the next-three-actions can offer a mock', () => {
  it('offers one once the window is short and there is something to measure', async () => {
    /*
      Dead from the hub before this fix: `nextActions` was handed
      `elapsedFraction: null` on every render, so the branch could not fire from
      the only place that calls it. It derives the fraction itself now.

      Both of its conditions have to be real for the assertion to mean anything,
      which is why this seeds an actual schedule rather than an empty one — the
      first version of this test asserted against a device that had studied
      nothing, where `overall >= 0.3` is false for a legitimate reason and the
      test would have passed the moment either condition was deleted.
    */
    const { db } = await import('@/db')
    const { loadCardsForAct } = await import('../data')
    const { actsOf } = await import('@/lib/exam')
    // EVERY act the profile draws on, not one of them: `overall` is weighted
    // across all eight of Paper II's mapped units, so seeding the Conduct Rules
    // alone leaves it below the 0.3 floor and the test fails for a reason that
    // has nothing to do with what it is checking.
    const profile = await loadExamProfile('css-so-ldce')
    const files = await Promise.all(actsOf(profile).map(loadCardsForAct))
    const served = files.flatMap((file) => file.cards).filter((card) => card.reviewState === 'approved')
    await db.srsCards.bulkPut(
      served.map((card) => ({
        qId: card.id,
        due: '2026-09-01T00:00:00.000Z',
        stability: 60,
        difficulty: 5,
        elapsed: 1,
        scheduled: 60,
        reps: 5,
        lapses: 0,
        state: 'review' as const,
        lastReview: '2026-09-01T00:00:00.000Z',
        lastGrade: 'Good' as const,
        learningSteps: 0,
      })),
    )

    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', istDayFromNow(3))
    at('/learn/exam')

    await screen.findByText('Readiness')
    await waitFor(() => {
      expect(screen.getByText('Sit a mock paper')).toBeInTheDocument()
    })
  })

  it('does not offer one on the first day of a long window', async () => {
    // The negative side, so "reachable" and "always shown" cannot be the same
    // passing test.
    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', istDayFromNow(300))
    at('/learn/exam')
    await screen.findByText('Readiness')
    expect(screen.queryByText('Sit a mock paper')).not.toBeInTheDocument()
  })
})

describe('Settings names the examination rather than its slug', () => {
  it('shows the profile’s own name, in the reader’s language', async () => {
    // It rendered `active.id` — "Preparing for css-so-ldce." — because the
    // section deliberately does not import `@/lib/exam`. The index is 2 KB and
    // is only fetched when there IS a row, which costs a reader with no
    // examination nothing at all.
    await setActiveExam('css-so-ldce')
    render(
      <MemoryRouter>
        <ExamModeSection />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Central Secretariat Service/)).toBeInTheDocument()
    expect(screen.queryByText(/css-so-ldce/)).not.toBeInTheDocument()
  })
})

describe('choosing a profile offers the Trainer its rule books', () => {
  it('applies the examination’s own acts to a reader who has chosen none, and SAYS so', async () => {
    // Gap #56's better signal: a profile's units come off a gazette-notified
    // reference list, where `trainerActHintsForJob` infers from an organisation
    // name. Applied and announced in the same view — the arrangement
    // `OnboardingPage` already uses for the job-derived version.
    const user = userEvent.setup()
    const { loadSettings } = await import('@/lib/srs')
    expect((await loadSettings()).actsEnabled).toEqual([])

    at('/learn/exam')
    const cards = await screen.findAllByRole('button', { name: 'Prepare for this' })
    await user.click(cards[0]!)

    expect(await screen.findByText(/your examination’s own reference list names/i)).toBeInTheDocument()
    await waitFor(async () => {
      expect((await loadSettings()).actsEnabled).toContain('ccs-conduct')
    })
  })

  it('never overwrites rule books the reader has chosen themselves', async () => {
    /*
      `actsEnabled: []` is the default and means EVERY rule book, so an empty
      list is "has not decided" and anything else is a decision. Silently
      discarding it because somebody tapped a card on a different screen is a
      change they would never connect to the action.
    */
    const user = userEvent.setup()
    const { loadSettings, saveSettings } = await import('@/lib/srs')
    await saveSettings({ actsEnabled: ['gfr'] })

    at('/learn/exam')
    const cards = await screen.findAllByRole('button', { name: 'Prepare for this' })
    await user.click(cards[0]!)

    await screen.findByText('Readiness')
    expect((await loadSettings()).actsEnabled).toEqual(['gfr'])
    expect(screen.queryByText(/own reference list names/i)).not.toBeInTheDocument()
  })
})

describe('the plan honours the reader’s Session 28 study goal', () => {
  it('takes the daily budget from a weekly Library goal when no explicit one is set', async () => {
    /*
      The THIRD instance in this module of the same family, and the worst of the
      three, because it put a false sentence on the screen rather than merely
      hiding a branch: `dailyBudget` reads `goals`, the plan screen never passed
      any, and the card underneath still read "Taken from your weekly Library
      goal" whenever no explicit budget was set.

      210 minutes a week is 30 a day, against a default of 50 — so the assertion
      distinguishes "the goal was read" from "the default was used", which a
      goal near the default would not.
    */
    const { db } = await import('@/db')
    await db.studyGoals.put({ id: 'ccs-conduct', minutesPerWeek: 210, updatedAt: '2026-09-01T00:00:00.000Z' })

    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', istDayFromNow(40))
    at('/learn/exam/plan')

    expect(await screen.findByText(/About 30 minutes a day/)).toBeInTheDocument()
    expect(screen.getByText(/Taken from your weekly Library goal/)).toBeInTheDocument()
  })

  it('ignores a goal on a work the examination does not draw on', async () => {
    // A reader with a large goal on the BNS is not thereby promising that much
    // a week to a Section Officers' examination that never mentions it.
    const { db } = await import('@/db')
    await db.studyGoals.put({ id: 'bns', minutesPerWeek: 700, updatedAt: '2026-09-01T00:00:00.000Z' })

    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', istDayFromNow(40))
    at('/learn/exam/plan')

    expect(await screen.findByText(/About 50 minutes a day/)).toBeInTheDocument()
  })
})

describe('the plan says why it stops', () => {
  it('reports a date it could not read rather than drawing four hundred days', async () => {
    await setActiveExam('css-so-ldce')
    // Only reachable from a row another build wrote — `setTargetDate` refuses
    // it — so it is written through the store's own escape hatch.
    const { db } = await import('@/db')
    const row = await db.examChoices.get('css-so-ldce')
    await db.examChoices.put({ ...row!, targetDate: 'not-a-day' })

    at('/learn/exam/plan')
    expect(await screen.findByText(/is not a date this app can read/i)).toBeInTheDocument()
  })

  it('says a window was cut short rather than just ending early', async () => {
    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', '2036-09-04')
    at('/learn/exam/plan')
    expect(await screen.findByText(/only the first/i)).toBeInTheDocument()
  })
})

/** An IST calendar day `n` days from now, as the date input produces one. */
function istDayFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10)
}
