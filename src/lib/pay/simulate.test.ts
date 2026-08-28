import { describe, expect, it } from 'vitest'

import { fixOnPromotion, nextIncrement, projectEighthCpc } from './simulate'

import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()

describe('nextIncrement', () => {
  it('moves to the next cell of the Level, which is 3 per cent to the nearest hundred', () => {
    const result = nextIncrement('7', 0, '07-01', tables)
    expect(result.fromBasic).toBe(44_900)
    expect(result.toBasic).toBe(46_200) // 44,900 x 1.03 = 46,247 -> 46,200
    expect(result.increase).toBe(1300)
    expect(result.stagnant).toBe(false)
  })

  it('says so when the officer is already in the last cell', () => {
    const cells = tables.matrix.levels.find((level) => level.level === '13')?.cells.length ?? 0
    const result = nextIncrement('13', cells - 1, '01-01', tables)
    expect(result.stagnant).toBe(true)
    expect(result.increase).toBe(0)
    expect(result.note.en).toContain('Modified Assured Career Progression')
    expect(result.note.hi.length).toBeGreaterThan(0)
  })
})

describe('fixOnPromotion — FR 22(I)(a)(1)', () => {
  it('grants one increment in the present Level before fixing in the higher one', () => {
    // Level 7 cell 1 is 44,900; one increment makes it 46,200; the first cell
    // of Level 8 at or above 46,200 is 47,600, which is Level 8 cell 1.
    const result = fixOnPromotion('7', 0, '8', tables)
    expect(result.fromBasic).toBe(44_900)
    expect(result.afterIncrement).toBe(46_200)
    expect(result.toBasic).toBe(47_600)
    expect(result.toCellIndex).toBe(0)
    expect(result.increase).toBe(2700)
  })

  it('skips past the cells of the higher Level that the increment overtook', () => {
    // Level 6 cell 11 is ₹47,600. One increment makes it ₹49,000, and the
    // first cell of Level 7 at or above that is ₹49,000 — Level 7 cell 4, not
    // cell 1, which is where a fixation that forgot the increment would land.
    const result = fixOnPromotion('6', 10, '7', tables)
    expect(result.afterIncrement).toBe(49_000)
    expect(result.toCellIndex).toBe(3)
    expect(result.toBasic).toBe(49_000)
  })

  it('handles the interpolated Level 13A on both sides', () => {
    expect(fixOnPromotion('13', 0, '13A', tables).invalid).toBe(false)
    expect(fixOnPromotion('13A', 0, '14', tables).invalid).toBe(false)
    expect(fixOnPromotion('13A', 0, '13', tables).invalid).toBe(true)
  })

  it('refuses a sideways or downward move rather than inventing a figure', () => {
    const result = fixOnPromotion('7', 3, '7', tables)
    expect(result.invalid).toBe(true)
    expect(result.increase).toBe(0)
    expect(result.toBasic).toBe(result.fromBasic)
  })
})

describe('projectEighthCpc', () => {
  it('multiplies, and says every time that it is multiplying a guess', () => {
    const result = projectEighthCpc(44_900, 2.57, tables)
    expect(result.projectedBasic).toBe(115_400) // 44,900 x 2.57 = 115,393
    expect(result.banner.en).toContain('not notified')
    expect(result.whatIsNotKnown.length).toBeGreaterThanOrEqual(5)
    expect(result.daResetNote.en).toContain('no DA')
  })

  it('offers only the factors the dataset records, each with who floated it', () => {
    const result = projectEighthCpc(44_900, 2.57, tables)
    expect(result.range).toEqual({ low: 1.92, high: 2.86 })
    for (const option of result.options) {
      expect(option.source.url).toMatch(/^https:\/\//)
      expect(option.attributedTo.hi.length).toBeGreaterThan(0)
    }
  })

  it('clamps a factor outside the range that has actually been discussed', () => {
    expect(projectEighthCpc(44_900, 9, tables).fitment).toBe(2.86)
    expect(projectEighthCpc(44_900, 1, tables).fitment).toBe(1.92)
  })

  it('never renders NaN, whatever the slider hands it', () => {
    // NaN survives every clamp — `Math.max(NaN, 1.92)` is NaN — so the panel
    // showed "Fitment factor — NaN%" over a projected pay of ₹0.
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const result = projectEighthCpc(44_900, bad, tables)
      expect(Number.isFinite(result.fitment)).toBe(true)
      expect(result.fitment).toBeGreaterThanOrEqual(result.range.low)
      expect(result.fitment).toBeLessThanOrEqual(result.range.high)
      expect(result.projectedBasic).toBeGreaterThan(0)
    }
  })
})
