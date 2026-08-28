import type { IsoDate } from '@/lib/istDay'

export interface LeaveInput {
  doj: IsoDate
  /** Leave already taken, lifetime for EL/HPL, this calendar year for CL/RH. */
  elTaken: number
  hplTaken: number
  clTakenThisYear: number
  rhTakenThisYear: number
}

export interface LeaveBucket {
  credited: number
  taken: number
  balance: number
}

export interface LeaveBalances {
  asOf: IsoDate
  el: LeaveBucket & { encashable: number }
  hpl: LeaveBucket & { commutable: number }
  cl: LeaveBucket
  rh: LeaveBucket
}
