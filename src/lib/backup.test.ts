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

  /**
   * Named explicitly, on top of the "every table" assertion above.
   *
   * That one passes by construction — `EXCLUDED_FROM_BACKUP` is a deny-list, so
   * a table added in a later session is backed up by default and the loop
   * cannot fail for it. Which is the right default and also means the general
   * assertion cannot tell anyone whether the five tables that hold a reader's
   * annotations are really in the file. These are the rows an officer would
   * most notice the loss of: what they highlighted, what they wrote, what they
   * bookmarked, how far they had read, and a document they added themselves
   * that exists in no dataset and cannot be recovered from anywhere else.
   */
  it('carries every Library table, including the ones a reader cannot get back', async () => {
    const backup = await buildBackup('0.1.0')
    for (const table of [
      'libraryProgress',
      'libraryBookmarks',
      'libraryHighlights',
      'libraryNotes',
      'libraryPersonalWorks',
    ]) {
      expect(Object.keys(backup.tables), table).toContain(table)
    }
  })

  it('round-trips a highlight, a note and a personal work through export and import', async () => {
    await db.libraryHighlights.put({
      id: 'hl-1',
      workId: 'rti',
      unitId: 'rti-8',
      lang: 'en',
      start: 10,
      end: 24,
      quote: 'public interest',
      colour: 'marigold',
      createdAt: '2026-09-03T00:00:00.000Z',
    })
    await db.libraryNotes.put({
      id: 'note-1',
      workId: 'rti',
      unitId: 'rti-8',
      body: 'Read with the DPDP amendment.',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    })
    await db.libraryPersonalWorks.put({
      id: 'my-office-order-abc',
      title: 'Office order',
      language: 'en',
      note: '',
      unitWord: 'paragraph',
      units: [
        { id: 'my-office-order-abc-1', number: '1', heading: '', text: 'Applies to all.', division: null },
      ],
      divisions: [],
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    })

    const backup = await buildBackup('0.1.0')
    await db.libraryHighlights.clear()
    await db.libraryNotes.clear()
    await db.libraryPersonalWorks.clear()
    await restoreBackup(backup)

    expect((await db.libraryHighlights.get('hl-1'))?.quote).toBe('public interest')
    expect((await db.libraryNotes.get('note-1'))?.body).toBe('Read with the DPDP amendment.')
    expect((await db.libraryPersonalWorks.get('my-office-order-abc'))?.units).toHaveLength(1)
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

  it('also empties the service worker’s caches where the API does exist', async () => {
    // "Erase everything" that leaves the precached shell and the `data-v1` /
    // `runtime-v1` runtime caches behind has not erased everything. jsdom has
    // no Cache Storage, so the branch is exercised against a stub of exactly
    // the two methods the function calls.
    const deleted: string[] = []
    const stub = {
      keys: () => Promise.resolve(['workbox-precache-v2', 'data-v1', 'runtime-v1']),
      delete: (key: string) => {
        deleted.push(key)
        return Promise.resolve(true)
      },
    }
    Object.defineProperty(globalThis, 'caches', { value: stub, configurable: true })
    try {
      await eraseAllLocalData()
    } finally {
      Reflect.deleteProperty(globalThis, 'caches')
    }

    expect(deleted.sort()).toEqual(['data-v1', 'runtime-v1', 'workbox-precache-v2'])
    expect(typeof caches).toBe('undefined')
  })
})
