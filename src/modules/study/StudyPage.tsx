import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { DetailLayout } from '@/app/layouts/DetailLayout'
import { FocusLayout } from '@/app/layouts/FocusLayout'
import { TabLayout } from '@/app/layouts/TabLayout'
import { useT } from '@/i18n/useT'
import { useDailyReminder } from '@/modules/trainer/useTrainerSettings'

/**
 * Study — the section that was three: the Library, the Rules Trainer and exam
 * mode.
 *
 * They were three top-level tabs (two of them behind a "More" sheet) doing one
 * thing: getting a rule from the book into the officer's head. Reading a
 * provision, drilling a card about it and checking where that leaves you for a
 * departmental examination are three views of one activity, and an officer
 * moving between them was crossing the whole navigation to do it. They are four
 * sub-tabs of one section now — Read, Practise, Exam, My notes — and the pages
 * underneath are exactly the pages that were there before, mounted at new paths
 * with a declared parent each (ADR-046).
 *
 * The module directories did NOT move. `src/modules/library` and
 * `src/modules/trainer` still own their pages, their hooks and their data
 * loaders; this file is the router that puts them in one section, which is what
 * makes the whole restructure a change to the URL tree and the chrome rather
 * than a rewrite of six thousand lines of screens.
 *
 * Every screen is its own chunk, as before: the shelf needs an 11 KB index, the
 * reader needs a corpus, the review session needs FSRS and the mock test needs
 * `recharts`.
 */

// Read
const LibraryHubPage = lazy(() => import('@/modules/library/pages/LibraryHubPage'))
const WorkPage = lazy(() => import('@/modules/library/pages/WorkPage'))
const ReaderPage = lazy(() => import('@/modules/library/pages/ReaderPage'))
const LibrarySearchPage = lazy(() => import('@/modules/library/pages/LibrarySearchPage'))
const AddWorkPage = lazy(() => import('@/modules/library/pages/AddWorkPage'))
const ChapterQuizPage = lazy(() => import('@/modules/library/pages/ChapterQuizPage'))
const RevisionSheetPage = lazy(() => import('@/modules/library/pages/RevisionSheetPage'))
const StudyHubPage = lazy(() => import('@/modules/library/pages/StudyHubPage'))

// Practise
const TrainerHomePage = lazy(() => import('@/modules/trainer/pages/HomePage'))
const ReviewPage = lazy(() => import('@/modules/trainer/pages/ReviewPage'))
const MockPage = lazy(() => import('@/modules/trainer/pages/MockPage'))
const BrowsePage = lazy(() => import('@/modules/trainer/pages/BrowsePage'))
const TrainerBookmarksPage = lazy(() => import('@/modules/trainer/pages/BookmarksPage'))
const ReportsPage = lazy(() => import('@/modules/trainer/pages/ReportsPage'))
const ReviewQueuePage = lazy(() => import('@/modules/trainer/pages/ReviewQueuePage'))

// Exam. The plan and the checklist are SECTIONS of the hub now, not routes
// (ADR-046 §5); only the mock, which an officer sits inside, is its own screen.
const ExamHubPage = lazy(() => import('@/modules/trainer/exam/ExamHubPage'))
const ExamMockPage = lazy(() => import('@/modules/trainer/exam/ExamMockPage'))

// My notes
const NotesPage = lazy(() => import('@/modules/library/pages/MyStudyPage'))
const ComparePage = lazy(() => import('@/modules/library/pages/ComparePage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function StudyPage() {
  /*
    The best-effort daily reminder, mounted for the whole section rather than
    for the Practise tab alone — which is what `/learn/*` did before and is the
    behaviour worth keeping: an officer who spends the evening READING is
    exactly the one whose review queue is quietly filling up.
  */
  useDailyReminder()

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<Navigate to="/study/read" replace />} />

        {/* Level 1 — the four sub-tabs. */}
        <Route element={<TabLayout />}>
          <Route path="read" element={<LibraryHubPage />} />
          <Route path="practise" element={<TrainerHomePage />} />
          <Route path="exam" element={<ExamHubPage />} />
          <Route path="notes" element={<NotesPage />} />
        </Route>

        {/* Level 2 — reached from a tab, breadcrumbed back to it. */}
        <Route element={<DetailLayout />}>
          <Route path="read/search" element={<LibrarySearchPage />} />
          <Route path="read/add" element={<AddWorkPage />} />
          <Route path="read/:workId" element={<WorkPage />} />
          <Route path="read/:workId/sheet/:nodeId" element={<RevisionSheetPage />} />
          <Route path="progress" element={<StudyHubPage />} />
          <Route path="practise/browse" element={<BrowsePage />} />
          <Route path="practise/bookmarks" element={<TrainerBookmarksPage />} />
          <Route path="practise/reports" element={<ReportsPage />} />
          <Route path="practise/review-queue" element={<ReviewQueuePage />} />
          <Route path="notes/compare" element={<ComparePage />} />
        </Route>

        {/* Level 3 — inside one thing, with no navigation but the way out. */}
        <Route element={<FocusLayout />}>
          <Route path="read/:workId/quiz/:nodeId" element={<ChapterQuizPage />} />
          <Route path="read/:workId/:unitId" element={<ReaderPage />} />
          <Route path="practise/review" element={<ReviewPage />} />
          <Route path="practise/mock" element={<MockPage />} />
          <Route path="exam/mock" element={<ExamMockPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/study/read" replace />} />
      </Routes>
    </Suspense>
  )
}
