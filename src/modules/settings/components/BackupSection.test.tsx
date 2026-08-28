import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { BackupSection } from './BackupSection'

import { db, setSetting, SETTING_KEYS } from '@/db'

/**
 * A restored `settings` row (theme, language, ai, onboarded,
 * devanagariDigits) sits in IndexedDB with no visible effect until a reload
 * runs `hydrate()` again — everything else a backup can restore (drafts,
 * favourites, scenarios, Trainer progress) is read through `useLiveQuery`,
 * which picks up the same write on its own. Found in an edge-case pass: the
 * "Restored N rows." message alone left a reader who imported a backup with
 * a different theme or language looking at a settings screen that had not
 * visibly changed at all.
 */
function makeBackupFile(tables: Record<string, unknown[]>) {
  return new File(
    [JSON.stringify({ app: 'sahayak', exportedAt: '2026-08-29T00:00:00.000Z', appVersion: '0.1.0', tables })],
    'backup.json',
    { type: 'application/json' },
  )
}

describe('BackupSection — import', () => {
  it('offers a reload once a restored file includes settings', async () => {
    const user = userEvent.setup()
    render(<BackupSection />)

    const file = makeBackupFile({ settings: [{ key: 'theme', value: 'dark' }] })
    await user.upload(screen.getByLabelText('Import backup'), file)

    await waitFor(() => expect(screen.getByText(/Restored 1 rows?\./)).toBeInTheDocument())
    expect(await db.settings.get('theme')).toMatchObject({ value: 'dark' })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('does not offer a reload when the restored file never touched settings', async () => {
    const user = userEvent.setup()
    render(<BackupSection />)

    const file = makeBackupFile({
      lawFavourites: [
        {
          id: 'bns:103',
          code: 'bns',
          section: '103',
          act: 'BNS',
          heading: { en: 'Murder', hi: 'हत्या' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await user.upload(screen.getByLabelText('Import backup'), file)

    await waitFor(() => expect(screen.getByText(/Restored 1 rows?\./)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
  })

  it('reports an error rather than crashing on a file that is not a Sahayak backup', async () => {
    const user = userEvent.setup()
    render(<BackupSection />)

    const file = new File(['{"not":"a backup"}'], 'oops.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Import backup'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent(/damaged/)
  })

  it('leaves an unrelated setting already on the device alone after a settings-only restore', async () => {
    await setSetting(SETTING_KEYS.devanagariDigits, true)
    const user = userEvent.setup()
    render(<BackupSection />)

    const file = makeBackupFile({ settings: [{ key: 'theme', value: 'dark' }] })
    await user.upload(screen.getByLabelText('Import backup'), file)

    await waitFor(() => expect(screen.getByText(/Restored 1 rows?\./)).toBeInTheDocument())
    expect(await db.settings.get(SETTING_KEYS.devanagariDigits)).toMatchObject({ value: true })
  })
})
