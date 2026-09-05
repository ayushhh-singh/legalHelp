import { useCallback, useRef } from 'react'

/**
 * Measure a fixed element and publish its height as a CSS variable.
 *
 * Two things in this app pin themselves to the bottom of a phone's screen — the
 * service worker's toast and the reader's action row — and anything else that
 * wants that edge has to know how much of it is already spoken for. Moving an
 * overlay up only relocates the collision, so the space is RESERVED: the
 * measured height goes into a custom property and whatever sits above it adds
 * that property to its own offset, in CSS.
 *
 * **Measured rather than assumed**, because these elements are not a fixed
 * height: the toast's strings wrap to one line in English and three in Hindi,
 * and the action row gains and loses a control with the work being read.
 * `ResizeObserver` rather than a one-shot read, because a height can change
 * without anything unmounting.
 *
 * **A callback ref**, which is what makes it correct on the way out: React calls
 * it with `null` when the element goes, and that is every route by which the
 * element disappears — so there is no path that leaves stale space behind.
 *
 * `gap` is added to the measurement, so the thing above is not flush against
 * the thing below it.
 */
export function useReservedSpace(variable: string, gap = 0) {
  const observerRef = useRef<ResizeObserver | null>(null)

  return useCallback(
    (node: HTMLElement | null) => {
      const root = document.documentElement
      observerRef.current?.disconnect()
      observerRef.current = null

      if (!node) {
        root.style.removeProperty(variable)
        return
      }

      const apply = () => {
        root.style.setProperty(variable, `${Math.ceil(node.offsetHeight) + gap}px`)
      }
      apply()

      // Absent in jsdom, and this is a layout refinement rather than a
      // correctness one — the first measurement above has already run.
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(apply)
      observer.observe(node)
      observerRef.current = observer
    },
    [variable, gap],
  )
}
