import { Calculator } from 'lucide-react'

import { ModulePlaceholder } from '@/components/common/ModulePlaceholder'
import { useT } from '@/i18n/useT'

export default function PayPage() {
  const { t } = useT()

  return (
    <ModulePlaceholder
      icon={Calculator}
      title={t('pages.pay.title')}
      subtitle={t('pages.pay.subtitle')}
      emptyTitle={t('pages.pay.emptyTitle')}
      emptyBody={t('pages.pay.emptyBody')}
    />
  )
}
