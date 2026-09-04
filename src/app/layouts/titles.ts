import { APP_ROUTES } from '@/lib/nav'

/**
 * Route pattern → the i18n key naming that page.
 *
 * Only `detail` and `focus` routes need one: a `tab` route's name is its
 * sub-tab's label, which `src/lib/nav.ts` already carries in both languages.
 *
 * A literal map rather than a `titleKey` field on `AppRoute`, for two reasons.
 * `t()` is typed against the catalogue, so a key written here is checked and a
 * key assembled from a template is not — the arrangement `AiDraftPanel.tsx`
 * uses for its per-tool labels and `ExamChecklistPage.tsx` for its items. And
 * `src/lib/nav.ts` stays free of translation keys, so it keeps saying what the
 * structure is rather than how it is worded.
 *
 * `satisfies` over the route list makes a detail or focus route added without
 * a name a COMPILE error, which is what stops a breadcrumb trail ending in a
 * blank crumb.
 */
type DetailOrFocusPath = Extract<(typeof APP_ROUTES)[number], { level: 'detail' | 'focus' }>['path']

export const ROUTE_TITLE_KEYS = {
  '/study/read/search': 'library.search.allTitle',
  '/study/read/add': 'library.add.title',
  '/study/read/:workId': 'library.work.title',
  '/study/read/:workId/quiz/:nodeId': 'library.study.quiz.title',
  '/study/read/:workId/sheet/:nodeId': 'library.study.sheet.title',
  '/study/read/:workId/:unitId': 'library.reader.title',
  '/study/progress': 'library.study.hub.title',
  '/study/practise/review': 'trainer.review.title',
  '/study/practise/mock': 'trainer.mock.title',
  '/study/practise/browse': 'trainer.browse.title',
  '/study/practise/bookmarks': 'trainer.bookmarks.title',
  '/study/practise/reports': 'trainer.reports.title',
  '/study/practise/review-queue': 'trainer.reviewQueue.title',
  '/study/exam/mock': 'trainer.exam.mock.title',
  '/study/notes/compare': 'library.compare.title',
  '/draft/documents/import': 'draft.import.title',
  '/draft/new/:type': 'draft.editor.newDocument',
  '/draft/d/:id': 'draft.editor.title',
  '/draft/d/:id/print': 'draft.print.title',
  '/draft/reply/:id': 'draft.intake.heading',
  '/settings': 'pages.settings.title',
  '/settings/profile': 'draft.profile.heading',
  '/settings/address-book': 'draft.addressBook.heading',
  '/settings/numbering': 'draft.numbering.heading',
  '/settings/trainer': 'trainer.settings.title',
  '/settings/ai': 'ai.sectionTitle',
  '/settings/data': 'pages.settings.updates.title',
  '/settings/backup': 'pages.settings.backup.title',
  '/settings/about': 'pages.settings.about.title',
  '/onboarding': 'onboarding.title',
} as const satisfies Record<DetailOrFocusPath, string>

/** The section header's own subtitle, per tab. Same reasoning as above. */
export const SECTION_SUBTITLE_KEYS = {
  home: 'pages.home.subtitle',
  study: 'pages.study.subtitle',
  draft: 'pages.draft.subtitle',
  law: 'pages.law.subtitle',
  tools: 'pages.tools.subtitle',
} as const
