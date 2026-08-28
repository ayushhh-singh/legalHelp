import { rupees } from './rounding'
import {
  cellAtOrAbove,
  cellPay,
  clampCell,
  levelFor,
  levelRank,
  type Bilingual,
  type PayLevelId,
  type PayTables,
} from './tables'

/**
 * The four what-ifs the Pay module offers, kept out of `engine.ts` because none
 * of them is a pay slip: each one produces a NEW basic pay, which the engine
 * then costs in the ordinary way.
 *
 * The 8th Central Pay Commission one is different in kind from the other three
 * and the difference is the point. An annual increment, a promotion and a
 * change in the Dearness Allowance rate are all rules that exist; an 8th CPC
 * pay matrix does not. `projectEighthCpc` returns a figure only alongside the
 * five things `data/pay/cpc8.json` records that nobody knows, and the UI is
 * required to render them.
 */

/* ------------------------------------------------------------------ *
 * Annual increment
 * ------------------------------------------------------------------ */

/** The two increment dates under the CCS (Revised Pay) Rules, 2016. */
export type IncrementDate = '01-01' | '07-01'

export interface IncrementResult {
  on: IncrementDate
  level: PayLevelId
  fromCellIndex: number
  toCellIndex: number
  fromBasic: number
  toBasic: number
  increase: number
  /** True where the officer is already in the last cell of the Level. */
  stagnant: boolean
  note: Bilingual
}

/**
 * The next cell of the same Level.
 *
 * The increment is not "add three per cent": it is "move to the next cell", and
 * the cell was built by adding three per cent and rounding to the nearest
 * hundred. Computing 3 per cent here instead would drift away from the printed
 * matrix within two increments, which is exactly the kind of quiet error a pay
 * calculator must not make.
 */
export function nextIncrement(
  level: PayLevelId,
  cellIndex: number,
  on: IncrementDate,
  tables: PayTables,
): IncrementResult {
  const cells = levelFor(tables.matrix, level)?.cells ?? []
  const from = clampCell(tables.matrix, level, cellIndex)
  const stagnant = from >= cells.length - 1
  const to = stagnant ? from : from + 1
  const fromBasic = cells[from] ?? 0
  const toBasic = cells[to] ?? fromBasic

  return {
    on,
    level,
    fromCellIndex: from,
    toCellIndex: to,
    fromBasic,
    toBasic,
    increase: toBasic - fromBasic,
    stagnant,
    note: stagnant
      ? {
          en: `Level ${level} has no cell above this one. Further movement needs a promotion or an upgrade under the Modified Assured Career Progression Scheme.`,
          hi: `लेवल ${level} में इससे ऊपर कोई सेल नहीं है। आगे की वृद्धि के लिए पदोन्नति अथवा संशोधित सुनिश्चित वृत्ति उन्नयन योजना के अंतर्गत उन्नयन आवश्यक है।`,
        }
      : {
          en: 'The next cell of the Level — the previous cell raised by 3 per cent and rounded to the nearest hundred rupees.',
          hi: 'लेवल का अगला सेल — पिछला सेल 3 प्रतिशत बढ़ाकर निकटतम सौ रुपये तक पूर्णांकित।',
        },
  }
}

/* ------------------------------------------------------------------ *
 * Promotion and MACP
 * ------------------------------------------------------------------ */

export interface PromotionResult {
  fromLevel: PayLevelId
  fromCellIndex: number
  fromBasic: number
  /** Pay after one increment in the present Level — the FR 22 first step. */
  afterIncrement: number
  toLevel: PayLevelId
  toCellIndex: number
  toBasic: number
  increase: number
  /** The target Level is at or below the present one. */
  invalid: boolean
  note: Bilingual
}

/**
 * Fixation on promotion, and on an upgrade under the Modified Assured Career
 * Progression Scheme, under FR 22(I)(a)(1) as applied to the Pay Matrix.
 *
 * Two steps, and the first is the one people forget: pay is first raised by ONE
 * INCREMENT IN THE PRESENT LEVEL, and only then placed in the new Level at the
 * cell equal to or next above that figure. Skipping the increment under-states
 * the fixation by one cell every time.
 */
export function fixOnPromotion(
  fromLevel: PayLevelId,
  fromCellIndex: number,
  toLevel: PayLevelId,
  tables: PayTables,
): PromotionResult {
  const from = clampCell(tables.matrix, fromLevel, fromCellIndex)
  const fromBasic = cellPay(tables.matrix, fromLevel, from) ?? 0
  const afterIncrement = nextIncrement(fromLevel, from, '01-01', tables).toBasic
  const invalid = !levelFor(tables.matrix, toLevel) || levelRank(toLevel) <= levelRank(fromLevel)

  if (invalid) {
    return {
      fromLevel,
      fromCellIndex: from,
      fromBasic,
      afterIncrement,
      toLevel,
      toCellIndex: from,
      toBasic: fromBasic,
      increase: 0,
      invalid: true,
      note: {
        en: 'A promotion or an upgrade must be to a higher Level of the Pay Matrix.',
        hi: 'पदोन्नति अथवा उन्नयन वेतन मैट्रिक्स के उच्चतर लेवल में ही हो सकता है।',
      },
    }
  }

  const toCellIndex = cellAtOrAbove(tables.matrix, toLevel, afterIncrement)
  const toBasic = cellPay(tables.matrix, toLevel, toCellIndex) ?? afterIncrement

  return {
    fromLevel,
    fromCellIndex: from,
    fromBasic,
    afterIncrement,
    toLevel,
    toCellIndex,
    toBasic,
    increase: toBasic - fromBasic,
    invalid: false,
    note: {
      en: 'Pay is first raised by one increment in the present Level, and then fixed in the higher Level at the cell equal to or next above that figure.',
      hi: 'वेतन पहले वर्तमान लेवल में एक वेतनवृद्धि से बढ़ाया जाता है, तत्पश्चात उच्चतर लेवल में उस राशि के बराबर या उससे अगले सेल पर नियत किया जाता है।',
    },
  }
}

/* ------------------------------------------------------------------ *
 * The 8th Central Pay Commission
 * ------------------------------------------------------------------ */

export interface FitmentOption {
  value: number
  attributedTo: Bilingual
  source: { name: string; url: string; reference?: string; dated?: string }
  note?: Bilingual | null
}

export interface EighthCpcProjection {
  fitment: number
  fromBasic: number
  /** Arithmetic, not a pay matrix. Nothing has been recommended. */
  projectedBasic: number
  /** Every fitment factor in public circulation, each with who floated it. */
  options: FitmentOption[]
  range: { low: number; high: number }
  /** The five things `cpc8.json` says nobody knows. Rendered, always. */
  whatIsNotKnown: Bilingual[]
  banner: Bilingual
  daResetNote: Bilingual
}

/**
 * Arithmetic on a number nobody has notified.
 *
 * There is no 8th CPC pay matrix. `data/pay/cpc8.json` has no place to put one,
 * and `tests/pay-data.test.ts` asserts that absence because the absence is the
 * feature. What this returns is a multiplication the reader asked for, wrapped
 * in everything that is not known about it — which is what separates it from
 * every "8th CPC salary calculator" on the internet, each of which is
 * multiplying a guess by a pay matrix and calling the product a salary.
 *
 * The Dearness Allowance note matters as much as the figure. A pay commission
 * subsumes the DA payable on the date it takes effect, so the projected basic
 * carries NO Dearness Allowance — comparing it against today's basic PLUS 60
 * per cent DA is the mistake every such calculator invites.
 */
export function projectEighthCpc(basic: number, fitment: number, tables: PayTables): EighthCpcProjection {
  const options = tables.cpc8.fitmentFactorsDiscussed.map((entry) => ({
    value: entry.value,
    attributedTo: entry.attributedTo,
    source: entry.source,
    note: entry.note ?? null,
  }))
  const values = options.map((option) => option.value)
  const low = values.length > 0 ? Math.min(...values) : fitment
  const high = values.length > 0 ? Math.max(...values) : fitment
  // `Math.max(NaN, low)` is NaN, and NaN survives every clamp — the panel then
  // rendered "Fitment factor — NaN%" over a projected pay of ₹0. A range input
  // reports '' while it is being dragged with the keyboard on some platforms,
  // and `Number('')` is 0, but `Number(undefined)` is NaN.
  const wanted = Number.isFinite(fitment) ? fitment : (tables.cpc8.fitmentFactorsDiscussed[0]?.value ?? low)
  const chosen = Math.min(Math.max(wanted, low), high)

  return {
    fitment: chosen,
    fromBasic: basic,
    // Rounded to the nearest hundred, which is how every cell of the 7th CPC
    // matrix was built. It is a convention, not a recommendation.
    projectedBasic: rupees(Math.round((basic * chosen) / 100) * 100),
    options,
    range: { low, high },
    whatIsNotKnown: tables.cpc8.whatIsNotKnown,
    banner: {
      en: 'Projection — not notified. The 8th Central Pay Commission has recommended nothing, and there is no pay matrix.',
      hi: 'प्रक्षेपण — अधिसूचित नहीं। आठवें केंद्रीय वेतन आयोग ने कोई संस्तुति नहीं की है, और कोई वेतन मैट्रिक्स नहीं है।',
    },
    daResetNote: {
      en: 'A pay commission subsumes the Dearness Allowance payable on the date it takes effect, so the projected pay carries no DA. Do not compare it against your present basic pay plus DA.',
      hi: 'वेतन आयोग अपनी प्रभावी तिथि को देय महँगाई भत्ते को मूल वेतन में समाहित कर देता है, अतः प्रक्षेपित वेतन पर कोई महँगाई भत्ता नहीं है। इसकी तुलना अपने वर्तमान मूल वेतन तथा महँगाई भत्ते के योग से न करें।',
    },
  }
}
