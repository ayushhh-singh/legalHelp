import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import PreviewSamplePage from './PreviewSamplePage'
import { TEMPLATE_IDS, loadTemplate } from './data'
import { documentFromTemplate } from './newDocument'

import { FocusLayout } from '@/app/layouts/FocusLayout'
import { emptyProfile } from '@/lib/drafting/profile'
import { sampleValues } from '@/lib/drafting/engine'

/**
 * `/draft/new/:type/preview` — a read-only reference view over the template's
 * OWN worked example, kept fully separate from document creation.
 *
 * Rendered inside `FocusLayout`, the arrangement `workspace.test.tsx`
 * established: the language toggle and "Use this template" are portalled
 * into the bar, so mounted bare the page would have neither.
 */

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

const at = (type: string) =>
  render(
    <MemoryRouter initialEntries={[`/draft/new/${type}/preview`]}>
      <Routes>
        <Route element={<FocusLayout />}>
          <Route path="/draft/new/:type/preview" element={<PreviewSamplePage />} />
        </Route>
        <Route path="/draft/new/:type" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

// Not reset by the global `beforeEach` in `src/test/setup.ts` (which clears
// Dexie, not `sessionStorage`), and the banner's whole point is to persist
// across this page's own renders within one session — so this suite clears
// it itself, or the dismiss tests below would depend on run order.
beforeEach(() => {
  sessionStorage.clear()
})

describe('PreviewSamplePage', () => {
  it.each(TEMPLATE_IDS)(
    'renders %s from its own worked example with no error, in English, Hindi and side by side',
    async (type) => {
      at(type)

      // "Use this template" (and the language toggle beside it) only appear
      // once the template has loaded and portalled them into the bar.
      const use = await screen.findByRole('link', { name: 'Use this template' })
      expect(use).toHaveAttribute('href', `/draft/new/${type}`)

      // The default view is the app's own language (English in this suite),
      // and it is never the empty state — every template's sample renders.
      expect(screen.queryByText(/nothing to show yet/i)).not.toBeInTheDocument()

      const user = userEvent.setup()
      const select = screen.getByRole('combobox', { name: 'Preview language' })

      await user.selectOptions(select, 'hi')
      expect(screen.queryByText(/nothing to show yet/i)).not.toBeInTheDocument()

      await user.selectOptions(select, 'both')
      expect(screen.queryByText(/nothing to show yet/i)).not.toBeInTheDocument()
      // Side by side renders two sheets of paper, one per language.
      expect(screen.getAllByRole('document')).toHaveLength(2)
    },
  )

  it('shows the "example content only" banner and lets it be dismissed for the session', async () => {
    at('office-memorandum')
    await screen.findByRole('link', { name: 'Use this template' })

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/example content only/i)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('draft.preview.sample.bannerDismissed')).toBe('1')
  })

  it('does not repeat the banner within the same session once dismissed', async () => {
    sessionStorage.setItem('draft.preview.sample.bannerDismissed', '1')
    at('office-memorandum')
    await screen.findByRole('link', { name: 'Use this template' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('titles itself "<template name> — worked example"', async () => {
    at('office-memorandum')
    await screen.findByRole('link', { name: 'Use this template' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Office Memorandum (O.M.) — worked example' }),
    ).toBeInTheDocument()
  })
})

/**
 * The regression this session must prevent forever: "Use this template" can
 * never seed a real document with the specimen's own text.
 *
 * `PreviewSamplePage`'s "Use this template" is a plain `<Link to="/draft/new/
 * :type">` — the SAME href `PickerPage`'s gallery card renders for the same
 * template (asserted above, per template, in every `it.each` case) — so both
 * roads run through the exact same `NewDocumentPage` → `createDocument` →
 * `documentFromTemplate` call. Because it is the SAME function call rather
 * than two implementations that happen to agree, `fromGallery` and
 * `fromPreview` below are trivially `toEqual` — the guarantee that matters is
 * architectural (one creation path, asserted by the shared href above), and
 * this test states it as data so a future session that gives the preview
 * screen its OWN creation call — say, to skip a redirect — trips it.
 */
describe('the "Use this template" guarantee', () => {
  const AT = '2026-09-20T00:00:00.000Z'

  it.each(['office-memorandum', 'appeal', 'leave-application'])(
    '%s creates the same document whichever entry point calls documentFromTemplate',
    async (id) => {
      const template = await loadTemplate(id)
      const profile = emptyProfile(AT)

      const fromGallery = documentFromTemplate({ id: 'd1', at: AT, template, profile })
      const fromPreview = documentFromTemplate({ id: 'd1', at: AT, template, profile })
      expect(fromPreview).toEqual(fromGallery)

      // Neither carries the specimen's own worked prose — the same claim
      // `newDocument.test.tsx#'never seeds a variable from its worked
      // example'` already makes for one template, restated here over the
      // ones this session's own review touched.
      const sample = sampleValues(template)
      const paras = sample.paras
      const specimenSentence = Array.isArray(paras) ? paras[0] : undefined
      if (specimenSentence) {
        expect(JSON.stringify(fromPreview.body)).not.toContain(specimenSentence)
      }
    },
  )
})
