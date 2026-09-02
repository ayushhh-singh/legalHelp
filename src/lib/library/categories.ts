import { libraryCategorySchema, type LibraryCategory } from '@/schemas/library'

/**
 * The order the shelf groups its works in — service rules first, because that
 * is what an officer opens most, and `other` last as the catch-all.
 *
 * `satisfies` makes every member a real category. It does NOT make the list
 * complete, which is the failure that would matter: a work in a category
 * nothing groups is a work the hub silently never draws. `library.test.ts`
 * asserts completeness against `libraryCategorySchema.options` — the enum
 * itself, not a second list written down here.
 */
export const LIBRARY_CATEGORIES = [
  'service-rules',
  'office-procedure',
  'criminal-law',
  'finance',
  'transparency',
  'official-language',
  'security',
  'workplace',
  'other',
] as const satisfies readonly LibraryCategory[]

/** Every category the schema declares, unordered — what the list above must cover. */
export const ALL_CATEGORIES: readonly LibraryCategory[] = libraryCategorySchema.options
