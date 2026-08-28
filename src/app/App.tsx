import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { BottomTabs, Sidebar } from './Nav'
import { PwaNotices } from './pwa'
import { HOME_PATH } from './routes'
import { TopBar } from './TopBar'
import { useAppStore } from './store'

import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useT } from '@/i18n/useT'

const LawPage = lazy(() => import('@/modules/law/LawPage'))
const PayPage = lazy(() => import('@/modules/pay/PayPage'))
const DraftPage = lazy(() => import('@/modules/drafting/DraftPage'))
const LearnPage = lazy(() => import('@/modules/trainer/LearnPage'))
const UtilsPage = lazy(() => import('@/modules/utils/UtilsPage'))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage'))

function RouteFallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-ink-2">
      {t('common.loading')}
    </p>
  )
}

export function App() {
  const { t } = useT()
  const hydrate = useAppStore((s) => s.hydrate)
  const { pathname } = useLocation()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href="#main" className="skip-link">
        {t('a11y.skipToContent')}
      </a>

      <TopBar />

      <div className="flex flex-1">
        <Sidebar />

        <main
          id="main"
          // Without tabIndex the skip link moves the caret but not focus in
          // Safari and Firefox, so keyboard users land back at the top.
          tabIndex={-1}
          aria-label={t('a11y.mainContent')}
          className="min-w-0 flex-1 px-4 pt-6 pb-24 focus-visible:outline-none sm:px-6 lg:pb-10"
        >
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
                <Route path="/law" element={<LawPage />} />
                <Route path="/pay" element={<PayPage />} />
                <Route path="/draft" element={<DraftPage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/utils" element={<UtilsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <BottomTabs />
      <PwaNotices />
    </div>
  )
}
