import { Scale } from 'lucide-react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

export default function LawPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.law.title')} subtitle={t('pages.law.subtitle')} />
      <EmptyState icon={Scale} title={t('pages.law.emptyTitle')} body={t('pages.law.emptyBody')} />
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
