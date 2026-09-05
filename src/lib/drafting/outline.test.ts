import { describe, expect, it } from 'vitest'

import { moveBlock, outlineOf, textOfNode } from './outline'
import type { BodyDoc, BodyNode } from './model'

/**
 * The editor's outline column, and the one operation that reorders a document.
 *
 * The thing worth testing here is not "does it list headings" — it is that the
 * indices it hands out address `body.content` rather than the outline, because
 * that is what makes "move this heading up" step over the paragraphs under the
 * heading above rather than burying itself inside them.
 */

const para = (text: string): BodyNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (text: string, level = 1): BodyNode => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})
const numbered = (text: string, level = 1): BodyNode => ({
  type: 'numberedPara',
  attrs: { level },
  content: [{ type: 'text', text }],
})

const doc = (...content: BodyNode[]): BodyDoc => ({ type: 'doc', content })

describe('textOfNode', () => {
  it('joins every run of text under a node with nothing between', () => {
    const node: BodyNode = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'It is ' },
        { type: 'text', text: 'hereby', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' clarified.' },
      ],
    }
    expect(textOfNode(node)).toBe('It is hereby clarified.')
  })

  it('is empty for a node with no text in it, and for nothing at all', () => {
    expect(textOfNode({ type: 'pageBreak' })).toBe('')
    expect(textOfNode(undefined)).toBe('')
  })

  it('reaches text nested two levels down, in a list', () => {
    const list: BodyNode = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [para('the first point')] }],
    }
    expect(textOfNode(list)).toBe('the first point')
  })
})

describe('outlineOf', () => {
  it('lists headings and numbered paragraphs, and nothing else', () => {
    const body = doc(
      heading('Grounds of appeal'),
      para('ordinary prose'),
      numbered('The first submission is this.'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('a bullet')] }] },
      numbered('And this follows from it.', 2),
    )
    expect(outlineOf(body).map((entry) => entry.text)).toEqual([
      'Grounds of appeal',
      'The first submission is this.',
      'And this follows from it.',
    ])
  })

  it('carries the position in body.content, not the position in the outline', () => {
    const body = doc(para('one'), para('two'), heading('Three'), para('four'), numbered('Five'))
    expect(outlineOf(body).map((entry) => entry.index)).toEqual([2, 4])
  })

  it('reads the level off the node, and clamps a stored one that is out of range', () => {
    const body = doc(heading('A', 3), numbered('B', 9), numbered('C', 0), {
      type: 'heading',
      content: [{ type: 'text', text: 'D' }],
    })
    expect(outlineOf(body).map((entry) => entry.level)).toEqual([3, 3, 1, 1])
  })

  it('keeps an empty block, because the officer has to be able to find it', () => {
    const body = doc(numbered(''), numbered('written'))
    expect(outlineOf(body)).toHaveLength(2)
    expect(outlineOf(body)[0]!.text).toBe('')
  })

  it('is empty for a document with no spine at all', () => {
    expect(outlineOf(doc(para('one'), para('two')))).toEqual([])
    expect(outlineOf({ type: 'doc', content: [] })).toEqual([])
  })
})

describe('moveBlock', () => {
  const body = doc(heading('A'), para('a1'), para('a2'), heading('B'), para('b1'))

  it('moves a block to another position', () => {
    const moved = moveBlock(body, 3, 0)
    expect((moved.content ?? []).map((node) => textOfNode(node))).toEqual(['B', 'A', 'a1', 'a2', 'b1'])
  })

  /**
   * The reason `index` is a content position rather than an outline position.
   *
   * Moving heading B "up one" means to where heading A is — index 0 — and that
   * puts it above A's own paragraphs. Moving it to `3 - 1 = 2` would bury it
   * between them, which is what an outline that renumbered its own entries
   * would have computed.
   */
  it('steps over the blocks under the entry above, not over one block', () => {
    const entries = outlineOf(body)
    const target = entries[0]!.index
    const moved = moveBlock(body, entries[1]!.index, target)
    expect((moved.content ?? []).map((node) => textOfNode(node))).toEqual(['B', 'A', 'a1', 'a2', 'b1'])
  })

  it('returns the SAME object when there is nothing to do', () => {
    // Identity, not equality: `useOfficialDoc` marks a document dirty on any
    // new object, so a move that moved nothing would create a version.
    expect(moveBlock(body, 2, 2)).toBe(body)
    expect(moveBlock(body, -1, 0)).toBe(body)
    expect(moveBlock(body, 0, 99)).toBe(body)
    expect(moveBlock(body, 99, 0)).toBe(body)
    expect(moveBlock({ type: 'doc', content: [] }, 0, 0)).toEqual({ type: 'doc', content: [] })
  })

  it('does not mutate the document it was given', () => {
    const before = JSON.stringify(body)
    moveBlock(body, 0, 4)
    expect(JSON.stringify(body)).toBe(before)
  })
})
