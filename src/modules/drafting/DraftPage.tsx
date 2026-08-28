import { FileSignature } from 'lucide-react'

import { ModulePlaceholder } from '@/components/common/ModulePlaceholder'
import { useT } from '@/i18n/useT'

export default function DraftPage() {
  const { t } = useT()

  return (
    <ModulePlaceholder
      icon={FileSignature}
      title={t('pages.draft.title')}
      subtitle={t('pages.draft.subtitle')}
      emptyTitle={t('pages.draft.emptyTitle')}
      emptyBody={t('pages.draft.emptyBody')}
    />
  )
}
