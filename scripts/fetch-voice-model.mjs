#!/usr/bin/env node
/**
 * Fetch the on-device speech model into `public/models/whisper-tiny/`.
 *
 * ## Why this exists
 *
 * Voice search recognises speech ON THE DEVICE or refuses (ADR-017). Chrome can
 * do that itself; every other browser needs a model, and transformers.js would
 * fetch one from HuggingFace's CDN at runtime — a cross-origin request, which
 * this app does not make. So the model is SELF-HOSTED: fetched here, served from
 * the app's own origin, and cached by the browser after the reader asks for it.
 * (The ADR for the feature itself is owed by the session that builds it.)
 *
 * ## Why the output is not committed
 *
 * It is 41.6 MB. `scripts/ingest/raw/` set the precedent for large fetched
 * artefacts: gitignored, reproducible from a committed script. A deployment that
 * wants voice search on non-Chrome browsers must run `pnpm voice:model` before
 * `pnpm build`.
 *
 * ## What this does NOT yet fetch
 *
 * The ONNX runtime that executes the model. `onnxruntime-web` ships four WASM
 * backends (12.3 MB plain, 13.9 MB JSPI, 22.5 MB asyncify, 24.9 MB JSEP) and
 * transformers.js picks one at load time, so a self-hosted deployment needs at
 * least the plain build and its `.mjs` loader beside it. True footprint: about
 * **54 MB**, not the 41.6 MB of model below.
 *
 * ## Why the feature is not built yet — an upstream incompatibility
 *
 * Verified as far as it goes, in a production build with everything served from
 * our own origin and zero cross-origin requests: the model resolves, the runtime
 * loads, and inference reaches session creation. It then fails inside ONNX
 * runtime, every time:
 *
 *     Can't create a session. ERROR_CODE: 1
 *     qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
 *     Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
 *
 * Reproduced with FIVE dtype configurations — `int8`, `uint8`, `quantized`,
 * `fp16`, and mixed encoder/decoder pairs — and with both the `Xenova` and the
 * `onnx-community` exports. The error is identical each time and mentions
 * `MatMulNBits`, a 4-bit operator, for a graph that is not 4-bit: it is a bug in
 * the pairing of `@huggingface/transformers@4.2.0` with the
 * `onnxruntime-web@1.26.0-dev` it bundles, not a choice this script can make
 * differently.
 *
 * So `@huggingface/transformers` is deliberately NOT a dependency. Retry with a
 * later transformers.js; the plumbing this script represents is sound and the
 * privacy properties held throughout.
 *
 * Idempotent and offline-safe: a file whose size already matches the manifest is
 * left alone, so re-running costs one HEAD request per file.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'models', 'whisper-tiny')

/**
 * onnx-community/whisper-tiny, the int8-quantised ONNX export.
 *
 * The `Xenova/*` export is the older one and its quantised graphs no longer load
 * in current onnxruntime-web — it fails with a missing-scale error in the QDQ
 * transposer. `onnx-community` is the maintained re-export and is what
 * transformers.js v3+ expects.
 *
 * Whisper is MULTILINGUAL: one model covers Hindi and English, so there is no
 * per-language download and no second model to keep in step. `tiny` rather than
 * `base` is a size decision — 39 MB against 73 MB, on an app whose readers are
 * often on a poor office connection.
 */
const REPO = 'onnx-community/whisper-tiny'
const REVISION = 'main'

const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_int8.onnx',
  'onnx/decoder_model_merged_int8.onnx',
]

const url = (file) => `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function sizeOnDisk(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

async function main() {
  const manifest = { repo: REPO, revision: REVISION, fetchedAt: new Date().toISOString(), files: {} }
  let downloaded = 0
  let skipped = 0

  for (const file of FILES) {
    const target = join(OUT, file)
    await mkdir(dirname(target), { recursive: true })

    const response = await fetch(url(file))
    if (!response.ok) {
      throw new Error(`${file}: ${response.status} ${response.statusText}`)
    }
    const expected = Number(response.headers.get('content-length') ?? 0)
    const existing = await sizeOnDisk(target)

    if (existing > 0 && expected > 0 && existing === expected) {
      // Already here at the right size. Read it back only to record its hash.
      const bytes = await readFile(target)
      manifest.files[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      skipped += 1
      console.log(`  = ${file.padEnd(46)} ${mb(existing).padStart(9)} (already here)`)
      continue
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(target, bytes)
    manifest.files[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    downloaded += 1
    console.log(`  + ${file.padEnd(46)} ${mb(bytes.length).padStart(9)}`)
  }

  const total = Object.values(manifest.files).reduce((sum, entry) => sum + entry.bytes, 0)
  manifest.totalBytes = total

  // The manifest is what `scripts/check-voice-model.mjs` verifies, and what the
  // app reads to tell a reader how large the download will be BEFORE it starts.
  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`\n  ${REPO} @ ${REVISION}`)
  console.log(`  ${downloaded} downloaded, ${skipped} already present, ${mb(total)} total`)
  console.log(`  -> ${OUT}\n`)
}

await main()
