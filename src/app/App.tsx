import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { BottomTabs, Sidebar } from './Nav'
import { usePaletteStore } from './paletteStore'
import { PwaNotices } from './pwa'
import { TopBar } from './TopBar'
import { useAppStore } from './store'
import { useGlobalShortcuts } from './useGlobalShortcuts'

import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useT } from '@/i18n/useT'
import { HOME_PATH } from '@/lib/nav'

const LawPage = lazy(() => import('@/modules/law/LawPage'))
const PayPage = lazy(() => import('@/modules/pay/PayPage'))
const DraftPage = lazy(() => import('@/modules/drafting/DraftPage'))
const LearnPage = lazy(() => import('@/modules/trainer/LearnPage'))
const UtilsPage = lazy(() => import('@/modules/utils/UtilsPage'))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage'))

/**
 * The command palette and the shortcuts-help sheet: one lazy chunk, mounted
 * only once the reader has actually asked for one of them (Ctrl-K, the
 * search button, or `?`) — the same "laziness as a privacy/perf property"
 * line the AI layer draws (ADR-011). `useGlobalShortcuts` itself is tiny and
 * stays a normal import: it only listens and writes to `usePaletteStore`, so
 * the two overlays it can open are what stay behind the split.
 */
const PaletteRoot = lazy(() => import('@/components/palette/PaletteRoot'))
const OnboardingPage = lazy(() => import('@/modules/onboarding/OnboardingPage'))

function RouteFallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export function App() {
  const { t } = useT()
  const hydrate = useAppStore((s) => s.hydrate)
  const hydrated = useAppStore((s) => s.hydrated)
  const onboarded = useAppStore((s) => s.onboarded)
  const { pathname } = useLocation()
  const paletteWanted = usePaletteStore((s) => s.open || s.helpOpen)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useGlobalShortcuts()

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
                {/*
                  Only a bare `/` — the PWA's `start_url` — is ever sent to
                  onboarding, and only once `hydrate()` has actually answered
                  whether this device has completed or skipped it. Deciding
                  before that would flash the normal shell for an unboarded
                  device or, worse, send an already-onboarded reader who
                  reloaded a deep link through the whole flow again for the
                  one frame before IndexedDB settles.
                */}
                <Route
                  path="/"
                  element={
                    !hydrated ? (
                      <RouteFallback />
                    ) : onboarded ? (
                      <Navigate to={HOME_PATH} replace />
                    ) : (
                      <Navigate to="/onboarding" replace />
                    )
                  }
                />
                <Route path="/onboarding" element={<OnboardingPage />} />
                {/* The Law Converter owns its own sub-routes (/law/whats-new, /law/saved);
                    src/lib/nav.ts stays the one list of navigation destinations. */}
                <Route path="/law/*" element={<LawPage />} />
                <Route path="/pay" element={<PayPage />} />
                {/* The Drafting Studio owns /draft and /draft/:type the same way. */}
                <Route path="/draft/*" element={<DraftPage />} />
                {/* The Rules Trainer owns its own sub-routes (/learn/review, /learn/mock, …)
                    the same way. */}
                <Route path="/learn/*" element={<LearnPage />} />
                {/* Utilities owns its own sub-routes (/utils/glossary) the same way. */}
                <Route path="/utils/*" element={<UtilsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <BottomTabs />
      <PwaNotices />
      {paletteWanted ? (
        <Suspense fallback={null}>
          <PaletteRoot />
        </Suspense>
      ) : null}
    </div>
  )
}
