import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { TabLayout } from '@/app/layouts/TabLayout'
import { useT } from '@/i18n/useT'

/**
 * The Law Converter's own router, mounted at `/law/*` by `src/app/App.tsx`.
 *
 * Its three screens are three sub-tabs now rather than three links buried in
 * the converter's own chrome (ADR-046 §7), and the converter is still the
 * section root: its whole view lives in the query string (ADR-013), so
 * `/law?q=302&code=bns` — in a bookmark, in a shared message, in the command
 * palette's own results — is unchanged and is not a redirect.
 *
 * Each screen is its own chunk. The converter pulls in Fuse and 3.9 MB of
 * section text; the saved list needs neither, and a reader checking a bookmark
 * should not download the section tables to read a heading they already saved.
 */
const ConverterPage = lazy(() => import('./ConverterPage'))
const WhatsNewPage = lazy(() => import('./WhatsNewPage'))
const SavedPage = lazy(() => import('./SavedPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function LawPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<TabLayout />}>
          <Route index element={<ConverterPage />} />
          <Route path="whats-new" element={<WhatsNewPage />} />
          <Route path="saved" element={<SavedPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/law" replace />} />
      </Routes>
    </Suspense>
  )
}
