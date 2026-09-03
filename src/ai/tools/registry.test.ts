import { z } from 'zod'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearRegistry,
  exportToolManifest,
  getTool,
  listTools,
  registerTool,
  registeredToolNames,
  toolSpecs,
  validateToolInput,
} from './registry'
import { registerBuiltinTools, todayInIndia } from './index'

import { parseJson } from '../json'

const lawTool = {
  name: 'section_lookup',
  scope: 'law' as const,
  description: { en: 'Look up a section.', hi: 'धारा खोजें।' },
  inputSchema: z.object({ act: z.enum(['ipc', 'bns']), section: z.string().min(1) }).strict(),
  handler: (input: { act: string; section: string }) => Promise.resolve({ ...input, found: true }),
}

beforeEach(() => {
  clearRegistry()
})

describe('registerTool', () => {
  it('rejects a name that is not lower_snake_case', () => {
    expect(() => registerTool({ ...lawTool, name: 'SectionLookup' })).toThrow(/lower_snake_case/)
  })

  it('rejects a second registration of the same name', () => {
    registerTool(lawTool)
    expect(() => registerTool(lawTool)).toThrow(/already registered/)
  })

  it('rejects a tool with no Hindi description', () => {
    expect(() => registerTool({ ...lawTool, description: { en: 'Look up a section.', hi: '' } })).toThrow(
      /en and a hi description/,
    )
  })
})

describe('the JSON Schema handed to the model', () => {
  it('is derived from the zod schema, with the dialect header stripped', () => {
    registerTool(lawTool)
    const schema = getTool('section_lookup')?.jsonSchema

    expect(schema).toMatchObject({
      type: 'object',
      required: ['act', 'section'],
      additionalProperties: false,
    })
    // `$schema` is a document-level declaration; input_schema is a fragment,
    // and the model would pay for the string on every request.
    expect(schema).not.toHaveProperty('$schema')
  })
})

describe('listTools and toolSpecs', () => {
  beforeEach(() => {
    registerBuiltinTools()
    registerTool(lawTool)
  })

  it('scopes a surface to its own tools plus the common ones', () => {
    // The five real law tools (src/ai/tools/law.ts) register alongside the
    // fixture one, because registerBuiltinTools() now brings the module tools
    // in with it. What this asserts is the SCOPING rule, not the census: every
    // law-scoped tool plus the two common ones, sorted.
    expect(listTools('law').map((tool) => tool.def.name)).toEqual([
      'compare_old_new',
      'dataset_versions',
      'format_citation',
      'get_classification',
      'get_section',
      'search_sections',
      'section_lookup',
      'today_in_india',
    ])
    expect(listTools('pay').map((tool) => tool.def.name)).toEqual([
      'compare_jobs',
      'compute_pay_for_job',
      'dataset_versions',
      'explain_pay_line',
      'get_allowance_source',
      'search_pay_jobs',
      'today_in_india',
    ])
  })

  it('sends English descriptions only, so the cached prefix is language-stable', () => {
    const specs = toolSpecs('law')
    expect(specs.find((spec) => spec.name === 'section_lookup')?.description).toBe('Look up a section.')
    expect(JSON.stringify(specs)).not.toContain('धारा')
  })

  it('marks exactly one cache breakpoint, at the end of a stable order', () => {
    const specs = toolSpecs()
    expect(specs.map((spec) => spec.name)).toEqual([...specs.map((spec) => spec.name)].sort())
    expect(specs.filter((spec) => spec.cache)).toHaveLength(1)
    expect(specs.at(-1)?.cache).toBe(true)
  })
})

describe('validateToolInput', () => {
  beforeEach(() => {
    registerTool(lawTool)
  })

  it('accepts and narrows a valid call', () => {
    const result = validateToolInput(getTool('section_lookup')!, { act: 'bns', section: '103' })
    expect(result).toEqual({ ok: true, value: { act: 'bns', section: '103' } })
  })

  it('names the failing path in a message written for the model', () => {
    const result = validateToolInput(getTool('section_lookup')!, { act: 'crpc', section: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Invalid arguments for section_lookup')
    expect(result.message).toContain('act')
  })
})

describe('exportToolManifest', () => {
  it('emits both languages, for an MCP client that is outside the prompt cache', () => {
    registerTool(lawTool)
    const manifest = parseJson(exportToolManifest()) as {
      version: number
      tools: { name: string; description: { en: string; hi: string }; scope: string }[]
    }

    expect(manifest.version).toBe(1)
    expect(manifest.tools[0]).toMatchObject({
      name: 'section_lookup',
      scope: 'law',
      description: { en: 'Look up a section.', hi: 'धारा खोजें।' },
    })
  })
})

describe('the built-in tools', () => {
  it('registers idempotently', () => {
    registerBuiltinTools()
    registerBuiltinTools()
    // Both the common tools and the module tools, once each — the duplicate
    // guard in registerTool throws, so a second pass that registered anything
    // twice would fail here rather than silently.
    expect(registeredToolNames()).toEqual([
      'check_draft',
      'compare_jobs',
      'compare_old_new',
      'compute_pay_for_job',
      'dataset_versions',
      'explain_pay_line',
      'format_citation',
      'get_allowance_source',
      'get_card_history',
      'get_classification',
      'get_definitions',
      'get_draft_template',
      'get_my_notes',
      'get_related_cards',
      'get_rule_text',
      'get_section',
      'get_study_aid',
      'get_unit',
      'get_user_weak_areas',
      'list_draft_phrases',
      'list_draft_templates',
      'lookup_admin_term',
      'lookup_glossary_term',
      'propose_card',
      'render_draft',
      'retrieve',
      'search_pay_jobs',
      'search_sections',
      'today_in_india',
    ])
  })

  it('reports the bundled dataset versions', async () => {
    registerBuiltinTools()
    const output = (await getTool('dataset_versions')!.def.handler(undefined as never, {
      language: 'en',
      signal: new AbortController().signal,
    })) as { datasets: { name: string; version: string }[] }

    expect(output.datasets.map((dataset) => dataset.name)).toContain('app')
  })

  it('pins today to Asia/Kolkata and derives the financial year', () => {
    // 31 March 2026, 23:00 UTC is already 1 April in India — the day the
    // financial year turns over.
    expect(todayInIndia(new Date('2026-03-31T23:00:00Z'))).toEqual({
      date: '2026-04-01',
      timeZone: 'Asia/Kolkata',
      financialYear: '2026-27',
      leaveYear: 2026,
    })
    expect(todayInIndia(new Date('2026-03-31T12:00:00Z')).financialYear).toBe('2025-26')
  })
})
