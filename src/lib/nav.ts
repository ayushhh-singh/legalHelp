import {
  BookOpen,
  Bookmark,
  Calculator,
  CalendarDays,
  ClipboardList,
  FileSignature,
  FileStack,
  FilePlus2,
  GraduationCap,
  Home,
  Landmark,
  Languages,
  Link2,
  Mail,
  PiggyBank,
  Scale,
  Sparkles,
  Star,
  Target,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { matchPath } from 'react-router-dom'

import type { Language } from '@/i18n'

/**
 * THE nav config, as a TREE.
 *
 * One structure drives the desktop sidebar, the mobile bottom bar, the
 * sub-tab strip inside every section, the layout each route is rendered in,
 * the parent every detail and focus page goes back to, the command palette's
 * "Go to" list and the redirects from every path this app used to have. A
 * destination can therefore never appear in one of those and not another —
 * which is the same rule the flat array kept, extended to the two things the
 * flat array had no way to say: what is inside what, and what a page is a
 * child of.
 *
 * ### Why five tabs and no "More"
 *
 * The app had seven top-level destinations, four of which fitted the bottom
 * bar; the other three lived behind a "More" sheet, so a phone reader could
 * not see half the app without opening a menu that told them nothing about
 * where they were. Five tabs fit the bar at every width this app supports, so
 * the sheet is gone (ADR-046).
 *
 * ### Levels
 *
 * `tab` is a section's own content: chrome, one `<h1>` for the section, the
 * sub-tab strip, the page. `detail` is a page reached from a tab: chrome, a
 * breadcrumb trail (or a back chevron on a phone), the page's own `<h1>`.
 * `focus` is a page an officer is *inside* — the reader, a review session, the
 * document editor: no sidebar, no tab bar, no app top bar, and a `FocusBar`
 * whose left-hand control goes back to the parent named here.
 *
 * Labels live here as `{ en, hi }` objects rather than as translation keys,
 * matching the master context's rule for every data record. `Record<Language,
 * string>` makes a missing Hindi label a compile error, which is the same
 * guarantee `scripts/i18n-check.mjs` gives the JSON catalogues.
 */

export type PageLevel = 'tab' | 'detail' | 'focus'

/** Which count a sub-tab may carry, where a section chooses to supply one. */
export type BadgeKind = 'dueReviews' | 'followUps'

export interface SubTab {
  id: string
  path: string
  label: Record<Language, string>
  icon?: LucideIcon
  /**
   * The badge SLOT. `SegmentedTabs` renders a count beside the label when the
   * section hands it one; a sub-tab with no `badge` can never show a number.
   * Only the section's own (lazily loaded) router may supply the value — see
   * `TabLayout`'s `badges` prop — because a count computed in the app shell is
   * a count every reader pays for.
   */
  badge?: BadgeKind
}

export interface NavTab {
  id: string
  /** The section root. `/study`, `/draft`, … */
  path: string
  icon: LucideIcon
  /** Full name: the sidebar label and the accessible name everywhere. */
  label: Record<Language, string>
  /** Short form for the bottom tab bar, where width is scarce. */
  short: Record<Language, string>
  subTabs: readonly SubTab[]
  /** Which sub-tab a bare visit to `path` lands on. */
  defaultSubTab: string
}

/* ------------------------------------------------------------------ *
 * The five tabs
 * ------------------------------------------------------------------ */

const HOME_TAB: NavTab = {
  id: 'home',
  path: '/home',
  icon: Home,
  label: { en: 'Home', hi: 'मुख पृष्ठ' },
  short: { en: 'Home', hi: 'मुख' },
  // A section of one. Home has no sub-tabs and `TabLayout` renders no strip
  // for it, which is what keeps the "every tab has sub-tabs" shape honest
  // rather than inventing a second tab nobody would press.
  subTabs: [
    {
      id: 'home',
      path: '/home',
      label: { en: 'Home', hi: 'मुख पृष्ठ' },
      icon: Home,
    },
  ],
  defaultSubTab: 'home',
}

const STUDY_TAB: NavTab = {
  id: 'study',
  path: '/study',
  icon: GraduationCap,
  label: { en: 'Study', hi: 'अध्ययन' },
  short: { en: 'Study', hi: 'अध्ययन' },
  subTabs: [
    { id: 'read', path: '/study/read', label: { en: 'Read', hi: 'पढ़ें' }, icon: BookOpen },
    {
      id: 'practise',
      path: '/study/practise',
      label: { en: 'Practise', hi: 'अभ्यास' },
      icon: GraduationCap,
      badge: 'dueReviews',
    },
    { id: 'exam', path: '/study/exam', label: { en: 'Exam', hi: 'परीक्षा' }, icon: Target },
    { id: 'notes', path: '/study/notes', label: { en: 'My notes', hi: 'मेरे नोट्स' }, icon: Bookmark },
  ],
  defaultSubTab: 'read',
}

const DRAFT_TAB: NavTab = {
  id: 'draft',
  path: '/draft',
  icon: FileSignature,
  label: { en: 'Drafting Studio', hi: 'प्रारूपण कक्ष' },
  short: { en: 'Draft', hi: 'प्रारूप' },
  subTabs: [
    {
      id: 'documents',
      path: '/draft/documents',
      label: { en: 'Documents', hi: 'दस्तावेज़' },
      icon: FileStack,
    },
    { id: 'new', path: '/draft/new', label: { en: 'New', hi: 'नया' }, icon: FilePlus2 },
    { id: 'reply', path: '/draft/reply', label: { en: 'Reply', hi: 'उत्तर' }, icon: Mail },
    {
      id: 'register',
      path: '/draft/register',
      label: { en: 'Register', hi: 'रजिस्टर' },
      icon: ClipboardList,
      badge: 'followUps',
    },
    { id: 'templates', path: '/draft/templates', label: { en: 'Templates', hi: 'टेम्पलेट' }, icon: Star },
  ],
  defaultSubTab: 'documents',
}

const LAW_TAB: NavTab = {
  id: 'law',
  path: '/law',
  icon: Scale,
  label: { en: 'Law Converter', hi: 'विधि परिवर्तक' },
  short: { en: 'Law', hi: 'विधि' },
  subTabs: [
    // The converter's path IS the section root, deliberately. Its whole view
    // lives in the query string (ADR-013), so every `/law?q=302` link ever
    // shared — and `toLawHref`'s default — stays canonical rather than
    // becoming a redirect.
    { id: 'convert', path: '/law', label: { en: 'Convert', hi: 'परिवर्तन' }, icon: Scale },
    {
      id: 'whats-new',
      path: '/law/whats-new',
      label: { en: "What's new", hi: 'क्या नया है' },
      icon: Sparkles,
    },
    { id: 'saved', path: '/law/saved', label: { en: 'Saved', hi: 'सहेजे गए' }, icon: Bookmark },
  ],
  defaultSubTab: 'convert',
}

const TOOLS_TAB: NavTab = {
  id: 'tools',
  path: '/tools',
  icon: Wrench,
  label: { en: 'Tools', hi: 'साधन' },
  short: { en: 'Tools', hi: 'साधन' },
  subTabs: [
    { id: 'salary', path: '/tools/salary', label: { en: 'Salary', hi: 'वेतन' }, icon: Calculator },
    { id: 'leave', path: '/tools/leave', label: { en: 'Leave', hi: 'अवकाश' }, icon: PiggyBank },
    { id: 'pension', path: '/tools/pension', label: { en: 'Pension', hi: 'पेंशन' }, icon: Landmark },
    {
      id: 'holidays',
      path: '/tools/holidays',
      label: { en: 'Holidays', hi: 'छुट्टियाँ' },
      icon: CalendarDays,
    },
    { id: 'glossary', path: '/tools/glossary', label: { en: 'Glossary', hi: 'शब्दावली' }, icon: Languages },
    { id: 'portals', path: '/tools/portals', label: { en: 'Portals', hi: 'पोर्टल' }, icon: Link2 },
  ],
  defaultSubTab: 'salary',
}

export const NAV_TABS: readonly NavTab[] = [HOME_TAB, STUDY_TAB, DRAFT_TAB, LAW_TAB, TOOLS_TAB] as const

/** Landing route. Everything else is one tap from it. */
export const HOME_PATH = '/home'

/** Settings is not a tab — it is the top-right menu and its own section tree. */
export const SETTINGS_PATH = '/settings'

export interface SettingsSection {
  id: string
  path: string
  label: Record<Language, string>
  icon?: LucideIcon
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'profile',
    path: '/settings/profile',
    label: { en: 'Profile & letterhead', hi: 'प्रोफ़ाइल एवं लेटरहेड' },
  },
  { id: 'address-book', path: '/settings/address-book', label: { en: 'Address book', hi: 'पता पुस्तिका' } },
  { id: 'numbering', path: '/settings/numbering', label: { en: 'Numbering', hi: 'क्रमांकन' } },
  { id: 'trainer', path: '/settings/trainer', label: { en: 'Trainer', hi: 'नियम अभ्यास' } },
  { id: 'ai', path: '/settings/ai', label: { en: 'AI', hi: 'एआई' } },
  { id: 'data', path: '/settings/data', label: { en: 'Data & updates', hi: 'डेटा एवं अद्यतन' } },
  { id: 'backup', path: '/settings/backup', label: { en: 'Backup', hi: 'बैकअप' } },
  { id: 'about', path: '/settings/about', label: { en: 'About', hi: 'ऐप के बारे में' } },
] as const

/* ------------------------------------------------------------------ *
 * Every route, its level and its parent
 * ------------------------------------------------------------------ */

export interface AppRoute {
  /** The route pattern, absolute, React-Router style (`:id` parameters). */
  path: string
  level: PageLevel
  /** The tab this route belongs to, or `'settings'`. */
  section: string
  /**
   * Where "back" goes. REQUIRED on every `detail` and `focus` route — a page an
   * officer is inside has to know what it is inside of, and a page that does
   * not is a page whose back chevron guesses. `nav.test.ts` asserts it.
   */
  parent?: string
}

/**
 * Ordered most specific first ONLY for readability; `routeFor` scores matches
 * so declaration order does not decide which pattern wins.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  { path: '/home', level: 'tab', section: 'home' },

  // Study — Read
  { path: '/study/read', level: 'tab', section: 'study' },
  { path: '/study/read/search', level: 'detail', section: 'study', parent: '/study/read' },
  { path: '/study/read/add', level: 'detail', section: 'study', parent: '/study/read' },
  { path: '/study/read/:workId', level: 'detail', section: 'study', parent: '/study/read' },
  {
    path: '/study/read/:workId/quiz/:nodeId',
    level: 'focus',
    section: 'study',
    parent: '/study/read/:workId',
  },
  {
    path: '/study/read/:workId/sheet/:nodeId',
    level: 'detail',
    section: 'study',
    parent: '/study/read/:workId',
  },
  { path: '/study/read/:workId/:unitId', level: 'focus', section: 'study', parent: '/study/read/:workId' },
  { path: '/study/progress', level: 'detail', section: 'study', parent: '/study/read' },

  // Study — Practise
  { path: '/study/practise', level: 'tab', section: 'study' },
  { path: '/study/practise/review', level: 'focus', section: 'study', parent: '/study/practise' },
  { path: '/study/practise/mock', level: 'focus', section: 'study', parent: '/study/practise' },
  { path: '/study/practise/browse', level: 'detail', section: 'study', parent: '/study/practise' },
  { path: '/study/practise/bookmarks', level: 'detail', section: 'study', parent: '/study/practise' },
  { path: '/study/practise/reports', level: 'detail', section: 'study', parent: '/study/practise' },
  { path: '/study/practise/review-queue', level: 'detail', section: 'study', parent: '/study/practise' },

  // Study — Exam and My notes
  { path: '/study/exam', level: 'tab', section: 'study' },
  { path: '/study/exam/mock', level: 'focus', section: 'study', parent: '/study/exam' },
  { path: '/study/notes', level: 'tab', section: 'study' },
  { path: '/study/notes/compare', level: 'detail', section: 'study', parent: '/study/notes' },

  // Draft
  { path: '/draft/documents', level: 'tab', section: 'draft' },
  { path: '/draft/documents/import', level: 'detail', section: 'draft', parent: '/draft/documents' },
  { path: '/draft/new', level: 'tab', section: 'draft' },
  { path: '/draft/new/:type', level: 'detail', section: 'draft', parent: '/draft/new' },
  { path: '/draft/d/:id', level: 'focus', section: 'draft', parent: '/draft/documents' },
  { path: '/draft/d/:id/print', level: 'focus', section: 'draft', parent: '/draft/d/:id' },
  { path: '/draft/reply', level: 'tab', section: 'draft' },
  { path: '/draft/reply/:id', level: 'focus', section: 'draft', parent: '/draft/reply' },
  { path: '/draft/register', level: 'tab', section: 'draft' },
  { path: '/draft/templates', level: 'tab', section: 'draft' },

  // Law
  { path: '/law', level: 'tab', section: 'law' },
  { path: '/law/whats-new', level: 'tab', section: 'law' },
  { path: '/law/saved', level: 'tab', section: 'law' },

  // Tools
  { path: '/tools/salary', level: 'tab', section: 'tools' },
  { path: '/tools/leave', level: 'tab', section: 'tools' },
  { path: '/tools/pension', level: 'tab', section: 'tools' },
  { path: '/tools/holidays', level: 'tab', section: 'tools' },
  { path: '/tools/glossary', level: 'tab', section: 'tools' },
  { path: '/tools/portals', level: 'tab', section: 'tools' },

  // Settings
  { path: '/settings', level: 'detail', section: 'settings', parent: HOME_PATH },
  ...SETTINGS_SECTIONS.map((section): AppRoute => ({
    path: section.path,
    level: 'detail',
    section: 'settings',
    parent: SETTINGS_PATH,
  })),

  /*
    Onboarding is `focus` because it is the one screen in this app that must
    not offer navigation: a reader halfway through choosing their language and
    post has nowhere useful to go, and a tab bar under a three-step flow is an
    invitation to leave it half-done. It is the only focus route rendered
    without a `FocusBar` — `App.tsx` renders it directly — so its `parent` is
    what the flow's own "Skip setup" already goes to rather than a chevron.
  */
  { path: '/onboarding', level: 'focus', section: 'home', parent: HOME_PATH },
] as const

/** How specific a pattern is: static segments beat dynamic ones. */
function specificity(pattern: string): number {
  const segments = pattern.split('/').filter(Boolean)
  return segments.length * 10 + segments.filter((segment) => !segment.startsWith(':')).length
}

/**
 * The registered route a pathname is on, or `null`.
 *
 * Scored rather than first-match, so `/study/read/search` resolves to the
 * search screen and not to a work called "search" whatever order the array
 * happens to be in — the same ranking React Router itself applies, restated
 * here because this function answers for the app shell, which has no router
 * match to read.
 */
export function routeFor(pathname: string): AppRoute | null {
  let best: AppRoute | null = null
  let bestScore = -1
  for (const route of APP_ROUTES) {
    if (!matchPath({ path: route.path, end: true }, pathname)) continue
    const score = specificity(route.path)
    if (score > bestScore) {
      best = route
      bestScore = score
    }
  }
  return best
}

/**
 * The level a pathname renders at.
 *
 * `tab` for anything unregistered: an unknown path is about to be redirected
 * home, and hiding the chrome on the way there would flash an empty screen.
 */
export function levelOf(pathname: string): PageLevel {
  return routeFor(pathname)?.level ?? 'tab'
}

/** The tab a pathname belongs to, for the sidebar's and tab bar's active state. */
export function tabFor(pathname: string): NavTab | null {
  const section = routeFor(pathname)?.section
  return NAV_TABS.find((tab) => tab.id === section) ?? null
}

/** The sub-tab within a section a pathname belongs to. */
export function subTabFor(pathname: string): SubTab | null {
  const tab = tabFor(pathname)
  if (!tab) return null
  let best: SubTab | null = null
  let bestLength = -1
  for (const subTab of tab.subTabs) {
    const on = pathname === subTab.path || pathname.startsWith(`${subTab.path}/`)
    if (on && subTab.path.length > bestLength) {
      best = subTab
      bestLength = subTab.path.length
    }
  }
  return best
}

/** The sub-tab a bare section root lands on. */
export function defaultSubTabOf(tab: NavTab): SubTab {
  const found = tab.subTabs.find((subTab) => subTab.id === tab.defaultSubTab)
  // The type cannot express "one of these ids"; the test asserts it, and a
  // section whose default went missing should still render its first tab
  // rather than a blank page.
  return found ?? (tab.subTabs[0] as SubTab)
}

/**
 * Substitute a matched path's parameters into a parent PATTERN.
 *
 * `/study/read/:workId/:unitId` on `/study/read/bns/103` gives a parent of
 * `/study/read/bns`. A parameter the child does not carry leaves the segment
 * as-is, which is a visibly broken link rather than a silently wrong one.
 */
export function resolveParent(pathname: string): string | null {
  const route = routeFor(pathname)
  if (!route?.parent) return null
  const match = matchPath({ path: route.path, end: true }, pathname)
  const params = match?.params ?? {}
  return route.parent
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const value = params[segment.slice(1)]
      return value === undefined ? segment : encodeURIComponent(value)
    })
    .join('/')
}

/* ------------------------------------------------------------------ *
 * Every path this app used to have
 * ------------------------------------------------------------------ */

/**
 * Old path → new path, as React-Router patterns.
 *
 * `App.tsx` turns each of these into a `<Route>` rendering `<Navigate replace>`,
 * so a bookmark, a shared link, an `.ics` file's URL or a printed QR code from
 * before ADR-046 still lands where it meant to — with its query string and its
 * parameters intact. `tests/redirects.test.ts` visits every row.
 *
 * A redirect is kept for ever, not for a release: the whole point of a stable
 * URL is that nobody has to know when it changed.
 */
export interface Redirect {
  from: string
  to: string
}

export const LEGACY_REDIRECTS: readonly Redirect[] = [
  // The Rules Trainer became Study → Practise.
  { from: '/learn', to: '/study/practise' },
  { from: '/learn/review', to: '/study/practise/review' },
  { from: '/learn/mock', to: '/study/practise/mock' },
  { from: '/learn/browse', to: '/study/practise/browse' },
  { from: '/learn/bookmarks', to: '/study/practise/bookmarks' },
  { from: '/learn/reports', to: '/study/practise/reports' },
  { from: '/learn/review-queue', to: '/study/practise/review-queue' },
  { from: '/learn/settings', to: '/settings/trainer' },
  { from: '/learn/exam', to: '/study/exam' },
  // The plan and the checklist are sections of the exam page now, not screens.
  { from: '/learn/exam/plan', to: '/study/exam#plan' },
  { from: '/learn/exam/checklist', to: '/study/exam#checklist' },
  { from: '/learn/exam/mock', to: '/study/exam/mock' },

  // The Library became Study → Read; its annotations became Study → My notes.
  { from: '/library', to: '/study/read' },
  { from: '/library/mine', to: '/study/notes' },
  { from: '/library/bookmarks', to: '/study/notes?type=bookmark' },
  { from: '/library/compare', to: '/study/notes/compare' },
  { from: '/library/search', to: '/study/read/search' },
  { from: '/library/add', to: '/study/read/add' },
  { from: '/library/study', to: '/study/progress' },
  { from: '/library/:workId/quiz/:nodeId', to: '/study/read/:workId/quiz/:nodeId' },
  { from: '/library/:workId/sheet/:nodeId', to: '/study/read/:workId/sheet/:nodeId' },
  { from: '/library/:workId/:unitId', to: '/study/read/:workId/:unitId' },
  { from: '/library/:workId', to: '/study/read/:workId' },

  // Utilities became Tools; the Pay calculator became one of its sub-tabs.
  { from: '/pay', to: '/tools/salary' },
  { from: '/utils', to: '/tools/salary' },
  { from: '/utils/glossary', to: '/tools/glossary' },
  { from: '/utils/holidays', to: '/tools/holidays' },
  { from: '/utils/leave', to: '/tools/leave' },
  { from: '/utils/pension', to: '/tools/pension' },
  { from: '/utils/portals', to: '/tools/portals' },

  // The Drafting Studio kept its root and rearranged underneath it.
  { from: '/draft', to: '/draft/documents' },
  { from: '/draft/import', to: '/draft/documents/import' },
  { from: '/draft/my-templates', to: '/draft/templates' },
  { from: '/draft/profile', to: '/settings/profile' },
  { from: '/draft/address-book', to: '/settings/address-book' },
  { from: '/draft/numbering', to: '/settings/numbering' },
  /*
    The Session 8 form-and-preview editor is gone (ADR-046 §7). Its route was
    `/draft/<type>`, and the honest answer to one of those links is the thing
    the link was for: create a document of that type and open it in the editor
    that replaced it. `/draft/new/:type` is exactly that flow, so the redirect
    is a redirect rather than a deleted page.

    LAST in this list, and last in the router, because `:type` matches every
    single-segment path under `/draft` — including the five above it.
  */
  { from: '/draft/:type', to: '/draft/new/:type' },
] as const

/**
 * Fill a redirect's target from the source's own matched parameters, keeping
 * the query string and the fragment.
 */
export function redirectTarget(redirect: Redirect, pathname: string, search = '', hash = ''): string | null {
  const match = matchPath({ path: redirect.from, end: true }, pathname)
  if (!match) return null
  const [withoutHash = '', ownHash = ''] = redirect.to.split('#')
  const [pathPart = '', ownSearch = ''] = withoutHash.split('?')
  const filled = pathPart
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const value = match.params[segment.slice(1)]
      return value === undefined ? segment : encodeURIComponent(value)
    })
    .join('/')

  // The target's own query wins where it has one — `/library/bookmarks` means
  // `?type=bookmark` and nothing else — otherwise the caller's is carried.
  const query = ownSearch ? `?${ownSearch}` : search
  const fragment = ownHash ? `#${ownHash}` : hash
  return `${filled}${query}${fragment}`
}

/** Every "go to" destination the palette offers: the tabs and their sub-tabs. */
export function navDestinations(): ReadonlyArray<{
  id: string
  path: string
  label: Record<Language, string>
  /** The section label, where this destination is a sub-tab of one. */
  parentLabel?: Record<Language, string>
}> {
  const out: Array<{
    id: string
    path: string
    label: Record<Language, string>
    parentLabel?: Record<Language, string>
  }> = []
  for (const tab of NAV_TABS) {
    out.push({ id: `tab:${tab.id}`, path: tab.path, label: tab.label })
    if (tab.subTabs.length < 2) continue
    for (const subTab of tab.subTabs) {
      out.push({
        id: `tab:${tab.id}:${subTab.id}`,
        path: subTab.path,
        label: subTab.label,
        parentLabel: tab.label,
      })
    }
  }
  out.push({ id: 'tab:settings', path: SETTINGS_PATH, label: { en: 'Settings', hi: 'सेटिंग्स' } })
  for (const section of SETTINGS_SECTIONS) {
    out.push({
      id: `tab:settings:${section.id}`,
      path: section.path,
      label: section.label,
      parentLabel: { en: 'Settings', hi: 'सेटिंग्स' },
    })
  }
  return out
}

/**
 * The redirects a section's own router must mount, because the section still
 * owns the prefix.
 *
 * `/draft/:type` cannot live in the app router: React Router ranks a dynamic
 * segment above a splat, so `/draft/:type` mounted beside `/draft/*` would
 * claim `/draft/documents` and send an officer's document list to a template
 * called "documents". Inside the section's own router it is simply the last
 * route, after every real one, which is where it was before and where it
 * belongs.
 */
export const redirectsUnder = (prefix: string): readonly Redirect[] =>
  LEGACY_REDIRECTS.filter((redirect) => redirect.from === prefix || redirect.from.startsWith(`${prefix}/`))

/** Everything else, mounted by the app router. */
export const APP_LEVEL_REDIRECTS: readonly Redirect[] = LEGACY_REDIRECTS.filter(
  (redirect) => !(redirect.from === '/draft' || redirect.from.startsWith('/draft/')),
)
