import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useT } from '@/i18n/useT'

/**
 * The Drafting Studio's own router, mounted at `/draft/*` by `src/app/App.tsx`.
 *
 * The module owns its sub-routes, exactly as the Law Converter does, so
 * `src/lib/nav.ts` stays the one list of navigation DESTINATIONS — a document
 * type is a screen inside a module, not a place in the navigation, and the
 * sidebar's segment-boundary match already keeps "Drafting Studio" active on
 * every one of them.
 *
 * Each screen is its own chunk, and the split earns its keep here: the picker
 * needs `index.json` and nothing else, while the editor pulls in the engine,
 * the checklist evaluator and a 24 KB template. An officer looking at the list
 * of forms should not download the editor to read fourteen names.
 */
const PickerPage = lazy(() => import('./PickerPage'))
const EditorPage = lazy(() => import('./EditorPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function DraftPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<PickerPage />} />
        <Route path=":type" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/draft" replace />} />
      </Routes>
    </Suspense>
  )
}
