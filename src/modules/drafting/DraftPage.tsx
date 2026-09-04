import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useDueFollowUpCount } from './register/useFollowUps'

import { LegacyRedirect } from '@/app/LegacyRedirect'
import { DetailLayout } from '@/app/layouts/DetailLayout'
import { FocusLayout } from '@/app/layouts/FocusLayout'
import { TabLayout } from '@/app/layouts/TabLayout'
import { useT } from '@/i18n/useT'
import { redirectsUnder } from '@/lib/nav'

/**
 * The Drafting Studio's own router, mounted at `/draft/*` by `src/app/App.tsx`.
 *
 * Thirteen sibling routes off a picker became five sub-tabs and the pages under
 * them (ADR-046 §6):
 *
 * - **Documents** is the library — continue, search, filter, import, bulk
 *   export — with the import flow as a page under it rather than beside it.
 * - **New** is the template gallery. Choosing a form creates the document and
 *   opens the editor; there is no second editor any more.
 * - **Reply**, **Register** and **Templates** are what they were.
 *
 * Profile, address book and numbering MOVED to `/settings/*`. They are things
 * an officer sets once and every new document reads, which is what Settings is
 * for — and having them as siblings of "Documents" was three of the thirteen.
 *
 * ### The redirects live here, not in the app router
 *
 * `/draft/:type` is the Session 8 editor's old route and it matches every
 * single-segment path under `/draft/documents`. React Router ranks a dynamic segment
 * above a splat, so mounting it beside `/draft/*` in the app router would make
 * it claim `/draft/documents` and send an officer's document list to a
 * template called "documents". Inside this router it is simply LAST, after
 * every real route — which is exactly where it was before.
 */
const PickerPage = lazy(() => import('./PickerPage'))
const DocEditorPage = lazy(() => import('./DocEditorPage'))
const DocumentsPage = lazy(() => import('./DocumentsPage'))
const NewDocumentPage = lazy(() => import('./NewDocumentPage'))
const PersonalTemplatesPage = lazy(() => import('./PersonalTemplatesPage'))
/*
  The import screen and the print route are their own chunks, and both matter.
  The importer's own code is small, but pressing Choose a file pulls in
  `mammoth` and `pdfjs-dist` — about 630 KB gzip between them — and an officer
  who only ever writes new documents should never meet either. The print route
  is split for the ordinary reason: it is a screen.
*/
const ImportPage = lazy(() => import('./ImportPage'))
const PrintPage = lazy(() => import('./PrintPage'))
const ReplyPage = lazy(() => import('./intake/ReplyPage'))
const RegisterPage = lazy(() => import('./register/RegisterPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

/** Everything under `/draft/documents` that used to be somewhere else. */
const LEGACY = redirectsUnder('/draft/documents').filter((redirect) => redirect.from !== '/draft/documents')

export default function DraftPage() {
  const followUps = useDueFollowUpCount()

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<Navigate to="/draft/documents" replace />} />

        {/* Level 1 — the five sub-tabs. */}
        <Route element={<TabLayout badges={{ register: followUps }} />}>
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="new" element={<PickerPage />} />
          <Route path="reply" element={<ReplyPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="templates" element={<PersonalTemplatesPage />} />
        </Route>

        {/* Level 2. */}
        <Route element={<DetailLayout />}>
          <Route path="documents/import" element={<ImportPage />} />
          <Route path="new/:type" element={<NewDocumentPage />} />
        </Route>

        {/* Level 3 — a document, a letter, a sheet of paper. */}
        <Route element={<FocusLayout />}>
          <Route path="d/:id" element={<DocEditorPage />} />
          <Route path="d/:id/print" element={<PrintPage />} />
          <Route path="reply/:id" element={<ReplyPage />} />
        </Route>

        {/*
          Declared after every real route. `/draft/:type` is last of these,
          because `LEGACY_REDIRECTS` puts it last and the reason is written
          there — it matches everything, and React Router ranks it above the
          splat below.
        */}
        {LEGACY.map((redirect) => (
          <Route
            key={redirect.from}
            path={redirect.from.slice('/draft/'.length)}
            element={<LegacyRedirect redirect={redirect} />}
          />
        ))}

        <Route path="*" element={<Navigate to="/draft/documents" replace />} />
      </Routes>
    </Suspense>
  )
}
