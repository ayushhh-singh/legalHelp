import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import OnboardingPage from './OnboardingPage'

import { loadPayTables } from '@/test/payTables'

/**
 * `finish()` used to have no error handling at all: a thrown write left the
 * reader stuck on step 3 with a re-enabled "Understood" button and nothing
 * telling them why nothing happened. Found in an edge-case pass, alongside
 * `BackupSection.test.tsx`'s sibling gap. `writeLastScenario` is mocked to
 * reject so the failure is deterministic rather than racing real IndexedDB.
 */
vi.mock('@/modules/pay/usePayTables', () => ({
  usePayTables: () => ({ status: 'ready', tables: loadPayTables(), error: null, retry: () => undefined }),
}))

vi.mock('@/modules/pay/scenarios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/pay/scenarios')>()
  return { ...actual, writeLastScenario: vi.fn().mockRejectedValue(new Error('storage blocked')) }
})

async function walkToStep3(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  )

  await user.click(screen.getByRole('button', { name: 'Continue' }))

  const jobPicker = await screen.findByRole('combobox', { name: 'Post' })
  await user.type(jobPicker, 'ACIO')
  await user.click(
    await screen.findByRole('option', { name: /Assistant Central Intelligence Officer, Grade-II/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByRole('heading', { name: 'Before you begin' })).toBeInTheDocument()
}

describe('OnboardingPage — finish() failure', () => {
  it('shows an error and lets the reader try again, rather than leaving them stuck with no feedback', async () => {
    const user = userEvent.setup()
    await walkToStep3(user)

    await user.click(screen.getByRole('button', { name: 'Understood' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save your post and city/)
    // Still on step 3 — finish() never reached setOnboarded/navigate.
    expect(screen.getByRole('heading', { name: 'Before you begin' })).toBeInTheDocument()
    // Not left disabled: a reader can press it again, or use "Skip setup" above.
    expect(screen.getByRole('button', { name: 'Understood' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Skip setup' })).toBeEnabled()
  })
})
