import { z } from 'zod'

import { registerTool, registeredToolNames } from './registry'

import { diffResults } from '@/lib/pay/compare'
import { computePay, type PayLine, type PayResult } from '@/lib/pay/engine'
import { normaliseScenario, scenarioForJob, toPayInput, type PayScenario } from '@/lib/pay/scenario'
import { allowanceFor, jobFor, latestNotifiedDa, type PayTables } from '@/lib/pay/tables'
import { loadPayTables } from '@/modules/pay/data'

/**
 * The Pay calculator's agent tools.
 *
 * Every one is a pure function over `data/pay/*.json`, which reaches the device
 * as a lazily-imported chunk and never as a network request (see
 * `src/modules/pay/data.ts`). That is the registry's first rule, and it is what
 * lets an agent answer "what would I be paid as an ACIO in Delhi?" while the
 * app keeps its promise that nothing a reader types goes anywhere.
 *
 * Their second job is grounding. `runAgent` discards an answer that states a
 * figure no cited tool result contains (ADR-011), so these results carry the
 * numbers, the formula that produced each one, and the source URL — explicitly,
 * and at the top level. A result that returned only a net pay would make a
 * correct explanation of it unciteable.
 *
 * Their third job is the `verify` flag. `data/pay/jobs.json` is almost entirely
 * unconfirmed (ADR-016), so every result that rests on it says so in the same
 * words the card on screen uses. An agent that presented a job-title pick as an
 * authority would be doing exactly what the UI is built not to do.
 */

const VERIFY_NOTE = {
  en: 'This figure has not been confirmed against the order that would settle it. Verify with the official gazette/order or your DDO before acting on it.',
  hi: 'यह आँकड़ा उस आदेश से पुष्ट नहीं किया गया है जो इसे निर्णीत करेगा। इस पर कार्रवाई से पहले शासकीय राजपत्र/आदेश अथवा अपने आहरण एवं संवितरण अधिकारी से सत्यापित करें।',
}

let pending: Promise<PayTables> | null = null

function tablesOnce(): Promise<PayTables> {
  // A failed load must not be remembered: caching the rejected promise would
  // make one interrupted download poison every later tool call in the tab.
  pending ??= loadPayTables().catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

const levelRef = z
  .string()
  .regex(/^(1[0-8]|[1-9]|13A)$/)
  .describe('A Pay Matrix Level: "1" to "18", plus the interpolated "13A".')

const overrides = z.object({
  level: levelRef.optional().describe('Overrides the post’s own entry Level.'),
  cell: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe('Cell in the Level, ONE-BASED as the printed matrix numbers them. Defaults to 1.'),
  cityId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional()
    .describe('City id from data/pay/cities.json, e.g. "delhi". Omit for a Z-class place.'),
  daRate: z
    .number()
    .min(0)
    .max(300)
    .optional()
    .describe('Dearness Allowance per cent. Defaults to the latest NOTIFIED rate — never a projection.'),
  quarters: z.boolean().optional().describe('Government accommodation: House Rent Allowance is then nil.'),
  pensionScheme: z.enum(['nps', 'ups', 'gpf']).optional(),
  regime: z.enum(['old', 'new', 'auto']).optional(),
  children: z.number().int().min(0).max(10).optional(),
  npa: z.boolean().optional().describe('Medical officer drawing Non-Practising Allowance.'),
})

type Overrides = z.infer<typeof overrides>

function scenarioFor(jobId: string, tables: PayTables, patch: Overrides): PayScenario {
  const base = scenarioForJob(jobId, tables, {
    daRate: patch.daRate ?? latestNotifiedDa(tables.da)?.rate ?? 0,
  })
  return normaliseScenario(
    {
      ...base,
      level: patch.level ?? base.level,
      cellIndex: (patch.cell ?? 1) - 1,
      cityId: patch.cityId ?? null,
      quarters: patch.quarters ?? false,
      pensionScheme: patch.pensionScheme ?? base.pensionScheme,
      regime: patch.regime ?? 'auto',
      children: patch.children ?? 0,
      npa: patch.npa ?? false,
    },
    tables,
  )
}

/** A line, flattened so every number an answer might quote is at the top level. */
function describeLine(line: PayLine) {
  return {
    id: line.id,
    label: line.label.en,
    labelHi: line.label.hi,
    amount: line.amount,
    formula: line.formula,
    inputs: line.inputs,
    taxable: line.taxable,
    taxSection: line.taxSection,
    source: line.source
      ? { name: line.source.name, url: line.source.url, reference: line.source.reference }
      : null,
    verify: line.verify,
    ...(line.needsChoice ? { needsChoice: true, choices: line.choices?.map((choice) => choice.key) } : {}),
    ...(line.unpriced ? { unpriced: true } : {}),
  }
}

function describeResult(result: PayResult, tables: PayTables, jobId: string | null) {
  const job = jobFor(tables.jobs, jobId)
  return {
    ...(job
      ? {
          job: {
            id: job.id,
            title: job.title.en,
            titleHi: job.title.hi,
            organisation: tables.jobs.organisations[job.organisation]?.name.en ?? job.organisation,
            group: job.group,
            source: { name: job.source.name, url: job.source.url },
            verify: job.verify,
          },
        }
      : {}),
    level: result.level,
    cell: result.cellIndex + 1,
    basic: result.basic,
    gradePay: result.gradePay,
    cityClass: result.cityClass,
    daRate: result.daRate,
    da: result.da,
    hra: result.hra,
    ta: result.ta,
    daOnTransportAllowance: result.daOnTa,
    gross: result.gross,
    deductions: {
      pension: result.deductions.pension,
      pensionScheme: result.pensionScheme,
      cghs: result.deductions.cghs,
      cgegis: result.deductions.cgegis,
      incomeTax: result.deductions.tax,
      total: result.deductions.total,
    },
    netMonthly: result.netMonthly,
    employerPensionContribution: result.employerPension,
    annualCostToGovernment: result.annualCtc,
    tax: {
      chosenRegime: result.regime,
      recommended: result.taxComputation.recommended,
      oldRegimeAnnual: result.taxComputation.old.total,
      newRegimeAnnual: result.taxComputation.new.total,
      saving: result.taxComputation.saving,
    },
    lines: result.lines.map(describeLine),
    warnings: result.warnings.map((warning) => warning.en),
    verify: result.verify,
    ...(result.verify ? { verifyNote: VERIFY_NOTE.en } : {}),
    disclaimer: tables.allowances.disclaimer.en,
  }
}

export function registerPayTools(): void {
  if (registeredToolNames().includes('compute_pay_for_job')) return

  registerTool({
    name: 'compute_pay_for_job',
    scope: 'pay',
    description: {
      en:
        'Work out a monthly pay slip for a Central Government post — basic pay from the 7th CPC matrix, ' +
        'Dearness Allowance, House Rent Allowance by city class, Transport Allowance with DA on it, the ' +
        'allowances the post itself carries, then NPS/UPS, CGHS, CGEGIS and income tax under both ' +
        'regimes. Call `search_pay_jobs` first to get the jobId. Never state a pay figure this tool ' +
        'has not returned, and repeat its `verifyNote` whenever `verify` is true.',
      hi:
        'किसी केंद्रीय सरकारी पद का मासिक वेतन-पर्ची निकालें — 7वें केंद्रीय वेतन आयोग के मैट्रिक्स से मूल ' +
        'वेतन, महँगाई भत्ता, शहर वर्ग के अनुसार मकान किराया भत्ता, परिवहन भत्ता तथा उस पर महँगाई भत्ता, ' +
        'पद से जुड़े भत्ते, तत्पश्चात एनपीएस/यूपीएस, सीजीएचएस, सीजीईजीआईएस तथा दोनों कर व्यवस्थाओं में ' +
        'आयकर। jobId के लिए पहले `search_pay_jobs` चलाएँ। इस उपकरण से न लौटा कोई वेतन आँकड़ा न बताएँ, ' +
        'तथा `verify` सत्य होने पर उसका `verifyNote` अवश्य दोहराएँ।',
    },
    inputSchema: z.object({
      jobId: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .describe('Post id from data/pay/jobs.json, e.g. "ib-acio-ii-executive".'),
      overrides: overrides.optional(),
    }),
    handler: async ({ jobId, overrides: patch }) => {
      const tables = await tablesOnce()
      if (!jobFor(tables.jobs, jobId)) return { jobId, found: false }
      const scenario = scenarioFor(jobId, tables, patch ?? {})
      return { found: true, ...describeResult(computePay(toPayInput(scenario), tables), tables, jobId) }
    },
  })

  registerTool({
    name: 'search_pay_jobs',
    scope: 'pay',
    description: {
      en:
        'Find a Central Government post by title, acronym ("ACIO", "ASO"), organisation ("CAPF", ' +
        '"Railways"), recruiting exam ("SSC CGL") or Pay Matrix Level, in English, Hindi or roman-Hindi. ' +
        'Returns the jobId that `compute_pay_for_job` and `compare_jobs` take.',
      hi:
        'किसी केंद्रीय सरकारी पद को उसके नाम, संक्षेपाक्षर ("ACIO", "ASO"), संगठन ("CAPF", "रेलवे"), ' +
        'भर्ती परीक्षा ("SSC CGL") अथवा वेतन मैट्रिक्स लेवल से खोजें — अंग्रेज़ी, हिंदी या रोमन-हिंदी में। ' +
        'यह वही jobId लौटाता है जो `compute_pay_for_job` तथा `compare_jobs` लेते हैं।',
    },
    inputSchema: z.object({
      query: z.string().min(1).max(120),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    handler: async ({ query, limit }) => {
      const tables = await tablesOnce()
      const { buildJobIndex, searchJobs } = await import('@/modules/pay/pick')
      const hits = searchJobs(buildJobIndex(tables.jobs), query, limit ?? 10)
      return {
        query,
        results: hits.map((hit) => ({
          jobId: hit.job.id,
          title: hit.job.title.en,
          titleHi: hit.job.title.hi,
          organisation: hit.organisation.en,
          group: hit.job.group,
          entryLevel: hit.job.entryLevel,
          gradePay: hit.job.gradePay,
          exam: hit.exam?.name.en ?? null,
          source: { name: hit.job.source.name, url: hit.job.source.url },
          verify: hit.job.verify,
        })),
      }
    },
  })

  registerTool({
    name: 'explain_pay_line',
    scope: 'pay',
    description: {
      en:
        'Explain one line of a pay slip: the formula that produced it, the inputs that went into the ' +
        'formula, and the order it comes from. Use this rather than reconstructing the arithmetic — the ' +
        'bases differ line by line (Non-Practising Allowance counts as pay for DA and not for HRA), and ' +
        'a fixed allowance is usually a quarter more than the figure its order printed.',
      hi:
        'वेतन-पर्ची की किसी एक पंक्ति की व्याख्या: उसे उत्पन्न करने वाला सूत्र, सूत्र में गए मान, तथा वह ' +
        'आदेश जिससे वह आया है। गणना स्वयं न दोहराएँ — आधार पंक्ति-दर-पंक्ति भिन्न हैं (अव्यवसाय भत्ता ' +
        'महँगाई भत्ते के लिए वेतन गिना जाता है, मकान किराया भत्ते के लिए नहीं), और कोई नियत भत्ता प्रायः ' +
        'अपने आदेश में छपे आँकड़े से एक चौथाई अधिक होता है।',
    },
    inputSchema: z.object({
      jobId: z.string().regex(/^[a-z0-9-]+$/),
      lineId: z
        .string()
        .min(1)
        .max(64)
        .describe('Line id from compute_pay_for_job — "basic", "da-on-ta", "house-rent-allowance", "tax".'),
      overrides: overrides.optional(),
    }),
    handler: async ({ jobId, lineId, overrides: patch }) => {
      const tables = await tablesOnce()
      if (!jobFor(tables.jobs, jobId)) return { jobId, found: false }
      const result = computePay(toPayInput(scenarioFor(jobId, tables, patch ?? {})), tables)
      const line = result.lines.find((entry) => entry.id === lineId)
      if (!line) {
        return { jobId, lineId, found: false, availableLines: result.lines.map((entry) => entry.id) }
      }
      return {
        found: true,
        jobId,
        ...describeLine(line),
        conditions: line.conditions.map((condition) => condition.en),
        note: line.note?.en ?? null,
        ...(line.verify ? { verifyNote: VERIFY_NOTE.en } : {}),
      }
    },
  })

  registerTool({
    name: 'get_allowance_source',
    scope: 'pay',
    description: {
      en:
        'The order behind an allowance: its number, its date, its URL, the rates it carries, the ' +
        'conditions on it, whether it is taxable, and whether the rate stated is the one payable today ' +
        'or the one the order printed. Call this before citing an allowance.',
      hi:
        'किसी भत्ते के पीछे का आदेश: उसकी संख्या, तिथि, URL, उसमें दी गई दरें, उस पर लगी शर्तें, वह कर ' +
        'योग्य है या नहीं, तथा दर्शाई गई दर आज देय दर है या वह जो आदेश में छपी थी। किसी भत्ते का उद्धरण ' +
        'देने से पहले इसे चलाएँ।',
    },
    inputSchema: z.object({
      allowanceId: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .describe('Allowance id from data/pay/allowances.json, e.g. "house-rent-allowance".'),
    }),
    handler: async ({ allowanceId }) => {
      const tables = await tablesOnce()
      const allowance = allowanceFor(tables.allowances, allowanceId)
      if (!allowance) {
        return {
          allowanceId,
          found: false,
          available: tables.allowances.allowances.map((entry) => entry.id),
        }
      }
      const factor =
        allowance.daLinked.kind === 'quarter-per-fifty' ? 1.25 ** allowance.daLinked.timesApplied : 1
      return {
        found: true,
        id: allowance.id,
        name: allowance.name.en,
        nameHi: allowance.name.hi,
        status: allowance.status,
        appliesTo: allowance.appliesTo.en,
        taxable: allowance.taxable,
        taxSection: allowance.taxSection,
        daLinked: allowance.daLinked.kind,
        // The figure the order printed, and the figure payable now. Both, named
        // — an agent that quoted only one of them would be right half the time.
        rates: allowance.rates.map((rate) => ({
          key: rate.key,
          when: rate.when.en,
          measure: rate.measure,
          statedInOrder: rate.value,
          payableNow:
            rate.value != null && factor !== 1 && rate.measure.startsWith('rupees')
              ? Math.round(rate.value * factor)
              : rate.value,
          floor: rate.floor ?? null,
          ceiling: rate.ceiling ?? null,
        })),
        conditions: allowance.conditions.map((condition) => condition.en),
        source: {
          name: allowance.source.name,
          url: allowance.source.url,
          reference: allowance.source.reference,
          dated: allowance.source.dated,
        },
        verify: allowance.verify,
        ...(allowance.verify ? { verifyNote: VERIFY_NOTE.en } : {}),
      }
    },
  })

  registerTool({
    name: 'compare_jobs',
    scope: 'pay',
    description: {
      en:
        'Put two posts side by side on the same assumptions and return the difference, line by line. ' +
        'A line that only one of the two carries is kept, with zero on the other side — that row is ' +
        'usually the answer to why the two differ.',
      hi:
        'दो पदों को समान मान्यताओं पर आमने-सामने रखकर पंक्ति-दर-पंक्ति अंतर लौटाता है। जो पंक्ति केवल एक ' +
        'पद में है, वह दूसरी ओर शून्य के साथ बनी रहती है — प्रायः वही पंक्ति बताती है कि दोनों में अंतर ' +
        'क्यों है।',
    },
    inputSchema: z.object({
      jobA: z.string().regex(/^[a-z0-9-]+$/),
      jobB: z.string().regex(/^[a-z0-9-]+$/),
      overrides: overrides.optional().describe('Applied to BOTH posts, so the comparison is like for like.'),
    }),
    handler: async ({ jobA, jobB, overrides: patch }) => {
      const tables = await tablesOnce()
      if (!jobFor(tables.jobs, jobA) || !jobFor(tables.jobs, jobB)) {
        return { jobA, jobB, found: false }
      }
      const a = computePay(toPayInput(scenarioFor(jobA, tables, patch ?? {})), tables)
      const b = computePay(toPayInput(scenarioFor(jobB, tables, patch ?? {})), tables)
      const diff = diffResults(a, b)

      return {
        found: true,
        a: describeResult(a, tables, jobA),
        b: describeResult(b, tables, jobB),
        difference: {
          gross: diff.gross.delta,
          netMonthly: diff.net.delta,
          incomeTax: diff.tax.delta,
          annualCostToGovernment: diff.annualCtc.delta,
          lines: diff.rows
            .filter((row) => row.delta !== 0)
            .map((row) => ({ id: row.id, label: row.label.en, a: row.a, b: row.b, delta: row.delta })),
        },
        verifyNote: a.verify || b.verify ? VERIFY_NOTE.en : null,
      }
    },
  })
}

/** Test seam: the memoised datasets, dropped. */
export function resetPayToolCache(): void {
  pending = null
}
