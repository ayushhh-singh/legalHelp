import { findLocalModel, type LocalModel } from './catalogue'

/**
 * What this device can actually run, asked before anything is downloaded.
 *
 * WebGPU exposes no video-memory figure — there is no `adapter.vram`, by
 * design, because it is a fingerprinting surface. So the guard here is a floor
 * rather than a guarantee, and it is built from the three things a browser
 * WILL answer:
 *
 *   1. whether there is a WebGPU adapter at all;
 *   2. whether that adapter has `shader-f16`, which every q4f16 model needs;
 *   3. `navigator.deviceMemory`, when the browser exposes it — SYSTEM memory,
 *      quantised and capped at 8 by every implementation that ships it.
 *
 * The real out-of-memory failure is a lost WebGPU device several hundred
 * megabytes into a load, and no probe prevents it. What prevents the bad
 * OUTCOME is that `src/ai/local/engine.ts` catches that failure and reports it
 * as a sentence naming a smaller model, rather than as a stack trace. This
 * function is what stops the obviously-doomed attempts before the download.
 */

export interface WebGpuReport {
  supported: boolean
  /** Why not, when `supported` is false. */
  reason?: 'no-webgpu-api' | 'no-adapter' | 'probe-failed'
  shaderF16: boolean
  /** `navigator.deviceMemory` in MB, or null where the browser omits it. */
  deviceMemoryMB: number | null
  /** The largest single buffer the adapter will allocate, in MB. */
  maxBufferMB: number | null
}

export const UNSUPPORTED: WebGpuReport = {
  supported: false,
  reason: 'no-webgpu-api',
  shaderF16: false,
  deviceMemoryMB: null,
  maxBufferMB: null,
}

/**
 * `navigator.gpu` and `navigator.deviceMemory` are both optional, and TypeScript's
 * DOM library has neither on every target this project builds for. Narrowing
 * through a local shape keeps the `any` out of the call sites.
 */
interface GpuAdapterLike {
  features: { has(name: string): boolean }
  limits: Record<string, number>
}

interface GpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<GpuAdapterLike | null>
}

function gpu(): GpuLike | undefined {
  const candidate = (navigator as unknown as { gpu?: GpuLike }).gpu
  return typeof candidate?.requestAdapter === 'function' ? candidate : undefined
}

function deviceMemoryMB(): number | null {
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory
  return typeof gb === 'number' && Number.isFinite(gb) && gb > 0 ? gb * 1024 : null
}

/**
 * Asks the browser once. Cheap — it allocates no device and downloads nothing.
 *
 * `requestAdapter` can reject as well as resolve null (a driver crash, a
 * headless container), and either way the honest answer to the reader is the
 * same, so both land on a report rather than an exception the caller must
 * remember to catch.
 */
export async function probeWebGpu(): Promise<WebGpuReport> {
  const api = gpu()
  if (!api) return { ...UNSUPPORTED, deviceMemoryMB: deviceMemoryMB() }

  try {
    const adapter = await api.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      return { ...UNSUPPORTED, reason: 'no-adapter', deviceMemoryMB: deviceMemoryMB() }
    }
    const maxBuffer = adapter.limits.maxBufferSize
    return {
      supported: true,
      shaderF16: adapter.features.has('shader-f16'),
      deviceMemoryMB: deviceMemoryMB(),
      maxBufferMB: typeof maxBuffer === 'number' ? Math.floor(maxBuffer / (1024 * 1024)) : null,
    }
  } catch {
    return { ...UNSUPPORTED, reason: 'probe-failed', deviceMemoryMB: deviceMemoryMB() }
  }
}

/* ------------------------------------------------------------------ *
 * The guard
 * ------------------------------------------------------------------ */

/**
 * - `ok`              — nothing known stands in the way.
 * - `tight`           — it should load, but this device has little room. Offered
 *                       with a warning rather than refused: the figure it is
 *                       judged against is coarse, and refusing on a coarse
 *                       figure would tell some readers their machine cannot do
 *                       something it can.
 * - `too-large`       — refused. The download would very probably be wasted.
 * - `needs-shader-f16`— refused. This one is not a heuristic: the adapter said so.
 * - `no-webgpu`       — refused, and no model on the list will run here.
 */
export type ModelFit = 'ok' | 'tight' | 'too-large' | 'needs-shader-f16' | 'no-webgpu'

/**
 * The memory guard, as a pure function so it can be tested without a GPU.
 *
 * The ratios are judgement, and they are written here rather than buried in a
 * component so that they can be argued with. A model needs its weights AND a
 * key-value cache AND whatever the browser, the page and the operating system
 * are already holding; half of system memory is the point past which a load is
 * more likely to fail than to succeed, and a quarter is the point past which it
 * is worth warning about. `navigator.deviceMemory` caps at 8 GB in every
 * browser that reports it, so on a 32 GB workstation this compares against 8
 * and every model on the list passes — which is the correct answer arrived at
 * for a slightly wrong reason, and is why the threshold is generous.
 */
export const TOO_LARGE_RATIO = 0.5
export const TIGHT_RATIO = 0.25

/**
 * `navigator.deviceMemory` is quantised AND capped, and the cap is the part
 * that matters here.
 *
 * The specification requires user agents to report one of a small set of
 * values and to clamp the upper end — every implementation that ships it caps
 * at 8. So `8` does not mean "eight gigabytes", it means "eight or more", and
 * a 64 GB workstation reports exactly what an 8 GB laptop reports.
 *
 * A guard that treated the two alike would put a "may be tight on this device"
 * warning on the 3B models for the majority of readers who can run them
 * comfortably — which was the first version of this function, and which its
 * own test caught. At the cap, the figure carries no information and is
 * treated as absent.
 */
export const DEVICE_MEMORY_CAP_MB = 8 * 1024

export function fitFor(model: LocalModel, report: WebGpuReport): ModelFit {
  if (!report.supported) return 'no-webgpu'
  // Checked before memory so the sentence the reader gets is the actionable
  // one: "choose the 32-bit build" is something they can do, and "too large
  // for this device" on a machine whose real problem is a missing feature is
  // not.
  if (model.requiresShaderF16 && !report.shaderF16) return 'needs-shader-f16'

  const memory = report.deviceMemoryMB
  // Firefox and Safari implement no `navigator.deviceMemory` at all, and a
  // value at the cap says only "eight or more". Both mean there is nothing
  // here to compare against, and inventing a default would mean refusing a
  // reader on a number this app made up.
  if (memory === null || memory >= DEVICE_MEMORY_CAP_MB) return 'ok'

  if (model.vramMB > memory * TOO_LARGE_RATIO) return 'too-large'
  if (model.vramMB > memory * TIGHT_RATIO) return 'tight'
  return 'ok'
}

/** `fitFor` by id; an id this build does not know is not runnable. */
export function fitForId(id: string, report: WebGpuReport): ModelFit | 'unknown' {
  const model = findLocalModel(id)
  return model ? fitFor(model, report) : 'unknown'
}

/** True when the fit permits a download at all. `tight` does. */
export function isRunnable(fit: ModelFit | 'unknown'): boolean {
  return fit === 'ok' || fit === 'tight'
}
