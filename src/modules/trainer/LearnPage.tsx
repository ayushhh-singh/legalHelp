import { GraduationCap } from 'lucide-react'

import { ModulePlaceholder } from '@/components/common/ModulePlaceholder'
import { useT } from '@/i18n/useT'

export default function LearnPage() {
  const { t } = useT()

  return (
    <ModulePlaceholder
      icon={GraduationCap}
      title={t('pages.learn.title')}
      subtitle={t('pages.learn.subtitle')}
      emptyTitle={t('pages.learn.emptyTitle')}
      emptyBody={t('pages.learn.emptyBody')}
    />
  )
}
