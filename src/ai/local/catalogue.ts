/**
 * The on-device models Sahayak offers, and nothing else.
 *
 * `@mlc-ai/web-llm` ships a `prebuiltAppConfig` of roughly 165 records — 8B
 * models, vision models, embedding models, four quantisations of each. Handing
 * that list to an officer would be handing them a way to start a seven-gigabyte
 * download on a work laptop. So this is a curated shortlist, the same posture
 * `data/law/overlays/` takes towards a generated dataset: the machine-readable
 * source is the authority for the FIGURES, and a human decides which rows are
 * offered.
 *
 * `src/ai/local/catalogue.test.ts` reads every id and every `vramMB` back out
 * of `prebuiltAppConfig` and fails if they disagree, so a web-llm upgrade that
 * renames or re-measures a model cannot ship a picker that lies.
 *
 * This is deliberately NOT in `src/ai/models.ts`. That file is one constants
 * module for the API models — ids, prices, effort levels, what the wire may
 * carry. Nothing here has a price or an effort level, and everything here has
 * a download size and a graphics-memory requirement. They are two different
 * kinds of thing that happen to share the word "model".
 */

/** How well the model writes Hindi. Resolved to a sentence by the UI. */
export type HindiQuality = 'poor' | 'limited' | 'usable'

export interface LocalModel {
  /** web-llm's `model_id`. The one identifier that must match exactly. */
  id: string
  /** Shown in the picker. A proper name, so it is not translated. */
  label: string
  /**
   * `vram_required_MB` from web-llm's own record: the graphics memory the
   * model needs once loaded, and the closest thing to a download size the
   * package states. The download is a little smaller — the difference is the
   * key-value cache, which is allocated rather than fetched — so this is shown
   * as an upper bound and labelled as one. docs/DATA-GAPS.md #68.
   */
  vramMB: number
  /**
   * q4f16 weights need the `shader-f16` WebGPU feature. Several integrated
   * GPUs and every WebGPU implementation on an older browser lack it, and the
   * failure without this check is a device-lost error several hundred
   * megabytes into a download.
   */
  requiresShaderF16: boolean
  /** `overrides.context_window_size` from the same record. */
  contextWindow: number
  hindi: HindiQuality
}

/**
 * Five models, spanning roughly 0.9 GB to 2.5 GB.
 *
 * Nothing larger is offered. A 7B model at q4f16 wants ~5 GB of graphics
 * memory, which on the machines this app is actually used on means a failed
 * load after a very long download — and the agents here are grounded lookups
 * over bundled tables, where a 3B model reading a section aloud is worth more
 * than a 7B model the device cannot start.
 *
 * The two 1B entries are the same weights at two precisions. The q4f32 one is
 * larger and slower and exists solely for a GPU with no `shader-f16`, so that
 * "your graphics card cannot run any of these" is not the answer a reader on
 * an ordinary office machine gets.
 */
export const LOCAL_MODELS: readonly LocalModel[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    vramMB: 879.04,
    requiresShaderF16: true,
    contextWindow: 4096,
    hindi: 'poor',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama 3.2 1B Instruct (32-bit)',
    vramMB: 1128.82,
    requiresShaderF16: false,
    contextWindow: 4096,
    hindi: 'poor',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B Instruct',
    vramMB: 1629.75,
    requiresShaderF16: true,
    contextWindow: 4096,
    hindi: 'limited',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B Instruct',
    vramMB: 2263.69,
    requiresShaderF16: true,
    contextWindow: 4096,
    hindi: 'limited',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 3B Instruct',
    vramMB: 2504.76,
    requiresShaderF16: true,
    contextWindow: 4096,
    hindi: 'usable',
  },
] as const

/**
 * The one this app suggests: the smallest that is not the 1B.
 *
 * A 1B model can follow the tool protocol but writes a poor answer, and a
 * reader who tried Tier 0 once on a 1B and concluded "the AI is useless" is a
 * reader the default failed. 1.6 GB is a real download and it is the honest
 * floor for something worth reading.
 */
export const DEFAULT_LOCAL_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'

export function findLocalModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find((model) => model.id === id)
}

/**
 * True for a model id this app runs on the device.
 *
 * `src/ai/usage.ts#estimateCost` reads it: `resolveModel()` prices an id it
 * does not recognise at the DEFAULT model's rate, which is right for a typo in
 * a settings row and very wrong for a local run — it would show the reader a
 * dollar figure for tokens nobody was billed for.
 */
export function isLocalModelId(id: string): boolean {
  return LOCAL_MODELS.some((model) => model.id === id)
}
