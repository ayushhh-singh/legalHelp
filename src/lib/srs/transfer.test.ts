import { describe, expect, it } from 'vitest'

import { createCard, gradeCard } from './engine'
import {
  buildExport,
  emptyTrainerData,
  mergeTrainerData,
  parseTrainerExport,
  TRAINER_EXPORT_VERSION,
  TrainerImportError,
  type TrainerData,
} from './transfer'
import { DEFAULT_TRAINER_SETTINGS } from './types'

import type { ReviewLogRow, SrsCardRow, StreakRow } from './types'

const T0 = new Date('2026-03-02T09:00:00.000Z')

/** A card graded once at `at`, so it carries a real `lastReview`. */
function graded(qId: string, at: string): { card: SrsCardRow; log: ReviewLogRow } {
  const when = new Date(at)
  return gradeCard(createCard(qId, when), 'Good', when)
}

const streak = (date: string, reviewed: number, goalMet: boolean): StreakRow => ({ date, reviewed, goalMet })

function data(patch: Partial<TrainerData> = {}): TrainerData {
  return { ...emptyTrainerData(), ...patch }
}

describe('export', () => {
  it('carries an envelope naming the app, the kind and the format version', () => {
    const file = buildExport(emptyTrainerData(), T0)

    expect(file).toMatchObject({
      app: 'sahayak',
      kind: 'trainer',
      version: TRAINER_EXPORT_VERSION,
      exportedAt: T0.toISOString(),
    })
  })

  it('sorts every list, so two exports of the same device agree byte for byte', () => {
    const a = graded('a-2', '2026-03-01T04:00:00.000Z')
    const b = graded('a-1', '2026-03-01T05:00:00.000Z')

    const one = buildExport(
      data({
        srsCards: [a.card, b.card],
        reviewLog: [a.log, b.log],
        streaks: [streak('2026-03-02', 2, true), streak('2026-03-01', 1, false)],
      }),
      T0,
    )
    const two = buildExport(
      data({
        srsCards: [b.card, a.card],
        reviewLog: [b.log, a.log],
        streaks: [streak('2026-03-01', 1, false), streak('2026-03-02', 2, true)],
      }),
      T0,
    )

    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(one.srsCards.map((row) => row.qId)).toEqual(['a-1', 'a-2'])
    expect(one.streaks.map((row) => row.date)).toEqual(['2026-03-01', '2026-03-02'])
  })
})

describe('parseTrainerExport', () => {
  const valid = () => {
    const a = graded('a-1', '2026-03-01T04:00:00.000Z')
    return buildExport(
      data({ srsCards: [a.card], reviewLog: [a.log], streaks: [streak('2026-03-01', 1, true)] }),
      T0,
    )
  }

  it('accepts a file it wrote itself, as an object or as text', () => {
    const file = valid()
    expect(parseTrainerExport(file)).toEqual(file)
    expect(parseTrainerExport(JSON.stringify(file))).toEqual(file)
  })

  it('refuses a file that is not one of ours', () => {
    expect(() => parseTrainerExport({ app: 'something-else' })).toThrow(TrainerImportError)
    expect(() => parseTrainerExport('{ not json')).toThrow(/not valid JSON/)
    expect(() => parseTrainerExport(null)).toThrow(TrainerImportError)
  })

  it('names where the file went wrong', () => {
    const broken = { ...valid(), srsCards: [{ ...valid().srsCards[0], stability: 'quite stable' }] }
    expect(() => parseTrainerExport(broken)).toThrow(/srsCards\.0\.stability/)
  })

  it('rejects a row carrying a key this release does not know', () => {
    // strictObject: a field silently dropped is a field silently lost.
    const file = valid()
    const broken = { ...file, srsCards: [{ ...file.srsCards[0], suspended: true }] }
    expect(() => parseTrainerExport(broken)).toThrow(TrainerImportError)
  })

  it('refuses a backup written by a newer release rather than half-reading it', () => {
    expect(() => parseTrainerExport({ ...valid(), version: TRAINER_EXPORT_VERSION + 1 })).toThrow(
      /newer version/,
    )
  })

  it('rejects a retention outside the range FSRS can be asked for', () => {
    const file = valid()
    expect(() =>
      parseTrainerExport({ ...file, trainerSettings: { ...file.trainerSettings, desiredRetention: 0 } }),
    ).toThrow(TrainerImportError)
  })
})

describe('merge', () => {
  it('round-trips: export, import into an empty device, export again — equal', () => {
    const a = graded('a-1', '2026-03-01T04:00:00.000Z')
    const b = graded('a-2', '2026-03-01T05:00:00.000Z')
    const original = data({
      srsCards: [a.card, b.card],
      reviewLog: [a.log, b.log],
      streaks: [streak('2026-03-01', 2, true)],
      trainerSettings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 25, actsEnabled: ['ccs-conduct'] },
    })

    const file = buildExport(original, T0)
    const restored = mergeTrainerData(emptyTrainerData(), parseTrainerExport(JSON.stringify(file)))

    expect(buildExport(restored, T0)).toEqual(file)
  })

  it('is idempotent — importing the same file twice changes nothing', () => {
    const a = graded('a-1', '2026-03-01T04:00:00.000Z')
    const file = data({ srsCards: [a.card], reviewLog: [a.log], streaks: [streak('2026-03-01', 1, true)] })

    const once = mergeTrainerData(emptyTrainerData(), file)
    expect(mergeTrainerData(once, file)).toEqual(once)
  })

  it('keeps the later review of a card, whichever side it came from', () => {
    const older = graded('a-1', '2026-03-01T04:00:00.000Z').card
    const newer = graded('a-1', '2026-03-05T04:00:00.000Z').card

    expect(mergeTrainerData(data({ srsCards: [older] }), data({ srsCards: [newer] })).srsCards).toEqual([
      newer,
    ])
    expect(mergeTrainerData(data({ srsCards: [newer] }), data({ srsCards: [older] })).srsCards).toEqual([
      newer,
    ])
  })

  it('prefers a reviewed card over one the other device has never seen', () => {
    const unseen = createCard('a-1', new Date('2026-03-05T00:00:00.000Z'))
    const reviewed = graded('a-1', '2026-03-01T04:00:00.000Z').card

    expect(mergeTrainerData(data({ srsCards: [unseen] }), data({ srsCards: [reviewed] })).srsCards).toEqual([
      reviewed,
    ])
    expect(mergeTrainerData(data({ srsCards: [reviewed] }), data({ srsCards: [unseen] })).srsCards).toEqual([
      reviewed,
    ])
  })

  it('breaks a tie on the timestamp by the longer history, then leaves the device alone', () => {
    const held = graded('a-1', '2026-03-01T04:00:00.000Z').card
    const sameInstantLonger = { ...held, reps: held.reps + 3 }

    expect(
      mergeTrainerData(data({ srsCards: [held] }), data({ srsCards: [sameInstantLonger] })).srsCards,
    ).toEqual([sameInstantLonger])
    // A dead-even tie is not a reason to overwrite what is on the device.
    expect(mergeTrainerData(data({ srsCards: [held] }), data({ srsCards: [held] })).srsCards).toEqual([held])
  })

  it('takes the union of the two review logs, and counts nothing twice', () => {
    const shared = graded('a-1', '2026-03-01T04:00:00.000Z').log
    const mine = graded('a-2', '2026-03-01T05:00:00.000Z').log
    const theirs = graded('a-3', '2026-03-01T06:00:00.000Z').log

    const merged = mergeTrainerData(
      data({ reviewLog: [shared, mine] }),
      data({ reviewLog: [shared, theirs] }),
    )

    expect(merged.reviewLog.map((row) => row.qId)).toEqual(['a-1', 'a-2', 'a-3'])
  })

  it('adds up a day worked on two devices without double counting the day', () => {
    const merged = mergeTrainerData(
      data({ streaks: [streak('2026-03-01', 12, false), streak('2026-03-02', 3, true)] }),
      data({ streaks: [streak('2026-03-01', 40, true), streak('2026-03-03', 1, false)] }),
    )

    expect(merged.streaks).toEqual([
      streak('2026-03-01', 40, true),
      streak('2026-03-02', 3, true),
      streak('2026-03-03', 1, false),
    ])
  })

  it('takes the settings from the file being imported', () => {
    const merged = mergeTrainerData(
      data({ trainerSettings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 5 } }),
      data({ trainerSettings: { ...DEFAULT_TRAINER_SETTINGS, dailyNew: 40, actsEnabled: ['rti'] } }),
    )

    expect(merged.trainerSettings).toEqual({
      ...DEFAULT_TRAINER_SETTINGS,
      dailyNew: 40,
      actsEnabled: ['rti'],
    })
  })

  it('gives the same result whichever device the file is carried to', () => {
    const mine = data({
      srsCards: [
        graded('a-1', '2026-03-05T04:00:00.000Z').card,
        graded('a-2', '2026-03-01T04:00:00.000Z').card,
      ],
      reviewLog: [graded('a-1', '2026-03-05T04:00:00.000Z').log],
      streaks: [streak('2026-03-01', 12, false)],
    })
    const theirs = data({
      srsCards: [
        graded('a-1', '2026-03-01T04:00:00.000Z').card,
        graded('a-3', '2026-03-06T04:00:00.000Z').card,
      ],
      reviewLog: [graded('a-3', '2026-03-06T04:00:00.000Z').log],
      streaks: [streak('2026-03-01', 40, true)],
    })

    // Settings are the one field with a stated precedence, so compare the rest.
    const forwards = mergeTrainerData(mine, theirs)
    const backwards = mergeTrainerData(theirs, mine)

    expect(forwards.srsCards).toEqual(backwards.srsCards)
    expect(forwards.reviewLog).toEqual(backwards.reviewLog)
    expect(forwards.streaks).toEqual(backwards.streaks)
  })
})
