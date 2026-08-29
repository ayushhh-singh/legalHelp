import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, findLocalModel, isLocalModelId } from './catalogue'

/**
 * The curated shortlist, checked against `@mlc-ai/web-llm`'s own records.
 *
 * This is the same arrangement `tests/law-data.test.ts` has with `data/law`:
 * the figures shown to the reader are read back out of the source they were
 * taken from, so a library upgrade that renames a model, drops one, or
 * re-measures its memory requirement fails here rather than shipping a picker
 * that quotes a number nobody can reproduce.
 *
 * It is the one place in the unit suite that imports web-llm, and it does so
 * dynamically inside the test — a static import would put ~6 MB into every
 * worker that touches this directory.
 */

describe('LOCAL_MODELS', () => {
  it('has a default that is on the list', () => {
    expect(findLocalModel(DEFAULT_LOCAL_MODEL)).toBeDefined()
  })

  it('offers no duplicate id', () => {
    expect(new Set(LOCAL_MODELS.map((model) => model.id)).size).toBe(LOCAL_MODELS.length)
  })

  it('stays within what a work machine can hold', () => {
    // A 7B model at q4f16 wants roughly 5 GB and is not offered. If a future
    // session wants to raise this, raise it deliberately — the reason it is
    // low is that a failed load AFTER a long download is the worst outcome
    // this tier can produce.
    for (const model of LOCAL_MODELS) {
      expect(model.vramMB, model.id).toBeLessThan(3_000)
    }
  })

  it('offers at least one model for a GPU with no shader-f16', () => {
    // Otherwise "your graphics card cannot run any of these" is the answer an
    // ordinary office machine gets, and Tier 0 is a feature nobody can use.
    expect(LOCAL_MODELS.some((model) => !model.requiresShaderF16)).toBe(true)
  })

  it('marks every q4f16 build as needing shader-f16, and no q4f32 build', () => {
    // The naming is MLC's own and it is the fact the guard turns on.
    for (const model of LOCAL_MODELS) {
      expect(model.requiresShaderF16, model.id).toBe(model.id.includes('q4f16'))
    }
  })

  it('answers isLocalModelId for its own ids and for nothing else', () => {
    expect(isLocalModelId(DEFAULT_LOCAL_MODEL)).toBe(true)
    // The one that matters: an Anthropic id must not be priced at zero.
    expect(isLocalModelId('claude-sonnet-4-6')).toBe(false)
    expect(isLocalModelId('')).toBe(false)
  })
})

describe('against web-llm’s own prebuiltAppConfig', () => {
  it('names only models the installed library actually ships', async () => {
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm')
    const known = new Map(prebuiltAppConfig.model_list.map((record) => [record.model_id, record]))

    for (const model of LOCAL_MODELS) {
      const record = known.get(model.id)
      expect(record, `${model.id} is not in prebuiltAppConfig`).toBeDefined()
      // The size the picker quotes is the library's own figure, to the
      // hundredth of a megabyte, not a rounding of it.
      expect(record?.vram_required_MB, model.id).toBe(model.vramMB)
      expect(record?.overrides?.context_window_size, model.id).toBe(model.contextWindow)
    }
  })

  it('downloads every model from a host the CSP names', async () => {
    // public/_headers permits huggingface.co (and its CDNs) and
    // raw.githubusercontent.com for exactly this, and nothing else. A record
    // pointing anywhere else would be refused by the browser several hundred
    // megabytes in, with no error a reader could act on.
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm')
    const known = new Map(prebuiltAppConfig.model_list.map((record) => [record.model_id, record]))

    for (const model of LOCAL_MODELS) {
      const record = known.get(model.id)
      expect(new URL(record?.model ?? '').host, `${model.id} weights`).toBe('huggingface.co')
      expect(new URL(record?.model_lib ?? '').host, `${model.id} library`).toBe('raw.githubusercontent.com')
    }
  })
})
