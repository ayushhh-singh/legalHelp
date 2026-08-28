import { Check } from 'lucide-react'

import { PageHeader } from '@/components/common/PageHeader'
import { useAppStore, type Theme } from '@/app/store'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/** Radio-style option row; the check mark is the only selected-state colour. */
function OptionRow({
  selected,
  label,
  onSelect,
}: {
  selected: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors',
        selected
          ? 'border-action bg-accent font-semibold text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <span>{label}</span>
      {selected ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
    </button>
  )
}

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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('pages.settings.privacyTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('pages.settings.privacyBody')}</p>
      </section>
    </div>
  )
}
