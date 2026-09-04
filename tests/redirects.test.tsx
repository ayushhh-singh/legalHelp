import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { LegacyRedirect } from '@/app/LegacyRedirect'
import { APP_LEVEL_REDIRECTS, LEGACY_REDIRECTS, redirectsUnder } from '@/lib/nav'

/**
 * Every URL this app used to have, visited, with the location it lands on
 * asserted.
 *
 * The table below is written out BY HAND rather than derived from
 * `LEGACY_REDIRECTS`. A test that reads the same array the code reads asserts
 * that the array equals itself; what is worth checking is that each row goes
 * where a reader following a two-year-old bookmark MEANT to go, and that is a
 * judgement a person makes once and writes down.
 *
 * It renders the redirect routes exactly as `App.tsx` and `DraftPage.tsx` mount
 * them — the Drafting Studio's own live under its router, because `/draft/:type`
 * would otherwise claim `/draft/documents` (React Router ranks a dynamic
 * segment above a splat). Getting that wrong is the one mistake here that would
 * send an officer's document list to a template called "documents", so the
 * harness reproduces the mounting rather than the intention.
 */

/** old → new. Every row is a promise to somebody's bookmark. */
const TABLE: ReadonlyArray<[string, string]> = [
  // The Rules Trainer became Study → Practise.
  ['/learn', '/study/practise'],
  ['/learn/review', '/study/practise/review'],
  ['/learn/review?act=ccs-conduct', '/study/practise/review?act=ccs-conduct'],
  ['/learn/mock', '/study/practise/mock'],
  ['/learn/browse', '/study/practise/browse'],
  ['/learn/bookmarks', '/study/practise/bookmarks'],
  ['/learn/reports', '/study/practise/reports'],
  ['/learn/review-queue', '/study/practise/review-queue'],
  ['/learn/settings', '/settings/trainer'],
  ['/learn/exam', '/study/exam'],
  ['/learn/exam/plan', '/study/exam#plan'],
  ['/learn/exam/checklist', '/study/exam#checklist'],
  ['/learn/exam/mock', '/study/exam/mock'],

  // The Library became Study → Read; its annotations became Study → My notes.
  ['/library', '/study/read'],
  ['/library/mine', '/study/notes'],
  ['/library/bookmarks', '/study/notes?type=bookmark'],
  ['/library/compare', '/study/notes/compare'],
  ['/library/compare?a=bns:103&b=ipc:302', '/study/notes/compare?a=bns:103&b=ipc:302'],
  ['/library/search', '/study/read/search'],
  ['/library/search?q=suspension', '/study/read/search?q=suspension'],
  ['/library/add', '/study/read/add'],
  ['/library/study', '/study/progress'],
  ['/library/ccs-conduct', '/study/read/ccs-conduct'],
  ['/library/ccs-conduct/ccs-conduct-3', '/study/read/ccs-conduct/ccs-conduct-3'],
  ['/library/ccs-conduct/quiz/group-n-ccs-conduct-1', '/study/read/ccs-conduct/quiz/group-n-ccs-conduct-1'],
  [
    '/library/ccs-conduct/sheet/group-n-ccs-conduct-1?mode=24h',
    '/study/read/ccs-conduct/sheet/group-n-ccs-conduct-1?mode=24h',
  ],

  // Utilities became Tools; the Pay calculator became one of its sub-tabs.
  ['/pay', '/tools/salary'],
  [
    '/pay?job=ib-acio-ii-executive&city=delhi&da=60',
    '/tools/salary?job=ib-acio-ii-executive&city=delhi&da=60',
  ],
  ['/utils', '/tools/salary'],
  ['/utils/glossary', '/tools/glossary'],
  ['/utils/glossary?term=under-secretary', '/tools/glossary?term=under-secretary'],
  ['/utils/holidays', '/tools/holidays'],
  ['/utils/leave', '/tools/leave'],
  ['/utils/pension', '/tools/pension'],
  ['/utils/portals', '/tools/portals'],

  // The Drafting Studio kept its root and rearranged underneath it.
  ['/draft', '/draft/documents'],
  ['/draft/import', '/draft/documents/import'],
  ['/draft/my-templates', '/draft/templates'],
  ['/draft/profile', '/settings/profile'],
  ['/draft/address-book', '/settings/address-book'],
  ['/draft/numbering', '/settings/numbering'],
  // The Session 8 editor is gone. Its links create a document of that type and
  // open it in the editor that replaced it — which is what the link was for.
  ['/draft/office-memorandum', '/draft/new/office-memorandum'],
  ['/draft/letter?d=abc123', '/draft/new/letter?d=abc123'],
]

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</p>
}

/** The app's redirect mounting, reproduced. */
function Harness({ at }: { at: string }) {
  return (
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        {/* The five live sections, as bare markers: what matters here is which
            location the reader ends on, not what renders there. */}
        <Route path="/home/*" element={<Where />} />
        <Route path="/study/*" element={<Where />} />
        <Route path="/law/*" element={<Where />} />
        <Route path="/tools/*" element={<Where />} />
        <Route path="/settings/*" element={<Where />} />
        <Route path="/draft/*" element={<DraftRoutes />} />

        {APP_LEVEL_REDIRECTS.map((redirect) => (
          <Route key={redirect.from} path={redirect.from} element={<LegacyRedirect redirect={redirect} />} />
        ))}
      </Routes>
    </MemoryRouter>
  )
}

const DRAFT_LEGACY = redirectsUnder('/draft').filter((redirect) => redirect.from !== '/draft')

function DraftRoutes() {
  return (
    <Routes>
      {/* The section root lands on its default sub-tab, exactly as
          `DraftPage` does it — an index route, not a `LEGACY_REDIRECTS` row,
          because a section's default is part of the tree rather than a path
          this app used to have. */}
      <Route index element={<Navigate to="/draft/documents" replace />} />
      <Route path="documents" element={<Where />} />
      <Route path="documents/import" element={<Where />} />
      <Route path="new" element={<Where />} />
      <Route path="new/:type" element={<Where />} />
      <Route path="templates" element={<Where />} />
      <Route path="reply" element={<Where />} />
      <Route path="register" element={<Where />} />
      {DRAFT_LEGACY.map((redirect) => (
        <Route
          key={redirect.from}
          path={redirect.from.slice('/draft/'.length)}
          element={<LegacyRedirect redirect={redirect} />}
        />
      ))}
    </Routes>
  )
}

describe('every URL this app used to have', () => {
  it.each(TABLE)('%s lands on %s', (from: string, to: string) => {
    render(<Harness at={from} />)
    expect(screen.getByTestId('where')).toHaveTextContent(to, { normalizeWhitespace: false })
  })

  it('covers every row of LEGACY_REDIRECTS', () => {
    // The table above is hand-written, which is the point — and a hand-written
    // table is one somebody forgets to add to. `/draft` appears twice in the
    // table (as a source and inside `/draft/...` sources), so compare on the
    // patterns rather than on the visited paths.
    const covered = new Set<string>()
    for (const [from] of TABLE) {
      const path = from.split('?')[0] ?? ''
      for (const redirect of LEGACY_REDIRECTS) {
        const pattern = redirect.from.split('/').filter(Boolean)
        const segments = path.split('/').filter(Boolean)
        if (pattern.length !== segments.length) continue
        if (pattern.every((part, at) => part.startsWith(':') || part === segments[at])) {
          covered.add(redirect.from)
          break
        }
      }
    }
    const missing = LEGACY_REDIRECTS.filter((redirect) => !covered.has(redirect.from)).map(
      (redirect) => redirect.from,
    )
    expect(missing).toEqual([])
  })
})
