import type { Language } from '@/i18n'

/**
 * The Library's own navigation tags, and their bilingual labels.
 *
 * `examTags` in `data/library/works/*.json` is a `string[]` of slugs, and this
 * is the one place a slug becomes something a reader sees. Declaring it as a
 * literal-keyed record rather than `Record<string, …>` makes an unlabelled tag
 * a COMPILE error at every call site, the same shape `draft.ai.step.<tool>`
 * uses — and `tests/library-data.test.ts` asserts in the other direction, that
 * no tag in the datasets is missing from here.
 *
 * These are this project's editorial labels, not anything a Ministry published,
 * which is why they live in code with the rest of the app's own vocabulary
 * rather than in the dataset beside the citations.
 */
export const LIBRARY_TAGS = {
  conduct: { en: 'Conduct', hi: 'आचरण' },
  discipline: { en: 'Discipline', hi: 'अनुशासन' },
  vigilance: { en: 'Vigilance', hi: 'सतर्कता' },
  probation: { en: 'Probation', hi: 'परिवीक्षा' },
  'departmental-exam': { en: 'Departmental exam', hi: 'विभागीय परीक्षा' },
  ldce: { en: 'LDCE', hi: 'सीमित विभागीय प्रतियोगी परीक्षा' },
  leave: { en: 'Leave', hi: 'छुट्टी' },
  pension: { en: 'Pension', hi: 'पेंशन' },
  retirement: { en: 'Retirement', hi: 'सेवानिवृत्ति' },
  establishment: { en: 'Establishment', hi: 'स्थापना' },
  'pay-and-allowances': { en: 'Pay & allowances', hi: 'वेतन एवं भत्ते' },
  procurement: { en: 'Procurement', hi: 'खरीद' },
  finance: { en: 'Finance', hi: 'वित्त' },
  'noting-and-drafting': { en: 'Noting & drafting', hi: 'टिप्पणी एवं प्रारूपण' },
  'file-management': { en: 'File management', hi: 'फ़ाइल प्रबंधन' },
  induction: { en: 'Induction', hi: 'आमुखीकरण' },
  rti: { en: 'RTI', hi: 'सूचना का अधिकार' },
  transparency: { en: 'Transparency', hi: 'पारदर्शिता' },
  'criminal-law': { en: 'Criminal law', hi: 'दंड विधि' },
  'criminal-procedure': { en: 'Criminal procedure', hi: 'दंड प्रक्रिया' },
  evidence: { en: 'Evidence', hi: 'साक्ष्य' },
  investigation: { en: 'Investigation', hi: 'अन्वेषण' },
  'official-language': { en: 'Official language', hi: 'राजभाषा' },
  security: { en: 'Security', hi: 'सुरक्षा' },
  'workplace-safety': { en: 'Workplace safety', hi: 'कार्यस्थल सुरक्षा' },
} as const satisfies Record<string, Record<Language, string>>

export type LibraryTag = keyof typeof LIBRARY_TAGS

export const isLibraryTag = (value: string): value is LibraryTag => value in LIBRARY_TAGS

/** The label, or the slug itself — a tag added to the data before this file. */
export function tagLabel(tag: string, language: Language): string {
  return isLibraryTag(tag) ? LIBRARY_TAGS[tag][language] : tag
}
