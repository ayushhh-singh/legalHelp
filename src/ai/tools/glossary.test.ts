import { beforeEach, describe, expect, it } from 'vitest'

import { registerGlossaryTools, resetGlossaryToolCache } from './glossary'
import { clearRegistry, getTool, listTools } from './registry'

/**
 * The glossary tool, run for real against the committed `data/glossary.json`.
 *
 * Called through the registry so the zod schema runs on the way in — the half a
 * direct call skips and the half a model finds.
 */

interface GlossaryToolResult {
  query: string
  category: string
  count: number
  terms: Array<{ id: string; en: string; hi: string; category: string; verify: boolean }>
  verifyNote: string
}

const lookup = async (input: unknown): Promise<GlossaryToolResult> => {
  const tool = getTool('lookup_glossary_term')
  if (!tool) throw new Error('lookup_glossary_term is not registered')
  const parsed = tool.def.inputSchema.parse(input)
  const result = await tool.def.handler(parsed, { language: 'en', signal: new AbortController().signal })
  return result as GlossaryToolResult
}

beforeEach(() => {
  clearRegistry()
  resetGlossaryToolCache()
  registerGlossaryTools()
})

describe('lookup_glossary_term', () => {
  it('registers under the utils scope, and is not a draft tool', () => {
    expect(listTools('utils').map((tool) => tool.def.name)).toContain('lookup_glossary_term')
    expect(
      listTools('draft')
        .filter((tool) => tool.def.scope === 'draft')
        .map((tool) => tool.def.name),
    ).not.toContain('lookup_glossary_term')
  })

  it('finds an English term and returns the Hindi rendering', async () => {
    const result = await lookup({ query: 'Cabinet Secretary' })
    expect(result.count).toBeGreaterThan(0)
    expect(result.terms[0]?.hi).toBe('मंत्रिमंडल सचिव')
  })

  it('finds a term typed in roman Hindi', async () => {
    // A reader — or a model — that cannot produce Devanagari still reaches the
    // entry. This is the drafting agent's own case: the leave application is
    // about अर्जित अवकाश.
    const result = await lookup({ query: 'arjit avkash' })
    expect(result.terms.some((term) => term.hi === 'अर्जित अवकाश')).toBe(true)
  })

  it('does NOT answer for a designation `structure-terms.json` already carries', async () => {
    /*
      "Under Secretary to the Government of India" is a CSMOP structural term
      and belongs to `lookup_admin_term`; `glossary_seed.py` drops it from this
      dataset so the two never answer the same question twice (ADR-024). The
      consequence for an agent is the reason both tools are in its scope: a
      drafting run that only had this one would find no Hindi for the
      designation that signs almost every document this app drafts.
    */
    const result = await lookup({ query: 'Under Secretary' })
    expect(result.terms.some((term) => term.en === 'Under Secretary')).toBe(false)
  })

  it('narrows to one category', async () => {
    const result = await lookup({ query: 'officer', category: 'designation' })
    expect(result.terms.every((term) => term.category === 'designation')).toBe(true)
  })

  it('honours the limit and caps it at fifteen', async () => {
    expect((await lookup({ query: 'officer', limit: 3 })).terms).toHaveLength(3)
    const tool = getTool('lookup_glossary_term')
    expect(tool?.def.inputSchema.safeParse({ query: 'officer', limit: 40 }).success).toBe(false)
  })

  it('carries the compiled-vocabulary caveat on every result', async () => {
    const result = await lookup({ query: 'Under Secretary' })
    // Every entry in this dataset is `verify: true` unconditionally (ADR-024,
    // DATA-GAPS #48), so a tool that returned the Hindi without the caveat
    // would let an agent present compiled vocabulary as a citation.
    expect(result.terms.every((term) => term.verify)).toBe(true)
    expect(result.verifyNote).toContain('verify')
  })

  it('rejects an empty query rather than returning the whole glossary', () => {
    const tool = getTool('lookup_glossary_term')
    expect(tool?.def.inputSchema.safeParse({ query: '' }).success).toBe(false)
  })
})
