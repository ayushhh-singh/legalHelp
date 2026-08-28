import { Command } from 'cmdk'
import {
  Calculator,
  Clock,
  Compass,
  FileSignature,
  GraduationCap,
  Languages,
  Moon,
  Scale,
  Settings,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { usePaletteStore } from '@/app/paletteStore'
import { useAppStore } from '@/app/store'
import { listCommandRecents, recordCommandRecent } from './recents'
import {
  draftingItems,
  glossaryItems,
  jobItems,
  lawItems,
  portalItems,
  trainerTopicItems,
} from './sections'
import type { PaletteItem, PaletteSection } from './types'
import { usePaletteData } from './usePaletteData'

import { useT } from '@/i18n/useT'
import { NAV_ITEMS } from '@/lib/nav'
import { romanKey } from '@/lib/transliterate'

/**
 * Ctrl/⌘-K, from anywhere: search over Law sections, Job posts, the Hindi
 * glossary, Document types, Trainer topics, Portals — and jump to a module or
 * flip a setting without either.
 *
 * `shouldFilter={false}` on the `Command` root, deliberately: every section
 * below does its OWN ranking, through the same search each module already
 * ships (`src/components/palette/sections.ts`), so cmdk is a list renderer
 * here rather than a second search engine. Radix Dialog (which `Command.
 * Dialog` wraps) supplies the focus trap, the Escape-to-close and the
 * ARIA `role="dialog"`; cmdk's own `Command.Input` supplies the ARIA 1.2
 * combobox wiring (`role="combobox"`, `aria-expanded`, `aria-controls`,
 * `aria-activedescendant`) — nothing here hand-rolls either.
 */
export function CommandPalette() {
  const { t, language } = useT()
  const navigate = useNavigate()
  const open = usePaletteStore((s) => s.open)
  const closePalette = usePaletteStore((s) => s.closePalette)
  const toggleLanguage = useAppStore((s) => s.toggleLanguage)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)

  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<PaletteItem[]>([])
  const otherLanguage = language === 'en' ? 'hi' : 'en'

  const trimmed = query.trim()
  const data = usePaletteData(open && trimmed.length > 0)

  // `App.tsx` only mounts this component once `open` (or `helpOpen`) is true,
  // and unmounts it again on close — so `query` already starts at `''` on
  // every fresh open, with nothing here needing to reset it. This effect's
  // only job is the recent-jumps list, read fresh each time the palette
  // opens because it can have changed since the last time.
  useEffect(() => {
    if (!open) return
    void listCommandRecents()
      .then(setRecents)
      .catch(() => setRecents([]))
  }, [open])

  const navResults = useMemo(() => {
    const items: PaletteItem[] = NAV_ITEMS.map((item) => ({
      id: `nav:${item.id}`,
      en: item.label.en,
      hi: item.label.hi,
      to: item.path,
    }))
    if (!trimmed) return items
    const folded = romanKey(trimmed)
    return items.filter(
      (item) => romanKey(`${item.en} ${item.hi}`).includes(folded) || item.hi.includes(trimmed),
    )
  }, [trimmed])

  const settingsResults = useMemo(() => {
    const items: (PaletteItem & { run: () => void })[] = [
      {
        id: 'settings:language',
        en: language === 'en' ? 'Switch to Hindi' : 'हिंदी में बदलें',
        hi: language === 'en' ? 'हिंदी में बदलें' : 'Switch to Hindi',
        to: '',
        run: () => void toggleLanguage(),
      },
      {
        id: 'settings:theme',
        en: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
        hi: theme === 'light' ? 'गहरे रंग में बदलें' : 'हल्के रंग में बदलें',
        to: '',
        run: () => void toggleTheme(),
      },
      {
        id: 'settings:open',
        en: 'Open Settings',
        hi: 'सेटिंग्स खोलें',
        to: '/settings',
        run: () => void navigate('/settings'),
      },
    ]
    if (!trimmed) return items
    const folded = romanKey(trimmed)
    return items.filter(
      (item) => romanKey(`${item.en} ${item.hi}`).includes(folded) || item.hi.includes(trimmed),
    )
  }, [trimmed, language, theme, toggleLanguage, toggleTheme, navigate])

  const sections: PaletteSection[] = useMemo(() => {
    if (!trimmed) return []
    const out: PaletteSection[] = []
    const push = (id: string, heading: string, items: PaletteItem[]) => {
      if (items.length > 0) out.push({ id, heading, items })
    }
    if (data.law) push('law', t('palette.groups.law'), lawItems(data.law, trimmed))
    if (data.jobs) push('pay', t('palette.groups.pay'), jobItems(data.jobs, trimmed))
    if (data.glossary) push('glossary', t('palette.groups.glossary'), glossaryItems(data.glossary, trimmed))
    if (data.drafting) push('draft', t('palette.groups.draft'), draftingItems(data.drafting, trimmed))
    if (data.trainer) push('trainer', t('palette.groups.trainer'), trainerTopicItems(data.trainer, trimmed))
    if (data.portals) push('portals', t('palette.groups.portals'), portalItems(data.portals, trimmed))
    return out
  }, [trimmed, data, t])

  const loadingMore = trimmed.length > 0 && (!data.law || !data.jobs || !data.glossary || !data.drafting || !data.trainer || !data.portals)
  const totalResults =
    navResults.length + settingsResults.length + sections.reduce((sum, section) => sum + section.items.length, 0)

  const go = (item: PaletteItem, section: string) => {
    closePalette()
    if (item.recordRecent) void recordCommandRecent(item, section).catch(() => {})
    void navigate(item.to)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closePalette()
      }}
      label={t('palette.label')}
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-50 bg-foreground/40"
      contentClassName="fixed top-[10vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
    >
      <div className="flex items-center border-b border-border px-3">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full bg-transparent px-1 text-base placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
          Esc
        </kbd>
      </div>

      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        {totalResults === 0 && !loadingMore ? (
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('palette.empty')}
          </Command.Empty>
        ) : null}

        {!trimmed && recents.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.recent')}
            className="px-1 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1"
          >
            {recents.map((item) => (
              <PaletteRow key={item.id} item={item} language={language} otherLanguage={otherLanguage} icon={Clock} onSelect={() => go(item, 'recent')} />
            ))}
          </Command.Group>
        ) : null}

        {navResults.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.nav')}
            className="px-1 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1"
          >
            {navResults.map((item) => (
              <PaletteRow key={item.id} item={item} language={language} otherLanguage={otherLanguage} icon={Compass} onSelect={() => go(item, 'nav')} />
            ))}
          </Command.Group>
        ) : null}

        {sections.map((section) => (
          <Command.Group
            key={section.id}
            heading={section.heading}
            className="px-1 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1"
          >
            {section.items.map((item) => (
              <PaletteRow
                key={item.id}
                item={item}
                language={language}
                otherLanguage={otherLanguage}
                icon={SECTION_ICON[section.id] ?? Compass}
                onSelect={() => go(item, section.id)}
              />
            ))}
          </Command.Group>
        ))}

        {settingsResults.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.settings')}
            className="px-1 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1"
          >
            {settingsResults.map((item) => {
              const Icon = SETTINGS_ICON[item.id] ?? Settings
              return (
                <Command.Item
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    closePalette()
                    item.run()
                  }}
                  className="group flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground group-data-[selected=true]:text-accent-foreground"
                  />
                  <span>{item[language]}</span>
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}
      </Command.List>

      {/*
        Outside `Command.List` (`role="listbox"`) deliberately: a progressbar
        is not a valid listbox child, and while every section is still
        loading — the FIRST render of any non-empty query, before any of the
        six datasets have settled — a `role="listbox"` with only this for
        content failed axe's `aria-required-children` intermittently in a
        real browser. `Command.Loading` still reads `useCommandState` from
        the surrounding `Command` root, so it works the same wherever it sits
        in the tree.
      */}
      {loadingMore ? (
        <Command.Loading label={t('palette.loading')}>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t('palette.loading')}</p>
        </Command.Loading>
      ) : null}
    </Command.Dialog>
  )
}

const SECTION_ICON: Record<string, typeof Scale> = {
  law: Scale,
  pay: Calculator,
  glossary: Languages,
  draft: FileSignature,
  trainer: GraduationCap,
  portals: Wrench,
}

const SETTINGS_ICON: Record<string, typeof Scale> = {
  'settings:language': Languages,
  'settings:theme': Moon,
  'settings:open': Settings,
}

function PaletteRow({
  item,
  language,
  otherLanguage,
  icon: Icon,
  onSelect,
}: {
  item: PaletteItem
  language: 'en' | 'hi'
  otherLanguage: 'en' | 'hi'
  icon: typeof Scale
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={item.id}
      keywords={[item.en, item.hi]}
      onSelect={onSelect}
      className="group flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <Icon
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground group-data-[selected=true]:text-accent-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item[language]}</span>
        <span className="block truncate text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground">
          {[item[otherLanguage], item.hint].filter(Boolean).join(' · ')}
        </span>
      </span>
    </Command.Item>
  )
}
