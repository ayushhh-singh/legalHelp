import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import ExamHubPage from './ExamHubPage'
import ExamMockPage from './ExamMockPage'
import { EXAM_PROFILE_IDS, loadExamIndex, loadExamProfile } from './data'

import { clearAllData } from '@/db'
import { setActiveExam, setTargetDate } from '@/lib/exam'

/**
 * Exam mode, in jsdom, against the REAL committed profiles.
 *
 * TWO routes since ADR-046, not four: the plan and the exam-day checklist are
 * sections of `/study/exam` under `#plan` and `#checklist`, so the tests that
 * used to visit them render the hub and read the section on it. That is what
 * the redirects from `/learn/exam/plan` and `/learn/exam/checklist` land on
 * too, so the assertions describe what a reader following an old link sees.
 *
 * Not a fixture profile: a stub of a dataset type is a stub of every field the
 * code happens to read, and `data/exams/profiles/*.json` is one `?raw` import
 * away and cannot lie. The catalogue is the real `data/rules` too, so the
 * readiness figures on screen are the ones a fresh device would actually show.
 *
 * The claims that carry weight are the two the module could most plausibly get
 * wrong and still look right: the caveat travels with the readiness figure on
 * the same card, and a topic this app holds nothing for is on screen as an
 * external one rather than quietly absent.
 */

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/study/exam" element={<ExamHubPage />} />
        <Route path="/study/exam/mock" element={<ExamMockPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await clearAllData()
  // Warm the dataset chunks once. `React.lazy`-style dynamic imports resolve a
  // tick late, and a test that asserts an ABSENCE before the module has ever
  // resolved cannot fail — `src/modules/library/study.edge.test.tsx` records
  // the same trap costing an assertion that meant nothing.
  await Promise.all([loadExamIndex(), ...EXAM_PROFILE_IDS.map(loadExamProfile)])
})

describe('the picker', () => {
  it('lists every bundled profile with its honest mapped/external ratio', async () => {
    at('/study/exam')
    // Each name appears twice on a card — the examination and the organisation
    // — so these are `getAllByText`. An unscoped `getByText` fails on strict
    // mode here, which is the shape CLAUDE.md already records for the reply
    // screen: a value that is on the page twice needs a scope or a plural.
    expect((await screen.findAllByText(/Central Secretariat Service/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Intelligence Bureau/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Railway Board Secretariat Service/).length).toBeGreaterThan(0)

    // Both counts are on the card, before the reader chooses rather than after.
    expect(screen.getAllByText(/topics this app can teach/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText(/topics you study elsewhere/).length).toBeGreaterThanOrEqual(3)
  })

  it('says the boundary out loud, and names the three exams that are not here', async () => {
    at('/study/exam')
    expect(await screen.findByText(/only public syllabus structure/i)).toBeInTheDocument()
    expect(screen.getByText(/no public notification of a CBI/i)).toBeInTheDocument()
  })

  it('shows the readiness screen once a profile is chosen, not the list', async () => {
    const user = userEvent.setup()
    at('/study/exam')
    const cards = await screen.findAllByRole('button', { name: 'Prepare for this' })
    await user.click(cards[0]!)

    expect(await screen.findByText('Readiness')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare for this' })).not.toBeInTheDocument()
  })
})

describe('the readiness screen', () => {
  beforeEach(async () => {
    await setActiveExam('css-so-ldce')
  })

  it('carries the caveat on the SAME card as the figure', async () => {
    // The difference between "80% ready" and "80% ready over three tenths of
    // the paper" is the whole honesty of this module, and a caveat one card
    // away is a caveat nobody reads. Scoped to the card, not to the page.
    at('/study/exam')
    const heading = await screen.findByText('Readiness')
    const card = heading.closest('div')!
    expect(within(card).getByText(/0% ready/)).toBeInTheDocument()
    expect(within(card).getByText(/question bank only/i)).toBeInTheDocument()
  })

  it('shows the mandatory banner and the weights caveat under it', async () => {
    at('/study/exam')
    expect(await screen.findByText(/confirm against your department's current circular/i)).toBeInTheDocument()
    // The weights caveat is `weightBasis` from the profile itself, rendered
    // under the banner — asserted against the dataset's own words rather than
    // a paraphrase, so a reword of the data fails here rather than passing.
    expect(screen.getByText(/this split is this app's, not the Commission's/i)).toBeInTheDocument()
  })

  it('renders external topics as external rather than leaving them out', async () => {
    at('/study/exam')
    await screen.findByText('Readiness')
    // Paper III is 200 of the 500 marks and this app holds nothing for it. A
    // screen that showed only what it could teach would be describing a
    // different examination.
    expect((await screen.findAllByText(/Noting and drafting/i)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Self-study, outside this app').length).toBeGreaterThan(0)
  })

  it('offers the Session 28 revision sheets, and only pays for them when opened', async () => {
    // Brief item 6, and it is a set of LINKS into `/library/:workId/sheet/:nodeId`
    // rather than a second sheet implementation. The chapter list comes from the
    // work file, so the card is behind a `<details>` and loads nothing until the
    // reader opens it — asserted here by the list being absent first.
    const user = userEvent.setup()
    at('/study/exam')
    const summary = await screen.findByText('Revision sheets')
    expect(screen.queryByRole('link', { name: /^24h$/ })).not.toBeInTheDocument()

    await user.click(summary)
    const links = await screen.findAllByRole('link', { name: /24-घंटा|24-hour/ })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]!.getAttribute('href')).toMatch(/\/library\/[a-z-]+\/sheet\/.+\?mode=24h$/)
  })

  it('lets a saved date be taken off again', async () => {
    const user = userEvent.setup()
    await setTargetDate('css-so-ldce', futureDay(30))
    at('/study/exam')
    await user.click(await screen.findByRole('button', { name: 'Remove date' }))
    await waitFor(() => {
      expect(screen.getByText('No date set yet')).toBeInTheDocument()
    })
  })

  it('asks for a target date first when there is none', async () => {
    at('/study/exam')
    expect(await screen.findByText(/Set your examination date/i)).toBeInTheDocument()
  })

  it('reports the days remaining once a date is saved', async () => {
    const user = userEvent.setup()
    at('/study/exam')
    const input = await screen.findByLabelText('Examination date')
    await user.type(input, futureDay(30))
    await user.click(screen.getByRole('button', { name: 'Save date' }))
    await waitFor(() => {
      expect(screen.getByText(/days to go/i)).toBeInTheDocument()
    })
  })

  /*
    The REFUSAL of a date that is not a calendar day is tested in
    `src/lib/exam/store.test.ts` and not here, deliberately.

    `<input type="date">` sanitises its own value: jsdom and every browser that
    implements the control turn `2027-02-31` into an empty string rather than
    passing it on, so the invalid branch is unreachable through this control.
    It is still guarded, because `type="date"` FALLS BACK to a text input where
    the control is unsupported and there the reader can type anything — a real
    path, and one no jsdom test can reach. A test that drove `fireEvent.change`
    with a bad value here would be asserting against a DOM state the component
    can never be in, which is worse than no test.
  */
})

describe('the plan', () => {
  it('says nothing is drawn until a date is set', async () => {
    await setActiveExam('css-so-ldce')
    at('/study/exam')
    expect(await screen.findByText(/Set an examination date to draw a plan/i)).toBeInTheDocument()
  })

  it('draws a plan, and says it is never saved', async () => {
    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', futureDay(60))
    const user = userEvent.setup()
    at('/study/exam')
    expect(await screen.findByText(/never saved/i)).toBeInTheDocument()
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0)
    // The sprint is at the END of the window, and the plan opens on the next
    // fortnight — so it is behind "show the whole plan", which is the control
    // that has to actually work for the sprint to be reachable at all.
    await user.click(screen.getByRole('button', { name: 'Show the whole plan' }))
    expect(screen.getAllByText('Revision sprint').length).toBeGreaterThan(0)
  })

  it('reports a date that has already passed rather than drawing nothing', async () => {
    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', '2020-01-01')
    at('/study/exam')
    expect(await screen.findByText(/already passed/i)).toBeInTheDocument()
  })
})

describe('the mock paper', () => {
  beforeEach(async () => {
    await setActiveExam('css-so-ldce')
  })

  it('labels itself generated, and says which paper it cannot mock', async () => {
    at('/study/exam/mock')
    expect(await screen.findByText('Generated paper')).toBeInTheDocument()
    expect(screen.getByText(/No question paper of any examination is in this app/i)).toBeInTheDocument()
    // Paper III is subjective: a written paper has no key a generated test
    // could mark, and the reader is told rather than left to notice.
    expect(await screen.findByText(/Not mocked:/)).toBeInTheDocument()
  })

  it('names the topics it could draw no questions for', async () => {
    at('/study/exam/mock')
    expect(
      (await screen.findAllByText(/studied outside this app, so no questions were drawn/i)).length,
    ).toBeGreaterThan(0)
  })

  it('warns about the penalty AND that a blank costs nothing, once a paper is running', async () => {
    const user = userEvent.setup()
    at('/study/exam/mock')
    await user.click(await screen.findByRole('button', { name: 'Start the paper' }))
    expect(await screen.findByText(/A blank costs nothing/i)).toBeInTheDocument()
  })

  it('marks an answer sheet cell by NAME, not by colour alone', async () => {
    const user = userEvent.setup()
    at('/study/exam/mock')
    await user.click(await screen.findByRole('button', { name: 'Start the paper' }))
    // Answered / marked for review / blank are three states a reader must be
    // able to tell apart without seeing them.
    expect(await screen.findByRole('button', { name: '1, blank' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark for review' }))
    expect(await screen.findByRole('button', { name: '1, marked for review' })).toBeInTheDocument()
  })
})

describe('the exam-day checklist', () => {
  it('carries the medium warning and the blank-costs-nothing rule', async () => {
    await setActiveExam('css-so-ldce')
    at('/study/exam')
    expect(await screen.findByText(/is FINAL/)).toBeInTheDocument()
    expect(screen.getByText(/A question left blank costs nothing/i)).toBeInTheDocument()
    expect(screen.getByText(/Confirm every date, paper and rule/i)).toBeInTheDocument()
  })

  it('names the document every item was read off', async () => {
    await setActiveExam('css-so-ldce')
    at('/study/exam')
    expect(await screen.findByText(/No\. 6\/1\/2020-CS\.I\(P\)/)).toBeInTheDocument()
  })
})

describe('with no examination chosen', () => {
  it('sends the reader to the picker from every other screen', async () => {
    // The plan and the checklist are sections of the hub, which shows the
    // PICKER when nothing is chosen — so the only other screen that can be
    // reached with no examination is the mock, and it has to offer a way out.
    const view = at('/study/exam/mock')
    expect(await screen.findByRole('link', { name: 'Which examination?' })).toBeInTheDocument()
    view.unmount()
  })
})

/** An IST day `n` days from now, as the date input would produce it. */
function futureDay(n: number): string {
  const at = new Date(Date.now() + n * 86_400_000 + 5.5 * 3_600_000)
  return at.toISOString().slice(0, 10)
}
