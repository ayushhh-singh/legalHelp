import { Languages, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useAppStore } from './store'
import { HOME_PATH } from './routes'

import { OfflineBadge } from '@/components/common/OfflineBadge'
import { LANGUAGE_LABELS } from '@/i18n'
import { useT } from '@/i18n/useT'

export function TopBar() {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const toggleLanguage = useAppStore((s) => s.toggleLanguage)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  const otherLanguage = language === 'en' ? 'hi' : 'en'

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
        <Link to={HOME_PATH} className="flex min-w-0 items-baseline gap-2 rounded-sm">
          {/* The red rule echoes the file thread in the identity. */}
          <span className="h-6 w-[3px] shrink-0 self-center bg-thread" aria-hidden="true" />
          <span className="truncate font-display text-lg leading-none text-ink">{t('app.name')}</span>
          <span className="hidden truncate font-sans text-xs text-ink-2 sm:inline">{t('app.tagline')}</span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <OfflineBadge />

          <button
            type="button"
            onClick={() => void toggleLanguage()}
            aria-label={t('a11y.toggleLanguage')}
            className="flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <Languages aria-hidden="true" className="h-4 w-4" />
            <span aria-hidden="true">{LANGUAGE_LABELS[otherLanguage]}</span>
          </button>

          <button
            type="button"
            onClick={() => void toggleTheme()}
            aria-label={theme === 'light' ? t('a11y.toggleTheme') : t('a11y.toggleThemeLight')}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            {theme === 'light' ? (
              <Moon aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Sun aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
