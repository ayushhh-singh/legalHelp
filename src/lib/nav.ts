import { Calculator, FileSignature, GraduationCap, Scale, Settings, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Language } from '@/i18n'

/**
 * THE nav config. One array drives the desktop sidebar (>=1024px), the mobile
 * bottom tab bar (<1024px) and the router, so a destination can never appear in
 * one and not another.
 *
 * Labels live here as `{ en, hi }` objects rather than as translation keys,
 * matching the master context's rule for every data record. `Record<Language,
 * string>` makes a missing Hindi label a compile error, which is the same
 * guarantee scripts/i18n-check.mjs gives the JSON catalogues.
 */
export interface NavItem {
  id: string
  path: string
  icon: LucideIcon
  /** Full name: the sidebar label and the accessible name everywhere. */
  label: Record<Language, string>
  /** Short form for the bottom tab bar, where width is scarce. */
  short: Record<Language, string>
  /**
   * One of the five modules, as opposed to a support destination. Only flagship
   * items get a bottom-bar slot of their own; the rest live behind "More".
   */
  flagship?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'law',
    path: '/law',
    icon: Scale,
    label: { en: 'Law Converter', hi: 'विधि परिवर्तक' },
    short: { en: 'Law', hi: 'विधि' },
    flagship: true,
  },
  {
    id: 'pay',
    path: '/pay',
    icon: Calculator,
    label: { en: 'Pay & Allowances', hi: 'वेतन एवं भत्ते' },
    short: { en: 'Pay', hi: 'वेतन' },
    flagship: true,
  },
  {
    id: 'draft',
    path: '/draft',
    icon: FileSignature,
    label: { en: 'Drafting Studio', hi: 'प्रारूपण कक्ष' },
    short: { en: 'Draft', hi: 'प्रारूप' },
    flagship: true,
  },
  {
    id: 'learn',
    path: '/learn',
    icon: GraduationCap,
    label: { en: 'Rules Trainer', hi: 'नियम अभ्यास' },
    short: { en: 'Learn', hi: 'अभ्यास' },
    flagship: true,
  },
  {
    id: 'utils',
    path: '/utils',
    icon: Wrench,
    label: { en: 'Utilities', hi: 'उपयोगी साधन' },
    short: { en: 'Tools', hi: 'साधन' },
  },
  {
    id: 'settings',
    path: '/settings',
    icon: Settings,
    label: { en: 'Settings', hi: 'सेटिंग्स' },
    short: { en: 'Settings', hi: 'सेटिंग्स' },
  },
] as const

/**
 * The four bottom-bar slots below 768px. The remainder go into the "More"
 * sheet; from 768px up the bar simply shows everything and "More" disappears.
 */
export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.flagship)
export const OVERFLOW_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.flagship)

/** Landing route. Law is the most-used module, so "/" redirects here. */
export const HOME_PATH = '/law'
