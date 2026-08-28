import { z } from 'zod'

import { registerDraftingTools } from './drafting'
import { registerLawTools } from './law'
import { registerPayTools } from './pay'
import { registerTool, registeredToolNames } from './registry'

import { DATASETS, DATA_GENERATED_AT, DATA_VERSION } from '@/lib/dataVersion'

/**
 * The built-in tools.
 *
 * Both of these are `common` scope — every agent gets them — and both are pure
 * functions over data that is already on the device. The module tools (section
 * lookup, pay-matrix cell, holiday calendar, template fetch) arrive in the
 * sessions that bring their datasets; the pattern is this file.
 *
 * Registration is idempotent so that a hot reload, or a test that imports this
 * module twice, does not throw on the duplicate-name guard.
 */

const NO_INPUT = z.object({}).strict()

export function registerBuiltinTools(): void {
  // The module tools register themselves. Each one is idempotent, so this is
  // safe on a hot reload and in a test that imports this module twice.
  registerLawTools()
  registerPayTools()
  registerDraftingTools()

  if (registeredToolNames().includes('dataset_versions')) return

  registerTool({
    name: 'dataset_versions',
    scope: 'common',
    description: {
      en:
        'List the bundled datasets on this device with their version and last-updated date. ' +
        'Call this before stating how current a figure or a section table is.',
      hi:
        'इस डिवाइस पर मौजूद डेटासेट, उनके संस्करण और अंतिम अद्यतन तिथि सहित। किसी आँकड़े या ' +
        'धारा-तालिका की नवीनता बताने से पहले इसे चलाएँ।',
    },
    inputSchema: NO_INPUT,
    handler: () =>
      Promise.resolve({
        fingerprint: DATA_VERSION,
        generatedAt: DATA_GENERATED_AT,
        datasets: Object.entries(DATASETS)
          .filter((entry): entry is [string, NonNullable<(typeof DATASETS)[string]>] => Boolean(entry[1]))
          .map(([name, dataset]) => ({
            name,
            version: dataset.version,
            updated: dataset.updated,
            label: dataset.label,
          })),
      }),
  })

  registerTool({
    name: 'today_in_india',
    scope: 'common',
    description: {
      en:
        'Return today’s date in Asia/Kolkata, plus the financial year and the leave year it ' +
        'falls in. Use this instead of assuming a date: whether an offence falls under the IPC or ' +
        'the BNS, and which leave year a day belongs to, both turn on it.',
      hi:
        'एशिया/कोलकाता समयानुसार आज की तारीख, साथ ही उससे जुड़ा वित्तीय वर्ष और अवकाश वर्ष। ' +
        'तारीख का अनुमान लगाने के बजाय इसका प्रयोग करें: अपराध IPC के अंतर्गत आएगा या BNS के, ' +
        'और कोई दिन किस अवकाश वर्ष का है — दोनों इसी पर निर्भर हैं।',
    },
    inputSchema: NO_INPUT,
    handler: () => Promise.resolve(todayInIndia()),
  })
}

/**
 * Everything here is derived from the clock, with no locale assumptions: the
 * `en-CA` formatter is used purely because it yields `YYYY-MM-DD`, and the
 * time zone is pinned to Asia/Kolkata rather than the device's, which may be
 * anything on a laptop that travelled.
 */
export function todayInIndia(now: Date = new Date()): {
  date: string
  timeZone: string
  financialYear: string
  leaveYear: number
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

  const [year = '1970', month = '01'] = parts.split('-')
  const y = Number(year)
  const m = Number(month)
  // The Indian financial year runs 1 April to 31 March.
  const fyStart = m >= 4 ? y : y - 1

  return {
    date: parts,
    timeZone: 'Asia/Kolkata',
    financialYear: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`,
    // Earned leave is credited by calendar year for central government staff.
    leaveYear: y,
  }
}
