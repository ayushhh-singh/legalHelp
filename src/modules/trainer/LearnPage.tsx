import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useDailyReminder } from './useTrainerSettings'

import { useT } from '@/i18n/useT'

/**
 * The Rules Trainer's own router, mounted at `/learn/*` by `src/app/App.tsx`
 * — the same arrangement `DraftPage.tsx` uses for `/draft/*`, so
 * `src/lib/nav.ts` stays the one list of navigation DESTINATIONS. Eight
 * screens, each its own chunk: Home needs only the catalogue and today's
 * counts, while the review session pulls in the FSRS engine and the mock test
 * pulls in `recharts`.
 */
const HomePage = lazy(() => import('./pages/HomePage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const MockPage = lazy(() => import('./pages/MockPage'))
const BrowsePage = lazy(() => import('./pages/BrowsePage'))
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const TrainerSettingsPage = lazy(() => import('./pages/TrainerSettingsPage'))
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function LearnPage() {
  useDailyReminder()

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="mock" element={<MockPage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="bookmarks" element={<BookmarksPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<TrainerSettingsPage />} />
        <Route path="review-queue" element={<ReviewQueuePage />} />
        <Route path="*" element={<Navigate to="/learn" replace />} />
      </Routes>
    </Suspense>
  )
}
