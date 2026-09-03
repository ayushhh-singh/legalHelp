import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useT } from '@/i18n/useT'

/**
 * The Library's own router, mounted at `/library/*` by `src/app/App.tsx` — the
 * same arrangement the Law Converter, the Drafting Studio, the Rules Trainer
 * and Utilities use, so `src/lib/nav.ts` stays the one list of navigation
 * DESTINATIONS. A work and a unit are screens inside the module, not places in
 * the nav.
 */
const LibraryHubPage = lazy(() => import('./pages/LibraryHubPage'))
const WorkPage = lazy(() => import('./pages/WorkPage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const MyStudyPage = lazy(() => import('./pages/MyStudyPage'))
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const LibrarySearchPage = lazy(() => import('./pages/LibrarySearchPage'))
const AddWorkPage = lazy(() => import('./pages/AddWorkPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<LibraryHubPage />} />
        {/*
          Every static route is declared BEFORE `:workId`. React Router ranks
          static segments above dynamic ones regardless of order, but a reader
          of this file should not have to know that to be sure `/library/mine`
          is not a work called "mine" — and `isPersonalWorkId` would not save
          it, because "mine" is not prefixed `my-`.
        */}
        <Route path="mine" element={<MyStudyPage />} />
        <Route path="bookmarks" element={<BookmarksPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="search" element={<LibrarySearchPage />} />
        <Route path="add" element={<AddWorkPage />} />
        <Route path=":workId" element={<WorkPage />} />
        <Route path=":workId/:unitId" element={<ReaderPage />} />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Routes>
    </Suspense>
  )
}
