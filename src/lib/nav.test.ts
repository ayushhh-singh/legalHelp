import { describe, expect, it } from 'vitest'

import {
  APP_ROUTES,
  defaultSubTabOf,
  HOME_PATH,
  LEGACY_REDIRECTS,
  levelOf,
  NAV_TABS,
  navDestinations,
  redirectTarget,
  resolveParent,
  routeFor,
  SETTINGS_PATH,
  SETTINGS_SECTIONS,
  subTabFor,
  tabFor,
} from './nav'

/**
 * The shape of the tree, and the three questions the whole restructure rests on
 * it being able to answer: what layout does this path render in, what is it
 * inside of, and where did this old link mean to go (ADR-046).
 */

describe('the tree', () => {
  it('is five tabs, in the order the chromes render them', () => {
    expect(NAV_TABS.map((tab) => tab.id)).toEqual(['home', 'study', 'draft', 'law', 'tools'])
  })

  it('gives every tab a default sub-tab that is one of its own', () => {
    for (const tab of NAV_TABS) {
      expect(
        tab.subTabs.map((subTab) => subTab.id),
        tab.id,
      ).toContain(tab.defaultSubTab)
      expect(defaultSubTabOf(tab).id).toBe(tab.defaultSubTab)
    }
  })

  it('keeps every sub-tab underneath its own section, or AT it', () => {
    // The Law Converter's own sub-tab IS `/law`, deliberately: its whole view
    // lives in the query string, so every `/law?q=302` ever shared stays
    // canonical rather than becoming a redirect.
    for (const tab of NAV_TABS) {
      for (const subTab of tab.subTabs) {
        expect(
          subTab.path === tab.path || subTab.path.startsWith(`${tab.path}/`),
          `${tab.id}/${subTab.id} is at ${subTab.path}`,
        ).toBe(true)
      }
    }
  })

  it('labels every tab, sub-tab and settings section in both languages', () => {
    for (const language of ['en', 'hi'] as const) {
      for (const tab of NAV_TABS) {
        expect(tab.label[language], `${tab.id}.label`).toBeTruthy()
        expect(tab.short[language], `${tab.id}.short`).toBeTruthy()
        for (const subTab of tab.subTabs) expect(subTab.label[language], subTab.id).toBeTruthy()
      }
      for (const section of SETTINGS_SECTIONS) expect(section.label[language], section.id).toBeTruthy()
    }
  })

  it('has no duplicate paths anywhere in it', () => {
    const paths = [
      ...NAV_TABS.flatMap((tab) => tab.subTabs.map((subTab) => subTab.path)),
      ...SETTINGS_SECTIONS.map((section) => section.path),
    ]
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('every route has a level, and every child knows its parent', () => {
  it('declares a parent on every detail and focus route', () => {
    // Not decoration: `useBackTo` has no third branch. A page with no parent
    // and no history is a page an officer cannot leave without the browser's
    // own back button, which a focus screen has hidden the chrome for.
    for (const route of APP_ROUTES) {
      if (route.level === 'tab') continue
      expect(route.parent, `${route.path} is ${route.level} with no parent`).toBeTruthy()
    }
  })

  it('names a parent that is itself a registered route', () => {
    const known = new Set(APP_ROUTES.map((route) => route.path))
    for (const route of APP_ROUTES) {
      if (!route.parent) continue
      expect(known.has(route.parent), `${route.path} points at ${route.parent}, which is not a route`).toBe(
        true,
      )
    }
  })

  it('reaches a tab route from every page by following parents', () => {
    for (const route of APP_ROUTES) {
      let current = route
      for (let depth = 0; depth < 8 && current.level !== 'tab'; depth += 1) {
        const parent = APP_ROUTES.find((candidate) => candidate.path === current.parent)
        expect(parent, `${route.path}: the chain breaks at ${current.path}`).toBeDefined()
        current = parent!
      }
      expect(current.level, `${route.path} never reaches a tab`).toBe('tab')
    }
  })

  it('assigns every route to a section that exists', () => {
    const sections = new Set([...NAV_TABS.map((tab) => tab.id), 'settings'])
    for (const route of APP_ROUTES) expect(sections.has(route.section), route.path).toBe(true)
  })
})

describe('levelOf', () => {
  it.each([
    ['/home', 'tab'],
    ['/study/read', 'tab'],
    ['/study/read/ccs-conduct', 'detail'],
    ['/study/read/ccs-conduct/ccs-conduct-3', 'focus'],
    ['/study/practise/review', 'focus'],
    ['/draft/d/abc123', 'focus'],
    ['/draft/d/abc123/print', 'focus'],
    ['/settings/backup', 'detail'],
    ['/law', 'tab'],
  ] as const)('%s renders at level %s', (path, level) => {
    expect(levelOf(path)).toBe(level)
  })

  it('answers "tab" for an unregistered path rather than hiding the chrome', () => {
    // An unknown path is about to be redirected home; dropping the sidebar and
    // the tab bar on the way there would flash an empty screen.
    expect(levelOf('/no-such-place')).toBe('tab')
  })

  it('prefers the more specific pattern regardless of declaration order', () => {
    // `/study/read/search` is the search screen, not a work called "search".
    expect(routeFor('/study/read/search')?.path).toBe('/study/read/search')
    expect(routeFor('/study/read/bns')?.path).toBe('/study/read/:workId')
    expect(routeFor('/study/read/bns/quiz/n1')?.path).toBe('/study/read/:workId/quiz/:nodeId')
  })
})

describe('resolveParent', () => {
  it('substitutes the page’s own parameters into the parent pattern', () => {
    expect(resolveParent('/study/read/bns/103')).toBe('/study/read/bns')
    expect(resolveParent('/draft/d/abc/print')).toBe('/draft/d/abc')
  })

  it('returns null on a tab route, which has no parent inside the app', () => {
    expect(resolveParent('/study/read')).toBeNull()
    expect(resolveParent('/law')).toBeNull()
  })

  it('encodes a parameter rather than pasting it into a path', () => {
    expect(resolveParent('/study/read/my-a%2Fb/unit-1')).toBe('/study/read/my-a%2Fb')
  })
})

describe('tabFor and subTabFor', () => {
  it('puts a page deep inside a section on that section’s tab', () => {
    expect(tabFor('/study/read/bns/103')?.id).toBe('study')
    expect(subTabFor('/study/read/bns/103')?.id).toBe('read')
    expect(subTabFor('/study/practise/review')?.id).toBe('practise')
  })

  it('resolves the converter to the Law section even though its path IS the root', () => {
    expect(tabFor('/law')?.id).toBe('law')
    expect(subTabFor('/law')?.id).toBe('convert')
    expect(subTabFor('/law/saved')?.id).toBe('saved')
  })

  it('leaves Settings on no tab at all', () => {
    // Settings is the top-right menu, not a sixth tab: nothing in the bottom
    // bar should light up while a reader is in it.
    expect(tabFor(SETTINGS_PATH)).toBeNull()
    expect(tabFor('/settings/backup')).toBeNull()
  })
})

describe('the "go to" list the palette offers', () => {
  it('carries every tab and every sub-tab, plus Settings and its sections', () => {
    const paths = navDestinations().map((entry) => entry.path)
    for (const tab of NAV_TABS) {
      expect(paths).toContain(tab.path)
      if (tab.subTabs.length < 2) continue
      for (const subTab of tab.subTabs) expect(paths, subTab.id).toContain(subTab.path)
    }
    expect(paths).toContain(SETTINGS_PATH)
    for (const section of SETTINGS_SECTIONS) expect(paths).toContain(section.path)
  })

  it('names the section a sub-tab belongs to, because two sections have Bookmarks', () => {
    const saved = navDestinations().find((entry) => entry.path === '/law/saved')
    expect(saved?.parentLabel?.en).toBe('Law Converter')
  })
})

describe('the redirects', () => {
  it('never points at a path that is itself redirected', () => {
    // A redirect chain is two navigations and a flash of the wrong screen.
    const sources = new Set(LEGACY_REDIRECTS.map((redirect) => redirect.from))
    for (const redirect of LEGACY_REDIRECTS) {
      const target = redirect.to.split(/[?#]/)[0] ?? ''
      expect(sources.has(target), `${redirect.from} → ${redirect.to} lands on another redirect`).toBe(false)
    }
  })

  it('declares `/draft/:type` LAST, because it matches every one above it', () => {
    // React Router ranks a dynamic segment above a splat, so this pattern
    // claims `/draft/profile` and `/draft/import` unless it is last.
    expect(LEGACY_REDIRECTS.at(-1)?.from).toBe('/draft/:type')
  })

  it('keeps the query string, which is the whole point for a shared /pay link', () => {
    const pay = LEGACY_REDIRECTS.find((redirect) => redirect.from === '/pay')!
    expect(redirectTarget(pay, '/pay', '?job=ib-acio-ii-executive&city=delhi&da=60')).toBe(
      '/tools/salary?job=ib-acio-ii-executive&city=delhi&da=60',
    )
  })

  it('prefers the target’s own query where it has one', () => {
    // `/library/bookmarks` MEANS `?type=bookmark` — the merged screen narrowed
    // to what the old one showed.
    const bookmarks = LEGACY_REDIRECTS.find((redirect) => redirect.from === '/library/bookmarks')!
    expect(redirectTarget(bookmarks, '/library/bookmarks')).toBe('/study/notes?type=bookmark')
  })

  it('carries parameters through, encoded', () => {
    const unit = LEGACY_REDIRECTS.find((redirect) => redirect.from === '/library/:workId/:unitId')!
    expect(redirectTarget(unit, '/library/ccs-conduct/ccs-conduct-3')).toBe(
      '/study/read/ccs-conduct/ccs-conduct-3',
    )
  })

  it('carries a fragment, and lets the target’s own fragment win', () => {
    const plan = LEGACY_REDIRECTS.find((redirect) => redirect.from === '/learn/exam/plan')!
    expect(redirectTarget(plan, '/learn/exam/plan')).toBe('/study/exam#plan')
  })

  it('returns null when the pattern does not match, rather than a broken path', () => {
    const pay = LEGACY_REDIRECTS.find((redirect) => redirect.from === '/pay')!
    expect(redirectTarget(pay, '/tools/salary')).toBeNull()
  })
})

describe('HOME_PATH', () => {
  it('is the new landing route, not a module', () => {
    expect(HOME_PATH).toBe('/home')
    expect(NAV_TABS[0]?.path).toBe(HOME_PATH)
  })
})
