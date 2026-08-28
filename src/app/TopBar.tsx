import { Languages, Moon, Search, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

import { usePaletteStore } from './paletteStore'
import { useAppStore } from './store'

import { OfflineBadge } from '@/components/common/OfflineBadge'
import { LANGUAGE_LABELS } from '@/i18n'
import { useT } from '@/i18n/useT'
import { HOME_PATH } from '@/lib/nav'

export function TopBar() {
  const { t, language } = useT()
  const theme = useAppStore((s) => s.theme)
  const toggleLanguage = useAppStore((s) => s.toggleLanguage)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const openPalette = usePaletteStore((s) => s.openPalette)

  const otherLanguage = language === 'en' ? 'hi' : 'en'

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
        <Link to={HOME_PATH} className="flex min-w-0 items-baseline gap-2 rounded-md">
          {/* The gold rule is the file tab, turned on its side: the same 3px
              marigold index mark the active nav item and the active card carry. */}
          <span className="h-6 w-[3px] shrink-0 self-center rounded-sm bg-marigold" aria-hidden="true" />
          <span className="truncate font-heading text-lg leading-none font-semibold">{t('app.name')}</span>
          <span className="hidden truncate font-sans text-xs text-muted-foreground sm:inline">
            {t('app.tagline')}
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <OfflineBadge />

          <button
            type="button"
            onClick={openPalette}
            aria-label={t('a11y.openCommandPalette')}
            className="hidden h-9 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            <span aria-hidden="true">{t('palette.searchLabel')}</span>
            <kbd className="ml-1 rounded border border-border px-1 py-0.5 text-[10px]">Ctrl K</kbd>
          </button>

          <button
            type="button"
            onClick={openPalette}
            aria-label={t('a11y.openCommandPalette')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => void toggleLanguage()}
            aria-label={t('a11y.toggleLanguage')}
            /* 36px: the documented exception to the 44px floor, for header
               icon buttons that sit in a 56px bar next to a 44px-tall title. */
            className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Languages aria-hidden="true" className="h-4 w-4" />
            <span aria-hidden="true">{LANGUAGE_LABELS[otherLanguage]}</span>
          </button>

          <button
            type="button"
            onClick={() => void toggleTheme()}
            aria-label={theme === 'light' ? t('a11y.toggleTheme') : t('a11y.toggleThemeLight')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
