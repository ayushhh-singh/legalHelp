import { lazy, Suspense } from 'react'

import { PageHeader } from '@/components/common/PageHeader'
import { useT } from '@/i18n/useT'
import { SETTINGS_SECTIONS } from '@/lib/nav'

/**
 * `/settings/ai` — the consent gate and the four tiers.
 *
 * The section stays behind its OWN dynamic import as well as behind this lazy
 * route. Laziness in `src/ai` is a privacy property rather than a performance
 * one (`docs/AI.md`): a reader who never opens this page never downloads the
 * code that could reach the network.
 *
 * The masthead is the SECTION's name from `src/lib/nav.ts` — "AI" — and not the
 * feature's, because `AiSettingsSection` renders its own `<h2>` with the on/off
 * badge beside it and two headings a line apart saying "AI features" would be
 * the same sentence twice. It also keeps the heading order honest: everything
 * inside that section is an `<h3>`.
 */
const AiSettingsSection = lazy(() => import('@/components/ai/AiSettingsSection'))

export default function AiSettingsPage() {
  const { t, language } = useT()
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === 'ai')

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title={section ? section.label[language] : t('pages.settings.title')} />
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
        <AiSettingsSection />
      </Suspense>
    </div>
  )
}
