import { describe, expect, it } from 'vitest'

import { loadFailureMessage } from './engine'

/**
 * The one part of `engine.ts` that can be tested without a GPU, and the part
 * most worth testing: what an officer is told when the load fails.
 *
 * The two failures that actually happen — a lost WebGPU device, which is what
 * running out of graphics memory looks like from JavaScript, and a missing
 * `shader-f16` — both have a real remedy, and "Error: Device lost" names
 * neither of them. The memory guard in `webgpu.ts` makes these less likely; it
 * cannot make them impossible, because WebGPU exposes no video-memory figure
 * to guard against.
 */

describe('loadFailureMessage', () => {
  it('turns a lost device into the remedy: a smaller model', () => {
    for (const raw of [
      'Device was lost.',
      'GPUDevice lost: out of memory',
      'The WebGPU device was destroyed',
    ]) {
      expect(loadFailureMessage(new Error(raw)), raw).toContain('smaller')
    }
  })

  it('turns a missing shader-f16 into the remedy: the 32-bit build', () => {
    // The list carries a q4f32 model for exactly this, so the sentence names
    // something the reader can actually select.
    expect(loadFailureMessage(new Error('Feature shader-f16 is not supported'))).toContain('32-bit')
  })

  it('names WebGPU when there is no adapter', () => {
    expect(loadFailureMessage(new Error('Cannot find adapter for WebGPU'))).toContain('WebGPU')
  })

  it('passes an unrecognised failure through rather than replacing it with a shrug', () => {
    // A message this app cannot improve on is still the most informative thing
    // available, and swallowing it would leave a reader with nothing to report.
    expect(loadFailureMessage(new Error('mlc: unexpected shard checksum'))).toBe(
      'mlc: unexpected shard checksum',
    )
  })

  it('survives a thrown non-Error and an empty message', () => {
    expect(loadFailureMessage('just a string')).toBe('just a string')
    expect(loadFailureMessage(new Error(''))).toBe('The on-device model could not be loaded.')
  })
})
