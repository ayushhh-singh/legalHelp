import versions from '../../../data/_meta/versions.json'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface DataVersionProps {
  /** Key into data/_meta/versions.json → datasets. */
  dataset?: string
  className?: string
}

type Dataset = { version: string; updated: string; label: Record<string, string> }

/** Shows which bundled dataset produced what the user is looking at. */
export function DataVersion({ dataset = 'app', className }: DataVersionProps) {
  const { t, language } = useT()
  const entry = (versions.datasets as Record<string, Dataset | undefined>)[dataset]

  if (!entry) return null

  const label = entry.label[language] ?? entry.label.en ?? dataset

  return (
    <p className={cn('text-xs text-muted-foreground tabular-nums', className)}>
      {label} · {t('common.dataVersion')} {entry.version} · {t('common.updated')} {entry.updated}
    </p>
  )
}
