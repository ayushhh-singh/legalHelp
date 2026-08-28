import { create } from 'zustand'

/**
 * Whether the command palette and the shortcuts-help sheet are open.
 *
 * A separate store from `useAppStore`, deliberately: neither value is a
 * preference — nothing here is ever persisted to IndexedDB, and there is
 * nothing to hydrate. It exists so `TopBar`'s search button, the global
 * keyboard shortcuts (`useGlobalShortcuts`) and `CommandPalette` itself can
 * all reach the same open/closed state without App.tsx threading props down
 * three layers for one boolean.
 */
interface PaletteState {
  open: boolean
  helpOpen: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
  openHelp: () => void
  closeHelp: () => void
}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  helpOpen: false,
  openPalette: () => set({ open: true, helpOpen: false }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set({ open: !get().open, helpOpen: false }),
  openHelp: () => set({ helpOpen: true, open: false }),
  closeHelp: () => set({ helpOpen: false }),
}))
