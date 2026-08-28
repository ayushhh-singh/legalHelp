import { lazy, Suspense } from 'react'

import { PageHeader } from '@/components/common/PageHeader'
import { VoiceSettingsSection } from '@/components/common/VoiceSettingsSection'
import { OptionRow } from '@/components/ui-x'
import { useAppStore, type Theme } from '@/app/store'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@/i18n'
import { useT } from '@/i18n/useT'

/**
 * The AI settings live behind their own dynamic import, not merely behind this
 * lazy route. Everything they reach — providers, WebCrypto, the tool registry,
 * the answer cache — is therefore downloaded only by a reader who opened
 * Settings, and never by one who did not.
 */
const AiSettingsSection = lazy(() => import('@/components/ai/AiSettingsSection'))

export default function SettingsPage() {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const setTheme = useAppStore((s) => s.setTheme)

  const themes: readonly Theme[] = ['light', 'dark']

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title={t('pages.settings.title')} subtitle={t('pages.settings.subtitle')} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('pages.settings.language')}</h2>
          <p className="text-sm text-muted-foreground">{t('pages.settings.languageHint')}</p>
        </div>
        <div role="radiogroup" aria-label={t('pages.settings.language')} className="flex flex-col gap-2">
          {LANGUAGES.map((code: Language) => (
            <OptionRow
              key={code}
              selected={language === code}
              label={LANGUAGE_NAMES[code]}
              onSelect={() => void setLanguage(code)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.theme')}</h2>
        <div role="radiogroup" aria-label={t('pages.settings.theme')} className="flex flex-col gap-2">
          {themes.map((value) => (
            <OptionRow
              key={value}
              selected={theme === value}
              label={value === 'light' ? t('pages.settings.themeLight') : t('pages.settings.themeDark')}
              onSelect={() => void setTheme(value)}
            />
          ))}
        </div>
      </section>

      <VoiceSettingsSection />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.privacyTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('pages.settings.privacyBody')}</p>
      </section>

      <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
        <AiSettingsSection />
      </Suspense>
    </div>
  )
}
