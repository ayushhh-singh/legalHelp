import { describe, expect, it } from 'vitest'

import { instantiate } from './skeleton'

import type { BodyDoc, BodyNode } from './model'

const para = (text: string): BodyNode => ({
  type: 'numberedPara',
  attrs: { level: 1 },
  content: [{ type: 'text', text }],
})
const marker = (text: string): BodyNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

const doc = (...content: BodyNode[]): BodyDoc => ({ type: 'doc', content })

/**
 * What a paragraph reads as, with an unfilled chip shown as `{{field}}`.
 *
 * That is the same projection `renderDoc.ts` makes, and it matters: the literal
 * `{{field}}` in the plain text is what `checklist.ts`'s `noPlaceholders` rule
 * matches and what blocks an export.
 */
const textOf = (node: BodyNode): string => {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'placeholder') {
    const field = node.attrs?.field
    return `{{${typeof field === 'string' ? field : ''}}}`
  }
  return (node.content ?? []).map(textOf).join('')
}

const lines = (body: BodyDoc): string[] => (body.content ?? []).map(textOf)

describe('placeholders', () => {
  it('substitutes a value and leaves a chip where there is none', () => {
    const result = instantiate(doc(para('Ref {{fileNumber}} dated {{date}}.')), { fileNumber: 'A-1/2026' })
    expect(lines(result.body)).toEqual(['Ref A-1/2026 dated {{date}}.'])
    expect(result.unfilled).toEqual(['date'])
    const chip = result.body.content?.[0]?.content?.find((node) => node.type === 'placeholder')
    expect(chip?.attrs?.field).toBe('date')
  })

  it('treats a blank value as unfilled', () => {
    const result = instantiate(doc(para('{{subject}}')), { subject: '   ' })
    expect(result.unfilled).toEqual(['subject'])
  })

  it('joins a list value with commas', () => {
    const result = instantiate(doc(para('Enclosed: {{enclosures}}')), { enclosures: ['A', 'B'] })
    expect(lines(result.body)).toEqual(['Enclosed: A, B'])
  })
})

describe('{{#if}}', () => {
  it('keeps the block when the field has a value', () => {
    const result = instantiate(
      doc(para('One.'), marker('{{#if note}}'), para('Note: {{note}}'), marker('{{/if}}'), para('Two.')),
      { note: 'something' },
    )
    expect(lines(result.body)).toEqual(['One.', 'Note: something', 'Two.'])
  })

  it('drops the block when the field is blank, and reports NO issue', () => {
    const result = instantiate(
      doc(para('One.'), marker('{{#if note}}'), para('Note: {{note}}'), marker('{{/if}}'), para('Two.')),
      { note: '' },
    )
    expect(lines(result.body)).toEqual(['One.', 'Two.'])
    expect(result.issues).toEqual([])
    expect(result.unfilled).toEqual([])
  })

  it('drops the block for a field the document does not have at all', () => {
    const result = instantiate(doc(marker('{{#if missing}}'), para('Hidden.'), marker('{{/if}}')), {})
    expect(lines(result.body)).toEqual([''])
  })

  it('nests', () => {
    const skeleton = doc(
      marker('{{#if a}}'),
      para('A'),
      marker('{{#if b}}'),
      para('B'),
      marker('{{/if}}'),
      para('A again'),
      marker('{{/if}}'),
    )
    expect(lines(instantiate(skeleton, { a: 'x', b: 'y' }).body)).toEqual(['A', 'B', 'A again'])
    expect(lines(instantiate(skeleton, { a: 'x' }).body)).toEqual(['A', 'A again'])
    expect(lines(instantiate(skeleton, {}).body)).toEqual([''])
  })
})

describe('{{#each}}', () => {
  it('repeats once per entry, with {{.}} and {{@index}}', () => {
    const result = instantiate(
      doc(marker('{{#each points}}'), para('{{@index}}. {{.}}'), marker('{{/each}}')),
      { points: ['First', 'Second', 'Third'] },
    )
    expect(lines(result.body)).toEqual(['1. First', '2. Second', '3. Third'])
  })

  it('emits NOTHING for zero rows — not an empty paragraph', () => {
    const result = instantiate(
      doc(para('Before.'), marker('{{#each points}}'), para('{{.}}'), marker('{{/each}}'), para('After.')),
      { points: [] },
    )
    expect(lines(result.body)).toEqual(['Before.', 'After.'])
  })

  it('treats a single string as one row', () => {
    const result = instantiate(doc(marker('{{#each one}}'), para('{{.}}'), marker('{{/each}}')), {
      one: 'only',
    })
    expect(lines(result.body)).toEqual(['only'])
  })

  it('nests an {{#if}} inside', () => {
    const result = instantiate(
      doc(
        marker('{{#each points}}'),
        para('{{.}}'),
        marker('{{#if suffix}}'),
        para('({{suffix}})'),
        marker('{{/if}}'),
        marker('{{/each}}'),
      ),
      { points: ['a', 'b'], suffix: 'note' },
    )
    expect(lines(result.body)).toEqual(['a', '(note)', 'b', '(note)'])
  })
})

describe('broken markers', () => {
  it('reports an unclosed {{#if}} and still produces a document', () => {
    const result = instantiate(doc(marker('{{#if a}}'), para('Kept.')), { a: 'yes' })
    expect(result.issues.map((issue) => issue.code)).toEqual(['unclosed'])
    expect(lines(result.body)).toEqual(['Kept.'])
  })

  it('reports a closer with no opener', () => {
    const result = instantiate(doc(para('One.'), marker('{{/if}}')), {})
    expect(result.issues.map((issue) => issue.code)).toEqual(['unopened'])
    expect(lines(result.body)).toEqual(['One.'])
  })

  it('never returns an empty document — the editor needs a caret', () => {
    const result = instantiate({ type: 'doc', content: [] }, {})
    expect(result.body.content).toEqual([{ type: 'paragraph' }])
  })
})

describe('Devanagari', () => {
  it('substitutes into a Hindi skeleton', () => {
    const result = instantiate(doc(para('{{officerName}} को {{days}} दिन का अवकाश।')), {
      officerName: 'श्री ए.बी.सी.',
      days: '१०',
    })
    expect(lines(result.body)).toEqual(['श्री ए.बी.सी. को १० दिन का अवकाश।'])
  })

  it("states the limit: a marker's FIELD NAME must be ASCII", () => {
    const result = instantiate(doc(marker('{{#if टिप्पणी}}'), para('x'), marker('{{/if}}')), {})
    // Field ids in this app are `[a-zA-Z][a-zA-Z0-9]*` everywhere — the zod
    // schema, the JSON Schema and the seed's self-check all say so — so a
    // Devanagari name is not an opener at all: it renders as literal text, and
    // the `{{/if}}` below it is then a closer with nothing to close.
    //
    // This is asserted rather than left to be discovered because the failure is
    // the quiet kind: a Hindi skeleton written with a Devanagari field name
    // would print its own control flow onto an official document.
    expect(lines(result.body)).toEqual(['{{#if टिप्पणी}}', 'x'])
    expect(result.issues.map((issue) => issue.code)).toEqual(['unopened'])
  })
})
