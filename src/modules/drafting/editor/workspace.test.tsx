import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import DocEditorPage from '../DocEditorPage'
import { putDocument } from '../documents'

import { FocusLayout } from '@/app/layouts/FocusLayout'
import { db } from '@/db'
import { docId } from '../documents'
import { newDoc, type OfficialDoc } from '@/lib/drafting/model'

/**
 * The editor as a workspace (Session 35).
 *
 * Rendered INSIDE `FocusLayout`, because the title box, the status control and
 * every ⋯ entry are portalled into that bar — mounted bare, the page has no
 * title, no menu and no way out, which is a screen no officer sees.
 *
 * Tiptap runs under jsdom (ADR-041 §1 is what proved it), so the outline, the
 * jump and the panel tabs are all real here. What is NOT here is anything about
 * the caret's position on screen: jsdom implements no layout, so
 * `Range.getClientRects` is absent and a test claiming the caret landed
 * somewhere would be claiming something jsdom cannot know. That claim lives in
 * `tests/e2e/draft-editor.spec.ts`.
 */

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<FocusLayout />}>
          <Route path="/draft/d/:id" element={<DocEditorPage />} />
        </Route>
        <Route path="/draft/d/:id/print" element={<Where />} />
        <Route path="/draft/documents" element={<Where />} />
        <Route path="/draft/register" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

/**
 * A real Office Memorandum, with a spine worth outlining.
 *
 * The TEMPLATE is the committed one — `useTemplate` loads it inside the page —
 * so the checklist, the lint and the preview here are the real ones. Only the
 * body is written by hand, because what these tests are about is the shape of
 * a document rather than its wording.
 */
async function seed(): Promise<string> {
  const doc = newDoc({
    id: docId(),
    templateId: 'office-memorandum',
    lang: 'en',
    at: '2026-09-05T00:00:00.000Z',
  })
  await putDocument({
    ...doc,
    title: 'Children Education Allowance',
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Background' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'ordinary prose' }] },
        { type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'The first point.' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Orders' }] },
      ],
    },
  })
  return doc.id
}

/**
 * The stored document, typed.
 *
 * `DocumentRow.doc` is `unknown` on purpose — Dexie hands back whatever is on
 * the device and `readDoc` is what decides whether it is readable. These tests
 * wrote the row themselves one line earlier, so the cast is a statement about
 * this test's own fixture rather than a claim about storage.
 */
const stored = async (id: string): Promise<OfficialDoc> => (await db.documents.get(id))!.doc as OfficialDoc

beforeEach(async () => {
  await Promise.all([db.documents.clear(), db.docVersions.clear(), db.docComments.clear()])
})

describe('the focus bar', () => {
  it('holds the document’s title, editable, and writes it', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    const title = await screen.findByLabelText('What this document is called')
    expect(title).toHaveValue('Children Education Allowance')

    await user.clear(title)
    await user.type(title, 'CEA — clarification')
    await waitFor(async () => {
      expect((await stored(id)).title).toBe('CEA — clarification')
    })
  })

  it('holds Draft / Final / Sent as a control rather than a badge', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    await user.selectOptions(await screen.findByLabelText('Status'), 'final')
    await waitFor(async () => expect((await stored(id)).status).toBe('final'))
  })

  it('puts the page’s eight actions in the shell’s ONE ⋯ menu', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = document.getElementById('focus-actions')!
    for (const name of [
      'Export as .docx',
      'Print / PDF',
      'Versions',
      'Duplicate',
      'Save as my template',
      'Issue number',
      'Move to thread',
      'Delete',
    ]) {
      expect(within(menu).getByText(name), name).toBeInTheDocument()
    }
    // …and the three the shell owes every focus route, in the same list.
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('the outline', () => {
  it('lists the spine and nothing else', async () => {
    const id = await seed()
    at(`/draft/d/${id}`)

    const outline = await screen.findByRole('navigation', { name: 'Outline' })
    const items = within(outline).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Background')
    expect(items[1]).toHaveTextContent('The first point.')
    expect(items[2]).toHaveTextContent('Orders')
    // The plain paragraph between them is in the document and not in the spine.
    expect(within(outline).queryByText('ordinary prose')).not.toBeInTheDocument()
  })

  it('reorders the document, stepping over what is under the entry above', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    const outline = await screen.findByRole('navigation', { name: 'Outline' })
    await user.click(within(outline).getByRole('button', { name: 'Move “Orders” up' }))

    /*
      "Orders" moves to where "The first point." was — index 2 — not to index 3
      minus one. The paragraph under a heading travels with the block above it
      because the indices address `body.content`, and a reorder that buried a
      heading inside the previous section would be worse than one that refused.
    */
    await waitFor(async () => {
      const blocks = (await stored(id)).body.content
      const spine = blocks
        .filter((node) => node.type === 'heading' || node.type === 'numberedPara')
        .map((node) => (node.content ?? []).map((run) => run.text ?? '').join(''))
      expect(spine).toEqual(['Background', 'Orders', 'The first point.'])
      // The plain paragraph stayed under the heading it was written under.
      expect(blocks[1]?.type).toBe('paragraph')
    })
  })

  it('jumps the caret into the block, which is what makes it a control and not a list', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    const body = await screen.findByRole('textbox', { name: 'Document body' })
    const outline = await screen.findByRole('navigation', { name: 'Outline' })
    /*
      An anchored regex, because a string `name` is a SUBSTRING match and the
      two move controls beside this one are called "Move “Orders” up" and
      "…down" — and `exact` is an option `getByText` takes and `getByRole` does
      not, which is a quieter version of the same trap.
      CLAUDE.md records the same trap costing half an hour on `{ name: 'Post' }`
      matching "Place of posting".
    */
    await user.click(within(outline).getByRole('button', { name: /^Orders$/ }))

    // The editing surface takes focus. WHERE the caret landed is a layout
    // question jsdom cannot answer — that half is asserted in the browser.
    await waitFor(() => expect(body).toHaveFocus())
  })
})

describe('the right-hand panel', () => {
  it('swaps one panel in place, and says which in the URL', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    const tabs = await screen.findByRole('tablist', { name: 'About this document' })
    expect(within(tabs).getByRole('tab', { name: /^Review/ })).toHaveAttribute('aria-selected', 'true')

    await user.click(within(tabs).getByRole('tab', { name: 'Versions' }))
    await waitFor(() =>
      expect(within(tabs).getByRole('tab', { name: 'Versions' })).toHaveAttribute('aria-selected', 'true'),
    )
    await user.click(within(tabs).getByRole('tab', { name: 'Notes to self' }))
    expect(await screen.findByRole('tab', { name: 'Notes to self' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the details as a card at the head of the surface, not a page of its own', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    /*
      Shut by default: an officer opening a document is opening it to write.

      Asserted on the `<details>` element's own `open`, not on whether the
      fields are queryable — jsdom keeps a closed disclosure's children in the
      DOM and reports them as present, so `queryByLabelText('Subject')` finds
      them either way and would pass against a card that never closed.
    */
    const summary = await screen.findByText('Document details')
    const card = summary.closest('details')!
    expect(card.open).toBe(false)

    await user.click(summary)
    await waitFor(() => expect(card.open).toBe(true))
    expect(screen.getByLabelText('Subject')).toBeInTheDocument()
    // And the body is still on screen underneath it — it is a card, not a tab.
    expect(screen.getByRole('textbox', { name: 'Document body' })).toBeInTheDocument()
  })
})

describe('the two sheets an IA change orphaned', () => {
  /**
   * `docs/DATA-GAPS.md` #94.
   *
   * Deleting the Session 8 form-and-preview editor took the only screen that
   * mounted the Rajbhasha glossary sheet, the phrase library and "Draft with
   * AI" — three shipped surfaces left in the tree with green unit tests and no
   * route reaching them. The toolbar kept both buttons and they opened the
   * details card: a control that does something other than what it says, which
   * is worse than one that is gone.
   *
   * Two of the three are back, on the editor's own caret. "Draft with AI" is
   * not, and #94 still records it.
   */
  it('opens the glossary from the toolbar and types the term in at the caret', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)

    const body = await screen.findByRole('textbox', { name: 'Document body' })
    await user.click(body)

    await user.click(screen.getByRole('button', { name: 'Insert a Hindi term' }))
    const sheet = await screen.findByRole('dialog')
    await user.click((await within(sheet).findAllByRole('button', { name: /^Insert the Hindi$/ }))[0]!)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Something was typed in — what, exactly, is the dataset's business.
    await waitFor(async () => {
      const blocks = (await stored(id)).body.content
      expect(JSON.stringify(blocks)).not.toBe(
        JSON.stringify([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Background' }] },
        ]),
      )
    })
  })

  it('offers the phrase library too', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.click(screen.getByRole('button', { name: 'Insert a standard phrase' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('the keyboard', () => {
  it('Ctrl+S saves a version', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.keyboard('{Control>}s{/Control}')
    await waitFor(async () => expect(await db.docVersions.where('docId').equals(id).count()).toBe(1))
  })

  it('Ctrl+E opens the export, and Ctrl+P goes to the print route', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.keyboard('{Control>}e{/Control}')
    expect(await screen.findByText(/Export as \.docx/)).toBeInTheDocument()

    await user.keyboard('{Control>}p{/Control}')
    // The print ROUTE, where paper, language and the `@page` rule are chosen —
    // not the preview, and not `window.print()` on the editing surface.
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/draft/d/${id}/print`))
  })

  it('Ctrl+/ opens the shortcuts sheet', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.keyboard('{Control>}/{/Control}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('deleting', () => {
  it('asks first, and lands on the document list', async () => {
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(within(document.getElementById('focus-actions')!).getByText('Delete'))

    // The document is still there until the second press.
    expect(await screen.findByText(/Delete “Children Education Allowance”\?/)).toBeInTheDocument()
    expect(await db.documents.get(id)).toBeDefined()

    // Scoped to the confirmation card: the ⋯ entry that opened it is called
    // "Delete" too, and pressing that one again would only re-ask.
    const confirm = screen.getByText(/Delete “Children Education Allowance”\?/).closest('div')
    expect(confirm).not.toBeNull()
    await user.click(within(confirm as HTMLElement).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/draft/documents'))
    expect(await db.documents.get(id)).toBeUndefined()
  })
})

/**
 * The edge-case pass (ADR-047's addendum).
 *
 * Each of these was confirmed to FAIL against the commit that introduced the
 * control it is about. All three are the same family: a control that is
 * reachable, labelled and translated, and cannot do the thing it offers.
 */
describe('controls that could not do what they offered', () => {
  it('opens “Save as my template” with the document’s own name in the box', async () => {
    /*
      The dialog resets its fields in Radix's `onOpenChange`, which fires when
      the dialog asks to change state — and a CONTROLLED `open` never asks. So
      opening it from the ⋯ menu (Session 35's way in) left the name field
      empty, where the old trigger had pre-filled it with the document's title.
      An officer saving their first template met a blank required field.
    */
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(within(document.getElementById('focus-actions')!).getByText('Save as my template'))

    expect(await screen.findByLabelText(/Template name/)).toHaveValue('Children Education Allowance')
  })

  it('lets a document START a thread, not only join one that exists', async () => {
    /*
      The select was built from the threads the officer's OTHER documents are
      already on — and `newReply` is the only thing that has ever set one, so on
      a device where nobody has replied to a letter the menu entry opened a card
      offering exactly one option: "Not on a thread", which is what the document
      already was. A control whose only option is the current state is a control
      that cannot fire.
    */
    const user = userEvent.setup()
    const id = await seed()
    at(`/draft/d/${id}`)
    await screen.findByRole('textbox', { name: 'Document body' })

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(within(document.getElementById('focus-actions')!).getByText('Move to thread'))

    const select = await screen.findByLabelText('Thread')
    await user.selectOptions(select, 'new')
    await waitFor(async () => expect((await stored(id)).threadId).toBe(id))
  })

  /*
    The third of this pass's findings — a drop carrying any `text/plain` moved
    an officer's paragraphs — is asserted in `tests/e2e/focus.spec.ts` and not
    here. jsdom has no `DataTransfer` at all, so a test written for it fails
    with a `ReferenceError` whatever the code does: it went red against the
    defect AND against the fix, which is not evidence of either.
  */
})
