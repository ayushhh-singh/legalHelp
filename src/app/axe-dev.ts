/**
 * Dev-only accessibility reporter.
 *
 * Replaces `@axe-core/react`, which cannot work on React 19: it monkey-patches
 * `React.createElement` and reads `_reactInternalInstance` / `_reactInternalFiber`
 * / `_owner._instance` to decide what to re-audit — internals React 19 removed,
 * and which the automatic JSX runtime no longer routes through `createElement`
 * at all. See ADR-009.
 *
 * axe-core is already a dependency (src/app/App.a11y.test.tsx), needs no React
 * coupling, and a MutationObserver is a more accurate "the tree changed" signal
 * than a createElement hook. Never bundled into production: main.tsx imports
 * this behind `import.meta.env.DEV`, and it makes no network request.
 */
import axe from 'axe-core'

const DEBOUNCE_MS = 1000

export function startAxeReporter(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false

  const audit = async () => {
    if (running) return
    running = true
    try {
      const { violations } = await axe.run(document, { resultTypes: ['violations'] })
      if (violations.length === 0) return
      console.groupCollapsed(`[sahayak] axe: ${violations.length} accessibility violation(s)`)
      for (const violation of violations) {
        console.warn(`${violation.impact ?? 'unknown'} · ${violation.id}: ${violation.help}`)
        console.warn(violation.nodes.map((node) => node.target.join(' ')).join('\n'))
      }
      console.groupEnd()
    } catch (error) {
      console.warn('[sahayak] axe could not run', error)
    } finally {
      running = false
    }
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void audit(), DEBOUNCE_MS)
  }

  // Re-audit whenever the rendered tree settles — a route change, a lazy chunk
  // arriving, a language switch.
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  })
  schedule()
}
