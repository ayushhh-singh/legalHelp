import i18next, { type BackendModule, type ReadCallback } from 'i18next'
import { describe, expect, it } from 'vitest'

import { isLanguage, type Language } from './index'

/**
 * What happens when a language chunk does not arrive.
 *
 * This failure mode was created by ADR-031 and did not exist before it. When
 * `en.json` and `hi.json` were both static imports, the catalogues were in the
 * entry chunk: if the app rendered at all, both languages were present. Now
 * each is fetched on demand, so a cache eviction while offline, a half-finished
 * deploy or a corrupt entry can leave one of them unreachable.
 *
 * The trap is that **i18next does not reject when a backend read fails**. It
 * resolves, sets `language` to the one it could not load, and — because
 * `fallbackLng` is deliberately `false`, so that a missing Hindi string is a
 * visible defect rather than silent English — `t()` then returns every key as
 * its own name. The reader gets a screen reading `pages.law.title`, and the
 * preference is persisted, so a reload reproduces it.
 *
 * These tests pin the library behaviour this project now depends on, and the
 * two rules built on top of it: a language that did not load is not applied
 * (`store.ts#applyLanguage`), and a boot language that did not load falls
 * through to the other one (`src/i18n/index.ts`).
 *
 * They use their own i18next instance rather than the app's singleton, because
 * the app's has already loaded English by the time any test runs and the point
 * here is the failure.
 */

/**
 * `t()` for a key the app does not have.
 *
 * `src/i18n/i18next.d.ts` types `t` against `en.json`'s own key union, which is
 * the point of that augmentation — a misspelled key is a compile error rather
 * than a string that renders as itself. A test ABOUT an absent key has to step
 * outside the union deliberately, and it says so here once rather than at the
 * call site.
 */
const translateUnknownKey = (instance: Harness['instance'], key: string): string =>
  (instance.t as unknown as (k: string) => string)(key)

interface Harness {
  instance: ReturnType<typeof i18next.createInstance>
  reads: string[]
}

/** An instance whose backend refuses to load the named languages. */
async function harness(failFor: readonly Language[], boot: Language = 'en'): Promise<Harness> {
  const reads: string[] = []
  const instance = i18next.createInstance()

  const backend: BackendModule = {
    type: 'backend',
    init: () => {},
    read(language: string, _namespace: string, callback: ReadCallback) {
      reads.push(language)
      if (!isLanguage(language) || failFor.includes(language)) {
        callback(new Error(`chunk for ${language} failed`), false)
        return
      }
      // A real key from the app's catalogue, so i18next's augmented `t` types
      // accept it without a cast — the module augmentation in i18next.d.ts
      // types `t` against `en.json`'s own key union.
      callback(null, { common: { loading: language === 'hi' ? 'लोड हो रहा है…' : 'Loading…' } })
    },
  }

  await instance.use(backend).init({
    lng: boot,
    supportedLngs: ['en', 'hi'],
    fallbackLng: false,
    returnNull: false,
    load: 'currentOnly',
  })

  return { instance, reads }
}

describe('the library behaviour this design rests on', () => {
  it('resolves rather than rejecting when a chunk fails, which is why the result must be checked', async () => {
    const { instance } = await harness(['hi'])

    // No `.rejects`. This is the whole reason `applyLanguage` inspects the
    // outcome instead of relying on try/catch.
    await expect(instance.changeLanguage('hi')).resolves.toBeDefined()
  })

  it('leaves the reader in a language with no strings at all', async () => {
    const { instance } = await harness(['hi'])
    await instance.changeLanguage('hi')

    expect(instance.language).toBe('hi')
    // The raw key, not Hindi and not English. This is what the fixes prevent.
    expect(instance.t('common.loading')).toBe('common.loading')
  })

  it('distinguishes a loaded catalogue from a failed one by hasResourceBundle', async () => {
    const { instance } = await harness(['hi'])
    expect(instance.hasResourceBundle('en', 'translation')).toBe(true)

    await instance.changeLanguage('hi')
    // `language` says hi and the bundle says otherwise — the disagreement is
    // exactly the signal, and nothing else in the API reports it.
    expect(instance.language).toBe('hi')
    expect(instance.hasResourceBundle('hi', 'translation')).toBe(false)
  })

  it('recovers completely when switched back to a language already in memory', async () => {
    const { instance, reads } = await harness(['hi'])
    await instance.changeLanguage('hi')
    const readsBefore = reads.length

    await instance.changeLanguage('en')

    expect(instance.language).toBe('en')
    expect(instance.t('common.loading')).toBe('Loading…')
    // The revert costs no second fetch: the bundle is already loaded, so the
    // recovery path cannot fail for the same reason the switch did.
    expect(reads.length).toBe(readsBefore)
  })
})

describe('the boot fallback', () => {
  it('leaves a Hindi reader with raw keys if nothing intervenes', async () => {
    // The state src/i18n/index.ts's `.then()` exists to prevent, reproduced
    // without it so the fix below is measured against a real failure.
    const { instance } = await harness(['hi'], 'hi')

    expect(instance.language).toBe('hi')
    expect(instance.hasResourceBundle('hi', 'translation')).toBe(false)
    expect(instance.t('common.loading')).toBe('common.loading')
  })

  it('gives a complete interface in the other language once it does intervene', async () => {
    const { instance } = await harness(['hi'], 'hi')

    // What index.ts does: if the boot language's bundle is absent, take the
    // other one. A complete interface in English beats an unusable one in
    // Hindi, and the reader can switch back once the chunk is reachable.
    if (!instance.hasResourceBundle('hi', 'translation')) {
      await instance.changeLanguage('en')
    }

    expect(instance.language).toBe('en')
    expect(instance.t('common.loading')).toBe('Loading…')
  })

  it('does not intervene when the boot language loaded normally', async () => {
    const { instance } = await harness([], 'hi')

    expect(instance.hasResourceBundle('hi', 'translation')).toBe(true)
    expect(instance.language).toBe('hi')
    expect(instance.t('common.loading')).toBe('लोड हो रहा है…')
  })
})

describe('this is not the silent English fallback fallbackLng: false forbids', () => {
  it('still renders a MISSING KEY as itself rather than reaching for the other language', async () => {
    // The two situations must not be conflated. A key absent from a catalogue
    // that DID load has to stay a visible defect — it is what
    // scripts/i18n-check.mjs and src/i18n/i18n.test.ts fail CI over. Only a
    // whole-file delivery failure gets the other language.
    const { instance } = await harness([])

    expect(instance.hasResourceBundle('en', 'translation')).toBe(true)
    expect(instance.t('common.loading')).toBe('Loading…')
    expect(translateUnknownKey(instance, 'no.such.key')).toBe('no.such.key')
  })
})
