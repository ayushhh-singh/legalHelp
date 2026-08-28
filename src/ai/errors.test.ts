import { describe, expect, it } from 'vitest'

import { AI_ERROR_CODES, AiError, isAiError } from './types'

import en from '@/i18n/en.json'
import hi from '@/i18n/hi.json'

/**
 * Every way a run can fail has to be sayable to the reader, in both languages.
 *
 * The failure this guards against is specific and easy: a new code is added to
 * the agent, the run fails in the field, and the surface has nothing to render
 * but the code itself — or, worse, an English string in a Hindi session.
 */
describe('AI error codes', () => {
  it('each has a message in both catalogues', () => {
    const missing: string[] = []
    for (const code of AI_ERROR_CODES) {
      const english = (en.ai.errors as Record<string, string | undefined>)[code]
      const hindi = (hi.ai.errors as Record<string, string | undefined>)[code]
      if (!english) missing.push(`en.ai.errors.${code}`)
      if (!hindi) missing.push(`hi.ai.errors.${code}`)
    }
    expect(missing).toEqual([])
  })

  it('has no message for a code that no longer exists', () => {
    const codes = new Set<string>(AI_ERROR_CODES)
    expect(Object.keys(en.ai.errors).filter((key) => !codes.has(key))).toEqual([])
  })

  it('carries the code and the HTTP status through a throw', () => {
    const error = new AiError('auth', 'invalid x-api-key', 401)

    expect(isAiError(error)).toBe(true)
    expect(error).toMatchObject({ name: 'AiError', code: 'auth', status: 401 })
    expect(error).toBeInstanceOf(Error)
  })

  it('is not confused with an ordinary Error', () => {
    expect(isAiError(new Error('nope'))).toBe(false)
    expect(isAiError('auth')).toBe(false)
    expect(isAiError(null)).toBe(false)
  })
})
