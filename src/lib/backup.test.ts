import { describe, expect, it } from 'vitest'

import {
  backupFileName,
  buildBackup,
  eraseAllLocalData,
  isBackupFile,
  restoreBackup,
  type BackupFile,
} from './backup'

import { db, setSetting, SETTING_KEYS } from '@/db'

describe('buildBackup', () => {
  it('contains every table except the AI vault, cache and usage ledger', async () => {
    const backup = await buildBackup('0.1.0')
    const keys = Object.keys(backup.tables)

    for (const table of db.tables) {
      if (['secrets', 'aiAnswers', 'aiUsage'].includes(table.name)) {
        expect(keys).not.toContain(table.name)
      } else {
        expect(keys).toContain(table.name)
      }
    }
  })

  it('carries the rows that are actually there', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    await db.lawFavourites.put({
      id: 'bns:103',
      code: 'bns',
      section: '103',
      act: 'BNS',
      heading: { en: 'Murder', hi: 'हत्या' },
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const backup = await buildBackup('0.1.0')

    expect(backup.tables.settings).toContainEqual({ key: 'theme', value: 'dark' })
    expect(backup.tables.lawFavourites).toHaveLength(1)
  })
})

describe('backupFileName', () => {
  it('takes the date from exportedAt', () => {
    expect(backupFileName('2026-08-29T12:34:56.000Z')).toBe('sahayak-backup-2026-08-29.json')
  })
})

describe('isBackupFile', () => {
  it.each([
    ['null', null],
    ['a string', 'sahayak-backup-2026-08-29.json'],
    ['missing app', { exportedAt: '2026-08-29T00:00:00.000Z', tables: {} }],
    ['wrong app', { app: 'someone-elses-app', exportedAt: '2026-08-29T00:00:00.000Z', tables: {} }],
    ['tables not an object', { app: 'sahayak', exportedAt: '2026-08-29T00:00:00.000Z', tables: 'nope' }],
  ])('rejects %s', (_label, value) => {
    expect(isBackupFile(value)).toBe(false)
  })

  it('accepts a well-formed file', () => {
    expect(isBackupFile({ app: 'sahayak', exportedAt: '2026-08-29T00:00:00.000Z', tables: {} })).toBe(true)
  })
})

describe('restoreBackup', () => {
  it('writes a row for every table it recognises', async () => {
    const result = await restoreBackup({
      app: 'sahayak',
      exportedAt: '2026-08-29T00:00:00.000Z',
      appVersion: '0.1.0',
      tables: {
        settings: [{ key: 'theme', value: 'dark' }],
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
      },
    })

    expect(result.restored).toMatchObject({ settings: 1, lawFavourites: 1 })
    expect(await db.settings.get('theme')).toMatchObject({ value: 'dark' })
    expect(await db.lawFavourites.get('bns:103')).toBeDefined()
  })

  it('overwrites a row with the same key rather than duplicating it', async () => {
    await db.settings.put({ key: 'theme', value: 'light' })

    await restoreBackup({
      app: 'sahayak',
      exportedAt: '2026-08-29T00:00:00.000Z',
      appVersion: '0.1.0',
      tables: { settings: [{ key: 'theme', value: 'dark' }] },
    })

    expect(await db.settings.count()).toBe(1)
    expect(await db.settings.get('theme')).toMatchObject({ value: 'dark' })
  })

  it('leaves a local row alone when the backup does not mention its table', async () => {
    await db.settings.put({ key: 'theme', value: 'dark' })

    await restoreBackup({
      app: 'sahayak',
      exportedAt: '2026-08-29T00:00:00.000Z',
      appVersion: '0.1.0',
      tables: { lawFavourites: [] },
    })

    expect(await db.settings.get('theme')).toMatchObject({ value: 'dark' })
  })

  it('skips a table this build does not have, and every AI table, rather than throwing', async () => {
    const result = await restoreBackup({
      app: 'sahayak',
      exportedAt: '2026-08-29T00:00:00.000Z',
      appVersion: '0.1.0',
      tables: {
        someFutureTable: [{ id: '1' }],
        secrets: [{ id: 'vault', mode: 'device' }],
      },
    })

    expect(result.restored).toEqual({})
    expect(result.skipped.sort()).toEqual(['secrets', 'someFutureTable'])
    expect(await db.secrets.count()).toBe(0)
  })

  it('skips a value that is not an array, rather than throwing', async () => {
    // Untrusted input on purpose: a well-formed backup never has a non-array
    // table value, so this goes through `unknown` rather than the real type.
    const malformed: unknown = {
      app: 'sahayak',
      exportedAt: '2026-08-29T00:00:00.000Z',
      appVersion: '0.1.0',
      tables: { settings: 'not-an-array' },
    }
    const result = await restoreBackup(malformed as BackupFile)

    expect(result.restored).toEqual({})
    expect(result.skipped).toEqual(['settings'])
  })
})

describe('eraseAllLocalData', () => {
  it('clears every table', async () => {
    await setSetting(SETTING_KEYS.theme, 'dark')
    await db.lawFavourites.put({
      id: 'bns:103',
      code: 'bns',
      section: '103',
      act: 'BNS',
      heading: { en: 'Murder', hi: 'हत्या' },
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    await eraseAllLocalData()

    for (const table of db.tables) {
      expect(await table.count(), `${table.name} was left behind`).toBe(0)
    }
  })

  it('does not throw where the Cache Storage API is unavailable', async () => {
    // jsdom has no `caches` global — the same environment every other unit
    // test in this app already runs under.
    expect(typeof caches).toBe('undefined')
    await expect(eraseAllLocalData()).resolves.toBeUndefined()
  })
})
