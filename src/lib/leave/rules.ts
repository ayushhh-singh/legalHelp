/**
 * The numeric constants behind the leave calculator, each carrying the rule
 * it comes from so the UI can show a citation the way a pay-slip line shows
 * its order. Earned Leave and Half Pay Leave are governed by the Central
 * Civil Services (Leave) Rules, 1972 itself; Casual Leave and Restricted
 * Holidays are not "leave" under that statute at all — they are granted by
 * consolidated Ministry of Personnel administrative instructions outside it,
 * which is why their citation below names an O.M. rather than a rule number,
 * and why `verify: true` sits on those two specifically.
 */

export interface RuleCitation {
  act: { en: string; hi: string }
  rule: string
  verify: boolean
}

const CCS_LEAVE_1972 = { en: 'CCS (Leave) Rules, 1972', hi: 'सीसीएस (अवकाश) नियम, 1972' }
const DOPT_CL_INSTRUCTIONS = {
  en: 'Consolidated DoPT instructions on Casual Leave (outside the CCS (Leave) Rules, 1972)',
  hi: 'आकस्मिक अवकाश पर समेकित डीओपीटी अनुदेश (सीसीएस (अवकाश) नियम, 1972 के बाहर)',
}

export const EL_CREDIT_PER_MONTH = 2.5
export const EL_MAX_ACCUMULATION = 300
export const EL_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 26', verify: false }

export const HPL_CREDIT_PER_MONTH = 20 / 12
export const HPL_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 29', verify: false }

/** Half Pay Leave commuted to full-pay commuted leave debits HPL at twice the days taken. */
export const COMMUTED_LEAVE_DEBIT_FACTOR = 2
export const COMMUTED_LEAVE_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 30', verify: false }

export const CL_ENTITLEMENT_PER_YEAR = 8
export const CL_CITATION: RuleCitation = { act: DOPT_CL_INSTRUCTIONS, rule: 'Estt.(A) O.M.', verify: true }

export const RH_ENTITLEMENT_PER_YEAR = 2
export const RH_CITATION: RuleCitation = { act: DOPT_CL_INSTRUCTIONS, rule: 'Estt.(A) O.M.', verify: true }

export const LEAVE_PREPARATORY_TO_RETIREMENT_CITATION: RuleCitation = {
  act: CCS_LEAVE_1972,
  rule: 'Rule 38',
  verify: false,
}

export const EL_ENCASHMENT_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 38A', verify: false }
export const EL_ENCASHMENT_MAX_DAYS = 300

/** Cash equivalent of leave salary encashed alongside one LTC availed. */
export const LTC_ENCASHMENT_DAYS = 10
export const LTC_ENCASHMENT_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 38A', verify: false }

export const EOL_CITATION: RuleCitation = { act: CCS_LEAVE_1972, rule: 'Rule 32', verify: false }

export interface LtcBlockYear {
  block: string
  startYear: number
  endYear: number
}

/** The two current four-year LTC block-year cycles. */
export const LTC_BLOCK_YEARS: LtcBlockYear[] = [
  { block: '2022-25', startYear: 2022, endYear: 2025 },
  { block: '2026-29', startYear: 2026, endYear: 2029 },
]
