import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import HomePage from './HomePage'

import { clearAllData, db } from '@/db'
import { setActiveExam, setTargetDate } from '@/lib/exam'
import { newEntry } from '@/lib/drafting/register'
import { putEntry } from '@/modules/drafting/register/registerStore'

/**
 * The edge-case pass over the landing screen.
 *
 * Every figure on `/home` comes out of IndexedDB, which means every one of them
 * is a row another build wrote, a row a half-finished write left behind, or a
 * row the reader's own storage handed back damaged. That is the family: this
 * screen trusts its own database, and the database is the one thing in this app
 * that outlives the code.
 */

const at = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <HomePage />
    </MemoryRouter>,
  )

beforeEach(async () => {
  await clearAllData()
})

describe('the examination countdown', () => {
  it('renders at all for a reader who has chosen an examination', async () => {
    /*
      It could not. The card read `db.examChoices.where('active').equals(1)`,
      which is the fast path inside `activeExamChoice` and **never matches** —
      IndexedDB has no boolean key type, so `true` is not indexable and the scan
      underneath is what answers. `store.ts` says exactly that in a comment two
      lines below the query.

      So this card was wired end to end, labelled in both languages, and unable
      to fire for any reader who had actually set an examination. The fifth
      time this repository has recorded that shape, and the first where the
      reason was written down in the file being copied from.
    */
    await setActiveExam('css-so-ldce')
    await setTargetDate('css-so-ldce', futureDay(30))

    at()
    expect(await screen.findByText('30 days to go')).toBeInTheDocument()
  })

  it('says the date cannot be read rather than counting NaN days', async () => {
    /*
      Only reachable from a row another build wrote — `setTargetDate` refuses a
      date that is not an IST calendar day — which is exactly the case ADR-044's
      addendum records `daysUntil` being written for: "a function that cannot
      read its input has to say so, not return a plausible number."

      This screen had a THIRD copy of that arithmetic with no guard in front of
      it, so a damaged row rendered "NaN days to go" on the first screen an
      officer sees.
    */
    // Written through the store and then damaged, because `setTargetDate`
    // refuses a date that is not an IST day — which is what makes this row
    // reachable only from another build.
    await setActiveExam('css-so-ldce')
    const row = (await db.examChoices.get('css-so-ldce'))!
    await db.examChoices.put({ ...row, targetDate: 'not-a-day' })

    at()

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  it('refuses a date that parses in JavaScript and is not a real day', async () => {
    // `2027-02-31` is the 3rd of March to `Date.parse`, which is the trap
    // `isIsoDate` exists for.
    await setActiveExam('css-so-ldce')
    const row = (await db.examChoices.get('css-so-ldce'))!
    await db.examChoices.put({ ...row, targetDate: '2027-02-31' })

    at()
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument()
  })

  it('renders nothing at all when no examination is chosen', async () => {
    at()
    // Not "Exam: none". A permanent reminder of a feature most readers never
    // asked for is worse than an absent card.
    await waitFor(() => expect(screen.getByText('Continue reading')).toBeInTheDocument())
    expect(screen.queryByText(/day to go|days to go|Your examination/)).not.toBeInTheDocument()
  })
})

describe('the follow-ups card', () => {
  it('counts what the register counts, and drops what the register drops', async () => {
    /*
      The register parses every row through `readEntry` and drops the ones a
      later build wrote; this card was reading `row.entry` raw. A row that fails
      the schema but happens to carry a `followUpDate` and a pending status was
      therefore counted HERE and not THERE — two screens disagreeing about one
      number, which is how a reader stops believing either.

      The readable one is built with `newEntry`, so it is valid by construction
      rather than by my guess at the schema.
    */
    const at = '2026-01-01T00:00:00.000Z'
    const readable = newEntry({
      id: 'r1',
      direction: 'received',
      at,
      patch: { number: 'A-1/2026', status: 'pending', followUpDate: '2020-01-01' },
    })
    await putEntry(readable)

    // A row no schema this build knows can read, carrying a due follow-up.
    await db.registerEntries.put({
      id: 'r2',
      direction: 'received',
      number: 'A-2/2026',
      date: '2026-01-01',
      status: 'pending',
      threadId: 'r2',
      followUpDate: '2020-01-01',
      createdAt: at,
      updatedAt: at,
      // The `entry` a later build wrote: not a `RegisterEntry`, which is the
      // whole point, so the row is assembled untyped rather than cast.
      entry: { written: 'by a later build', status: 'pending', followUpDate: '2020-01-01' },
    })

    render(
      <MemoryRouter initialEntries={['/home']}>
        <HomePage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('1 waiting')).toBeInTheDocument()
  })

  it('says nothing is waiting rather than showing a zero', async () => {
    at()
    expect(await screen.findByText(/Nothing is waiting on a reply/)).toBeInTheDocument()
  })
})

/** An IST day `n` days from now, as the date input would produce it. */
function futureDay(n: number): string {
  return new Date(Date.now() + n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10)
}
