import { describe, expect, it } from 'vitest'

import { readFromRoot } from '@/test/paths'

/**
 * Every route the app can render is swept by axe and reloaded offline.
 *
 * The two sweeps are plain arrays — `ROUTES` in `tests/e2e/a11y.spec.ts` and
 * `EVERY_ROUTE` in `tests/e2e/offline.spec.ts` — and `docs/TESTING.md` tells
 * the next person to add a new route to both. That is a convention, and a
 * convention with nothing enforcing it is a convention that lasts until the
 * session that is in a hurry.
 *
 * It had already lapsed when this test was written. `/learn/review` — the
 * Trainer's actual review card, with a radiogroup of options, four grade
 * buttons and a report dialog, and the single most-used screen in that module —
 * was in NEITHER sweep. `/onboarding`, `/learn/mock` and `/learn/review-queue`
 * were missing from the offline one. Every route around them was covered, which
 * is exactly why nobody noticed.
 *
 * This reads the routes out of the router itself rather than restating them, so
 * the list cannot drift from the app: a route added to `LearnPage.tsx` is a
 * failure here until it is swept.
 */

/** Files that declare routes, and the path each one is mounted under. */
const ROUTERS: ReadonlyArray<{ file: string; base: string }> = [
  { file: 'src/modules/law/LawPage.tsx', base: '/law' },
  { file: 'src/modules/drafting/DraftPage.tsx', base: '/draft' },
  { file: 'src/modules/trainer/LearnPage.tsx', base: '/learn' },
  { file: 'src/modules/library/LibraryPage.tsx', base: '/library' },
  { file: 'src/modules/utils/UtilsPage.tsx', base: '/utils' },
]

/**
 * Routes that are deliberately not swept, each with the reason.
 *
 * Keep this short. An entry here is a route nobody looks at in either sweep.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  '/': 'a redirect, not a screen — App.tsx sends it to /onboarding or the home route',
  '/draft/:type':
    'parameterised; the sweeps visit /draft/office-memorandum, a real instance of it, because a literal ":type" renders the not-found redirect',
  '/draft/d/:id':
    'parameterised; a document id is minted by `crypto.getRandomValues` and exists only on the device that made one. `tests/e2e/draft-editor.spec.ts` creates a real document and sweeps the editor with axe there, which is the only place a real id exists.',
  '/draft/d/:id/print':
    'parameterised for the same reason as /draft/d/:id above — it prints ONE document, and a document id exists only on the device that made one. `tests/e2e/draft-io.spec.ts` creates a real document and sweeps the print route with axe there.',
  '/draft/new/:type':
    'parameterised, and not a screen: it creates a document and redirects. `tests/e2e/draft-editor.spec.ts` walks through it on the way to the editor.',
  '/library/:workId':
    'parameterised; the sweeps visit /library/ccs-conduct, a real instance of it, because a literal ":workId" renders the not-found redirect',
  '/library/:workId/:unitId':
    'parameterised; the sweeps visit /library/ccs-conduct/ccs-conduct-3, a real unit of a real work, for the same reason',
  '/library/:workId/quiz/:nodeId':
    'parameterised; the sweeps visit /library/ccs-conduct/quiz/group-n-ccs-conduct-1, a real chapter of a real work, for the same reason',
  '/library/:workId/sheet/:nodeId':
    'parameterised; the sweeps visit /library/ccs-conduct/sheet/group-n-ccs-conduct-1, likewise',
}

/** `<Route path="x" ...>` from a module router, ignoring the catch-all. */
function subRoutes(file: string): string[] {
  const source = readFromRoot(file)
  const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1] ?? '')
  return paths.filter((path) => path !== '*')
}

/** Every concrete route the app can render, derived from the routers. */
function appRoutes(): string[] {
  const app = readFromRoot('src/app/App.tsx')
  const top = [...app.matchAll(/path="([^"]+)"/g)]
    .map((match) => match[1] ?? '')
    .filter((path) => path !== '*')

  const routes = new Set<string>()
  for (const path of top) {
    // `/law/*` is a module router; its own sub-routes are read from its file.
    if (!path.endsWith('/*')) routes.add(path)
  }
  for (const { file, base } of ROUTERS) {
    routes.add(base) // the index route
    for (const sub of subRoutes(file)) routes.add(`${base}/${sub}`)
  }
  return [...routes].sort()
}

/** A named array of string literals out of a spec, comments stripped. */
function sweptRoutes(file: string, name: string): string[] {
  const source = readFromRoot(file)
  const start = source.indexOf('[', source.indexOf(name))
  expect(start, `${name} not found in ${file}`).toBeGreaterThan(0)

  let depth = 0
  let end = start
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1
    if (source[i] === ']') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  // Comments in these arrays explain why each route is there, and several of
  // them quote a path. Strip them, or the guard passes on a mention.
  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '')
}

const ROUTES = appRoutes()
const AXE = sweptRoutes('tests/e2e/a11y.spec.ts', 'const ROUTES')
const OFFLINE = sweptRoutes('tests/e2e/offline.spec.ts', 'const EVERY_ROUTE')

describe('the route list this guard reads', () => {
  it('found the routers, rather than silently parsing nothing', () => {
    // A guard that asserts over an empty list is not a guard. These floors are
    // deliberately below the real counts so ordinary growth does not touch them.
    expect(ROUTES.length).toBeGreaterThanOrEqual(20)
    expect(AXE.length).toBeGreaterThanOrEqual(15)
    expect(OFFLINE.length).toBeGreaterThanOrEqual(15)
  })

  it('includes the sub-routes each module owns, not just its base', () => {
    // If the `<Route path="...">` shape ever changes, this fails rather than
    // quietly reducing the guard to four base paths.
    for (const route of ['/law/whats-new', '/learn/review', '/utils/pension', '/library/:workId']) {
      expect(ROUTES, `${route} was not derived from the routers`).toContain(route)
    }
  })
})

describe('every route is swept', () => {
  const checked = ROUTES.filter((route) => !(route in EXEMPT))

  it.each(checked)('%s is audited by axe in both languages and both themes', (route) => {
    expect(
      AXE,
      `${route} is not in ROUTES in tests/e2e/a11y.spec.ts. Add it there, or add it to EXEMPT in this file with the reason.`,
    ).toContain(route)
  })

  it.each(checked)('%s still renders after an offline reload', (route) => {
    expect(
      OFFLINE,
      `${route} is not in EVERY_ROUTE in tests/e2e/offline.spec.ts. Add it there, or add it to EXEMPT in this file with the reason.`,
    ).toContain(route)
  })
})

describe('the exemptions', () => {
  it('names only routes that exist', () => {
    for (const route of Object.keys(EXEMPT)) {
      // A stale exemption is a route silently excused after it stopped being a
      // route — or, worse, a typo excusing nothing while looking like it does.
      const known =
        ROUTES.includes(route) ||
        ['/draft/:type', '/library/:workId', '/library/:workId/:unitId'].includes(route)
      expect(known, `EXEMPT names ${route}, which the routers do not declare`).toBe(true)
    }
  })

  it('gives a reason for each', () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${route} is exempt with no reason given`).toBeGreaterThan(20)
    }
  })
})
