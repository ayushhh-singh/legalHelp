import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { documentsFor } from './exportDoc'
import { useObjectUrl } from './useObjectUrl'
import type { DocumentModel } from '@/lib/drafting/types'

/**
 * The edge-case pass over Session 30's module layer.
 *
 * Every test here was confirmed to FAIL against the committed code before its
 * fix was written. The two that matter most are both the same shape, and it is
 * the shape this project keeps finding: **a control that is on screen, is
 * labelled, is wired to state, and cannot reach the thing it names.** The
 * export panel's language selector chose between two identical files, and the
 * print route's paper selector rewrote a stylesheet nothing applied.
 */

const model = (id: string): DocumentModel => ({
  templateId: id,
  lang: 'en',
  urgency: null,
  header: [],
  title: null,
  refLine: null,
  subject: null,
  paras: [],
  closing: null,
  signature: [],
  enclosures: [],
  copyTo: [],
  blocks: [],
})

describe('which document each export view actually exports', () => {
  /*
    `DocEditorPage` renders `single` in the APP language and `bilingual` in both.
    So asking `documentsFor` for `hi` while the app is in English handed back
    the ENGLISH render — the selector changed a `<select>` and produced the same
    file either way, with a file name claiming otherwise.

    The bilingual result is authoritative when it is there, because it holds a
    real render of each language; `single` is the fallback for a caller that has
    only one.
  */
  const single = model('SINGLE-RENDERED-IN-THE-APP-LANGUAGE')
  const bilingual = { en: model('EN'), hi: model('HI') }

  it('takes the English render for the English view', () => {
    expect(documentsFor('en', single, bilingual).map((d) => d.templateId)).toEqual(['EN'])
  })

  it('takes the Hindi render for the Hindi view', () => {
    expect(documentsFor('hi', single, bilingual).map((d) => d.templateId)).toEqual(['HI'])
  })

  it('takes both, in layout order, for the side-by-side view', () => {
    expect(documentsFor('both', single, bilingual).map((d) => d.templateId)).toEqual(['EN', 'HI'])
  })

  it('falls back to the one render a caller has when there is no bilingual pair', () => {
    expect(documentsFor('en', single, null).map((d) => d.templateId)).toEqual([
      'SINGLE-RENDERED-IN-THE-APP-LANGUAGE',
    ])
    expect(documentsFor('both', single, null)).toEqual([])
  })
})

describe('useObjectUrl', () => {
  function Preview({ blob }: { blob: Blob | null }) {
    return <img alt="letterhead" ref={useObjectUrl(blob)} />
  }

  const spies = () => {
    const revoked: string[] = []
    let made = 0
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:u${(made += 1)}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url)
    })
    return { revoked, create, revoke, made: () => made }
  }

  it('never leaves a revoked URL on the element — the StrictMode defect', () => {
    /*
      Confirmed against the committed code first, and it is the worst of this
      pass because NO browser run in this project could have found it.

      The first version created the URL during render and revoked it in the
      effect's cleanup. StrictMode mounts, runs the effect, DESTROYS it and runs
      it again — so the destroy revoked the URL while it was still in state and
      still on screen, and the recreated effect had nothing to do. The measured
      result was `created: 1, src: "blob:u1", revoked: ["blob:u1"]`: a broken
      image in every `pnpm dev` session, and invisible to `pnpm test:e2e`
      because that runs a production build where StrictMode is inert.
    */
    const { revoked, create, revoke } = spies()
    try {
      render(
        <StrictMode>
          <Preview blob={new Blob(['x'], { type: 'image/png' })} />
        </StrictMode>,
      )
      const src = screen.getByAltText('letterhead').getAttribute('src')
      expect(src).toMatch(/^blob:/)
      expect(revoked, 'the URL on the element has been revoked').not.toContain(src)
    } finally {
      create.mockRestore()
      revoke.mockRestore()
    }
  })

  it('revokes the old URL when a new blob replaces it, and clears the attribute with it', async () => {
    const { revoked, create, revoke } = spies()
    try {
      const { rerender } = render(<Preview blob={new Blob(['a'], { type: 'image/png' })} />)
      const first = screen.getByAltText('letterhead').getAttribute('src')
      expect(revoked).not.toContain(first)

      rerender(<Preview blob={new Blob(['b'], { type: 'image/png' })} />)
      await waitFor(() => expect(revoked).toContain(first))
      const second = screen.getByAltText('letterhead').getAttribute('src')
      expect(second).not.toBe(first)
      expect(revoked).not.toContain(second)
    } finally {
      create.mockRestore()
      revoke.mockRestore()
    }
  })

  it('puts no src on the element at all when there is no blob', () => {
    const { create } = spies()
    try {
      render(<Preview blob={null} />)
      expect(screen.getByAltText('letterhead')).not.toHaveAttribute('src')
      expect(create).not.toHaveBeenCalled()
    } finally {
      create.mockRestore()
    }
  })

  it('takes the src back off when the blob goes away, rather than pointing at a dead URL', async () => {
    const { revoked, create, revoke } = spies()
    try {
      const { rerender } = render(<Preview blob={new Blob(['a'], { type: 'image/png' })} />)
      const src = screen.getByAltText('letterhead').getAttribute('src')
      rerender(<Preview blob={null} />)
      await waitFor(() => expect(revoked).toContain(src))
      expect(screen.getByAltText('letterhead')).not.toHaveAttribute('src')
    } finally {
      create.mockRestore()
      revoke.mockRestore()
    }
  })
})

describe('sharing a batch', () => {
  it('falls back to a download when the share is refused for anything but a cancellation', async () => {
    /*
      `navigator.share` requires TRANSIENT ACTIVATION — the user gesture that
      started the call. The batch builds its archive first, and every `await`
      on the way there spends that activation, so a real browser rejects the
      share with `NotAllowedError` on a press that looks perfectly ordinary.

      The first version caught every rejection and did nothing with it, on the
      grounds that "a cancelled share is not a failure". A cancellation is
      `AbortError`; everything else means the officer pressed Share and got
      no file, no message and no error. The two are told apart now and anything
      that is not a cancellation falls back to the download.
    */
    const { shareFallbackNeeded } = await import('./exportDoc')
    expect(shareFallbackNeeded(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
    expect(shareFallbackNeeded(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe(true)
    expect(shareFallbackNeeded(new TypeError('files are not supported'))).toBe(true)
    expect(shareFallbackNeeded(undefined)).toBe(true)
  })
})

describe('the export panel says what it cannot embed', () => {
  it('names an SVG letterhead as one Word will not carry', async () => {
    /*
      `embeddableInDocx` returns false for an SVG and `docxLetterhead` therefore
      returns null, so the Word file is written with no letterhead on it. The
      profile card says so — on a different screen, which an officer exporting a
      document need never have visited. ADR-042 §6 claims "nothing silently
      produces a Word file with no letterhead"; this is the function that makes
      the claim true where the export actually happens.
    */
    const { letterheadWarning } = await import('./exportDoc')
    expect(letterheadWarning({ type: 'image/svg+xml' }, true)).toBe('svg')
    expect(letterheadWarning({ type: 'image/png' }, true)).toBeNull()
    // Turned off, or absent, there is nothing to warn about.
    expect(letterheadWarning({ type: 'image/svg+xml' }, false)).toBeNull()
    expect(letterheadWarning(null, true)).toBeNull()
  })
})

/** Kept so the router import is used — every test above renders bare. */
export const routerIsAvailable = MemoryRouter
export const typingIsAvailable = userEvent

describe('the date at the head of an exported page', () => {
  it('is formatted, not the raw stored value', async () => {
    /*
      Found by Session 31's warning that a register holding dates from two
      sources sorts wrong — the same hazard one step along, and it was here.

      A document created by the IMPORTER stores `2026-09-03`, because that is
      what a date input needs; one typed in the Session 8 editor stores
      `03.09.2026`, because that is what CSMOP prints. The engine formats
      whatever it is given, so the body of the document reads `, the 03.09.2026`
      — and the number/date table this session adds at the head of the page
      passed `meta.date` through untouched, so the SAME page carried
      `2026-09-03` above `03.09.2026`. An ISO storage date is not a form any
      CSMOP specimen uses, and it reached a signed document.

      `formatDate` is the engine's own function, so the two cannot disagree
      again.
    */
    const { buildDocxOptions, defaultExportSettings } = await import('./exportDoc')
    const { emptyMeta, newDoc } = await import('@/lib/drafting/model')
    const labels = { pageOf: 'of', columnEn: 'English', columnHi: 'हिंदी' }
    const doc = (date: string) =>
      newDoc({
        id: 'x',
        templateId: 'office-memorandum',
        lang: 'en',
        at: '2026-09-03T10:00:00.000Z',
        meta: { ...emptyMeta(), number: 'A-11011/2/2026-Estt.', date },
      })
    const dateIn = (stored: string, lang: 'en' | 'hi' = 'en', devanagariDigits = false) =>
      buildDocxOptions({
        doc: doc(stored),
        lang,
        settings: defaultExportSettings(),
        letterhead: null,
        labels,
        devanagariDigits,
      }).numberDate?.date

    // Both storage forms print the one form CSMOP's specimens use.
    expect(dateIn('2026-09-03')).toBe('03.09.2026')
    expect(dateIn('03.09.2026')).toBe('03.09.2026')

    // And it follows the app-wide Devanagari-digits setting exactly as
    // `formatDate` does everywhere else — which means the HINDI issue only.
    // An office that files its own O.M. numbers in ASCII wants the English
    // issue's date to match them, so the setting is not a global substitution
    // (`src/lib/drafting/format.ts`).
    expect(dateIn('2026-09-03', 'hi', true)).toBe('०३.०९.२०२६')
    expect(dateIn('2026-09-03', 'en', true)).toBe('03.09.2026')
  })

  it('leaves a date it cannot parse exactly as the officer typed it', async () => {
    const { buildDocxOptions, defaultExportSettings } = await import('./exportDoc')
    const { emptyMeta, newDoc } = await import('@/lib/drafting/model')
    const options = buildDocxOptions({
      doc: newDoc({
        id: 'x',
        templateId: 'office-memorandum',
        lang: 'en',
        at: '2026-09-03T10:00:00.000Z',
        meta: { ...emptyMeta(), number: 'A-1/2026', date: 'the third of September' },
      }),
      lang: 'en',
      settings: defaultExportSettings(),
      letterhead: null,
      labels: { pageOf: 'of', columnEn: 'English', columnHi: 'हिंदी' },
    })
    expect(options.numberDate?.date).toBe('the third of September')
  })
})
