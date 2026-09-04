import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { DetailLayout } from '@/app/layouts/DetailLayout'
import { useT } from '@/i18n/useT'

/**
 * Settings — a section, not a tab.
 *
 * It was a seventh top-level destination, which put a screen an officer opens
 * a handful of times a year in the same rank as the four they open every day,
 * and it was ONE page eleven sections long. It is now the gear in the top-right
 * corner (where everyone looks for it) opening a list of eight sections, each
 * its own page (ADR-046 §9).
 *
 * Three of those pages came from the Drafting Studio — profile, address book
 * and numbering — because they are things set once and read by every new
 * document, which is what this section is for. Their old `/draft/*` paths
 * redirect here. The Trainer's own settings screen moved from `/settings/trainer`
 * for the same reason.
 *
 * Every section is its own chunk. The AI section in particular stays behind its
 * own dynamic import, so everything it reaches — providers, WebCrypto, the tool
 * registry, the answer cache — is downloaded only by a reader who opened it.
 */
const SettingsIndexPage = lazy(() => import('./pages/SettingsIndexPage'))
const DataSettingsPage = lazy(() => import('./pages/DataSettingsPage'))
const BackupSettingsPage = lazy(() => import('./pages/BackupSettingsPage'))
const AboutSettingsPage = lazy(() => import('./pages/AboutSettingsPage'))
const AiSettingsPage = lazy(() => import('./pages/AiSettingsPage'))
const ProfilePage = lazy(() => import('@/modules/drafting/ProfilePage'))
const AddressBookPage = lazy(() => import('@/modules/drafting/AddressBookPage'))
const NumberingPage = lazy(() => import('@/modules/drafting/NumberingPage'))
const TrainerSettingsPage = lazy(() => import('@/modules/trainer/pages/TrainerSettingsPage'))

function Fallback() {
  const { t } = useT()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<DetailLayout />}>
          <Route index element={<SettingsIndexPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="address-book" element={<AddressBookPage />} />
          <Route path="numbering" element={<NumberingPage />} />
          <Route path="trainer" element={<TrainerSettingsPage />} />
          <Route path="ai" element={<AiSettingsPage />} />
          <Route path="data" element={<DataSettingsPage />} />
          <Route path="backup" element={<BackupSettingsPage />} />
          <Route path="about" element={<AboutSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </Suspense>
  )
}
