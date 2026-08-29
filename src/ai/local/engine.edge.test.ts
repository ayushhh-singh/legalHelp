import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The engine's lifecycle, which had no coverage at all before this pass —
 * `engine.test.ts` reaches only `loadFailureMessage`, because everything else
 * in that file needs a GPU.
 *
 * It is testable now for one reason: the library is behind a single memoised
 * `webllm()` promise. With an `import()` per call site, `vi.mock` was NOT
 * stable under concurrent dynamic import — a second overlapping `import()`
 * resolved to the REAL package and the suite failed with "caches is not
 * defined", which looks exactly like an application defect and is not one. If a
 * future change reintroduces a second import site, this file starts lying
 * before it starts failing.
 */

const created: string[] = []
const unloaded: string[] = []
let release: Record<string, () => void> = {}

vi.mock('@mlc-ai/web-llm', () => ({
  prebuiltAppConfig: {
    model_list: [
      { model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', model: 'https://x', model_lib: 'https://y' },
      { model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', model: 'https://x', model_lib: 'https://y' },
    ],
  },
  CreateMLCEngine: (id: string) => {
    created.push(id)
    return new Promise((resolve) => {
      release[id] = () =>
        resolve({
          unload: () => {
            unloaded.push(id)
            return Promise.resolve()
          },
          chat: {},
          interruptGenerate: () => undefined,
        })
    })
  },
  hasModelInCache: () => Promise.resolve(true),
  deleteModelAllInfoInCache: () => Promise.resolve(),
}))

const A = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
const B = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function engineModule() {
  return import('./engine')
}

beforeEach(async () => {
  const { unloadLocalEngine } = await engineModule()
  await unloadLocalEngine()
  created.length = 0
  unloaded.length = 0
  release = {}
})

describe('two loads at once', () => {
  it('never has two engines initialising on one WebGPU device', async () => {
    /*
      The defect this replaces: `ensureLocalEngine` returned the in-flight
      promise only when the model ids MATCHED, and otherwise called `load()`
      straight away. `load()` unloads the current engine first — but during
      another load there is no current engine yet, so nothing stopped a second
      `CreateMLCEngine`. The comment in that function claimed the opposite.

      Reachable: a reader with a run streaming on /law walks to Settings and
      presses Download on a different model.
    */
    const { ensureLocalEngine } = await engineModule()

    const first = ensureLocalEngine(A)
    await tick()
    const second = ensureLocalEngine(B)
    await tick()

    expect(created, 'B started before A had finished').toEqual([A])

    release[A]?.()
    await first
    await tick()
    expect(created).toEqual([A, B])

    release[B]?.()
    await second
    // A left the GPU before B arrived on it.
    expect(unloaded).toEqual([A])
  })

  it('joins a load already in flight for the same model instead of starting a second', async () => {
    const { ensureLocalEngine } = await engineModule()
    const first = ensureLocalEngine(A)
    const second = ensureLocalEngine(A)
    await tick()
    expect(created).toEqual([A])
    release[A]?.()
    expect(await first).toBe(await second)
  })

  it('a failed load does not take the load queued behind it down too', async () => {
    const { ensureLocalEngine } = await engineModule()
    // An id this build does not offer is refused before anything is created.
    const bad = ensureLocalEngine('Qwen3-8B-q4f16_1-MLC').catch((error: Error) => error.message)
    const good = ensureLocalEngine(A)
    await tick()
    release[A]?.()

    expect(await bad).toContain('does not offer')
    await expect(good).resolves.toBeDefined()
    expect(created).toEqual([A])
  })
})

describe('unloading while a load is in flight', () => {
  it('does not let the finishing load resurrect the model, and releases it', async () => {
    // Without the epoch, `load()` simply assigned `engine` when it finished and
    // the reader's unload was silently undone — leaving a model on the GPU that
    // Settings reported as unloaded.
    const { ensureLocalEngine, unloadLocalEngine, loadedLocalModelId } = await engineModule()

    const load = ensureLocalEngine(A).catch((error: Error) => `err:${error.message}`)
    await tick()
    await unloadLocalEngine()
    release[A]?.()

    expect(await load).toContain('unloaded while it was loading')
    expect(loadedLocalModelId()).toBeNull()
    // The engine that did finish arriving is released rather than left holding
    // the device with nothing referencing it.
    expect(unloaded).toEqual([A])
  })
})
