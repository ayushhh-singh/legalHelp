import { describe, expect, it } from 'vitest'

import { decodeEntities, htmlText, parseHtml, styleOf, walkHtml, type HtmlElement } from './html'

/**
 * The HTML reader, against the two things it actually sees: mammoth's output
 * and a word processor's clipboard.
 *
 * Every case below is a shape one of those two really produces. The parser is
 * deliberately forgiving — an unbalanced close tag, an unclosed element, text
 * outside any element — because refusing a slightly wrong document would mean
 * refusing most of what Word puts on a clipboard.
 */

const first = (html: string): HtmlElement => parseHtml(html)[0] as HtmlElement

describe('parseHtml', () => {
  it('reads elements, attributes and text', () => {
    const node = first('<p class="MsoNormal" style="text-align:center">Hello</p>')
    expect(node.tag).toBe('p')
    expect(node.attrs.class).toBe('MsoNormal')
    expect(htmlText([node])).toBe('Hello')
  })

  it('nests', () => {
    const tree = parseHtml('<ul><li>One<ul><li>Deeper</li></ul></li></ul>')
    const tags = [...walkHtml(tree)].filter((n) => n.kind === 'element').map((n) => n.tag)
    expect(tags).toEqual(['ul', 'li', 'ul', 'li'])
  })

  it('closes a `<li>` that was never closed — which is legal HTML and what Word writes', () => {
    const list = first('<ul><li>One<li>Two</ul>')
    expect(list.children.filter((child) => child.kind === 'element')).toHaveLength(2)
  })

  it('closes a `<p>` that was never closed', () => {
    const nodes = parseHtml('<p>One<p>Two')
    expect(nodes.filter((node) => node.kind === 'element')).toHaveLength(2)
  })

  it('treats a void element as having no children', () => {
    const nodes = parseHtml('<p>before<br />after</p>')
    const paragraph = nodes[0] as HtmlElement
    expect(paragraph.children.map((child) => (child.kind === 'element' ? child.tag : child.text))).toEqual([
      'before',
      'br',
      'after',
    ])
  })

  it('accepts a self-closing tag written either way', () => {
    expect(first('<img src="a.png"/>').tag).toBe('img')
    expect(first('<img src="a.png">').tag).toBe('img')
  })

  it('ignores a close tag for something that was never open', () => {
    expect(htmlText(parseHtml('</b>text'))).toBe('text')
  })

  it('drops comments, doctypes and processing instructions whole', () => {
    expect(htmlText(parseHtml('<!DOCTYPE html><!--[if gte mso 9]>junk<![endif]--><p>Kept</p>'))).toBe('Kept')
  })

  it('drops a `<script>` and a `<style>` with their contents', () => {
    // A browser paste carries both, and neither is a document. The CONTENTS
    // must go too — dropping only the tags would leave the CSS as text.
    expect(htmlText(parseHtml('<style>p{color:red}</style><p>Kept</p><script>alert(1)</script>'))).toBe(
      'Kept',
    )
  })

  it('treats a stray `<` as text, because on the page it came from it was one', () => {
    expect(htmlText(parseHtml('5 < 6'))).toBe('5 < 6')
  })

  it('never throws on anything', () => {
    for (const input of ['<', '<<<>>>', '<p', '<p ="', '</>', '<p>'.repeat(500)]) {
      expect(() => parseHtml(input)).not.toThrow()
    }
  })
})

describe('decodeEntities', () => {
  it('decodes the five XML entities and the ones Word writes', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &rsquo;e&rsquo; &nbsp;')).toBe(
      'a & b <c> "d" ’e’  ',
    )
  })

  it('decodes numeric references in both bases', () => {
    expect(decodeEntities('&#2325;&#x0930;')).toBe('कर')
  })

  it('leaves a malformed or unknown entity exactly as written', () => {
    // A broken entity in somebody's document must not be what stops the import.
    expect(decodeEntities('&notareal; &#999999999; &#xD800;')).toBe('&notareal; &#999999999; &#xD800;')
  })
})

describe('styleOf', () => {
  it('splits an inline style into properties', () => {
    expect(styleOf(first('<span style="font-weight: bold; COLOR:#1F497D">x</span>'))).toEqual({
      'font-weight': 'bold',
      color: '#1F497D',
    })
  })

  it('is empty for an element with no style', () => {
    expect(styleOf(first('<span>x</span>'))).toEqual({})
  })
})

describe('htmlText', () => {
  it('turns a `<br>` into a newline and ignores every other tag', () => {
    expect(htmlText(parseHtml('<p>One<br>Two <b>bold</b></p>'))).toBe('One\nTwo bold')
  })
})
