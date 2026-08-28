import { describe, expect, it } from 'vitest'

import { render, renderDocument, serialise, serialiseBilingual } from '@/lib/drafting/engine'
import { docTemplateFileSchema } from '@/modules/drafting/schema'
import { readFromRoot } from '@/test/paths'

import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * Snapshots of the two documents an officer writes most: the Office Memorandum
 * and a note on a file.
 *
 * They are written to `.txt` files rather than inlined, because the thing under
 * test is the *shape of a page* — where the number sits, where the date sits,
 * which paragraph carries a 2. A reviewer can read a diff of these; nobody can
 * read a diff of an escaped string.
 *
 * Update with `pnpm test -u` only after looking at what changed. A snapshot
 * that moved because the format changed is the point of the snapshot.
 */

const load = (id: string): DocTemplate =>
  docTemplateFileSchema.parse(JSON.parse(readFromRoot(`data/drafting/templates/${id}.json`)) as unknown)
    .template

describe('Office Memorandum', () => {
  const template = load('office-memorandum')

  it('renders the Appendix 8.1 format in English', async () => {
    await expect(serialise(renderDocument(template, {}, 'en').document)).toMatchFileSnapshot(
      './__snapshots__/office-memorandum.en.txt',
    )
  })

  it('renders the Hindi issue’s format', async () => {
    await expect(serialise(renderDocument(template, {}, 'hi').document)).toMatchFileSnapshot(
      './__snapshots__/office-memorandum.hi.txt',
    )
  })

  it('renders both, one under the other, for a side-by-side draft', async () => {
    await expect(serialiseBilingual(render(template, {}, 'bilingual'))).toMatchFileSnapshot(
      './__snapshots__/office-memorandum.bilingual.txt',
    )
  })

  it('puts the addressee below the signature, as the specimen does', () => {
    const roles = renderDocument(template, {}, 'en').document.blocks.map((block) => block.role)
    expect(roles.indexOf('addressee')).toBeGreaterThan(roles.indexOf('signature'))
  })

  it('leaves the first paragraph unnumbered and numbers the second 2', () => {
    const paras = renderDocument(template, {}, 'en').document.paras
    expect(paras[0]).toMatch(/^The undersigned is directed/)
    expect(paras[1]).toMatch(/^2\. /)
  })
})

describe('Noting', () => {
  const template = load('noting')

  it('renders a note on a file in English', async () => {
    await expect(serialise(renderDocument(template, {}, 'en').document)).toMatchFileSnapshot(
      './__snapshots__/noting.en.txt',
    )
  })

  it('renders a note on a file in Hindi', async () => {
    await expect(serialise(renderDocument(template, {}, 'hi').document)).toMatchFileSnapshot(
      './__snapshots__/noting.hi.txt',
    )
  })

  it('numbers every paragraph from 1, unlike a communication', () => {
    const paras = renderDocument(template, {}, 'en').document.paras
    expect(paras[0]).toMatch(/^1\. /)
    expect(paras[1]).toMatch(/^2\. /)
  })

  it('signs on the left with the date, and states the level of disposal', () => {
    const document = renderDocument(template, {}, 'en').document
    const signature = document.blocks.find((block) => block.role === 'signature')
    expect(signature?.align).toBe('left')
    expect(signature?.lines.at(-1)).toBe('28.08.2026')
    expect(document.blocks.at(-1)?.lines[0]).toMatch(/^Level of disposal: /)
  })
})
