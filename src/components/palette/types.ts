/**
 * One row the command palette can show, whichever section it came from.
 *
 * `en`/`hi` are what renders; `hint` is the smaller second line (an
 * organisation, a category, a rule-book short name); `keywords` are extra
 * terms cmdk's own item matching never sees, because every section here does
 * its OWN ranking (`shouldFilter={false}` on the `Command` root) and hands the
 * palette an already-ordered list — see `src/components/palette/sections.ts`
 * for why a shared search engine, not a second one, is what does that
 * ranking.
 */
export interface PaletteItem {
  id: string
  en: string
  hi: string
  hint?: string
  /** Where selecting the item navigates. */
  to: string
  /** Recorded in `commandRecents` on selection. `false` for a settings action. */
  recordRecent?: boolean
}

export interface PaletteSection {
  id: string
  heading: string
  items: PaletteItem[]
}
