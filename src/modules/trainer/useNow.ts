import { useEffect, useState } from 'react'

/**
 * The current instant, refreshed every `intervalMs` (default 30s).
 *
 * Every SRS function is pure and told the time rather than reading a clock, so
 * something above them has to hold `now` — and holding it as `new Date()`
 * inlined at render time would change on every render, which would in turn
 * change on every `useLiveQuery` dependency array that includes it and re-run
 * every query on every render. A ticking value that changes only every 30
 * seconds is fresh enough for a due count or a countdown and cheap enough not
 * to matter.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
