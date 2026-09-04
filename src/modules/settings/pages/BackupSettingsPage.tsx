import { BackupSection } from '../components/BackupSection'
import { EraseSection } from '../components/EraseSection'

import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

/**
 * `/settings/backup` — export, import and erase.
 *
 * Erase is on this page and not on its own, because the three are one decision
 * an officer makes about the data on this device, and the one thing somebody
 * about to erase everything should have in front of them is the button that
 * exports it first.
 */
export default function BackupSettingsPage() {
  const { t } = useT()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title={t('pages.settings.backup.title')} subtitle={t('pages.settings.backup.hint')} />
      <section className="flex flex-col gap-3">
        <BackupSection />
      </section>
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">{t('pages.settings.erase.title')}</h2>
        <EraseSection />
      </section>
    </div>
  )
}
