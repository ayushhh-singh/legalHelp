import {
  decryptString,
  deriveKeyFromPassphrase,
  encryptString,
  generateDeviceKey,
  newSalt,
  toBytes,
  type EncryptedPayload,
  type VaultMode,
} from './crypto'
import { AiError } from './types'

import { db, type VaultRow } from '@/db'

/**
 * The Dexie half of the key vault. src/ai/crypto.ts owns the cryptography and
 * documents the threat model; this module owns where the bytes live and when
 * the key is in memory.
 *
 * There is exactly one secret today. It is still keyed by id so that a future
 * Tier 2 bearer token does not need a second mechanism.
 */

export const ANTHROPIC_KEY_ID = 'anthropic-api-key'
const VAULT_ID = 'vault'

/**
 * The unlocked key, held only in this module and only for the tab's lifetime.
 * A reload re-derives it (passphrase) or re-reads the handle (device). It is
 * never put in the zustand store, a React prop or a settings row.
 */
let unlockedKey: CryptoKey | null = null

const isVaultRow = (row: unknown): row is VaultRow =>
  typeof row === 'object' && row !== null && (row as { id?: unknown }).id === VAULT_ID

async function readVaultRow(): Promise<VaultRow | undefined> {
  const row = await db.secrets.get(VAULT_ID)
  return isVaultRow(row) ? row : undefined
}

/** Which mode this device was set up in, or null if the vault does not exist. */
export async function vaultMode(): Promise<VaultMode | null> {
  return (await readVaultRow())?.mode ?? null
}

export function isUnlocked(): boolean {
  return unlockedKey !== null
}

/** Drops the in-memory key. The ciphertext stays; the next read must unlock. */
export function lockVault(): void {
  unlockedKey = null
}

/**
 * Creates the vault. Refuses to run twice, because a second `device` key would
 * orphan every secret encrypted under the first one.
 */
export async function createVault(mode: VaultMode, passphrase?: string): Promise<void> {
  if (await readVaultRow()) {
    throw new AiError('not_configured', 'A vault already exists on this device.')
  }

  if (mode === 'passphrase') {
    if (!passphrase) throw new AiError('not_configured', 'A passphrase is required.')
    const salt = newSalt()
    unlockedKey = await deriveKeyFromPassphrase(passphrase, salt)
    await db.secrets.put({ id: VAULT_ID, mode, salt, createdAt: new Date().toISOString() })
    return
  }

  const deviceKey = await generateDeviceKey()
  unlockedKey = deviceKey
  await db.secrets.put({ id: VAULT_ID, mode, deviceKey, createdAt: new Date().toISOString() })
}

/**
 * Loads the key into memory. Returns false for a wrong passphrase rather than
 * throwing — that is an expected outcome the UI reports, not an exception.
 *
 * The passphrase is verified against the stored ciphertext, not against a
 * separate verifier blob: AES-GCM's authentication tag already tells us
 * whether the derived key is the right one, and a verifier would be one more
 * thing to keep in step.
 */
export async function unlockVault(passphrase?: string): Promise<boolean> {
  const vault = await readVaultRow()
  if (!vault) return false

  if (vault.mode === 'device') {
    if (!vault.deviceKey) return false
    unlockedKey = vault.deviceKey
    return true
  }

  if (!passphrase || !vault.salt) return false
  const candidate = await deriveKeyFromPassphrase(passphrase, vault.salt)

  const stored = toPayload(await db.secrets.get(ANTHROPIC_KEY_ID))
  if (stored) {
    const plaintext = await decryptString(candidate, stored)
    if (plaintext === null) return false
  }

  unlockedKey = candidate
  return true
}

/**
 * Reads a stored ciphertext back, normalising the byte views. Returns undefined
 * for the vault row and for anything that is not a secret.
 */
function toPayload(row: unknown): EncryptedPayload | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const candidate = row as { iv?: unknown; ciphertext?: unknown }
  const iv = toBytes(candidate.iv)
  const ciphertext = toBytes(candidate.ciphertext)
  return iv && ciphertext ? { iv, ciphertext } : undefined
}

/**
 * Creates the vault on first use so the caller never has to sequence it. The
 * default is `device` mode; the settings UI offers a passphrase for readers who
 * want one, and the consent modal explains the difference.
 */
export async function storeSecret(id: string, plaintext: string, mode: VaultMode = 'device'): Promise<void> {
  if (!(await readVaultRow())) await createVault(mode)
  if (!unlockedKey) {
    const ok = await unlockVault()
    if (!ok) throw new AiError('no_key', 'The vault is locked; unlock it before storing a secret.')
  }
  if (!unlockedKey) throw new AiError('no_key', 'The vault is locked.')

  const { iv, ciphertext } = await encryptString(unlockedKey, plaintext)
  await db.secrets.put({ id, iv, ciphertext, updatedAt: new Date().toISOString() })
}

/**
 * Null when there is no such secret, when the vault is locked, or when the
 * ciphertext fails to authenticate. Callers treat all three the same way: no
 * key, so no request.
 */
export async function readSecret(id: string): Promise<string | null> {
  const payload = toPayload(await db.secrets.get(id))
  if (!payload) return null

  if (!unlockedKey) {
    const mode = await vaultMode()
    // Device mode can unlock itself; passphrase mode needs the reader.
    if (mode !== 'device') return null
    if (!(await unlockVault())) return null
  }
  if (!unlockedKey) return null

  return decryptString(unlockedKey, payload)
}

export async function clearSecret(id: string): Promise<void> {
  await db.secrets.delete(id)
}

/**
 * What the kill switch calls. Removes the key material as well as the secrets,
 * so nothing decryptable is left behind — the next opt-in starts from scratch.
 */
export async function clearVault(): Promise<void> {
  lockVault()
  await db.secrets.clear()
}

/** True when a ciphertext exists, without decrypting it. Mirrors `hasKey`. */
export async function hasStoredKey(id: string = ANTHROPIC_KEY_ID): Promise<boolean> {
  return toPayload(await db.secrets.get(id)) !== undefined
}
