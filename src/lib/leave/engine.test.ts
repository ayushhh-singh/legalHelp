import { describe, expect, it } from 'vitest'

import { calculateLeaveBalances, cashEquivalent, elCredited, hplCredited } from './engine'

import type { LeaveInput } from './types'

const baseInput: LeaveInput = {
  doj: '2020-01-01',
  elTaken: 0,
  hplTaken: 0,
  clTakenThisYear: 0,
  rhTakenThisYear: 0,
}

describe('EL and HPL credit across half-years', () => {
  it('credits 15 EL and 10 HPL at the six-month mark', () => {
    expect(elCredited('2020-01-01', '2020-07-01')).toBe(15)
    expect(hplCredited('2020-01-01', '2020-07-01')).toBeCloseTo(10, 6)
  })

  it('credits 30 EL and 20 HPL after one full year — two half-yearly postings', () => {
    expect(elCredited('2020-01-01', '2021-01-01')).toBe(30)
    expect(hplCredited('2020-01-01', '2021-01-01')).toBeCloseTo(20, 6)
  })

  it('credits nothing before the first completed month', () => {
    expect(elCredited('2020-01-15', '2020-02-10')).toBe(0)
    expect(elCredited('2020-01-15', '2020-02-15')).toBe(2.5)
  })
})

describe('EL accumulation cap', () => {
  it('caps the balance at 300 even though the credit keeps accruing', () => {
    // 15 years of untaken EL: 15 * 30 = 450 credited, capped at 300 balance.
    const balances = calculateLeaveBalances(baseInput, '2035-01-01')
    expect(balances.el.credited).toBe(450)
    expect(balances.el.balance).toBe(300)
    expect(balances.el.encashable).toBe(300)
  })

  it('is exactly 300 the moment credit reaches 300, not before or after', () => {
    // 300 / 2.5 = 120 completed months = 10 years.
    const at300 = calculateLeaveBalances(baseInput, '2030-01-01')
    expect(at300.el.credited).toBe(300)
    expect(at300.el.balance).toBe(300)
  })

  it('reduces the balance by leave actually taken, still respecting the cap', () => {
    // 450 credited - 200 taken = 250, which is below the 300 cap and so is not clipped by it.
    const balances = calculateLeaveBalances({ ...baseInput, elTaken: 200 }, '2035-01-01')
    expect(balances.el.balance).toBe(250)
  })

  it('never goes negative when more leave is recorded taken than credited', () => {
    const balances = calculateLeaveBalances({ ...baseInput, elTaken: 999 }, '2020-06-01')
    expect(balances.el.balance).toBe(0)
  })
})

describe('HPL commutation', () => {
  it('halves the HPL balance, rounded down, for the commuted-leave figure', () => {
    const balances = calculateLeaveBalances(baseInput, '2021-01-01') // 20 HPL credited
    expect(balances.hpl.balance).toBeCloseTo(20, 6)
    expect(balances.hpl.commutable).toBe(10)
  })
})

describe('Casual Leave and Restricted Holidays: pro-rata in the joining year, full thereafter', () => {
  it('pro-rates CL and RH for a mid-year joiner', () => {
    const input: LeaveInput = { ...baseInput, doj: '2026-07-01' } // 6 months remaining, inclusive
    const balances = calculateLeaveBalances(input, '2026-08-01')
    expect(balances.cl.credited).toBe(4) // 8 * 6/12
    expect(balances.rh.credited).toBe(1) // 2 * 6/12
  })

  it('gives the full entitlement in a later year', () => {
    const balances = calculateLeaveBalances(baseInput, '2026-08-01')
    expect(balances.cl.credited).toBe(8)
    expect(balances.rh.credited).toBe(2)
  })

  it('gives nothing before the officer has joined', () => {
    const balances = calculateLeaveBalances({ ...baseInput, doj: '2027-01-01' }, '2026-08-01')
    expect(balances.cl.credited).toBe(0)
    expect(balances.rh.credited).toBe(0)
  })
})

describe('cashEquivalent', () => {
  it('applies the (basic + DA) / 30 * days formula, rounded to the rupee', () => {
    expect(cashEquivalent(100000, 300)).toBe(1000000)
    expect(cashEquivalent(83333, 10)).toBe(27778) // 83333/30*10 = 27777.67
  })
})
