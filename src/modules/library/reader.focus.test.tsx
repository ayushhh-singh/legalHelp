import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import ReaderPage from './pages/ReaderPage'

import { FocusLayout } from '@/app/layouts/FocusLayout'
import { db, SETTING_KEYS } from '@/db'
import { expectRailTab, openRail } from '@/test/rail'

/**
 * The reader at level 3 (Session 35).
 *
 * These render the page INSIDE `FocusLayout`, which the other reader suites do
 * not, and that is the whole point: the unit switcher, the "Aa" tray, the
 * headphones button and every ⋯ entry are PORTALLED into that bar. Mounting the
 * page bare renders none of them — `FocusSlot` finds no host and returns null —
 * so a suite that did would be asserting about a screen no reader sees.
 */

const WORK = 'ccs-conduct'
const UNIT = 'ccs-conduct-3'

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<FocusLayout />}>
          <Route path="/study/read/:workId/:unitId" element={<ReaderPage />} />
        </Route>
        <Route path="/study/read/:workId" element={<p>the work page</p>} />
        <Route path="/study/read" element={<p>the shelf</p>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await Promise.all([
    db.settings.clear(),
    db.libraryProgress.clear(),
    db.libraryBookmarks.clear(),
    db.chapterCards.clear(),
    db.feynmanAttempts.clear(),
  ])
})

/** The stored reading preferences, whatever they are now. */
const storedPrefs = async () =>
  ((await db.settings.get(SETTING_KEYS.library))?.value ?? {}) as Record<string, unknown>

describe('the focus bar', () => {
  it('names the provision, and the switcher goes to another one', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)

    const switcher = await screen.findByRole('button', { name: /Go to another provision/ })
    // The number and the heading, in the one row that is always on screen.
    expect(switcher).toHaveTextContent('3')
    expect(switcher).toHaveTextContent('General')

    await user.click(switcher)
    const rows = within(screen.getByRole('button', { name: /Go to another provision/ }).parentElement!)
    await user.click(rows.getByRole('link', { name: /Definitions/i }))
    // The switcher names the unit it is ON, so a jump has to shut it — and it
    // does it by DERIVATION (the open state is keyed on the unit id) rather
    // than by an effect that resynchronises one render late.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Go to another provision/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    )
  })

  it('filters the switcher on what is typed', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)

    await user.click(await screen.findByRole('button', { name: /Go to another provision/ }))
    const box = screen.getByLabelText('Go to')
    await user.type(box, 'definitions')

    /*
      Scoped to the switcher's own popover: the page below it is full of links
      — citations inside the provision, the rail, prev/next — and an unscoped
      `getAllByRole('link')` would be asserting that the whole reader matches
      what was typed into one box.
    */
    const panel = document.getElementById('reader-unit-switcher')!
    await waitFor(() => expect(within(panel).getAllByRole('link').length).toBeGreaterThan(0))
    for (const row of within(panel).getAllByRole('link')) expect(row).toHaveTextContent(/definitions/i)
  })

  it('carries the reader’s own actions in the shell’s ONE ⋯ menu', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)
    await screen.findByRole('heading', { level: 1 })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = document.getElementById('focus-actions')!

    // The page's own entries…
    expect(within(menu).getByText('Print')).toBeInTheDocument()
    expect(within(menu).getByText('Copy the citation')).toBeInTheDocument()
    expect(within(menu).getByText('Compare with…')).toBeInTheDocument()
    // …and the three the shell owes every focus route, in the same list.
    expect(within(menu).getByRole('button', { name: 'Switch to Hindi' })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('the “Aa” tray', () => {
  it('holds all five controls and remembers each one', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)

    await user.click(await screen.findByRole('button', { name: 'Type' }))

    await user.click(screen.getByRole('button', { name: 'Larger text' }))
    await user.click(screen.getByRole('button', { name: 'Serif' }))
    await user.click(screen.getByRole('button', { name: 'Sepia' }))

    await waitFor(async () => {
      const prefs = await storedPrefs()
      expect(prefs.size).toBe(3)
      expect(prefs.family).toBe('serif')
      expect(prefs.surface).toBe('sepia')
    })
  })

  it('is the only place the reading language is chosen, and it announces the missing Hindi', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)
    await screen.findByRole('heading', { level: 1 })

    // Not on the page: the five control groups are gone from the column.
    expect(screen.queryByRole('button', { name: 'हिंदी' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Type' }))
    await user.click(screen.getByRole('button', { name: 'हिंदी' }))

    // No source publishes a readable Hindi text layer (ADR-023), so the reader
    // is TOLD rather than shown an empty page.
    expect(await screen.findByText(/Hindi text is not yet available/i)).toBeInTheDocument()
  })
})

describe('the study rail', () => {
  it('remembers which tab was open, across units', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)

    await openRail(user, 'Related')
    await waitFor(async () => expect((await storedPrefs()).railTab).toBe('related'))

    await user.click(screen.getByRole('link', { name: /^Next/ }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    await expectRailTab('Related')
  })

  it('can be put away, and the choice is remembered', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)
    await screen.findByRole('heading', { level: 1 })

    // The desktop row and the phone bar both carry this control, which is one
    // component rendered twice — so the assertion is on the stored preference
    // rather than on a count of buttons.
    await user.click(screen.getAllByRole('button', { name: 'Hide the study panel' })[0]!)
    await waitFor(async () => expect((await storedPrefs()).railOpen).toBe(false))
  })

  /**
   * The phone's sheet, opened from the unit's action row.
   *
   * There is ONE control for it — an edge-case pass removed a floating
   * "Understand" button that did the same job and, being pinned to the same
   * corner, sat on top of both the action row and the "Next" link. jsdom
   * applies no CSS, so the sheet's markup is here at every width; what this
   * asserts is the wiring, and `tests/e2e/focus.spec.ts` asserts which of the
   * two presentations a given width actually gets.
   */
  it('opens as a sheet from the action row', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)
    await screen.findByRole('heading', { level: 1 })

    const group = await screen.findByRole('group', { name: 'What to do with this provision' })
    await user.click(within(group).getByRole('button', { name: 'Show the study panel' }))
    expect(await screen.findByRole('button', { name: 'Close the study panel' })).toBeInTheDocument()
  })
})

describe('the first-run coach marks', () => {
  it('shows one at a time, in order, and each dismissal is stored', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)

    // The "Aa" tray first, because that is where four controls went.
    const first = await screen.findByText(/live behind “Aa” at the top/)
    expect(first).toBeInTheDocument()
    // …and only that one. Three at once is a tour.
    expect(screen.queryByText(/Select a few words/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(await screen.findByText(/Select a few words/)).toBeInTheDocument()
    await waitFor(async () => {
      expect(((await storedPrefs()).coach as Record<string, boolean>).aa).toBe(true)
    })
  })

  it('shows none once all three have been dismissed', async () => {
    await db.settings.put({
      key: SETTING_KEYS.library,
      value: { coach: { aa: true, highlight: true, rail: true } },
    })
    at(`/study/read/${WORK}/${UNIT}`)

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
  })
})

describe('the footer', () => {
  it('states the source behind a disclosure and the disclaimer in full, once', async () => {
    const user = userEvent.setup()
    at(`/study/read/${WORK}/${UNIT}`)
    await screen.findByRole('heading', { level: 1 })

    // The citation is visible because it is what an officer copies.
    expect(screen.getByText(/^Rule 3, Central Civil Services \(Conduct\) Rules/)).toBeInTheDocument()

    const disclosure = screen.getByRole('button', { name: /Source & version/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /Department of Personnel/ })).toBeInTheDocument()
  })
})

/**
 * The edge-case pass (ADR-047's addendum).
 *
 * Two labels, and a label is a promise. Both were confirmed wrong against the
 * commit that introduced the action row.
 */
describe('the unit action row’s labels', () => {
  it('names the highlight control after what it IS, not after why it is off', async () => {
    /*
      Its accessible name with nothing selected was the whole sentence "Select
      some words in the provision first, then choose a colour." — a DESCRIPTION
      used as a NAME. CLAUDE.md records the same mistake on three numbering
      fields: a name says what the control is, a description says what to do
      about it. The sentence is still there, as the description.
    */
    at(`/study/read/${WORK}/${UNIT}`)
    const group = await screen.findByRole('group', { name: 'What to do with this provision' })
    const highlight = within(group).getAllByRole('button')[0]!

    expect(highlight).toHaveAccessibleName('Highlight')
    expect(highlight).toHaveAccessibleDescription(/Select some words in the provision first/)
  })

  it('does not call the trainer control by the dialog’s own Save button’s name', async () => {
    /*
      Both were `library.trainer.add` — "Add to the review queue" — so the icon
      that OPENS the dialog and the button that COMMITS the card had one name
      and two jobs.
    */
    at(`/study/read/${WORK}/${UNIT}`)
    const group = await screen.findByRole('group', { name: 'What to do with this provision' })
    expect(within(group).queryByRole('button', { name: 'Add to the review queue' })).toBeNull()
    expect(within(group).getByRole('button', { name: 'Add to trainer' })).toBeInTheDocument()
  })

  it('will not offer to make a card out of nothing', async () => {
    /*
      The dialog builds a cloze whose ANSWER is the selected words. Opened from
      this row with no selection it offered to store a card whose answer is the
      empty string — the same "a control that cannot succeed" as the highlight
      swatches, which are disabled for exactly this reason one button to the
      left.
    */
    at(`/study/read/${WORK}/${UNIT}`)
    const group = await screen.findByRole('group', { name: 'What to do with this provision' })
    expect(within(group).getByRole('button', { name: 'Add to trainer' })).toBeDisabled()
  })
})
