import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW,
  forgetOffenceDate,
  parseLawParams,
  recallOffenceDate,
  rememberOffenceDate,
  toLawHref,
  toLawParams,
} from './url'

/**
 * The deep link is a product feature, not an implementation detail: a citation
 * sent to a colleague is worthless if the link lands them on an empty search
 * box, and the offence date is part of the answer rather than a preference.
 *
 * It is also untrusted input. Every assertion about a malformed parameter below
 * is about what a hand-edited or truncated URL must NOT be able to do.
 */

const params = (query: string) => parseLawParams(new URLSearchParams(query))

describe('parseLawParams', () => {
  it('restores the exact view from the brief’s example link', () => {
    expect(params('code=bns&q=302&dir=old-new&date=2024-08-01')).toEqual({
      query: '302',
      code: 'bns',
      direction: 'old-new',
      date: '2024-08-01',
      browse: false,
    })
  })

  it('falls back to the default view for an empty query string', () => {
    expect(params('')).toEqual(DEFAULT_VIEW)
  })

  it.each(['bns', 'bnss', 'bsa'])('accepts %s as a code', (code) => {
    expect(params(`code=${code}`).code).toBe(code)
  })

  it('discards a code it does not recognise rather than filtering to nothing', () => {
    expect(params('code=ipc').code).toBeNull()
    expect(params('code=').code).toBeNull()
    expect(params('code=<script>').code).toBeNull()
  })

  it('discards a direction it does not recognise', () => {
    expect(params('dir=sideways').direction).toBe('old-new')
    expect(params('dir=new-old').direction).toBe('new-old')
  })

  it('discards a date it cannot read, rather than showing the wrong era', () => {
    // Showing "Old law applies" from an unparseable date would be worse than
    // showing nothing, because the banner reads as an answer.
    expect(params('date=2024-02-31').date).toBeNull()
    expect(params('date=yesterday').date).toBeNull()
    expect(params('date=01-07-2024').date).toBeNull()
    expect(params('date=2024-07-01').date).toBe('2024-07-01')
  })

  it('keeps a query verbatim, in either script', () => {
    expect(params('q=%E0%A4%B9%E0%A4%A4%E0%A5%8D%E0%A4%AF%E0%A4%BE').query).toBe('हत्या')
    expect(params('q=sec+438+crpc').query).toBe('sec 438 crpc')
  })
})

describe('toLawParams', () => {
  it('writes nothing for the default view, so the common case stays /law', () => {
    expect(toLawParams(DEFAULT_VIEW).toString()).toBe('')
    expect(toLawHref(DEFAULT_VIEW)).toBe('/law')
  })

  it('round-trips every field', () => {
    const view = {
      query: '302',
      code: 'bns' as const,
      direction: 'new-old' as const,
      date: '2024-08-01',
      browse: false,
    }
    expect(parseLawParams(toLawParams(view))).toEqual(view)
  })

  it('round-trips a Devanagari query', () => {
    const view = { ...DEFAULT_VIEW, query: 'अग्रिम जमानत' }
    expect(parseLawParams(toLawParams(view))).toEqual(view)
  })

  it('trims the query, so a stray space does not become part of the link', () => {
    expect(toLawParams({ ...DEFAULT_VIEW, query: '  302  ' }).get('q')).toBe('302')
    expect(toLawParams({ ...DEFAULT_VIEW, query: '   ' }).has('q')).toBe(false)
  })

  it('builds an href against a given path', () => {
    expect(toLawHref({ ...DEFAULT_VIEW, query: '302' })).toBe('/law?q=302')
    expect(toLawHref({ ...DEFAULT_VIEW, query: '302' }, '/law/saved')).toBe('/law/saved?q=302')
  })
})

describe('browse intent', () => {
  it('is remembered in the URL, so a browse can be shared or reloaded', () => {
    expect(params('browse=1&code=bnss').browse).toBe(true)
    expect(toLawParams({ ...DEFAULT_VIEW, browse: true }).get('browse')).toBe('1')
  })

  it('is separate from the code, because "All" IS the default code', () => {
    // Without its own flag there is no way to tell a click on the pre-selected
    // All chip from a fresh page load — so either a bare /law downloads 3.9 MB
    // nobody asked for, or the All chip does nothing at all.
    expect(params('browse=1').code).toBeNull()
    expect(params('browse=1').browse).toBe(true)
    expect(params('code=bns').browse).toBe(false)
  })

  it('is not written beside a query, where it means nothing', () => {
    expect(toLawParams({ ...DEFAULT_VIEW, browse: true, query: '302' }).has('browse')).toBe(false)
  })

  it('accepts only the exact flag', () => {
    expect(params('browse=true').browse).toBe(false)
    expect(params('browse=yes').browse).toBe(false)
    expect(params('browse=1').browse).toBe(true)
  })
})

describe('the offence date, in session state only', () => {
  beforeEach(() => forgetOffenceDate())

  it('survives navigating away and back within the session', () => {
    rememberOffenceDate('2023-05-01')
    expect(recallOffenceDate()).toBe('2023-05-01')
  })

  it('refuses to remember a date it could not read', () => {
    rememberOffenceDate('2023-05-01')
    rememberOffenceDate('nonsense')
    expect(recallOffenceDate()).toBeNull()
  })

  it('is cleared by forgetting it', () => {
    rememberOffenceDate('2023-05-01')
    forgetOffenceDate()
    expect(recallOffenceDate()).toBeNull()
  })

  it('is not written to any storage', () => {
    // The hard rule is that all user state lives in IndexedDB; the brief asks
    // for the date in "session state only". An offence date is the most
    // identifying thing a reader types into this module, so the resolution of
    // that tension is that it is written NOWHERE — not IndexedDB, and not
    // localStorage or sessionStorage either.
    rememberOffenceDate('2023-05-01')
    expect(globalThis.localStorage?.length ?? 0).toBe(0)
    expect(globalThis.sessionStorage?.length ?? 0).toBe(0)
  })
})
