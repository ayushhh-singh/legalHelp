import { describe, expect, it } from 'vitest'

import { reportMailto } from './reportMailto'

/**
 * "Report a data error" — one address, two callers.
 *
 * It lives in `src/lib` because Settings' About card and the Library reader's
 * ⋯ menu both offer it, and two copies of an e-mail address is one that goes
 * stale. What is worth asserting is the part that is easy to get wrong when a
 * citation is dropped into a URL.
 */
describe('reportMailto', () => {
  it('is a mailto with an encoded subject and body, and no backend anywhere in it', () => {
    const href = reportMailto('en')
    expect(href.startsWith('mailto:')).toBe(true)
    expect(href).toContain('subject=')
    expect(href).toContain('body=')
    // The master context rules out a backend for anything the reader types.
    expect(href).not.toMatch(/^https?:/)
  })

  it('writes the subject and the preamble in the reader’s own language', () => {
    expect(decodeURIComponent(reportMailto('hi'))).toContain('डेटा में त्रुटि')
    expect(decodeURIComponent(reportMailto('en'))).toContain('data error report')
  })

  it('carries a citation into the body, ENCODED, so the officer need not retype it', () => {
    const href = reportMailto('en', 'Rule 3, CCS (Conduct) Rules, 1964 (ccs-conduct:ccs-conduct-3)')
    /*
      The raw string must not appear: a citation has brackets, commas and
      spaces in it, and a `mailto:` whose body carries them unescaped is one
      some clients truncate at the first one they dislike.
    */
    expect(href).not.toContain('Rule 3, CCS (Conduct)')
    expect(decodeURIComponent(href)).toContain('Rule 3, CCS (Conduct) Rules, 1964')
  })

  it('ends the body with a blank line either way, so the officer types into one', () => {
    const bare = decodeURIComponent(reportMailto('en'))
    const withCitation = decodeURIComponent(reportMailto('en', 'Rule 3'))
    expect(bare.endsWith('\n\n')).toBe(true)
    expect(withCitation.endsWith('\n\n')).toBe(true)
    // …and the citation sits between the preamble and that blank line.
    expect(withCitation).toContain('correct source:\n\nRule 3\n\n')
  })
})
