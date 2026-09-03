import { useEffect, useRef, type RefObject } from 'react'

/**
 * Show a `Blob` in an `<img>`, and revoke its URL when it is no longer shown.
 *
 * Attach the returned ref to the image. There is no state and no return value
 * to render, and that is the whole design rather than a stylistic preference —
 * the two obvious shapes are both wrong, and the second one is wrong in a way
 * no browser test in this project could ever have caught.
 *
 * **`useEffect(() => { setUrl(createObjectURL(blob)); return () => revoke(url) })`**
 * is a `setState` inside an effect body: a cascading render that paints once
 * with no image and again with one, which `react-hooks/set-state-in-effect`
 * rejects.
 *
 * **Creating the URL during render and revoking it in the effect** — which is
 * what this hook did first — is worse, and the reason is StrictMode. React
 * mounts, runs the effect, DESTROYS it, and runs it again; the destroy revokes
 * the URL, and the recreated effect has nothing to do because the URL is still
 * sitting in state. The component then renders a `blob:` URL that has already
 * been revoked, which is a broken image with nothing in the console. It is
 * invisible to `pnpm test:e2e`, because that runs a production build where
 * StrictMode is inert (CLAUDE.md records the same trap costing two defects in
 * Session 8's `useDraft`), and it is what an officer sees in `pnpm dev`.
 *
 * Writing to the DOM node is what effects are FOR — "update external systems"
 * is the rule's own first bullet — so the URL is made and destroyed in the same
 * effect, in step, and StrictMode's destroy-and-recreate produces a second URL
 * that is actually on the element.
 */
export function useObjectUrl(blob: Blob | null | undefined): RefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!blob) {
      node.removeAttribute('src')
      return
    }
    const url = URL.createObjectURL(blob)
    node.setAttribute('src', url)
    return () => {
      // The attribute goes with the URL. Leaving it behind would point the
      // element at a `blob:` that no longer resolves, which is the state this
      // hook exists to make impossible.
      node.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [blob])

  return ref
}
