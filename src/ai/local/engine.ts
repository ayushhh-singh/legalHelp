import type { AppConfig, InitProgressReport, MLCEngineInterface, ModelRecord } from '@mlc-ai/web-llm'

import { LOCAL_MODELS, findLocalModel } from './catalogue'
import type { LocalMessage } from './protocol'
import { AiError, EMPTY_USAGE, type StopReason, type TokenUsage } from '../types'

/**
 * The one on-device engine, and its lifecycle.
 *
 * A module singleton rather than a field on `LocalProvider`, because
 * `useAi()` builds a fresh provider whenever the settings change and a model
 * on the GPU must survive that: re-loading 1.6 GB of weights because the
 * reader toggled the answer cache would be absurd. `unloadLocalEngine()` is
 * the only thing that gives the memory back.
 *
 * EVERY reference to `@mlc-ai/web-llm` in this file is a dynamic `import()`
 * inside a function, and the one static import is `import type`, which is
 * erased. That is a privacy and a bandwidth property, not a style: the library
 * is ~6 MB of JavaScript, and a reader who never chooses Tier 0 must never
 * fetch it. `tests/bundle-budget.test.ts` asserts the initial route does not
 * name it; `vite.config.ts` keeps its chunk out of the service worker's
 * precache for the same reason `og.png` is kept out (ADR-037).
 */

export interface LoadProgress {
  /** 0..1, as web-llm reports it. */
  progress: number
  /** web-llm's own English progress line — shard counts, cache hits. */
  text: string
}

export interface LoadOptions {
  onProgress?: (progress: LoadProgress) => void
  signal?: AbortSignal
}

let engine: MLCEngineInterface | null = null
let loadedModelId: string | null = null
/** In flight, keyed by model id, so two callers share one load. */
const pending = new Map<string, Promise<MLCEngineInterface>>()
/** Loads run one at a time; each new one chains behind this. */
let queue: Promise<unknown> = Promise.resolve()
/**
 * Bumped by every unload. A load or a generation that started under an older
 * epoch knows the engine it was working with is gone — which is the difference
 * between reporting "the model was unloaded" and reporting an out-of-memory
 * failure that never happened.
 */
let epoch = 0

/**
 * ONE dynamic import of the library, shared by every caller.
 *
 * Not merely tidier than an `import()` per function: the four call sites here
 * can run concurrently, and a module resolved several times over is several
 * megabytes of parsing the browser did not need to repeat. A failed import is
 * deliberately NOT cached — a network blip on the first press would otherwise
 * make every later press fail with the same stale rejection.
 *
 * That reset branch is the one thing in this file with no test behind it, said
 * plainly rather than left to be discovered: exercising it means swapping the
 * module mock mid-file, and `vi.doMock` reports its own wrapper error rather
 * than the thrown one, so the only assertion available would have been about
 * vitest. A test that cannot fail for the right reason is not evidence.
 */
let webllmModule: Promise<typeof import('@mlc-ai/web-llm')> | null = null

function webllm(): Promise<typeof import('@mlc-ai/web-llm')> {
  webllmModule ??= import('@mlc-ai/web-llm').catch((error: unknown) => {
    webllmModule = null
    throw error
  })
  return webllmModule
}

export function loadedLocalModelId(): string | null {
  return loadedModelId
}

/**
 * The app config the engine is given: our five records and nothing else.
 *
 * web-llm's `prebuiltAppConfig` lists ~165 models. Narrowing it here means a
 * settings row naming `Qwen3-8B` — hand-edited, or written by a build that
 * offered more — cannot start a seven-gigabyte download, because the engine
 * has never heard of it. The picker is the policy and this is the enforcement,
 * the same split `parseAiSettings` uses for the tier.
 */
async function appConfigFor(): Promise<AppConfig> {
  const { prebuiltAppConfig } = await webllm()
  const offered = new Set(LOCAL_MODELS.map((model) => model.id))
  const list = prebuiltAppConfig.model_list.filter((record: ModelRecord) => offered.has(record.model_id))
  return { ...prebuiltAppConfig, model_list: list }
}

/**
 * True once the weights are in the Cache API — i.e. the model will start
 * without a download.
 *
 * This is what `AiSettings.localModelInstalled` mirrors, and it is read back
 * from the browser rather than trusted from the settings row, exactly as
 * `AiSettingsSection` already reconciles `hasKey` against `hasStoredKey()`.
 */
export async function isLocalModelCached(modelId: string): Promise<boolean> {
  if (!findLocalModel(modelId)) return false
  try {
    const [{ hasModelInCache }, appConfig] = await Promise.all([webllm(), appConfigFor()])
    return await hasModelInCache(modelId, appConfig)
  } catch {
    // A browser with no Cache API, or a storage bucket the user has cleared
    // mid-question. "Not cached" is the safe answer: the worst it causes is an
    // offer to download something already downloaded.
    return false
  }
}

/** Frees the GPU device. The download stays; loading again is quick. */
export async function unloadLocalEngine(): Promise<void> {
  // Bumped BEFORE anything awaits, so a load or a generation already in flight
  // sees it the moment it next looks. Without this an in-flight load simply
  // reassigns `engine` when it finishes and the unload is silently undone.
  epoch += 1
  const current = engine
  engine = null
  loadedModelId = null
  pending.clear()
  if (current) await current.unload()
}

/**
 * Deletes the weights, the tokenizer and the chat config from the Cache API.
 *
 * Unloads first when it is the model on the GPU: deleting the files under a
 * running engine leaves a model in memory that nothing on this screen claims
 * is installed, which is precisely the drift the reconciliation above exists
 * to prevent.
 */
export async function deleteLocalModel(modelId: string): Promise<void> {
  if (loadedModelId === modelId) await unloadLocalEngine()
  const [{ deleteModelAllInfoInCache }, appConfig] = await Promise.all([webllm(), appConfigFor()])
  await deleteModelAllInfoInCache(modelId, appConfig)
}

/**
 * Loads the model if it is not already loaded, and returns the engine.
 *
 * ON CANCELLATION. `signal` stops the WAITING, not the transfer: web-llm's
 * loader takes no AbortSignal, and there is no way from here to stop a fetch it
 * started. What cancelling does is stop reporting progress, return control to
 * the reader, and unload whatever finishes arriving. Nothing is wasted — the
 * shards already written are in the Cache API, and pressing Download again
 * continues from there rather than starting over. That resumability is web-llm's,
 * not this file's, and it is the reason the Cache API backend is left at its
 * default rather than swapped for IndexedDB.
 */
export async function ensureLocalEngine(
  modelId: string,
  options: LoadOptions = {},
): Promise<MLCEngineInterface> {
  const model = findLocalModel(modelId)
  if (!model) {
    throw new AiError('not_configured', `This build does not offer the on-device model "${modelId}".`)
  }

  if (engine && loadedModelId === modelId) return engine

  // A second caller asking for the SAME model joins the load in flight rather
  // than starting a second one.
  const inFlight = pending.get(modelId)
  if (inFlight) return inFlight

  /*
    A caller asking for a DIFFERENT model waits, and until this edge-case pass
    it did not — the old code checked only whether the in-flight load was for
    the same id and otherwise called `load()` immediately. `load()` unloads the
    current engine first, but during another load there IS no current engine
    yet, so nothing stopped two `CreateMLCEngine` calls initialising on one
    WebGPU device at once. The comment there claimed the opposite, which is the
    worst kind of wrong: it described an invariant nothing enforced.

    Reachable from the app: a reader with a run streaming on `/law` walks to
    Settings and presses Download on a different model. Serialising is the whole
    fix — each load still unloads whatever came before it, in order.
  */
  const previous = queue
  const promise = (async () => {
    // A failed or cancelled predecessor must not take this load down with it.
    await previous.catch(() => undefined)
    // It may have loaded exactly what we came for while we waited.
    if (engine && loadedModelId === modelId) return engine
    return load(modelId, options)
  })()

  pending.set(modelId, promise)
  queue = promise
  try {
    return await promise
  } finally {
    if (pending.get(modelId) === promise) pending.delete(modelId)
  }
}

async function load(modelId: string, options: LoadOptions): Promise<MLCEngineInterface> {
  // Switching models means the old one leaves the GPU first.
  if (engine) await unloadLocalEngine()

  const startedAt = epoch
  let cancelled = false
  const onAbort = () => {
    cancelled = true
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const [{ CreateMLCEngine }, appConfig] = await Promise.all([webllm(), appConfigFor()])

    const created = await CreateMLCEngine(modelId, {
      appConfig,
      initProgressCallback: (report: InitProgressReport) => {
        // Progress after a cancel would keep a bar moving under a panel the
        // reader has already dismissed.
        if (cancelled) return
        options.onProgress?.({ progress: report.progress, text: report.text })
      },
    })

    // `epoch !== startedAt` means somebody unloaded while this was loading.
    // Assigning `engine` here would resurrect a model the reader asked to be
    // rid of, and the engine that just finished has to be released rather than
    // left holding the GPU with nothing referencing it.
    if (cancelled || epoch !== startedAt) {
      await created.unload()
      throw new AiError(
        'aborted',
        cancelled ? 'The download was cancelled.' : 'The model was unloaded while it was loading.',
      )
    }

    engine = created
    loadedModelId = modelId
    return created
  } catch (error) {
    engine = null
    loadedModelId = null
    if (error instanceof AiError) throw error
    throw new AiError('provider', loadFailureMessage(error))
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Turns web-llm's failure into a sentence an officer can act on.
 *
 * The two that actually happen are a lost WebGPU device — which is what
 * running out of graphics memory looks like from JavaScript, and which the
 * memory guard in `webgpu.ts` can only make less likely — and a missing
 * `shader-f16`. Both have a real remedy, and "Error: Device lost" names
 * neither of them.
 */
export function loadFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const lowered = raw.toLowerCase()

  if (lowered.includes('device') && (lowered.includes('lost') || lowered.includes('destroyed'))) {
    return 'This device ran out of graphics memory while loading the model. Choose a smaller one, or close other tabs and try again.'
  }
  if (lowered.includes('shader-f16') || lowered.includes('f16')) {
    return 'This graphics card cannot run the 16-bit version of this model. Choose the 32-bit one.'
  }
  if (lowered.includes('webgpu') || lowered.includes('adapter')) {
    return 'This browser has no WebGPU support, so an on-device model cannot run here.'
  }
  return raw || 'The on-device model could not be loaded.'
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * One turn of generation, in this app's own vocabulary rather than OpenAI's.
 *
 * `LocalProvider` is written against this function type and nothing else, so
 * `src/ai/providers/local.test.ts` exercises the whole provider — the tool
 * protocol, the two-step cap, cancellation, usage accounting — against a
 * scripted stub, with no GPU, no download and no web-llm import. That is the
 * same arrangement `MockProvider` gives the agents one level up.
 */
export interface LocalGenerateRequest {
  messages: readonly LocalMessage[]
  maxTokens: number
  /** Constrain the decoder to a JSON object. */
  jsonMode: boolean
  /** A JSON Schema, stringified, when the caller demanded a specific shape. */
  jsonSchema?: string
  onToken?: (text: string) => void
  signal?: AbortSignal
}

export interface LocalGenerateResult {
  text: string
  usage: TokenUsage
  stopReason: StopReason
}

export type LocalGenerate = (request: LocalGenerateRequest) => Promise<LocalGenerateResult>

/**
 * The real one. Requires the model to be CACHED already — a chat that quietly
 * started a 1.6 GB download because the reader pressed "Ask" would be exactly
 * the surprise this whole tier exists to avoid. The download is a deliberate
 * act in Settings, and `not_installed` is what sends the reader there.
 */
export function engineGenerate(modelId: string): LocalGenerate {
  return async (request) => {
    if (loadedModelId !== modelId || !engine) {
      if (!(await isLocalModelCached(modelId))) {
        throw new AiError(
          'not_installed',
          'This on-device model has not been downloaded yet. Download it in Settings first.',
        )
      }
    }

    const active = await ensureLocalEngine(modelId, request.signal ? { signal: request.signal } : {})

    const startedAt = epoch
    try {
      return await streamCompletion(active, request)
    } catch (error) {
      /*
        A generation running against an engine somebody else unloaded fails
        with a lost/destroyed WebGPU device — which `loadFailureMessage` maps,
        correctly for a LOAD, to "this device ran out of graphics memory,
        choose a smaller model". Here that is a wrong diagnosis of a real
        event, and acting on it means downloading a smaller model to fix
        something that was never about memory.

        The epoch is what tells the two apart, and it is checked only on the
        failure path so a normal run pays nothing for it.
      */
      if (epoch !== startedAt) {
        throw new AiError(
          'provider',
          'The on-device model was unloaded while this answer was being written. Load it again in Settings.',
        )
      }
      throw error
    }
  }
}

async function streamCompletion(
  active: MLCEngineInterface,
  request: LocalGenerateRequest,
): Promise<LocalGenerateResult> {
  let text = ''
  let usage: TokenUsage = { ...EMPTY_USAGE }
  let stopReason: StopReason = 'end_turn'

  try {
    const stream = await active.chat.completions.create({
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      stream: true,
      // The last chunk then carries prompt/completion counts, which is the only
      // way this tier can report usage at all.
      stream_options: { include_usage: true },
      max_tokens: request.maxTokens,
      // Deterministic. Two officers asking the same question of the same local
      // model should get the same answer, and a tool call is a structure rather
      // than a piece of writing — there is nothing here for sampling to improve.
      temperature: 0,
      ...(request.jsonSchema
        ? { response_format: { type: 'json_object' as const, schema: request.jsonSchema } }
        : request.jsonMode
          ? { response_format: { type: 'json_object' as const } }
          : {}),
    })

    for await (const chunk of stream) {
      if (request.signal?.aborted) {
        active.interruptGenerate()
        throw new AiError('aborted', 'Cancelled.')
      }
      const choice = chunk.choices[0]
      const delta = choice?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta
        request.onToken?.(delta)
      }
      if (choice?.finish_reason === 'length') stopReason = 'max_tokens'
      if (chunk.usage) {
        usage = {
          ...EMPTY_USAGE,
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        }
      }
    }
  } catch (error) {
    if (error instanceof AiError) throw error
    if (request.signal?.aborted) throw new AiError('aborted', 'Cancelled.')
    throw new AiError('provider', loadFailureMessage(error))
  }

  return { text, usage, stopReason }
}
