import { describe, expect, it } from 'vitest'

import {
  checkLetterheadFile,
  embeddableInDocx,
  fitLetterhead,
  LETTERHEAD_MAX_BYTES,
  LETTERHEAD_MAX_HEIGHT_MM,
  mmToTwip,
  svgIsInert,
} from './letterhead'

/**
 * The letterhead image an officer supplies.
 *
 * **This app supplies no emblem, crest or seal, and there is no test here that
 * one exists** — that absence is the feature. What is tested is the checking:
 * a file that is too big, of the wrong kind, or an SVG that would execute
 * something.
 */

const file = (name: string, type: string, size = 1024) => ({ name, type, size })

describe('checkLetterheadFile', () => {
  it('accepts the three kinds an office actually has', () => {
    expect(checkLetterheadFile(file('logo.png', 'image/png'))).toEqual({ ok: true, type: 'image/png' })
    expect(checkLetterheadFile(file('logo.jpg', 'image/jpeg'))).toEqual({ ok: true, type: 'image/jpeg' })
    expect(checkLetterheadFile(file('logo.svg', 'image/svg+xml'))).toEqual({
      ok: true,
      type: 'image/svg+xml',
    })
  })

  it('believes the extension when the browser reports a useless MIME type', () => {
    // A browser reports `application/octet-stream` for a `.svg` on some
    // platforms and `image/x-png` for a `.png` on others.
    expect(checkLetterheadFile(file('logo.svg', 'application/octet-stream')).ok).toBe(true)
    expect(checkLetterheadFile(file('logo.png', 'image/x-png')).ok).toBe(true)
  })

  it('falls back to the MIME type when the file has no extension at all', () => {
    expect(checkLetterheadFile(file('logo', 'image/png'))).toEqual({ ok: true, type: 'image/png' })
  })

  it('refuses a file over the cap', () => {
    expect(checkLetterheadFile(file('logo.png', 'image/png', LETTERHEAD_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: 'too-big',
    })
  })

  it('refuses an empty file before it refuses anything else', () => {
    expect(checkLetterheadFile(file('logo.png', 'image/png', 0))).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses a kind this app cannot place on a page', () => {
    expect(checkLetterheadFile(file('logo.gif', 'image/gif'))).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(checkLetterheadFile(file('scan.pdf', 'application/pdf')).ok).toBe(false)
  })
})

describe('svgIsInert', () => {
  it('accepts a drawing', () => {
    expect(svgIsInert('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>')).toBe(true)
  })

  it('refuses anything that executes', () => {
    for (const source of [
      '<svg><script>fetch("https://x")</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)">x</a></svg>',
      '<svg><foreignObject><iframe/></foreignObject></svg>',
    ]) {
      expect(svgIsInert(source), source).toBe(false)
    }
  })

  it('refuses anything that fetches from another host', () => {
    expect(svgIsInert('<svg><image xlink:href="https://example.gov.in/seal.png"/></svg>')).toBe(false)
    expect(svgIsInert('<svg><use href="//cdn.example/x.svg#a"/></svg>')).toBe(false)
    expect(svgIsInert('<svg><style>@import url(https://x)</style></svg>')).toBe(false)
  })

  it('refuses an entity declaration, which is how an SVG reads a local file', () => {
    expect(svgIsInert('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toBe(false)
  })

  it('accepts a relative reference inside the same file', () => {
    expect(svgIsInert('<svg><use href="#logo"/><defs><g id="logo"/></defs></svg>')).toBe(true)
  })
})

describe('fitLetterhead', () => {
  it('fits a wide image to the width of the header band', () => {
    const fitted = fitLetterhead({ width: 1200, height: 200 })
    expect(fitted.widthMm).toBeLessThanOrEqual(160)
    expect(fitted.heightMm).toBeLessThanOrEqual(30)
    // The aspect ratio survives: 6:1 in, 6:1 out.
    expect(fitted.widthMm / fitted.heightMm).toBeCloseTo(6, 1)
  })

  it('fits a tall image to the height of the band, which is what the margin allows', () => {
    // 16mm, not an arbitrary number: the printed band sits inside the page's
    // 25.4mm margin, because a `position: fixed` running header is positioned
    // against the text column and anything taller lands on the first line.
    const fitted = fitLetterhead({ width: 200, height: 800 })
    expect(fitted.heightMm).toBeCloseTo(LETTERHEAD_MAX_HEIGHT_MM, 0)
  })

  it('never enlarges a small image', () => {
    // A 40-pixel logo blown up to 160mm is a smear, and an officer who supplied
    // a small file meant a small mark.
    const fitted = fitLetterhead({ width: 40, height: 20 })
    expect(fitted.widthMm).toBeCloseTo((40 / 96) * 25.4, 1)
  })

  it('returns nothing for an image with no size', () => {
    expect(fitLetterhead({ width: 0, height: 0 })).toEqual({ widthMm: 0, heightMm: 0 })
  })
})

describe('embeddableInDocx', () => {
  it('says no to an SVG, which is why the export shows a note instead of nothing', () => {
    expect(embeddableInDocx('image/svg+xml')).toBe(false)
    expect(embeddableInDocx('image/png')).toBe(true)
    expect(embeddableInDocx('image/jpeg')).toBe(true)
  })
})

describe('mmToTwip', () => {
  it('converts an inch to 1440', () => {
    expect(mmToTwip(25.4)).toBe(1440)
  })
})
