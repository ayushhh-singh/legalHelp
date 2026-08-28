import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'

import { AboutSection } from './components/AboutSection'
import { BackupSection } from './components/BackupSection'
import { CheckForUpdates } from './components/CheckForUpdates'
import { DataSourcesTable } from './components/DataSourcesTable'
import { EraseSection } from './components/EraseSection'

import { PageHeader } from '@/components/common/PageHeader'
import { OptionRow } from '@/components/ui-x'
import { useAppStore, type Theme } from '@/app/store'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { loadReminderSetting } from '@/modules/trainer/reminder'

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
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const setDevanagariDigits = useAppStore((s) => s.setDevanagariDigits)
  const reminder = useLiveQuery(() => loadReminderSetting(), [], undefined)

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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.digits.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('pages.settings.digits.hint')}</p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={devanagariDigits}
            onChange={(event) => void setDevanagariDigits(event.target.checked)}
            className="h-5 w-5 rounded-sm border-input accent-action"
          />
          {t('pages.settings.digits.title')}
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.reminder.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {reminder === undefined
            ? t('common.loading')
            : reminder.enabled
              ? t('pages.settings.reminder.on', {
                  time: `${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`,
                })
              : t('pages.settings.reminder.off')}
        </p>
        <Link to="/learn/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('pages.settings.reminder.trainerLink')}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.privacyTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('pages.settings.privacyBody')}</p>
      </section>

      <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
        <AiSettingsSection />
      </Suspense>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div>
          <h2 className="text-lg font-semibold">{t('pages.settings.updates.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('pages.settings.updates.hint')}</p>
        </div>
        <CheckForUpdates />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('pages.settings.backup.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('pages.settings.backup.hint')}</p>
        </div>
        <BackupSection />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.erase.title')}</h2>
        <EraseSection />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.about.title')}</h2>
        <AboutSection />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.dataSources.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('pages.settings.dataSources.hint')}</p>
        <DataSourcesTable />
      </section>
    </div>
  )
}
