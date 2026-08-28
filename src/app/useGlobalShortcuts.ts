import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { usePaletteStore } from './paletteStore'

/**
 * `g` then a destination letter, matching `src/lib/nav.ts`'s five modules.
 * `u` reaches Utilities rather than a sixth module — Settings has no letter of
 * its own and stays reachable from the sidebar and the palette's own list.
 */
const CHORD_TARGETS: Readonly<Record<string, string>> = {
  l: '/law',
  p: '/pay',
  d: '/draft',
  e: '/learn',
  u: '/utils',
}

/** How long a bare `g` stays "pending" before it reverts to a plain `g`. */
const CHORD_WINDOW_MS = 900

/**
 * Global keyboard shortcuts, mounted once in `App.tsx` so every route shares
 * one listener rather than each page wiring its own.
 *
 * - `Ctrl`/`Cmd`+`K` toggles the command palette, from anywhere, even while a
 *   field elsewhere on the page has focus — the one shortcut here that is a
 *   modifier combo, so it cannot collide with ordinary typing.
 * - `g` then `l`/`p`/`d`/`e`/`u` jumps to a module. The `g` is "pending" for
 *   `CHORD_WINDOW_MS`; anything else read as a plain keypress instead.
 * - `?` opens the shortcuts-help sheet.
 * - `/` focuses the current page's own search box (`[data-module-search]`),
 *   the same convention `SearchBar.tsx` already gives the Law Converter —
 *   falling back to the command palette on a page with no search field of its
 *   own, so the key always does something useful.
 *
 * Every one of these is skipped while the reader is typing: in an `<input>`,
 * a `<textarea>`, or a `contentEditable` region such as the Drafting Studio's
 * body editor, which a plain `tagName` check would miss.
 *
 * The `keydown` listener is attached ONCE, in a mount-only effect, and every
 * value it reads (`navigate`, the palette actions, `open`) comes through a
 * ref updated on every render rather than through the effect's own
 * dependency array. `navigate` in particular is not a value worth
 * re-subscribing over: React Router hands out a fresh function on route
 * changes in some configurations, and re-running this effect on that churn
 * tore down and rebuilt the listener between a `g` press and the letter that
 * completes it — a chord pressed right after a navigation could lose its
 * `g` to a freshly reset closure. A ref sidesteps the question entirely: the
 * listener, and the `pendingG`/`timer` state it closes over, live for the
 * component's whole lifetime.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate()
  const open = usePaletteStore((s) => s.open)
  const openPalette = usePaletteStore((s) => s.openPalette)
  const closePalette = usePaletteStore((s) => s.closePalette)
  const openHelp = usePaletteStore((s) => s.openHelp)

  const latest = useRef({ navigate, open, openPalette, closePalette, openHelp })
  useEffect(() => {
    latest.current = { navigate, open, openPalette, closePalette, openHelp }
  }, [navigate, open, openPalette, closePalette, openHelp])

  useEffect(() => {
    let pendingG = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearPending = () => {
      pendingG = false
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        clearPending()
        if (latest.current.open) latest.current.closePalette()
        else latest.current.openPalette()
        return
      }

      if (typing) {
        clearPending()
        return
      }

      // Every remaining shortcut is a bare key; a modifier held alongside it
      // is almost always a browser or OS binding (Ctrl+G "find next", etc.).
      if (event.metaKey || event.ctrlKey || event.altKey) {
        clearPending()
        return
      }

      if (pendingG) {
        clearPending()
        const path = CHORD_TARGETS[event.key.toLowerCase()]
        if (path) {
          event.preventDefault()
          void latest.current.navigate(path)
        }
        return
      }

      if (event.key === 'g') {
        pendingG = true
        timer = setTimeout(clearPending, CHORD_WINDOW_MS)
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        latest.current.openHelp()
        return
      }

      if (event.key === '/') {
        event.preventDefault()
        const field = document.querySelector<HTMLElement>('[data-module-search]')
        if (field) {
          field.focus()
          if (field instanceof HTMLInputElement) field.select()
        } else {
          latest.current.openPalette()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearPending()
    }
    // Mount-only, deliberately — see the function doc comment above.
  }, [])
}
