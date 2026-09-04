import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import RegisterPage from './register/RegisterPage'
import ReplyPage from './intake/ReplyPage'
import { createEntry, listEntries } from './register/registerStore'
import { listIntakes, saveIntake } from './intake/intakeStore'

import { clearAllData } from '@/db'
import { analyseIntake } from '@/lib/drafting/intake'
import { INTAKE_LETTERS } from '../../../tests/fixtures/drafting/intake'

/**
 * The edge-case pass over Session 31's own screens.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written — the rule this project's own addenda keep, because a
 * regression test that never went red is a test nobody knows the shape of.
 *
 * The pattern this pass found is the one ADR-039's addendum named and ADR-043's
 * repeated twice already: **a control that is reachable, labelled in both
 * languages, and unable to do the thing it says.** Four of the six below are
 * that. The other two are the state-not-keyed family — a form that saves one
 * row's values onto another, and a per-letter confirmation that is not per
 * letter — which is CLAUDE.md's `FeynmanBox` lesson arriving in a new module.
 */

const AT = '2026-09-04T10:00:00.000Z'

const renderAt = (node: React.ReactElement) => render(<MemoryRouter>{node}</MemoryRouter>)

/**
 * `ReplyPage` reads its intake id from `useParams`, so a stored letter needs a
 * real route rather than a prop. Rendering it bare would test the empty screen
 * and pass for the wrong reason.
 */
const renderReplyAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/draft/reply" element={<ReplyPage />} />
        <Route path="/draft/reply/:id" element={<ReplyPage />} />
      </Routes>
    </MemoryRouter>,
  )

/** A whole letter, without `user.type`'s per-character cost (8s a letter). */
const paste = async (text: string) => {
  const box = await screen.findByLabelText(/The letter that arrived|प्राप्त पत्र/)
  fireEvent.change(box, { target: { value: text } })
  return box
}

beforeEach(async () => {
  await clearAllData()
})

describe('the register’s edit form', () => {
  it('shows the row that was pressed, not the one pressed before it', async () => {
    /*
      DEFECT 1, and the worst of the six: `EntryForm` held its own `draft` in
      `useState(entry)`, which runs on MOUNT. Pressing Edit on a second row
      while the form was open re-rendered it with a new `entry` prop and kept
      the FIRST row's values — and Save wrote them to the second row's id.

      Nothing throws, nothing looks wrong, and the officer's correction lands on
      a communication they were not looking at. CLAUDE.md records the same shape
      costing the Library a Feynman attempt saved against the wrong provision:
      a component that is not keyed on what it is about will edit the wrong
      thing. Fixed with a `key`, never an effect that resynchronises.
    */
    const user = userEvent.setup()
    await createEntry({
      direction: 'received',
      at: AT,
      patch: { subject: 'The first letter', number: 'A-1/2026', date: '2026-08-01' },
    })
    await createEntry({
      direction: 'received',
      at: AT,
      patch: { subject: 'The second letter', number: 'B-2/2026', date: '2026-08-02' },
    })

    renderAt(<RegisterPage />)
    const rows = await screen.findAllByRole('article')
    expect(rows).toHaveLength(2)

    // Newest first, so row 0 is the second letter.
    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Subject')).toHaveValue('The second letter')

    // Now the other one, without saving.
    await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Subject')).toHaveValue('The first letter')
  })

  it('does not file an entry until the officer saves one', async () => {
    /*
      DEFECT 2. "Add an entry" called `createEntry` and then opened the form on
      the row it had just written, so pressing Add and then Cancel left a blank
      entry in the register — with no number, no subject and no date, sorted by
      its creation instant to the top of the list.

      A register is a record of what happened. An empty row is a record of the
      officer having pressed a button.
    */
    const user = userEvent.setup()
    renderAt(<RegisterPage />)

    await user.click(await screen.findByRole('button', { name: 'Add an entry' }))
    expect(await listEntries()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await listEntries()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Add an entry' }))
    await user.type(screen.getByLabelText('Subject'), 'A letter I was handed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => expect(await listEntries()).toHaveLength(1))
    expect((await listEntries())[0]?.subject).toBe('A letter I was handed')
  })
})

describe('the reply screen', () => {
  it('clears a stored letter when Clear is pressed', async () => {
    /*
      DEFECT 3. `activeText` was `text || stored?.text || ''`, so emptying the
      box fell straight back to the stored letter and refilled it. Clear
      appeared to do nothing at all on any letter the officer had kept — which
      is every letter they came back to.

      An empty string is a VALUE here, not an absence, and `||` cannot tell the
      two apart. The same distinction `useLiveQuery`'s `undefined` needed in the
      Library (ADR-039's addendum) one type down.
    */
    const user = userEvent.setup()
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const saved = await saveIntake({ text: INTAKE_LETTERS.englishOm, analysis, at: AT })

    renderReplyAt(`/draft/reply/${saved.id}`)
    const box = await screen.findByLabelText('The letter that arrived')
    await waitFor(() => expect(box).toHaveValue(INTAKE_LETTERS.englishOm))

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(box).toHaveValue('')
  })

  it('does not offer to answer a letter with the alphabetically first form', async () => {
    /*
      DEFECT 4. The form select's default option is "Suggested", and with no AI
      analysis to suggest anything `draftReply` fell back to
      `index.data.templates[0]?.id` — the first of forty-three in sorted order,
      which is `acknowledgement`. An officer taking the default got an
      Acknowledgement for every letter.

      The fallback is `letter` now, which is the form CSMOP prescribes for
      writing outside the Department and the one form that answers anything.
      It is stated in the option's own label rather than hidden in a fallback.
    */
    const user = userEvent.setup()
    renderReplyAt('/draft/reply')

    await user.click(await screen.findByRole('button', { name: 'I understand' }))
    await paste(INTAKE_LETTERS.noNumber)
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    /*
      The select's VALUE is what "Draft the reply" will use, so it must always
      be a real form the officer can see named — never an empty placeholder
      standing in for a fallback computed somewhere else.
    */
    const select = await screen.findByLabelText<HTMLSelectElement>('Answer it with')
    expect(select.value).toBe('letter')
    const chosen = within(select).getByRole('option', { selected: true })
    expect(chosen.textContent).toMatch(/Letter/)
  })

  it('leaves nothing in the store when a letter is pasted and never kept', async () => {
    // Not a defect — the claim the screen makes, asserted at this layer too so
    // it is checked on every commit rather than only in the browser run.
    const user = userEvent.setup()
    renderReplyAt('/draft/reply')
    await user.click(await screen.findByRole('button', { name: 'I understand' }))
    await paste(INTAKE_LETTERS.noNumber)
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    // Scoped to the "What was read" region: the letter is still in the
    // textarea above it, so an unscoped match finds both.
    // The letter's DATE, which appears exactly once on the card and not in the
    // request sentence — the subject phrase appears twice inside the region
    // (as the subject and inside the ask), which is the same strict-mode trap
    // one level in.
    const read = await screen.findByRole('region', { name: 'What was read' })
    expect(within(read).getByText('2026-09-01')).toBeInTheDocument()
    expect(await listIntakes()).toEqual([])
  })
})
