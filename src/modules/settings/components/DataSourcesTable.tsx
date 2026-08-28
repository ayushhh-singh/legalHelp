import versions from '../../../../data/_meta/versions.json'

import { SourceChip } from '@/components/common/SourceChip'
import { useT } from '@/i18n/useT'

interface VersionsDataset {
  version: string
  updated: string
  label: Record<string, string>
  rows?: number
  source?: { name: string; url?: string }
}

const DATASETS = versions.datasets as Record<string, VersionsDataset>

/**
 * "Data sources & versions" (Settings): every bundled dataset, its version,
 * when it was last touched, how many rows, and where it came from.
 *
 * Reads `data/_meta/versions.json` the same way `DataVersion.tsx` does — a
 * build-time import, not a fetch — so this table is the bundled truth. "Check
 * for data updates" (`CheckForUpdates.tsx`) is the one place that asks the
 * origin whether a newer copy exists; this table never does.
 */
export function DataSourcesTable() {
  const { t, language } = useT()
  const rows = Object.entries(DATASETS).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={t('pages.settings.dataSources.title')}
      className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">{t('pages.settings.dataSources.title')}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('pages.settings.dataSources.dataset')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('pages.settings.dataSources.version')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('pages.settings.dataSources.updated')}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('pages.settings.dataSources.rows')}
            </th>
            <th scope="col" className="py-2 font-semibold">
              {t('pages.settings.dataSources.source')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, dataset]) => (
            <tr key={id} className="border-b border-border align-top last:border-0">
              <th scope="row" className="py-2 pr-3 font-medium">
                {dataset.label[language] ?? dataset.label.en ?? id}
              </th>
              <td className="py-2 pr-3 tabular-nums">{dataset.version}</td>
              <td className="py-2 pr-3 tabular-nums">{dataset.updated}</td>
              <td className="py-2 pr-3 tabular-nums">{dataset.rows ?? '—'}</td>
              <td className="py-2">
                {dataset.source ? (
                  dataset.source.url ? (
                    <SourceChip name={dataset.source.name} url={dataset.source.url} />
                  ) : (
                    <span className="text-muted-foreground">{dataset.source.name}</span>
                  )
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
