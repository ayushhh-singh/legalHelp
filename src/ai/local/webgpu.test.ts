import { afterEach, describe, expect, it } from 'vitest'

import { LOCAL_MODELS, findLocalModel, type LocalModel } from './catalogue'
import {
  DEVICE_MEMORY_CAP_MB,
  TIGHT_RATIO,
  TOO_LARGE_RATIO,
  UNSUPPORTED,
  fitFor,
  fitForId,
  isRunnable,
  probeWebGpu,
  type WebGpuReport,
} from './webgpu'

/**
 * The memory guard, which is a judgement call and is therefore written as a
 * pure function that can be argued with in a test rather than as a condition
 * inside a component.
 *
 * What it CANNOT do is worth stating: WebGPU exposes no video-memory figure,
 * so nothing here predicts an out-of-memory failure. It stops the attempts
 * that are obviously doomed before a gigabyte is downloaded; the real failure
 * is caught by `loadFailureMessage`, and there is a test for that too.
 */

const F16 = findLocalModel('Llama-3.2-1B-Instruct-q4f16_1-MLC') as LocalModel
const F32 = findLocalModel('Llama-3.2-1B-Instruct-q4f32_1-MLC') as LocalModel
const BIG = findLocalModel('Qwen2.5-3B-Instruct-q4f16_1-MLC') as LocalModel

const report = (over: Partial<WebGpuReport> = {}): WebGpuReport => ({
  supported: true,
  shaderF16: true,
  deviceMemoryMB: 8 * 1024,
  maxBufferMB: 2048,
  ...over,
})

describe('fitFor', () => {
  it('refuses everything when there is no WebGPU', () => {
    for (const model of LOCAL_MODELS) {
      expect(fitFor(model, UNSUPPORTED), model.id).toBe('no-webgpu')
    }
  })

  it('refuses a q4f16 model on an adapter with no shader-f16, and allows the q4f32 one', () => {
    // This one is not a heuristic — the adapter said so — which is why it is a
    // refusal rather than a warning, and why the list carries a 32-bit build.
    expect(fitFor(F16, report({ shaderF16: false }))).toBe('needs-shader-f16')
    expect(fitFor(F32, report({ shaderF16: false }))).toBe('ok')
  })

  it('warns about nothing at the reported-memory cap', () => {
    // navigator.deviceMemory caps at 8 in every browser that ships it, so `8`
    // means "eight or more" and a 64 GB workstation reports what an 8 GB
    // laptop reports. This is the common case, and the first version of
    // fitFor() put a warning on both 3B models for all of it — which is what
    // this assertion, failing, is what caught.
    for (const model of LOCAL_MODELS) {
      expect(fitFor(model, report()), model.id).toBe('ok')
      expect(fitFor(model, report({ deviceMemoryMB: DEVICE_MEMORY_CAP_MB * 4 })), model.id).toBe('ok')
    }
  })

  it('warns before it refuses, as memory falls below the cap', () => {
    // 2.5 GB against 4 GB is past half — refused. Against 6 GB it is past a
    // quarter but under half — a warning, not a refusal.
    expect(fitFor(BIG, report({ deviceMemoryMB: 4 * 1024 }))).toBe('too-large')
    expect(fitFor(BIG, report({ deviceMemoryMB: 6 * 1024 }))).toBe('tight')
    // The 1B model is comfortable on the same 4 GB machine that cannot take
    // the 3B one, which is the whole point of offering a range.
    expect(fitFor(F16, report({ deviceMemoryMB: 4 * 1024 }))).toBe('ok')
  })

  it('puts the boundaries exactly where the ratios say', () => {
    // Exact, not rounded: rounding 1758.08 down to 1758 moves the boundary by
    // 0.04 MB and flips the answer, which is a fair warning that `>` rather
    // than `>=` is a real choice here and not a detail.
    const memoryAt = (ratio: number) => F16.vramMB / ratio
    // 879.04 MB / 0.5 = 1758.08 MB: exactly at the line is not over it.
    expect(fitFor(F16, report({ deviceMemoryMB: memoryAt(TOO_LARGE_RATIO) }))).toBe('tight')
    expect(fitFor(F16, report({ deviceMemoryMB: memoryAt(TOO_LARGE_RATIO) - 10 }))).toBe('too-large')
    // 879 MB / 0.25 = 3516 MB, still under the cap, so the ratio decides.
    expect(fitFor(F16, report({ deviceMemoryMB: memoryAt(TIGHT_RATIO) }))).toBe('ok')
    expect(fitFor(F16, report({ deviceMemoryMB: memoryAt(TIGHT_RATIO) - 10 }))).toBe('tight')
  })

  it('does not refuse when the browser reports no memory figure at all', () => {
    // Firefox and Safari implement no navigator.deviceMemory. Inventing a
    // default would mean refusing a reader on a number this app made up.
    expect(fitFor(BIG, report({ deviceMemoryMB: null }))).toBe('ok')
  })

  it('checks shader-f16 before memory, so the actionable reason is the one shown', () => {
    expect(fitFor(F16, report({ shaderF16: false, deviceMemoryMB: 1024 }))).toBe('needs-shader-f16')
  })
})

describe('fitForId and isRunnable', () => {
  it('treats an unknown id as unrunnable', () => {
    expect(fitForId('Qwen3-8B-q4f16_1-MLC', report())).toBe('unknown')
    expect(isRunnable('unknown')).toBe(false)
  })

  it('allows a download on a tight fit and refuses one on the rest', () => {
    expect(isRunnable('ok')).toBe(true)
    expect(isRunnable('tight')).toBe(true)
    expect(isRunnable('too-large')).toBe(false)
    expect(isRunnable('needs-shader-f16')).toBe(false)
    expect(isRunnable('no-webgpu')).toBe(false)
  })
})

describe('probeWebGpu', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'gpu')

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'gpu', original)
    else delete (navigator as unknown as Record<string, unknown>).gpu
  })

  const stub = (value: unknown) =>
    Object.defineProperty(navigator, 'gpu', { value, configurable: true, writable: true })

  it('reports no WebGPU when navigator.gpu is absent — which is jsdom, and is Firefox today', async () => {
    delete (navigator as unknown as Record<string, unknown>).gpu
    const result = await probeWebGpu()
    expect(result.supported).toBe(false)
    expect(result.reason).toBe('no-webgpu-api')
  })

  it('reports no adapter separately from no API', async () => {
    // The two have different remedies — one is "use another browser", the
    // other is "hardware acceleration is switched off" — so they are different
    // sentences and must be different reasons.
    stub({ requestAdapter: () => Promise.resolve(null) })
    expect((await probeWebGpu()).reason).toBe('no-adapter')
  })

  it('reads the feature and the buffer limit off the adapter', async () => {
    stub({
      requestAdapter: () =>
        Promise.resolve({
          features: { has: (name: string) => name === 'shader-f16' },
          limits: { maxBufferSize: 1024 * 1024 * 1024 },
        }),
    })
    const result = await probeWebGpu()
    expect(result.supported).toBe(true)
    expect(result.shaderF16).toBe(true)
    expect(result.maxBufferMB).toBe(1024)
  })

  it('turns a rejected requestAdapter into a report, not an exception', async () => {
    // A driver crash and a headless container both land here, and the honest
    // answer to the reader is the same either way — so a caller must not have
    // to remember a try/catch.
    stub({ requestAdapter: () => Promise.reject(new Error('driver went away')) })
    const result = await probeWebGpu()
    expect(result.supported).toBe(false)
    expect(result.reason).toBe('probe-failed')
  })
})
