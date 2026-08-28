import { describe, expect, it } from 'vitest'

import { purgeAiData } from './consent'
import { decryptString, deriveKeyFromPassphrase, encryptString, newSalt } from './crypto'
import {
  ANTHROPIC_KEY_ID,
  clearSecret,
  createVault,
  hasStoredKey,
  isUnlocked,
  lockVault,
  readSecret,
  storeSecret,
  unlockVault,
  vaultMode,
} from './secrets'

import { db } from '@/db'

const KEY = 'sk-ant-api03-not-a-real-key-0000000000'

describe('the key vault', () => {
  it('round-trips a secret in device mode', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, KEY)
    expect(await readSecret(ANTHROPIC_KEY_ID)).toBe(KEY)
    expect(await vaultMode()).toBe('device')
  })

  it('never writes the plaintext to the table', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, KEY)

    const rows = await db.secrets.toArray()
    expect(JSON.stringify(rows)).not.toContain('sk-ant')
    expect(JSON.stringify(rows)).not.toContain(KEY)
  })

  it('generates a device key that cannot be exported', async () => {
    await createVault('device')
    const row = await db.secrets.get('vault')
    const deviceKey = (row as { deviceKey?: CryptoKey }).deviceKey

    expect(deviceKey).toBeDefined()
    expect(deviceKey?.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', deviceKey as CryptoKey)).rejects.toThrow()
  })

  it('reads back after a reload, because device mode can unlock itself', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, KEY)
    lockVault()
    expect(isUnlocked()).toBe(false)

    expect(await readSecret(ANTHROPIC_KEY_ID)).toBe(KEY)
  })

  it('requires the passphrase again after a reload in passphrase mode', async () => {
    await createVault('passphrase', 'correct horse battery staple')
    await storeSecret(ANTHROPIC_KEY_ID, KEY, 'passphrase')
    lockVault()

    // No passphrase supplied: the secret is unreadable rather than wrong.
    expect(await readSecret(ANTHROPIC_KEY_ID)).toBeNull()

    expect(await unlockVault('wrong passphrase')).toBe(false)
    expect(await unlockVault('correct horse battery staple')).toBe(true)
    expect(await readSecret(ANTHROPIC_KEY_ID)).toBe(KEY)
  })

  it('reports whether a key exists without decrypting it', async () => {
    expect(await hasStoredKey()).toBe(false)
    await storeSecret(ANTHROPIC_KEY_ID, KEY)
    expect(await hasStoredKey()).toBe(true)
    await clearSecret(ANTHROPIC_KEY_ID)
    expect(await hasStoredKey()).toBe(false)
  })

  it('leaves nothing decryptable behind after the kill switch', async () => {
    await storeSecret(ANTHROPIC_KEY_ID, KEY)
    await db.aiAnswers.put({
      id: 'x',
      agentId: 'law-explain',
      language: 'en',
      dataVersion: 'v',
      promptVersion: 1,
      normalised: 'q',
      question: 'q',
      answer: 'a',
      meta: {},
      createdAt: new Date().toISOString(),
    })

    await purgeAiData()

    expect(await db.secrets.count()).toBe(0)
    expect(await db.aiAnswers.count()).toBe(0)
    expect(await db.aiUsage.count()).toBe(0)
    expect(isUnlocked()).toBe(false)
  })

  it('refuses to create a second vault over the first', async () => {
    await createVault('device')
    await expect(createVault('device')).rejects.toThrow(/already exists/)
  })
})

describe('AES-GCM', () => {
  it('detects a wrong key rather than returning garbage', async () => {
    const salt = newSalt()
    const right = await deriveKeyFromPassphrase('right', salt)
    const wrong = await deriveKeyFromPassphrase('wrong', salt)

    const payload = await encryptString(right, KEY)
    expect(await decryptString(right, payload)).toBe(KEY)
    // The authentication tag is what makes this null instead of noise.
    expect(await decryptString(wrong, payload)).toBeNull()
  })

  it('uses a fresh nonce for every encryption', async () => {
    const key = await deriveKeyFromPassphrase('p', newSalt())
    const a = await encryptString(key, KEY)
    const b = await encryptString(key, KEY)

    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv))
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext))
  })
})
