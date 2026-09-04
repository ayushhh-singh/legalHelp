import { describe, expect, it } from 'vitest'

import { APP_ROUTES, LEGACY_REDIRECTS } from '@/lib/nav'
import { readFromRoot } from '@/test/paths'

/**
 * Every route the app can render is swept by axe and reloaded offline, is
 * registered in `src/lib/nav.ts` with a layout level, and — if it is a detail
 * or a focus page — declares what it goes back to.
 *
 * The two sweeps are plain arrays — `ROUTES` in `tests/e2e/a11y.spec.ts` and
 * `EVERY_ROUTE` in `tests/e2e/offline.spec.ts` — and `docs/TESTING.md` tells
 * the next person to add a new route to both. That is a convention, and a
 * convention with nothing enforcing it is a convention that lasts until the
 * session that is in a hurry. It had already lapsed when this test was first
 * written: `/learn/review` — the Trainer's actual review card, and the single
 * most-used screen in that module — was in NEITHER sweep.
 *
 * ADR-046 added the third question. A route with no entry in `APP_ROUTES` gets
 * no layout, no breadcrumb and no back chevron, and the way that fails is not
 * a crash — it is a page an officer cannot get out of.
 *
 * Everything here reads the routers themselves rather than restating them, so
 * the lists cannot drift from the app.
 */

/** Files that declare routes, and the path each one is mounted under. */
const ROUTERS: ReadonlyArray<{ file: string; base: string }> = [
  { file: 'src/modules/law/LawPage.tsx', base: '/law' },
  { file: 'src/modules/study/StudyPage.tsx', base: '/study' },
  { file: 'src/modules/drafting/DraftPage.tsx', base: '/draft' },
  { file: 'src/modules/utils/ToolsPage.tsx', base: '/tools' },
  { file: 'src/modules/settings/SettingsPage.tsx', base: '/settings' },
]

/**
 * Routes that are deliberately not swept, each with the reason.
 *
 * Keep this short. An entry here is a route nobody looks at in either sweep.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  '/': 'a redirect, not a screen — App.tsx sends it to /onboarding or the home route',
  '/study/read/:workId':
    'parameterised; the sweeps visit /study/read/ccs-conduct, a real instance of it, because a literal ":workId" renders the not-found redirect',
  '/study/read/:workId/:unitId':
    'parameterised; the sweeps visit /study/read/ccs-conduct/ccs-conduct-3, a real unit of a real work, for the same reason',
  '/study/read/:workId/quiz/:nodeId':
    'parameterised; the sweeps visit /study/read/ccs-conduct/quiz/group-n-ccs-conduct-1, a real chapter of a real work, for the same reason',
  '/study/read/:workId/sheet/:nodeId':
    'parameterised; the sweeps visit /study/read/ccs-conduct/sheet/group-n-ccs-conduct-1, likewise',
  '/draft/d/:id':
    'parameterised; a document id is minted by `crypto.getRandomValues` and exists only on the device that made one. `tests/e2e/draft-editor.spec.ts` creates a real document and sweeps the editor with axe there, which is the only place a real id exists.',
  '/draft/d/:id/print':
    'parameterised for the same reason as /draft/d/:id above — it prints ONE document. `tests/e2e/draft-io.spec.ts` creates a real document and sweeps the print route with axe there.',
  '/draft/new/:type':
    'parameterised, and not a screen: it creates a document and redirects. `tests/e2e/draft-editor.spec.ts` walks through it on the way to the editor.',
  '/draft/reply/:id':
    'parameterised; an intake id is minted on the device that kept the letter, so a literal ":id" renders the empty reply screen. `/draft/reply` — the same component with no letter open — IS swept, and `tests/e2e/draft-reply.spec.ts` pastes a real letter and keeps it.',
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

/**
 * Paths that are a decision rather than a screen: a bare `/` (onboarding or
 * home, once IndexedDB answers) and the three section roots, each of which only
 * ever redirects to its default sub-tab.
 */
const SECTION_ROOTS = new Set(['/', '/study', '/draft', '/tools'])

/** Everything the routers declare that is not itself a redirect. */
const REAL_ROUTES = ROUTES.filter(
  (route) => !SECTION_ROOTS.has(route) && !LEGACY_REDIRECTS.some((redirect) => redirect.from === route),
)

describe('the route list this guard reads', () => {
  it('found the routers, rather than silently parsing nothing', () => {
    // A guard that asserts over an empty list is not a guard. These floors are
    // deliberately below the real counts so ordinary growth does not touch them.
    expect(ROUTES.length).toBeGreaterThanOrEqual(30)
    expect(AXE.length).toBeGreaterThanOrEqual(25)
    expect(OFFLINE.length).toBeGreaterThanOrEqual(25)
  })

  it('includes the sub-routes each section owns, not just its base', () => {
    // If the `<Route path="...">` shape ever changes, this fails rather than
    // quietly reducing the guard to five base paths.
    for (const route of [
      '/law/whats-new',
      '/study/practise/review',
      '/tools/pension',
      '/study/read/:workId',
      '/settings/backup',
    ]) {
      expect(ROUTES, `${route} was not derived from the routers`).toContain(route)
    }
  })
})

describe('every route is swept', () => {
  const checked = REAL_ROUTES.filter((route) => !(route in EXEMPT))

  it.each(checked)('%s is audited by axe in both languages and both themes', (route: string) => {
    expect(
      AXE,
      `${route} is not in ROUTES in tests/e2e/a11y.spec.ts. Add it there, or add it to EXEMPT in this file with the reason.`,
    ).toContain(route)
  })

  it.each(checked)('%s still renders after an offline reload', (route: string) => {
    expect(
      OFFLINE,
      `${route} is not in EVERY_ROUTE in tests/e2e/offline.spec.ts. Add it there, or add it to EXEMPT in this file with the reason.`,
    ).toContain(route)
  })
})

describe('every route has a layout level', () => {
  const registered = new Set(APP_ROUTES.map((route) => route.path))

  it.each(REAL_ROUTES)('%s is registered in src/lib/nav.ts', (route: string) => {
    // A route with no entry gets no layout, no breadcrumb trail and no back
    // control — and that failure is not a crash, it is a page an officer
    // cannot get out of.
    expect(
      registered.has(route),
      `${route} is declared by a router and is not in APP_ROUTES. Add it with a level, and a parent if it is a detail or focus page.`,
    ).toBe(true)
  })

  it('registers nothing the routers do not declare', () => {
    // The other direction: a stale entry is a level, a parent and a breadcrumb
    // for a page that no longer exists.
    const declared = new Set([...ROUTES, ...SECTION_ROOTS])
    for (const route of APP_ROUTES) {
      expect(declared.has(route.path), `APP_ROUTES names ${route.path}, which no router declares`).toBe(true)
    }
  })
})

describe('the exemptions', () => {
  it('names only routes that exist', () => {
    for (const route of Object.keys(EXEMPT)) {
      // A stale exemption is a route silently excused after it stopped being a
      // route — or, worse, a typo excusing nothing while looking like it does.
      expect(ROUTES.includes(route), `EXEMPT names ${route}, which the routers do not declare`).toBe(true)
    }
  })

  it('gives a reason for each', () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${route} is exempt with no reason given`).toBeGreaterThan(20)
    }
  })
})
