import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useT } from '@/i18n/useT'

/**
 * The Law Converter's own router, mounted at `/law/*` by `src/app/App.tsx`.
 *
 * The module owns its sub-routes rather than declaring them in the app router,
 * so `src/lib/nav.ts` stays the one list of DESTINATIONS — "What's new" and
 * "Saved" are screens inside a module, not places in the navigation, and the
 * sidebar's segment-boundary match already keeps "Law Converter" active on
 * both of them.
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
        <Route index element={<ConverterPage />} />
        <Route path="whats-new" element={<WhatsNewPage />} />
        <Route path="saved" element={<SavedPage />} />
        <Route path="*" element={<Navigate to="/law" replace />} />
      </Routes>
    </Suspense>
  )
}
