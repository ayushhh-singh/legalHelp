import { CheckForUpdates } from '../components/CheckForUpdates'
import { DataSourcesTable } from '../components/DataSourcesTable'

import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'

/** `/settings/data` — where every dataset came from, and whether it has moved. */
export default function DataSettingsPage() {
  const { t } = useT()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title={t('pages.settings.updates.title')} subtitle={t('pages.settings.updates.hint')} />
      <section className="flex flex-col gap-3">
        <CheckForUpdates />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.dataSources.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('pages.settings.dataSources.hint')}</p>
        <DataSourcesTable />
      </section>
    </div>
  )
}
