import { CommandPalette } from './CommandPalette'
import { ShortcutsHelp } from './ShortcutsHelp'

/**
 * One lazy chunk for both overlays `App.tsx` mounts on demand — cmdk, Radix
 * Dialog and every section's search machinery stay out of the initial route
 * the same way the AI layer does (ADR-011): a reader who never presses
 * Ctrl-K, the search button or `?` never downloads any of it.
 */
export default function PaletteRoot() {
  return (
    <>
      <CommandPalette />
      <ShortcutsHelp />
    </>
  )
}
