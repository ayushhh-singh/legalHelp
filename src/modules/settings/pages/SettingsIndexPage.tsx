import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ExamModeSection } from '../components/ExamModeSection'

import { useAppStore, type Theme } from '@/app/store'
import { PageHeader } from '@/components/common/PageHeader'
import { OptionRow, SectionCard } from '@/components/ui-x'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { SETTINGS_SECTIONS } from '@/lib/nav'

/**
 * `/settings` — the three controls that are one tap each, and the way in to
 * everything else.
 *
 * Language, theme and Devanagari digits stay HERE rather than becoming a ninth
 * section. They are a radio each: putting them one level down would mean two
 * taps to do the thing an officer opens this screen for most often, and a
 * section list whose first entry is "the three switches" is a list with a
 * pointless row at the top.
 */
export default function SettingsIndexPage() {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const setTheme = useAppStore((s) => s.setTheme)
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const setDevanagariDigits = useAppStore((s) => s.setDevanagariDigits)

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

      {/*
        Exam mode: one choice, one screen, a line from wherever else it is
        looked for. The sentence under the heading names the examination the
        reader picked, so "am I still preparing for that?" is answered here.
      */}
      <ExamModeSection />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pages.settings.sections')}</h2>
        <ul className="flex flex-col gap-2">
          {SETTINGS_SECTIONS.map((section) => (
            <li key={section.id}>
              <SectionCard className="transition-colors hover:border-input">
                <Link
                  to={section.path}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium"
                >
                  {section.label[language]}
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </SectionCard>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.privacyTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('pages.settings.privacyBody')}</p>
      </section>
    </div>
  )
}
