import { AboutSection } from '../components/AboutSection'

import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

/** `/settings/about` — version, build, licence, and how to report a data error. */
export default function AboutSettingsPage() {
  const { t } = useT()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title={t('pages.settings.about.title')} />
      <AboutSection />
    </div>
  )
}
