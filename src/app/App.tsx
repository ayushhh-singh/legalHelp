import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { LegacyRedirect } from './LegacyRedirect'
import { BottomTabs, Sidebar } from './Nav'
import { usePaletteStore } from './paletteStore'
import { PwaNotices } from './pwa'
import { TopBar } from './TopBar'
import { useAppStore } from './store'
import { useGlobalShortcuts } from './useGlobalShortcuts'

import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useT } from '@/i18n/useT'
import { APP_LEVEL_REDIRECTS, HOME_PATH, levelOf } from '@/lib/nav'
import { cn } from '@/lib/utils'

const HomePage = lazy(() => import('@/modules/home/HomePage'))
const LawPage = lazy(() => import('@/modules/law/LawPage'))
const StudyPage = lazy(() => import('@/modules/study/StudyPage'))
const DraftPage = lazy(() => import('@/modules/drafting/DraftPage'))
const ToolsPage = lazy(() => import('@/modules/utils/ToolsPage'))
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

  /*
    Which chrome this route gets, decided SYNCHRONOUSLY from the route registry
    rather than reported upwards by the layout that renders.

    `FocusLayout` could set a flag in an effect and this component could read
    it — and every focus route would then paint one frame with the sidebar and
    the tab bar still on it before they vanished, on every navigation into the
    reader or the editor. `levelOf` is a pure function over the pathname
    (`src/lib/nav.ts`), so the first frame is already right.
  */
  const focus = levelOf(pathname) === 'focus'

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href="#main" className="skip-link">
        {t('a11y.skipToContent')}
      </a>

      {focus ? null : <TopBar />}

      <div className="flex flex-1">
        {focus ? null : <Sidebar />}

        <main
          id="main"
          // Without tabIndex the skip link moves the caret but not focus in
          // Safari and Firefox, so keyboard users land back at the top.
          tabIndex={-1}
          aria-label={t('a11y.mainContent')}
          className={cn(
            'flex min-w-0 flex-1 flex-col focus-visible:outline-none',
            // At focus level the layout supplies its own bar and padding, and
            // there is no tab bar to clear.
            focus
              ? ''
              : // The bottom padding clears the tab bar, plus however much room a
                // service-worker toast currently needs above it (`--pwa-toast-space`,
                // measured in `pwa.tsx`; 0 whenever no toast is on screen, which is
                // almost always). Without the second term the toast is an overlay
                // covering the last action on the page — docs/DATA-GAPS.md #59.
                'px-4 pt-6 pb-[calc(6rem+var(--pwa-toast-space,0px))] sm:px-6 lg:pb-[calc(2.5rem+var(--pwa-toast-space,0px))]',
          )}
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

                {/*
                  Five sections, each owning its own sub-tree, plus Settings.
                  `src/lib/nav.ts` is still the one list of destinations; what
                  changed in ADR-046 is that it is a tree, so the layout a route
                  renders in and the page it goes back to come from the same
                  place as the sidebar's labels.
                */}
                <Route path="/home" element={<HomePage />} />
                <Route path="/study/*" element={<StudyPage />} />
                <Route path="/draft/*" element={<DraftPage />} />
                <Route path="/law/*" element={<LawPage />} />
                <Route path="/tools/*" element={<ToolsPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />

                {/*
                  Every path this app used to have. Kept for ever: the point of
                  a stable URL is that nobody has to know when it changed.
                  The Drafting Studio's own legacy paths are mounted inside
                  `DraftPage` instead — see `redirectsUnder` for why.
                */}
                {APP_LEVEL_REDIRECTS.map((redirect) => (
                  <Route
                    key={redirect.from}
                    path={redirect.from}
                    element={<LegacyRedirect redirect={redirect} />}
                  />
                ))}

                <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {focus ? null : <BottomTabs />}
      <PwaNotices />
      {paletteWanted ? (
        <Suspense fallback={null}>
          <PaletteRoot />
        </Suspense>
      ) : null}
    </div>
  )
}
