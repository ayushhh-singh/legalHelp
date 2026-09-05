import { screen, waitFor } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * Open one of the reader rail's four tabs, in a jsdom test.
 *
 * The rail became four tabs in Session 35, so a test that wants the own-words
 * box, the chapter card or "Around this" has to say which panel it is asking
 * about. This is a helper rather than three lines copied into six tests for one
 * reason: it ASSERTS the tab is selected afterwards.
 *
 * That matters more than it looks. The choice is remembered in IndexedDB, so
 * after a navigation the rail comes back on the tab it was on — but a write
 * that has not landed leaves it on the default, and a test that then checks
 * something is ABSENT would pass because the panel is not on screen at all
 * rather than because the state was reset. Two of the reader's edge tests exist
 * precisely to catch state carried between units; both would have gone green
 * against the bug they were written for.
 */
export async function openRail(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  const control = await screen.findByRole('tab', { name: label })
  if (control.getAttribute('aria-selected') !== 'true') await user.click(control)
  await expectRailTab(label)
}

/** The same assertion on its own, for a tab that must ALREADY be selected. */
export async function expectRailTab(label: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
  })
}
