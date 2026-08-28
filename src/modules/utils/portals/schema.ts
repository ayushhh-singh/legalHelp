import { z } from 'zod'

const bilingual = z.strictObject({ en: z.string().min(1), hi: z.string().min(1) })
const url = z.string().regex(/^https?:\/\//)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const slug = z.string().regex(/^[a-z0-9-]+$/)

export const PORTAL_CATEGORIES = [
  'hr-service',
  'pay-pension',
  'health',
  'grievance',
  'training',
  'provident-fund-nps',
  'e-office',
  'procurement',
  'rajbhasha',
  'law-gazette',
  'welfare',
] as const

export const portalSourceSchema = z.strictObject({
  name: z.string().min(1),
  url,
  reference: z.string().optional(),
  dated: isoDate.optional(),
  note: bilingual.optional(),
})

export const portalSchema = z.strictObject({
  id: slug,
  name: bilingual,
  shortName: bilingual,
  purpose: bilingual,
  url,
  category: z.enum(PORTAL_CATEGORIES),
  helpline: z
    .strictObject({ phone: z.string().optional(), email: z.string().optional(), label: bilingual })
    .nullable(),
  administeredBy: bilingual,
  source: portalSourceSchema.optional(),
  verify: z.boolean(),
})

export const portalsDatasetSchema = z.strictObject({
  $schema: z.string().optional(),
  version: semver,
  generatedAt: z.string(),
  disclaimer: bilingual,
  portals: z.array(portalSchema).min(1),
})

export type PortalCategory = (typeof PORTAL_CATEGORIES)[number]
export type Portal = z.infer<typeof portalSchema>
export type PortalsDataset = z.infer<typeof portalsDatasetSchema>
