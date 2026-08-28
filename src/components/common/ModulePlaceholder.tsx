import type { LucideIcon } from 'lucide-react'

import { DataVersion } from './DataVersion'
import { Disclaimer } from './Disclaimer'
import { EmptyState } from './EmptyState'
import { PageHeader } from './PageHeader'

import { SectionCard } from '@/components/ui-x'

interface ModulePlaceholderProps {
  title: string
  subtitle: string
  emptyTitle: string
  emptyBody: string
  icon: LucideIcon
}

/**
 * The shape every module page has until it grows real content: masthead, the
 * module's own card, the standing disclaimer, the dataset version.
 *
 * The card carries the FILE TAB — the 3px marigold index tab on its top edge —
 * because it is the card for the module you are currently in. That is the whole
 * rule for the signature: one tab, on the thing you are working in.
 */
export function ModulePlaceholder({ title, subtitle, emptyTitle, emptyBody, icon }: ModulePlaceholderProps) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={title} subtitle={subtitle} />
      <SectionCard active>
        <EmptyState icon={icon} title={emptyTitle} body={emptyBody} className="border-0 bg-transparent" />
      </SectionCard>
      <Disclaimer />
      <DataVersion />
    </div>
  )
}
