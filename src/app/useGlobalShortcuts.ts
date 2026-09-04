import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { usePaletteStore } from './paletteStore'

/**
 * `g` then a destination letter — one per tab in `src/lib/nav.ts`, plus the two
 * places inside Study an officer goes straight to.
 *
 * The letters follow the tab NAMES rather than the old module names: `h` home,
 * `s` study, `d` draft, `l` law, `t` tools. `r` and `p` reach Study's Read and
 * Practise sub-tabs directly, because "open the shelf" and "start practising"
 * are two different intentions and landing on the section root would make one
 * of them a second keystroke. Settings has no letter of its own and stays
 * reachable from the top-right menu and the palette's own list.
 */
const CHORD_TARGETS: Readonly<Record<string, string>> = {
  h: '/home',
  s: '/study',
  r: '/study/read',
  p: '/study/practise',
  d: '/draft',
  l: '/law',
  t: '/tools',
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
 * - `g` then `h`/`s`/`d`/`l`/`t` jumps to a section (and `r`/`p` to Study's
 *   Read and Practise tabs). The `g` is "pending" for
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

      // Is some OTHER dialog already open — the AI consent modal, the
      // shortcuts-help sheet, a Drafting Studio Sheet? None of those is
      // reachable from `usePaletteStore`, so a live DOM query is what tells
      // the difference between "nothing is open" and "the palette itself is
      // open" (which the code below already knows via `latest.current.open`
      // and does not need this for). Left unguarded, `g p` fired while the
      // shortcuts sheet was open navigated away and left the sheet showing
      // over the new page, and Ctrl+K fired while the AI consent modal was
      // open stacked the palette on top of it — harmless on its own, except
      // that the modal's own hand-rolled Escape handler and Radix's
      // Escape-closes-the-topmost-dialog handling both then fired on the
      // SAME Escape press, closing both at once and losing the reader's
      // place in the consent flow.
      const foreignDialogOpen = !latest.current.open && document.querySelector('[role="dialog"]') !== null

      // Lower-cased once: `event.key` reports the character actually
      // produced, so CapsLock (or Shift) turns "g" into "G" at the OS level —
      // without this, starting a chord (below) silently stopped working
      // whenever CapsLock was on, since it compared against the literal
      // lower-case `'g'`.
      const key = event.key.toLowerCase()

      // `!event.shiftKey` so Ctrl+Shift+K (Firefox's "Web Console", among
      // others) is left alone rather than also toggling the palette on top
      // of whatever that shortcut does.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === 'k') {
        if (foreignDialogOpen) return
        event.preventDefault()
        clearPending()
        if (latest.current.open) latest.current.closePalette()
        else latest.current.openPalette()
        return
      }

      if (typing || foreignDialogOpen) {
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
        const path = CHORD_TARGETS[key]
        if (path) {
          event.preventDefault()
          void latest.current.navigate(path)
        }
        return
      }

      if (key === 'g') {
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
