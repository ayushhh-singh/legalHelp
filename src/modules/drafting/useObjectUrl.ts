import { useEffect, useState } from 'react'

/**
 * A blob as a URL an `<img>` can use, revoked when it is no longer that blob.
 *
 * The obvious shape — `useEffect(() => { setUrl(createObjectURL(blob)); return
 * () => revoke(url) }, [blob])` — is a `setState` in an effect body, which
 * `react-hooks/set-state-in-effect` rejects and which is genuinely a cascading
 * render: the component paints once with no image, then again with one.
 *
 * The shape here creates the URL during RENDER and adjusts state in the same
 * pass, which is React's own "adjusting state when a prop changes" pattern —
 * the render that reads the new blob is the render that has its URL. The effect
 * that remains does one thing, and it is the thing effects are for: releasing a
 * resource the component acquired. Without it every letterhead preview pins its
 * blob in memory for the life of the tab.
 *
 * `null` in gives `null` out, so a caller can turn the preview off by passing
 * nothing rather than by conditionally calling a hook.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [current, setCurrent] = useState<{ blob: Blob | null; url: string | null }>({
    blob: null,
    url: null,
  })

  const next = blob ?? null
  if (current.blob !== next) {
    if (current.url) URL.revokeObjectURL(current.url)
    setCurrent({ blob: next, url: next ? URL.createObjectURL(next) : null })
  }

  useEffect(
    () => () => {
      if (current.url) URL.revokeObjectURL(current.url)
    },
    [current.url],
  )

  return current.blob === next ? current.url : null
}
