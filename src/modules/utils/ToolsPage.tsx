import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { TabLayout } from '@/app/layouts/TabLayout'
import { useT } from '@/i18n/useT'

/**
 * Tools — the six calculators and directories, as six sub-tabs.
 *
 * Two things merged here. The Pay & Allowances calculator was a top-level tab
 * and is now "Salary", the first of these; Utilities was a seventh destination
 * behind the "More" sheet whose own hub page was a grid of five cards that did
 * nothing but link one level down. A hub whose only content is links to its own
 * children is a tap an officer pays on every visit, and the sub-tab strip says
 * the same thing without one — so `UtilsHubPage` is gone and `/tools` lands on
 * Salary (ADR-046 §8).
 *
 * Salary keeps its whole view in the query string (ADR-016), so every
 * `?job=…&city=…&da=…` link still restores exactly the screen it was shared
 * from; only the path in front of the query changed, and `/tools/salary?…` redirects
 * with its query intact.
 */
const PayPage = lazy(() => import('@/modules/pay/PayPage'))
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

export default function ToolsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<Navigate to="/tools/salary" replace />} />
        <Route element={<TabLayout />}>
          <Route path="salary" element={<PayPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="pension" element={<PensionPage />} />
          <Route path="holidays" element={<HolidaysPage />} />
          <Route path="glossary" element={<GlossaryPage />} />
          <Route path="portals" element={<PortalsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/tools/salary" replace />} />
      </Routes>
    </Suspense>
  )
}
