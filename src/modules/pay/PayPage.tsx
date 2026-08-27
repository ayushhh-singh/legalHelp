import { Calculator } from 'lucide-react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

export default function PayPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.pay.title')} subtitle={t('pages.pay.subtitle')} />
      <EmptyState icon={Calculator} title={t('pages.pay.emptyTitle')} body={t('pages.pay.emptyBody')} />
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
