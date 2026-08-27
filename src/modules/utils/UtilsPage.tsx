import { Wrench } from 'lucide-react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

export default function UtilsPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.utils.title')} subtitle={t('pages.utils.subtitle')} />
      <EmptyState icon={Wrench} title={t('pages.utils.emptyTitle')} body={t('pages.utils.emptyBody')} />
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
