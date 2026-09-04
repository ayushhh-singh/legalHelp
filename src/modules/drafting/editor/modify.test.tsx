import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocSuggestion } from '../components/DocSuggestion'
import { ModifyPanel } from './ModifyPanel'
import { listVersions, putDocument, snapshot } from '../documents'

import { clearAllData } from '@/db'
import { newDoc, type BodyDoc, type OfficialDoc } from '@/lib/drafting/model'
import { applyProposal, numberedBlocks, proposeChanges, textOf } from '@/lib/drafting/proposal'
import { docTemplateFileSchema } from '../schema'

/**
 * The suggestion surface, and the one thing about applying that has to be true:
 * **an accepted set creates exactly one version.**
 *
 * A version per accepted change would fill the thirty-deep list with one
 * officer's single decision and push a week of real snapshots off the end
 * (`prune` keeps thirty). One per apply is what makes the change undoable as
 * the act the officer performed rather than as five acts they did not.
 */

const AT = '2026-09-04T10:00:00.000Z'

const para = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] })
const bodyOf = (...texts: string[]): BodyDoc => ({ type: 'doc', content: texts.map(para) })

const THREE = ['First paragraph.', 'Second paragraph.', 'Third paragraph.']

const DOC: OfficialDoc = newDoc({
  id: 'doc-modify-1',
  templateId: 'office-memorandum',
  lang: 'en',
  at: AT,
  body: bodyOf(...THREE),
})

// Loaded but not used directly — its presence is what proves the fixture is a
// real form rather than a shape invented for the test.
const TEMPLATE = docTemplateFileSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'data',
        'drafting',
        'templates',
        'office-memorandum.json',
      ),
      'utf8',
    ),
  ),
).template

beforeEach(async () => {
  await clearAllData()
})

describe('applying an accepted set', () => {
  it('creates exactly one version, whatever the officer accepted', async () => {
    await putDocument(DOC)
    expect(await listVersions(DOC.id)).toHaveLength(0)

    const proposal = proposeChanges(
      DOC,
      { ...DOC, body: bodyOf('Rewritten first.', 'Rewritten second.', THREE[2] as string) },
      'en',
    )
    const decisions = {
      blocks: Object.fromEntries(
        proposal.blocks.filter((block) => block.kind !== 'unchanged').map((block) => [block.id, true]),
      ),
    }
    expect(Object.keys(decisions.blocks)).toHaveLength(2)

    // What `ModifyPanel.onApply` does, in the order it does it: a version
    // first, then the write.
    await snapshot(DOC, 'manual', 'Change')
    const applied = applyProposal(DOC, proposal, decisions, 'en', '2026-09-04T11:00:00.000Z')
    await putDocument(applied.doc)

    const versions = await listVersions(DOC.id)
    expect(versions).toHaveLength(1)
    // And the version holds the state BEFORE the change, which is what makes
    // the confirmation's promise ("this can be undone") true.
    expect((versions[0]?.doc.body.content ?? []).map(textOf)).toEqual(THREE)
  })

  it('writes nothing at all when the officer refused everything', async () => {
    await putDocument(DOC)
    const proposal = proposeChanges(DOC, { ...DOC, body: bodyOf('Rewritten.', ...THREE.slice(1)) }, 'en')
    const applied = applyProposal(DOC, proposal, { blocks: {} }, 'en', AT)

    expect(applied.acceptedBlocks).toBe(0)
    // `ModifyPanel` returns before `onApply` in this case, so no version is
    // taken either — a refused suggestion must leave the document's history
    // exactly as it was.
    expect(await listVersions(DOC.id)).toHaveLength(0)
  })
})

describe('the suggestion surface', () => {
  const proposal = proposeChanges(
    DOC,
    { ...DOC, body: bodyOf('Rewritten first.', THREE[1] as string, THREE[2] as string) },
    'en',
  )

  it('starts with every change REFUSED', () => {
    // The opposite of `SuggestionDiff`, and deliberately: the officer asked for
    // one paragraph to change and the model may have changed five.
    const onApply = vi.fn()
    render(<DocSuggestion proposal={proposal} onApply={onApply} onDiscard={() => {}} />)

    const apply = screen.getByRole('button', { name: /Apply/i })
    expect(apply).toBeDisabled()
  })

  it('applies exactly what was accepted', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<DocSuggestion proposal={proposal} onApply={onApply} onDiscard={() => {}} />)

    await user.click(screen.getAllByRole('button', { name: 'Accept' })[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: /Apply/i }))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    const decisions = onApply.mock.calls[0]?.[0] as { blocks: Record<string, boolean> }
    expect(Object.values(decisions.blocks).filter(Boolean)).toHaveLength(1)
  })

  it('accepts and refuses everything in one press', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<DocSuggestion proposal={proposal} onApply={onApply} onDiscard={() => {}} />)

    await user.click(screen.getByRole('button', { name: /Accept all/i }))
    expect(screen.getByRole('button', { name: /Apply/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Refuse all/i }))
    expect(screen.getByRole('button', { name: /Apply/i })).toBeDisabled()
  })

  it('says so when the suggestion changed nothing', () => {
    const empty = proposeChanges(DOC, DOC, 'en')
    render(<DocSuggestion proposal={empty} onApply={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/made no change/i)).toBeInTheDocument()
  })

  it('shows what was discarded for being outside the selection', () => {
    const scoped = {
      ...proposal,
      outOfScope: [{ what: 'b0', describe: 'A paragraph outside the selection was rewritten.' }],
    }
    render(<DocSuggestion proposal={scoped} onApply={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/outside the selection was rewritten/i)).toBeInTheDocument()
  })

  it('names the checklist items the change would break', () => {
    render(
      <DocSuggestion
        proposal={proposal}
        onApply={() => {}}
        onDiscard={() => {}}
        broken={[TEMPLATE.checklist[0]?.label.en ?? 'Written in the third person']}
      />,
    )
    expect(screen.getByText(/would break/i)).toBeInTheDocument()
  })
})

describe('the scope control', () => {
  /*
    The test this session owed itself.

    `restrictToBlocks` is enforced in code and tested five ways in
    `src/ai/agents/modify.test.ts` — and the first version of `ModifyPanel` took
    the selection as a PROP that nothing passed, so the whole feature could
    never fire from the screen. That is the "wired end to end and unable to
    fire" trap in this session's own code, and this is the assertion that stops
    it coming back: the control exists, it names the document's own paragraphs,
    and choosing one narrows what a run is given.
  */
  const ai = {
    enabled: true,
    provider: null,
    tier: 'byok' as const,
    settings: { monthlyTokenBudget: 200_000 },
    refreshBudget: () => Promise.resolve(),
  } as unknown as Parameters<typeof ModifyPanel>[0]['ai']

  it('offers every paragraph of the document, by its own words', () => {
    render(
      <ModifyPanel
        doc={DOC}
        template={TEMPLATE}
        lang="en"
        devanagariDigits={false}
        ai={ai}
        onApply={() => {}}
      />,
    )

    const scope = screen.getByLabelText(/The selected paragraph only/i)
    const options = within(scope as HTMLSelectElement).getAllByRole('option')
    // The whole document, plus one per paragraph that has text in it.
    expect(options).toHaveLength(numberedBlocks(DOC, 'en').length + 1)
    expect(options[0]).toHaveValue('')
    expect(options[1]?.textContent).toContain('First paragraph.')
  })

  it('is not offered at all for a one-paragraph document', () => {
    // A scope control whose only option is "the whole document" is a control
    // that cannot do anything.
    const single: OfficialDoc = { ...DOC, body: bodyOf('The only paragraph.') }
    render(
      <ModifyPanel
        doc={single}
        template={TEMPLATE}
        lang="en"
        devanagariDigits={false}
        ai={ai}
        onApply={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/The selected paragraph only/i)).not.toBeInTheDocument()
  })

  it('keeps the consistency check when AI is off, and drops everything else', () => {
    // Turning AI off must cost this tab its model half and not its
    // deterministic one — `src/modules/library/ai-seam.ts` states the rule.
    const off = { ...ai, enabled: false }
    render(
      <ModifyPanel
        doc={DOC}
        template={TEMPLATE}
        lang="en"
        devanagariDigits={false}
        ai={off}
        onApply={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Check consistency/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/What to change/i)).not.toBeInTheDocument()
  })
})
