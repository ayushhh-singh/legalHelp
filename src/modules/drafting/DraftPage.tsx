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
const DocEditorPage = lazy(() => import('./DocEditorPage'))
const DocumentsPage = lazy(() => import('./DocumentsPage'))
const NewDocumentPage = lazy(() => import('./NewDocumentPage'))
const ProfilePage = lazy(() => import('./ProfilePage'))
const AddressBookPage = lazy(() => import('./AddressBookPage'))
const NumberingPage = lazy(() => import('./NumberingPage'))
const PersonalTemplatesPage = lazy(() => import('./PersonalTemplatesPage'))

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
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="new/:type" element={<NewDocumentPage />} />
        <Route path="d/:id" element={<DocEditorPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="address-book" element={<AddressBookPage />} />
        <Route path="numbering" element={<NumberingPage />} />
        <Route path="my-templates" element={<PersonalTemplatesPage />} />
        {/*
          The Session 8 form-and-preview editor. It is kept, and kept reachable,
          because every draft in the `drafts` table still opens in it and the
          migration into `documents` is offered rather than forced. Its route is
          LAST so a document type that collides with one of the names above —
          none does today — cannot shadow a real screen.
        */}
        <Route path=":type" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/draft" replace />} />
      </Routes>
    </Suspense>
  )
}
