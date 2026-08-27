import { FileSignature } from 'lucide-react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

export default function DraftPage() {
  const { t } = useT()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('pages.draft.title')} subtitle={t('pages.draft.subtitle')} />
      <EmptyState
        icon={FileSignature}
        title={t('pages.draft.emptyTitle')}
        body={t('pages.draft.emptyBody')}
      />
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
