import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useT } from '@/i18n/useT'

/**
 * The Utilities module's own router, mounted at `/utils/*` by `src/app/App.tsx`
 * — the same arrangement the Law Converter and the Drafting Studio use, so
 * `src/lib/nav.ts` stays the one list of navigation DESTINATIONS. A tool
 * inside Utilities is a screen inside the module, not a place in the nav.
 */
const UtilsHubPage = lazy(() => import('./UtilsHubPage'))
const GlossaryPage = lazy(() => import('./glossary/GlossaryPage'))
const HolidaysPage = lazy(() => import('./holidays/HolidaysPage'))
const LeavePage = lazy(() => import('./leave/LeavePage'))
const PensionPage = lazy(() => import('./pension/PensionPage'))
const PortalsPage = lazy(() => import('./portals/PortalsPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function UtilsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<UtilsHubPage />} />
        <Route path="glossary" element={<GlossaryPage />} />
        <Route path="holidays" element={<HolidaysPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="pension" element={<PensionPage />} />
        <Route path="portals" element={<PortalsPage />} />
        <Route path="*" element={<Navigate to="/utils" replace />} />
      </Routes>
    </Suspense>
  )
}
