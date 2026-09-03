import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import NewDocumentPage from './NewDocumentPage'
import { documentFromTemplate } from './newDocument'
import { loadTemplate } from './data'
import { savePersonal } from './personalStore'
import { saveProfile } from './profileStore'

import { db } from '@/db'
import { officialDocSchema } from '@/lib/drafting/model'
import { personalFromDocument } from '@/lib/drafting/personal'
import { linesOfNodes, projectBody } from '@/lib/drafting/renderDoc'
import { emptyProfile } from '@/lib/drafting/profile'

const AT = '2026-09-03T00:00:00.000Z'

const profile = () => ({
  ...emptyProfile(AT),
  name: { en: 'A.B.C.', hi: 'ए.बी.सी.' },
  designation: { en: 'Under Secretary', hi: 'अवर सचिव' },
  place: 'New Delhi',
  ministry: { en: 'Ministry of Personnel', hi: 'कार्मिक मंत्रालय' },
})

describe('documentFromTemplate', () => {
  it('snapshots the profile into meta.from and meta.signature', async () => {
    const doc = documentFromTemplate({
      id: 'd1',
      at: AT,
      template: await loadTemplate('office-memorandum'),
      profile: profile(),
    })
    expect(officialDocSchema.safeParse(doc).success).toBe(true)
    expect(doc.meta.from.ministry.hi).toBe('कार्मिक मंत्रालय')
    expect(doc.meta.signature.name.en).toBe('A.B.C.')
    expect(doc.meta.place).toBe('New Delhi')
    expect(doc.meta.date).toBe('2026-09-03')
  })

  it('takes a variable default from the profile where the template declares one', async () => {
    const doc = documentFromTemplate({
      id: 'd1',
      at: AT,
      // `noc-request` declares `defaultFrom: 'name'` and `'designation'`.
      template: await loadTemplate('noc-request'),
      profile: profile(),
    })
    expect(doc.vars.employeeName).toEqual({ en: 'A.B.C.', hi: 'ए.बी.सी.' })
    expect(doc.vars.employeeDesignation).toEqual({ en: 'Under Secretary', hi: 'अवर सचिव' })
    // …and leaves the ones it cannot know alone, so they stay chips.
    expect(doc.vars.employeeCode).toBeUndefined()
    expect(JSON.stringify(doc.body)).toContain('employeeCode')
  })

  it('never seeds a variable from its worked example', async () => {
    const template = await loadTemplate('office-order')
    const doc = documentFromTemplate({ id: 'd1', at: AT, template, profile: emptyProfile(AT) })
    // The specimen's "Shri A.B.C." is the template's EXAMPLE. A new document
    // filled with it would be the failure `sampleValues` was pulled out of the
    // engine to prevent — a document signed by the specimen.
    expect(doc.vars.officerName).toBeUndefined()
    expect(JSON.stringify(doc.body)).not.toContain('Shri A.B.C.')
  })

  it("applies a personal template's frozen values and its own skeleton", async () => {
    const base = await loadTemplate('office-order')
    const personal = personalFromDocument({
      id: 'pt1',
      name: 'My leave order',
      baseTemplateId: 'office-order',
      // `officerName` is NOT kept as a variable below, so it is frozen — and a
      // frozen value is what the skeleton interpolates when a document is made.
      vars: { officerName: 'Shri P.Q.R.', days: '10' },
      body: {
        type: 'doc',
        content: [
          {
            type: 'numberedPara',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Leave for {{officerName}}.' }],
          },
        ],
      },
      keepAsVariable: ['days'],
      base,
      at: AT,
    })

    const doc = documentFromTemplate({
      id: 'd1',
      at: AT,
      template: base,
      profile: emptyProfile(AT),
      personal,
    })
    expect(doc.vars.officerName).toBe('Shri P.Q.R.')
    // Read through the renderer rather than off the JSON: substitution leaves
    // three adjacent text nodes ("Leave for ", the value, ".") and Tiptap
    // merges them when the document is loaded. What matters is the sentence.
    expect(linesOfNodes(projectBody(doc.body, 'en'))).toEqual(['1. Leave for Shri P.Q.R..'])
    expect(doc.personalTemplateId).toBe('pt1')
  })

  it('leaves a blank body when the form has no skeleton', async () => {
    const template = { ...(await loadTemplate('office-memorandum')) }
    delete template.bodySkeleton
    const doc = documentFromTemplate({ id: 'd1', at: AT, template, profile: emptyProfile(AT) })
    expect(doc.body.content).toEqual([{ type: 'paragraph' }])
  })
})

describe('the /draft/new/:type route', () => {
  const renderAt = (path: string, wrap = false) => {
    const tree = (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/draft/new/:type" element={<NewDocumentPage />} />
          <Route path="/draft/d/:id" element={<p>the editor</p>} />
        </Routes>
      </MemoryRouter>
    )
    return render(wrap ? <StrictMode>{tree}</StrictMode> : tree)
  }

  it('creates exactly ONE document and redirects to it', async () => {
    await saveProfile(profile())
    renderAt('/draft/new/office-memorandum')
    expect(await screen.findByText('the editor')).toBeInTheDocument()
    expect(await db.documents.count()).toBe(1)
  })

  it('creates exactly one under StrictMode too', async () => {
    // `src/main.tsx` renders under StrictMode, which invokes every effect
    // twice; `pnpm test:e2e` runs a production build where it is inert. An
    // unguarded create would leave an empty document behind on every use, and
    // CLAUDE.md records two StrictMode defects shipped in `useDraft.ts` for
    // exactly this reason.
    await saveProfile(profile())
    renderAt('/draft/new/office-memorandum', true)
    expect(await screen.findByText('the editor')).toBeInTheDocument()
    expect(await db.documents.count()).toBe(1)
  })

  it('records the form as recently used', async () => {
    await saveProfile(profile())
    renderAt('/draft/new/office-memorandum')
    await screen.findByText('the editor')
    expect((await db.templateRecents.toArray()).map((row) => row.id)).toEqual(['office-memorandum'])
  })

  it('uses a personal template when one is named, and records THAT as recent', async () => {
    const base = await loadTemplate('office-order')
    await savePersonal(
      personalFromDocument({
        id: 'pt1',
        name: 'Mine',
        baseTemplateId: 'office-order',
        vars: { officerName: 'Shri P.Q.R.' },
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }] },
        keepAsVariable: [],
        base,
        at: AT,
      }),
    )
    renderAt('/draft/new/office-order?personal=pt1')
    await screen.findByText('the editor')
    const [row] = await db.documents.toArray()
    expect((row?.doc as { personalTemplateId?: string }).personalTemplateId).toBe('pt1')
    expect((await db.templateRecents.toArray()).map((entry) => entry.id)).toEqual(['pt1'])
  })

  it('says so for a form that does not exist, and writes nothing', async () => {
    renderAt('/draft/new/not-a-form')
    expect(await screen.findByText(/There is no such form|ऐसा कोई प्ररूप नहीं/)).toBeInTheDocument()
    expect(await db.documents.count()).toBe(0)
  })
})
