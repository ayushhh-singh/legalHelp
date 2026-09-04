import { describe, expect, it } from 'vitest'

import {
  APP_ROUTES,
  LEGACY_REDIRECTS,
  levelOf,
  redirectTarget,
  resolveParent,
  routeFor,
  subTabFor,
} from './nav'

/**
 * The edge-case pass over ADR-046's route tree.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written, or is a pin on behaviour that is easy to break and that
 * nothing else asserts.
 *
 * The family is one sentence: **a path is a string the reader controls**, and
 * three of these are about what happens when it is not the tidy string the
 * happy path assumes — a percent-escape, a trailing slash, a case fold.
 */

const redirect = (from: string) => LEGACY_REDIRECTS.find((row) => row.from === from)!

describe('a parameter is carried VERBATIM, never decoded and re-encoded', () => {
  /*
    `matchPath` decodes some parameters and not others.

    Measured, not assumed: on `/study/read/my%2Fa/u%201` it returns
    `{ workId: 'my/a', unitId: 'u%201' }` — the first decoded, the second not.
    So a redirect that re-encodes what `matchPath` handed back double-encodes
    exactly the parameters `matchPath` chose to leave alone, and the reader
    lands on a unit id that does not exist. Nothing throws; the link simply
    goes somewhere else.

    The fix is to stop round-tripping: both `resolveParent` and
    `redirectTarget` copy the SEGMENT out of the pathname the reader is
    actually on, which is exact by construction.
  */
  it('does not double-encode a percent-escape a redirect carries through', () => {
    expect(redirectTarget(redirect('/library/:workId/:unitId'), '/library/ccs-conduct/u%201')).toBe(
      '/study/read/ccs-conduct/u%201',
    )
  })

  it('does not decode an escape into a path separator', () => {
    // `%2F` is a slash INSIDE one segment. Decoding it would turn a two-segment
    // path into a three-segment one, which is a different route.
    expect(redirectTarget(redirect('/library/:workId'), '/library/my%2Fwork')).toBe('/study/read/my%2Fwork')
  })

  it('carries an escape through the parent chain too', () => {
    expect(resolveParent('/study/read/ccs-conduct/u%201')).toBe('/study/read/ccs-conduct')
    expect(resolveParent('/study/read/my%2Fwork/u1')).toBe('/study/read/my%2Fwork')
  })

  it('leaves an ordinary id exactly as it was', () => {
    expect(resolveParent('/study/read/ccs-conduct/ccs-conduct-3')).toBe('/study/read/ccs-conduct')
    expect(redirectTarget(redirect('/library/:workId/quiz/:nodeId'), '/library/bns/quiz/group-n-1')).toBe(
      '/study/read/bns/quiz/group-n-1',
    )
  })
})

describe('a trailing slash is the same page', () => {
  // A phone keyboard adds one, a copied link carries one, and React Router
  // matches it — so every function that answers about a pathname has to agree
  // with the router rather than with a naive split.
  it.each([
    ['/study/read/bns/103/', 'focus'],
    ['/study/read/bns/', 'detail'],
    ['/law/', 'tab'],
    ['/settings/backup/', 'detail'],
  ] as const)('%s is still %s', (path, level) => {
    expect(levelOf(path)).toBe(level)
  })

  it('still resolves the parent and the sub-tab', () => {
    expect(resolveParent('/study/read/bns/103/')).toBe('/study/read/bns')
    expect(subTabFor('/study/practise/review/')?.id).toBe('practise')
  })

  it('still redirects', () => {
    expect(redirectTarget(redirect('/pay'), '/pay/')).toBe('/tools/salary')
  })
})

describe('a pathname that is not a route', () => {
  it('is a tab, so the chrome stays on while the catch-all redirects', () => {
    // Hiding the sidebar and the tab bar on the way to the home route would
    // flash an empty screen at a reader who mistyped a URL.
    for (const path of ['', '/', '/nope', '//study//read', '/study/read/a/b/c/d']) {
      expect(levelOf(path), path).toBe('tab')
    }
  })

  it('answers null rather than guessing a section', () => {
    expect(routeFor('/nope')).toBeNull()
    expect(subTabFor('/nope')).toBeNull()
  })

  it('returns null from a redirect whose pattern does not match', () => {
    expect(redirectTarget(redirect('/library/:workId'), '/library')).toBeNull()
    expect(redirectTarget(redirect('/library/:workId'), '/library/a/b')).toBeNull()
  })
})

describe('the redirect table cannot send a reader in a circle', () => {
  /** React Router's own ranking: more segments wins, then more STATIC ones. */
  const score = (pattern: string) => {
    const segments = pattern.split('/').filter(Boolean)
    return segments.length * 10 + segments.filter((segment) => !segment.startsWith(':')).length
  }

  const matches = (pattern: string, path: string) => {
    const p = pattern.split('/')
    const a = path.split('/')
    return p.length === a.length && p.every((segment, at) => segment.startsWith(':') || segment === a[at])
  }

  it('lands every target on a REAL route, not back on another redirect', () => {
    /*
      Stronger than "no target is also a source", which is what
      `src/lib/nav.test.ts` asserts, and it caught something that one cannot
      see: `/draft` → `/draft/documents`, and `/draft/:type` MATCHES
      `/draft/documents` — so the two strings are not equal and the second
      pattern still claims the first one's target. The app is right today only
      because React Router ranks a static segment above a dynamic one and
      `/draft/documents` is a real route; this asserts exactly that reasoning
      rather than trusting it, because if the real route ever loses the ranking
      the result is a redirect loop, and a redirect loop is a browser that
      hangs.
    */
    for (const row of LEGACY_REDIRECTS) {
      const target = row.to.split(/[?#]/)[0] ?? ''
      const best = [
        ...APP_ROUTES.map((route) => ({ pattern: route.path, real: true })),
        ...LEGACY_REDIRECTS.map((other) => ({ pattern: other.from, real: false })),
      ]
        .filter((candidate) => matches(candidate.pattern, target))
        .sort((a, b) => score(b.pattern) - score(a.pattern))[0]

      expect(best, `${row.from} → ${row.to} matches nothing at all`).toBeDefined()
      expect(best?.real, `${row.from} → ${row.to} is claimed by the redirect ${best?.pattern}`).toBe(true)
    }
  })
})
