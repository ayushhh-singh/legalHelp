import { Wrench } from 'lucide-react'

import { ModulePlaceholder } from '@/components/common/ModulePlaceholder'
import { useT } from '@/i18n/useT'

export default function UtilsPage() {
  const { t } = useT()

  return (
    <ModulePlaceholder
      icon={Wrench}
      title={t('pages.utils.title')}
      subtitle={t('pages.utils.subtitle')}
      emptyTitle={t('pages.utils.emptyTitle')}
      emptyBody={t('pages.utils.emptyBody')}
    />
  )
}
