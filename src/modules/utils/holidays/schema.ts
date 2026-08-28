import { z } from 'zod'

/**
 * The runtime half of the holidays dataset contract — `schemas/holidays.
 * schema.json` is the Python half `scripts/ingest/holidays.py` and `scripts/
 * ingest/validate_data.py` validate against. Strict, for the reason `src/
 * modules/pay/schema.ts` gives: `z.object` silently drops an unknown key.
 */

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)
const weekday = z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])

export const holidaySourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

export const holidaySchema = z.strictObject({
  id: slug,
  name: bilingual,
  date: isoDate,
  day: weekday,
})

export const holidaysDatasetSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
  year: z.number().int().min(2000).max(2100),
  source: holidaySourceSchema,
  fetchedAt: z.string(),
  verify: z.boolean(),
  delegationNote: bilingual,
  gazetted: z.array(holidaySchema).min(1),
  restricted: z.array(holidaySchema).min(1),
})

export type Holiday = z.infer<typeof holidaySchema>
export type HolidaysDataset = z.infer<typeof holidaysDatasetSchema>
