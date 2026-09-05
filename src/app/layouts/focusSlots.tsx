import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * What a focus page may put in the bar above it.
 *
 * A separate file from `FocusLayout` because these are hooks and a context
 * rather than components, and a module that exports both loses fast refresh for
 * the components in it.
 *
 * ### Two mechanisms, and the difference is deliberate
 *
 * `title` and `status` are STRINGS held in state. A string is a stable
 * dependency, so `useFocusTitle` cannot loop the way a `useEffect` over a
 * freshly-built element would.
 *
 * Everything richer — the reader's unit switcher, its "Aa" and headphones
 * buttons, the editor's ⋯ entries — is a PORTAL instead. Storing a React
 * element in state is exactly the loop that rules out: an element is a new
 * object on every render, so an effect that depends on it fires on every
 * render, sets state, and fires again. A portal has no such problem, and it
 * buys two more things worth having: the controls live in the PAGE's tree, so
 * they keep its state and its handlers with no stale closures, and they appear
 * in the bar's DOM in reading order, so the tab order is right.
 */
export interface FocusSlots {
  /** Overrides the route's own name — a work's title, a document's subject. */
  title: string | null
  /** "Saved 3 s ago", "12 of 20", "Question 4". */
  status: string | null
  /** The right-hand control: "Show the notes panel", "Hide the rail". */
  panel: React.ReactNode
}

/**
 * Where a page's own controls land.
 *
 * - `title` — the centre of the bar, replacing the plain title text.
 * - `actions` — buttons between the status and the ⋯ menu.
 * - `menu` — entries at the TOP of the ⋯ menu, above language/theme/Settings.
 *   One menu, not two: a page that opened a second ⋯ beside the shell's would
 *   be asking the reader which of two identical glyphs they wanted.
 */
export type FocusHost = 'title' | 'actions' | 'menu'

export const EMPTY_SLOTS: FocusSlots = { title: null, status: null, panel: null }

const EMPTY_HOSTS: Record<FocusHost, HTMLElement | null> = { title: null, actions: null, menu: null }

export interface FocusContextValue {
  set: (patch: Partial<FocusSlots>) => void
  hosts: Record<FocusHost, HTMLElement | null>
  /** Shuts the ⋯ menu — what an entry portalled into it calls after it acts. */
  closeMenu: () => void
}

const FocusSlotsContext = createContext<FocusContextValue | null>(null)

/**
 * The raw context provider, not a wrapper component.
 *
 * `FocusLayout` supplies the value. Keeping it raw is what keeps this file
 * hooks-only, which is what the header says it is for — a module that exports
 * both components and hooks loses fast refresh for the components in it, and
 * `FocusSlot` lives in its own file for the same reason.
 */
export const FocusSlotsProvider = FocusSlotsContext.Provider

export interface FocusSlotState {
  slots: FocusSlots
  /** Callback refs for the three hosts, handed to the bar. */
  hostRef: (host: FocusHost) => (element: HTMLElement | null) => void
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  provider: FocusContextValue
}

/** Holds the slots and the hosts for one focus route, and hands them down. */
export function useFocusSlotState(): FocusSlotState {
  const [slots, setSlots] = useState<FocusSlots>(EMPTY_SLOTS)
  const [hosts, setHosts] = useState<Record<FocusHost, HTMLElement | null>>(EMPTY_HOSTS)
  const [menuOpen, setMenuOpen] = useState(false)

  const set = useCallback((patch: Partial<FocusSlots>) => {
    setSlots((current) => ({ ...current, ...patch }))
  }, [])

  /*
    One callback ref per host, memoised on the host NAME.

    A fresh arrow per render would detach and re-attach the ref on every render
    — React calls the old one with `null` and the new one with the element —
    which unmounts and remounts every portal underneath it.
  */
  const setters = useMemo(() => {
    const make = (host: FocusHost) => (element: HTMLElement | null) => {
      setHosts((current) => (current[host] === element ? current : { ...current, [host]: element }))
    }
    return { title: make('title'), actions: make('actions'), menu: make('menu') }
  }, [])
  const hostRef = useCallback((host: FocusHost) => setters[host], [setters])

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  const provider = useMemo<FocusContextValue>(() => ({ set, hosts, closeMenu }), [set, hosts, closeMenu])

  return { slots, hostRef, menuOpen, setMenuOpen, provider }
}

/** Where a `FocusSlot` should render, or null while the bar has not mounted. */
export function useFocusHost(host: FocusHost): HTMLElement | null {
  const context = useContext(FocusSlotsContext)
  return context?.hosts[host] ?? null
}

/** Shuts the ⋯ menu. A no-op outside a `FocusLayout`. */
export function useFocusMenuClose(): () => void {
  const context = useContext(FocusSlotsContext)
  const close = context?.closeMenu
  return useCallback(() => close?.(), [close])
}

/**
 * Put this page's own name in the focus bar.
 *
 * A string, not a node, deliberately: a string is a stable dependency, so this
 * hook cannot loop the way a `useEffect` over a freshly-built element would.
 * Pages with nothing better to say leave it alone and the bar names the route.
 */
export function useFocusTitle(title: string | null | undefined): void {
  const context = useContext(FocusSlotsContext)
  const set = context?.set
  useEffect(() => {
    if (!set) return
    set({ title: title ?? null })
    return () => set({ title: null })
  }, [set, title])
}

/** The same, for the bar's status line. */
export function useFocusStatus(status: string | null | undefined): void {
  const context = useContext(FocusSlotsContext)
  const set = context?.set
  useEffect(() => {
    if (!set) return
    set({ status: status ?? null })
    return () => set({ status: null })
  }, [set, status])
}
