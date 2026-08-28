import { Scale } from 'lucide-react'

import { ModulePlaceholder } from '@/components/common/ModulePlaceholder'
import { useT } from '@/i18n/useT'

export default function LawPage() {
  const { t } = useT()

  return (
    <ModulePlaceholder
      icon={Scale}
      title={t('pages.law.title')}
      subtitle={t('pages.law.subtitle')}
      emptyTitle={t('pages.law.emptyTitle')}
      emptyBody={t('pages.law.emptyBody')}
    />
  )
}
