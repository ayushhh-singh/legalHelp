import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ClassificationTable } from './ClassificationTable'

import { lawDatasetSchema } from '@/modules/law/schema'
import type { LawDataset } from '@/modules/law/types'
import { readFromRoot } from '@/test/paths'

/**
 * The First Schedule grades some offences by circumstance, and every limb sits
 * on its own row under ONE section number.
 *
 * That shape arrived when the Schedule's continuation rows started being read
 * (ADR-045). Before it, a section's classification rows had distinct clauses
 * and `key={row.clause}` was safe; after it, BNS 77 has two rows both keyed
 * `77`. Read against the REAL dataset rather than a fixture, because the point
 * is the shape the committed data actually has.
 */
const bns = lawDatasetSchema.parse(JSON.parse(readFromRoot('data/law', 'bns.json')) as unknown) as LawDataset

describe('ClassificationTable', () => {
  it('renders every limb of an offence graded by circumstance', () => {
    const rows = bns.sections['77']?.classification ?? []
    expect(rows.length, 'BNS 77 should carry a first and a second conviction').toBe(2)

    render(<ClassificationTable rows={rows} />)
    const body = screen.getAllByRole('rowgroup')[1]!
    const rendered = within(body).getAllByRole('row')

    // Two rows, not one — a duplicate React key silently reconciles the second
    // row's cells onto the first and the reader never sees it.
    expect(rendered).toHaveLength(2)
    expect(within(rendered[0]!).getByText(/voyeurism/i)).toBeTruthy()
    expect(within(rendered[1]!).getByText(/second or subsequent conviction/i)).toBeTruthy()
  })

  it('shows the two limbs with DIFFERENT bailability, which is the whole point', () => {
    render(<ClassificationTable rows={bns.sections['77']?.classification ?? []} />)
    const body = screen.getAllByRole('rowgroup')[1]!
    const rendered = within(body).getAllByRole('row')

    // Bailable on a first conviction, not on a second. If these ever read the
    // same, the parser has gone back to answering the second with the first.
    expect(within(rendered[0]!).getByText('Bailable')).toBeTruthy()
    expect(within(rendered[1]!).getByText('Non-bailable')).toBeTruthy()
  })

  it('keeps both rows of a header-graded section, each with its own punishment', () => {
    // BNS 264 is the one section whose own Schedule row states nothing: the
    // offence is named there and the punishments are on the two lettered rows.
    const rows = bns.sections['264']?.classification ?? []
    expect(rows).toHaveLength(2)

    render(<ClassificationTable rows={rows} />)
    const rendered = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row')
    expect(rendered).toHaveLength(2)
    for (const row of rendered) {
      // No column may be blank — the un-suppressed header row rendered a
      // classification with every value empty.
      expect(within(row).queryByText('unspecified')).toBeNull()
    }
    expect(within(rendered[0]!).getByText(/3 years/)).toBeTruthy()
    expect(within(rendered[1]!).getByText(/2 years/)).toBeTruthy()
  })

  it('gives each row a key of its own', () => {
    /*
      The assertion the two above CANNOT make. React renders both rows whatever
      the keys are and only logs `Encountered two children with the same key`,
      so a content test passes against the duplicate — which is how a key
      collision survives a green suite. It is not cosmetic: React reconciles by
      key, so on a re-render with the list changed it can carry one limb's
      cells onto the other's row, and the two limbs differ on exactly the value
      an officer is reading.
    */
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      render(<ClassificationTable rows={bns.sections['77']?.classification ?? []} />)
    } finally {
      spy.mockRestore()
    }
    const duplicate = errors.filter((args) => String(args[0]).includes('same key'))
    expect(duplicate, `React reported a duplicate key: ${JSON.stringify(duplicate[0] ?? [])}`).toEqual([])
  })
})
