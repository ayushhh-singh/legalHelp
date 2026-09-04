import { describe, expect, it } from 'vitest'

import { emptyBilingual, newDoc, type BodyDoc, type OfficialDoc } from './model'
import {
  acceptAll,
  applyProposal,
  applyWordDecisions,
  decidableBlocks,
  proposeChanges,
  rejectAll,
  restrictToBlocks,
  textOf,
} from './proposal'

/**
 * The modify-by-instruction proposal: what a model returned, what an officer
 * accepted, and what the app refused to let through.
 *
 * The tests that matter most here are the negative ones. A model returning a
 * better paragraph is the easy case; a model that also rewrote a paragraph
 * nobody asked about, or changed the subject line during a "rewrite this para",
 * is the case where the app has to be the one saying no.
 */

const AT = '2026-09-04T10:00:00.000Z'

const para = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] })

const body = (...texts: string[]): BodyDoc => ({ type: 'doc', content: texts.map(para) })

const doc = (texts: string[], patch: Partial<OfficialDoc> = {}): OfficialDoc => ({
  ...newDoc({
    id: 'doc-1',
    templateId: 'office-memorandum',
    lang: 'en',
    at: AT,
    body: body(...texts),
    meta: { subject: { en: 'Children Education Allowance', hi: '' } },
  }),
  ...patch,
})

const THREE = [
  'The undersigned is directed to refer to the subject mentioned above.',
  'The position has been examined in consultation with the Department of Expenditure.',
  'The information called for may kindly be furnished.',
]

/**
 * How many DECISIONS a word diff carries.
 *
 * Not the number of non-`equal` parts: an adjacent delete-and-insert is a
 * replacement and is one decision, because offering "remove shall" and "add
 * may" separately lets a reader produce a sentence with neither word in it.
 * The first version of the partial-acceptance test below counted parts, passed
 * a decision array a change longer than there were changes, and accidentally
 * accepted everything — which made the assertion about flattening pass against
 * a version that never flattened anything.
 */
const groupCount = (parts: readonly { op: string }[]): number => {
  let groups = 0
  let inRun = false
  for (const part of parts) {
    if (part.op === 'equal') inRun = false
    else if (!inRun) {
      groups += 1
      inRun = true
    }
  }
  return groups
}

describe('proposeChanges', () => {
  it('reports nothing when the two documents are the same', () => {
    const proposal = proposeChanges(doc(THREE), doc(THREE))
    expect(proposal.changed).toBe(false)
    expect(decidableBlocks(proposal)).toEqual([])
  })

  it('reports a rewritten paragraph as one changed block, with a word diff', () => {
    const after = [...THREE]
    after[1] = 'The position has been examined and no relaxation is under consideration.'
    const proposal = proposeChanges(doc(THREE), doc(after))

    const changes = decidableBlocks(proposal)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.kind).toBe('changed')
    expect(changes[0]?.kind === 'changed' && changes[0].words?.length).toBeGreaterThan(0)
  })

  it('reports an inserted paragraph as one addition and not as a change to everything below it', () => {
    // The defect `diffDocuments` was written to avoid, in a second place: a
    // naive diff turns one insertion into a ripple through the whole document.
    const after = [THREE[0] as string, 'A new second paragraph.', ...THREE.slice(1)]
    const proposal = proposeChanges(doc(THREE), doc(after))
    const changes = decidableBlocks(proposal)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.kind).toBe('added')
  })

  it('reports a deleted paragraph as one removal', () => {
    const proposal = proposeChanges(doc(THREE), doc([THREE[0] as string, THREE[2] as string]))
    const changes = decidableBlocks(proposal)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.kind).toBe('removed')
  })

  it('reports a changed subject as a field change, not a block', () => {
    const before = doc(THREE)
    const after = {
      ...doc(THREE),
      meta: { ...before.meta, subject: { en: 'Something else entirely', hi: '' } },
    }
    const proposal = proposeChanges(before, after)
    expect(proposal.fields).toEqual([
      { path: 'meta.subject.en', before: 'Children Education Allowance', after: 'Something else entirely' },
    ])
    expect(decidableBlocks(proposal)).toEqual([])
  })

  it('reports a variable the model invented as a change from nothing', () => {
    const before = doc(THREE)
    const after = { ...before, vars: { sanctionAmount: '5,00,000' } }
    const proposal = proposeChanges(before, after)
    expect(proposal.fields).toContainEqual({ path: 'vars.sanctionAmount', before: '', after: '5,00,000' })
  })

  it('compares the Hindi body when the Hindi issue is being modified', () => {
    const before: OfficialDoc = { ...doc(THREE), bodyHi: body('पहला अनुच्छेद।', 'दूसरा अनुच्छेद।') }
    const after: OfficialDoc = { ...before, bodyHi: body('पहला अनुच्छेद।', 'बदला हुआ दूसरा अनुच्छेद।') }
    // Against `body` the two are identical; the change is in `bodyHi` alone.
    expect(proposeChanges(before, after, 'en').changed).toBe(false)
    expect(decidableBlocks(proposeChanges(before, after, 'hi'))).toHaveLength(1)
  })
})

describe('applyProposal', () => {
  it('applies nothing when nothing was accepted', () => {
    const after = [...THREE]
    after[1] = 'Rewritten.'
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc(after))
    const applied = applyProposal(before, proposal, rejectAll(proposal), 'en', AT)

    expect(applied.acceptedBlocks).toBe(0)
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(THREE)
  })

  it('applies exactly the block that was accepted', () => {
    const after = ['Rewritten first.', THREE[1] as string, 'Rewritten third.']
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc(after))
    const changes = decidableBlocks(proposal)
    expect(changes).toHaveLength(2)

    const applied = applyProposal(
      before,
      proposal,
      { blocks: { [changes[0]?.id ?? '']: true, [changes[1]?.id ?? '']: false } },
      'en',
      AT,
    )
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(['Rewritten first.', THREE[1], THREE[2]])
    expect(applied.acceptedBlocks).toBe(1)
  })

  it('inserts an accepted addition in its own position', () => {
    const after = [THREE[0] as string, 'A new second paragraph.', ...THREE.slice(1)]
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc(after))
    const applied = applyProposal(before, proposal, acceptAll(proposal), 'en', AT)
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(after)
  })

  it('removes an accepted removal', () => {
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc([THREE[0] as string, THREE[2] as string]))
    const applied = applyProposal(before, proposal, acceptAll(proposal), 'en', AT)
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual([THREE[0], THREE[2]])
  })

  it('keeps the officer’s own node, marks and all, where nothing was accepted', () => {
    const before: OfficialDoc = {
      ...doc(THREE),
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Bold matters.', marks: [{ type: 'bold' }] }],
          },
          para(THREE[1] as string),
        ],
      },
    }
    const proposal = proposeChanges(before, doc(['Bold matters.', 'Rewritten.']))
    const applied = applyProposal(before, proposal, rejectAll(proposal), 'en', AT)
    expect(applied.doc.body.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
  })

  it('reports that a partly accepted block lost its marks rather than losing them quietly', () => {
    // Two separate word changes in one paragraph, so accepting one and
    // refusing the other produces text that is neither side's.
    const before = doc(['The reply is awaited from the office.'])
    const proposal = proposeChanges(before, doc(['A reply is awaited from this office.']))
    const block = decidableBlocks(proposal)[0]
    if (block?.kind !== 'changed' || !block.words) throw new Error('expected a word diff')
    expect(groupCount(block.words)).toBe(2)

    const applied = applyProposal(
      before,
      proposal,
      { blocks: { [block.id]: true }, words: { [block.id]: [true, false] } },
      'en',
      AT,
    )
    expect(applied.flattened).toEqual([block.id])
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(['A reply is awaited from the office.'])
  })

  it('takes the model\u2019s node whole when every word change was accepted', () => {
    const before = doc(['The reply is awaited from the office.'])
    const proposal = proposeChanges(before, doc(['A reply is awaited from this office.']))
    const block = decidableBlocks(proposal)[0]
    if (block?.kind !== 'changed' || !block.words) throw new Error('expected a word diff')

    const applied = applyProposal(
      before,
      proposal,
      { blocks: { [block.id]: true }, words: { [block.id]: [true, true] } },
      'en',
      AT,
    )
    expect(applied.flattened).toEqual([])
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(['A reply is awaited from this office.'])
  })

  it('keeps an empty spacer paragraph the proposal never saw', () => {
    const before: OfficialDoc = {
      ...doc(THREE),
      body: {
        type: 'doc',
        content: [para(THREE[0] as string), { type: 'paragraph' }, para(THREE[1] as string)],
      },
    }
    const proposal = proposeChanges(before, doc([THREE[0] as string, 'Rewritten.']))
    const applied = applyProposal(before, proposal, acceptAll(proposal), 'en', AT)
    expect(applied.doc.body.content).toHaveLength(3)
    expect(applied.doc.body.content?.[1]).toEqual({ type: 'paragraph' })
  })

  it('applies an accepted field change and refuses a path it does not own', () => {
    const before = doc(THREE)
    const after = { ...before, meta: { ...before.meta, number: 'A-11011/4/2026-Estt.' } }
    const proposal = proposeChanges(before, after)
    const applied = applyProposal(before, proposal, { blocks: {}, fields: { 'meta.number': true } }, 'en', AT)
    expect(applied.doc.meta.number).toBe('A-11011/4/2026-Estt.')

    // A path `proposeChanges` never produces is refused rather than walked. A
    // path walker here could reach `id` or `docModelVersion`.
    const forged = applyProposal(
      before,
      { ...proposal, fields: [{ path: 'docModelVersion', before: '1', after: '99' }] },
      { blocks: {}, fields: { docModelVersion: true } },
      'en',
      AT,
    )
    expect(forged.doc.docModelVersion).toBe(1)
    expect(forged.acceptedFields).toBe(0)
  })

  it('leaves updatedAt alone when nothing was accepted', () => {
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc(['Rewritten.', ...THREE.slice(1)]))
    const applied = applyProposal(before, proposal, rejectAll(proposal), 'en', '2026-12-25T00:00:00.000Z')
    expect(applied.doc.updatedAt).toBe(AT)
  })
})

describe('restrictToBlocks', () => {
  it('discards a change to a paragraph outside the selection, and says so', () => {
    // The claim this session makes in code rather than in a prompt: the officer
    // selected paragraph 2, so paragraph 1 may not change however good the
    // rewrite is.
    const after = ['The model tidied this one too.', 'Rewritten second.', THREE[2] as string]
    const before = doc(THREE)
    const proposal = restrictToBlocks(proposeChanges(before, doc(after)), new Set([1]))

    const changes = decidableBlocks(proposal)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.kind === 'changed' && changes[0].after).toBe('Rewritten second.')
    expect(proposal.outOfScope).toHaveLength(1)
    expect(proposal.outOfScope[0]?.describe).toMatch(/outside the selection was rewritten/)
  })

  it('rebuilds the document with the out-of-scope paragraph untouched', () => {
    const after = ['The model tidied this one too.', 'Rewritten second.', THREE[2] as string]
    const before = doc(THREE)
    const proposal = restrictToBlocks(proposeChanges(before, doc(after)), new Set([1]))
    const applied = applyProposal(before, proposal, acceptAll(proposal), 'en', AT)
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual([THREE[0], 'Rewritten second.', THREE[2]])
  })

  it('discards a deletion outside the selection', () => {
    const before = doc(THREE)
    const proposal = restrictToBlocks(
      proposeChanges(before, doc([THREE[1] as string, THREE[2] as string])),
      new Set([1]),
    )
    expect(proposal.outOfScope[0]?.describe).toMatch(/deleted and the deletion was discarded/)
    const applied = applyProposal(before, proposal, acceptAll(proposal), 'en', AT)
    expect((applied.doc.body.content ?? []).map(textOf)).toEqual(THREE)
  })

  it('allows a paragraph split out of the selected one, and refuses one appended at the end', () => {
    const before = doc(THREE)
    const split = doc([THREE[0] as string, 'First half.', 'Second half.', THREE[2] as string])
    const scoped = restrictToBlocks(proposeChanges(before, split), new Set([1]))
    expect(scoped.outOfScope).toEqual([])

    const appended = doc([...THREE, 'An entirely new closing paragraph.'])
    const refused = restrictToBlocks(proposeChanges(before, appended), new Set([1]))
    expect(refused.outOfScope[0]?.describe).toMatch(/new paragraph was proposed outside the selection/)
    expect(decidableBlocks(refused)).toEqual([])
  })

  it('discards every field change under a block scope', () => {
    const before = doc(THREE)
    const after = {
      ...doc(['Rewritten first.', ...THREE.slice(1)]),
      meta: { ...before.meta, subject: emptyBilingual() },
    }
    const proposal = restrictToBlocks(proposeChanges(before, after), new Set([0]))
    expect(proposal.fields).toEqual([])
    expect(proposal.outOfScope.some((entry) => entry.what === 'meta.subject.en')).toBe(true)
  })

  it('does nothing at all when there is no scope', () => {
    const before = doc(THREE)
    const proposal = proposeChanges(before, doc(['Rewritten.', ...THREE.slice(1)]))
    expect(restrictToBlocks(proposal, new Set())).toBe(proposal)
  })
})

describe('applyWordDecisions', () => {
  it('keeps an insertion that was accepted and drops one that was not', () => {
    const parts = [
      { op: 'equal' as const, tokens: ['The', 'reply'] },
      { op: 'insert' as const, tokens: ['is', 'awaited'] },
    ]
    expect(applyWordDecisions(parts, [true])).toBe('The reply is awaited')
    expect(applyWordDecisions(parts, [false])).toBe('The reply')
  })

  it('keeps the original words when a deletion is REFUSED', () => {
    // The one inversion in the whole scheme, and the reason it has its own test
    // here as well as in `suggestion.ts`.
    const parts = [
      { op: 'equal' as const, tokens: ['The'] },
      { op: 'delete' as const, tokens: ['old'] },
      { op: 'equal' as const, tokens: ['wording'] },
    ]
    expect(applyWordDecisions(parts, [false])).toBe('The old wording')
    expect(applyWordDecisions(parts, [true])).toBe('The wording')
  })

  it('treats an adjacent delete and insert as one decision', () => {
    const parts = [
      { op: 'delete' as const, tokens: ['shall'] },
      { op: 'insert' as const, tokens: ['may'] },
      { op: 'equal' as const, tokens: ['be', 'furnished'] },
    ]
    // Both parts belong to one change, so neither can produce a sentence with
    // neither word in it.
    expect(applyWordDecisions(parts, [true])).toBe('may be furnished')
    expect(applyWordDecisions(parts, [false])).toBe('shall be furnished')
  })

  it('keeps a hard line break as a break rather than a space', () => {
    const parts = [{ op: 'equal' as const, tokens: ['(1)', 'first', '\n', '(2)', 'second'] }]
    expect(applyWordDecisions(parts, [])).toBe('(1) first\n(2) second')
  })
})
