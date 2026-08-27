import { GraduationCap } from 'lucide-react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

export default function LearnPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.learn.title')} subtitle={t('pages.learn.subtitle')} />
      <EmptyState
        icon={GraduationCap}
        title={t('pages.learn.emptyTitle')}
        body={t('pages.learn.emptyBody')}
      />
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
