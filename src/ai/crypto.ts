import { AiError } from './types'

/**
 * The key vault: AES-GCM encryption of the reader's own API key, at rest in
 * IndexedDB.
 *
 * ── THREAT MODEL, honestly ──────────────────────────────────────────────────
 *
 * WHAT THIS DEFENDS AGAINST
 *   • Someone who reads the IndexedDB file off the disk, or opens DevTools and
 *     looks at the `secrets` table, sees ciphertext rather than `sk-ant-…`.
 *   • A future export/backup feature that dumps tables cannot leak a usable key.
 *   • In `passphrase` mode, an attacker with the whole browser profile still
 *     needs the passphrase: the key is derived by PBKDF2-SHA256 over 600,000
 *     iterations and is never written down.
 *
 * WHAT IT DOES NOT DEFEND AGAINST — and cannot, in a browser
 *   • ANY code running on this origin. A cross-site-scripting bug, a malicious
 *     browser extension with host access, or a compromised dependency can call
 *     `readSecret()` exactly as the app does. Encryption at rest never stops
 *     code executing inside the process that is allowed to decrypt.
 *   • `device` mode against an attacker who has the browser profile. The key
 *     material lives in the same IndexedDB as the ciphertext; that mode raises
 *     the bar to "run code in this origin", nothing more. It is the default
 *     because a passphrase prompt on every session is a bad trade for a key
 *     the reader can revoke in one click at console.anthropic.com — but it is
 *     obfuscation-plus, not secrecy, and the consent modal says so.
 *   • Anthropic seeing the prompts. Tier 1 is the reader's own key talking to
 *     Anthropic; what is sent is sent.
 *
 * The mitigation that actually matters is the standing rule the AI banner
 * repeats on every surface: do not enter official, sensitive or classified
 * content. No cryptography in a web page substitutes for that.
 *
 * `device` mode does use one real browser guarantee: the AES key is generated
 * NON-EXTRACTABLE, so `crypto.subtle.exportKey` on it throws. The stored
 * CryptoKey handle can be used to decrypt but not read out, which means a
 * table dump — the realistic leak — yields nothing reusable elsewhere.
 */

export const VAULT_MODES = ['device', 'passphrase'] as const
export type VaultMode = (typeof VAULT_MODES)[number]

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface EncryptedPayload {
  iv: Uint8Array
  ciphertext: Uint8Array
}

function subtle(): SubtleCrypto {
  const available = globalThis.crypto?.subtle
  if (!available) {
    // Non-secure origins have no WebCrypto. Fail loudly rather than storing
    // a key in the clear.
    throw new AiError('not_configured', 'WebCrypto is unavailable; a key cannot be stored safely.')
  }
  return available
}

/**
 * Normalises a value read back out of IndexedDB into a byte array this realm
 * owns.
 *
 * `instanceof Uint8Array` is the wrong check here and would be a latent bug in
 * the browser too: a structured clone can hand back a view whose prototype
 * comes from another realm, and the test environment (jsdom over Node's
 * WebCrypto) reproduces exactly that. `ArrayBuffer.isView` is realm-agnostic.
 */
export function toBytes(value: unknown): Uint8Array | undefined {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return undefined
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

export const newSalt = (): Uint8Array => randomBytes(SALT_BYTES)

/**
 * Non-extractable on purpose — see the threat model above. Generated once per
 * device and stored as a CryptoKey handle, never as bytes.
 */
export function generateDeviceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    // Derived keys are non-extractable too: nothing in the app ever needs the
    // raw bytes, so nothing may read them.
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_BYTES)
  const buffer = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { iv, ciphertext: new Uint8Array(buffer) }
}

/**
 * Returns null rather than throwing when the payload does not authenticate —
 * a wrong passphrase is an expected outcome, not an exception. AES-GCM's tag
 * check is what makes "wrong passphrase" detectable at all.
 */
export async function decryptString(key: CryptoKey, payload: EncryptedPayload): Promise<string | null> {
  try {
    const buffer = await subtle().decrypt(
      { name: 'AES-GCM', iv: payload.iv as unknown as BufferSource },
      key,
      payload.ciphertext as unknown as BufferSource,
    )
    return new TextDecoder().decode(buffer)
  } catch {
    return null
  }
}
