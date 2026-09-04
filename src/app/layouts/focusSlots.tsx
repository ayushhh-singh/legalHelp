import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * What a focus page may put in the bar above it.
 *
 * A separate file from `FocusLayout` because these are hooks and a context
 * rather than components, and a module that exports both loses fast refresh for
 * the components in it.
 */
export interface FocusSlots {
  /** Overrides the route's own name — a work's title, a document's subject. */
  title: string | null
  /** "Saved 3 s ago", "12 of 20", "Question 4". */
  status: string | null
  /** The right-hand control: "Show the notes panel", "Hide the rail". */
  panel: React.ReactNode
}

export const EMPTY_SLOTS: FocusSlots = { title: null, status: null, panel: null }

const FocusSlotsContext = createContext<{ set: (patch: Partial<FocusSlots>) => void } | null>(null)

/** Holds the slots for one focus route, and hands the setter down. */
export function useFocusSlotState(): {
  slots: FocusSlots
  provider: { set: (patch: Partial<FocusSlots>) => void }
} {
  const [slots, setSlots] = useState<FocusSlots>(EMPTY_SLOTS)
  const set = useCallback((patch: Partial<FocusSlots>) => {
    setSlots((current) => ({ ...current, ...patch }))
  }, [])
  return { slots, provider: { set } }
}

export const FocusSlotsProvider = FocusSlotsContext.Provider

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
