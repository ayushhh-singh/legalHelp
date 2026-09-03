import { describe, expect, it } from 'vitest'

import { noteToPlainText, parseInline, parseNote, safeHref, wikiLinks } from './markdown'

/**
 * Markdown-lite, and the one thing it must never do.
 *
 * A margin note is the only place in this app where text a person typed is
 * rendered with structure. The parser returns an AST and the component walks
 * it, so React escapes every leaf — but the URL of a link is an attribute, not
 * a leaf, and that is where `safeHref` earns its place.
 */

describe('safeHref', () => {
  it.each([
    ['https', 'https://indiacode.nic.in/x'],
    ['http', 'http://example.gov.in'],
    ['a route inside this app', '/library/rti/rti-8'],
  ])('allows %s', (_label, href) => {
    expect(safeHref(href)).toBe(href)
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['javascript with padding', '  javascript:alert(1)  '],
    ['a data URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a protocol-relative URL', '//evil.example/x'],
    ['vbscript', 'vbscript:msgbox'],
    ['nothing at all', '   '],
  ])('refuses %s', (_label, href) => {
    expect(safeHref(href)).toBeNull()
  })
})

describe('parseInline', () => {
  it('reads bold before italic, so **a** is not an empty emphasis', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'strong', children: [{ type: 'text', value: 'bold' }] }])
  })

  it('reads both italic markers', () => {
    expect(parseInline('*one*')[0]?.type).toBe('emphasis')
    expect(parseInline('_two_')[0]?.type).toBe('emphasis')
  })

  it('reads a link', () => {
    expect(parseInline('see [the Act](https://x.gov.in)')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', href: 'https://x.gov.in', children: [{ type: 'text', value: 'the Act' }] },
    ])
  })

  it('renders a refused scheme as visible text rather than an inert link', () => {
    const nodes = parseInline('[click](javascript:alert(1))')
    expect(nodes.every((node) => node.type === 'text')).toBe(true)
    expect(nodes.map((node) => (node.type === 'text' ? node.value : '')).join('')).toContain('javascript:')
  })

  it('reads a wiki-link', () => {
    expect(parseInline('[[rti:rti-8]]')).toEqual([
      { type: 'wikiLink', workId: 'rti', unitId: 'rti-8', raw: 'rti:rti-8' },
    ])
  })

  it('reads a wiki-link with its own label', () => {
    expect(parseInline('[[rti:rti-8|the exemptions]]')[0]).toMatchObject({
      workId: 'rti',
      unitId: 'rti-8',
      raw: 'the exemptions',
    })
  })

  it('does not read a wiki-link as an ordinary link', () => {
    // `[[a:b]]` also matches `[text](url)`-adjacent shapes; wiki must win.
    expect(parseInline('[[gfr:gfr-21]]')[0]?.type).toBe('wikiLink')
  })

  it('nests emphasis inside bold', () => {
    const [node] = parseInline('**very *odd* wording**')
    expect(node).toMatchObject({ type: 'strong' })
    const children = node?.type === 'strong' ? node.children : []
    expect(children.some((child) => child.type === 'emphasis')).toBe(true)
  })

  it('leaves an unmatched marker as plain text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', value: '2 * 3 = 6' }])
  })

  it('keeps Devanagari intact', () => {
    expect(parseInline('**नियम 3** देखें')[0]).toMatchObject({
      type: 'strong',
      children: [{ type: 'text', value: 'नियम 3' }],
    })
  })
})

describe('parseNote', () => {
  it('separates paragraphs on a blank line and joins wrapped lines', () => {
    expect(parseNote('one\ntwo\n\nthree')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'one two' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'three' }] },
    ])
  })

  it('groups a run of bullets into one list', () => {
    const [block] = parseNote('- one\n- two\n- three')
    expect(block).toMatchObject({ type: 'list', ordered: false })
    expect(block?.type === 'list' ? block.items : []).toHaveLength(3)
  })

  it('reads a numbered list as ordered', () => {
    const [list] = parseNote('1. first\n2. second')
    expect(list).toMatchObject({ type: 'list', ordered: true })
  })

  it('starts a new list when the kind changes', () => {
    expect(parseNote('- a\n1. b').map((block) => block.type)).toEqual(['list', 'list'])
  })

  it('closes a paragraph when a list starts', () => {
    expect(parseNote('intro\n- a').map((block) => block.type)).toEqual(['paragraph', 'list'])
  })

  it('is empty for an empty note', () => {
    expect(parseNote('')).toEqual([])
    expect(parseNote('\n\n  \n')).toEqual([])
  })

  it('normalises CRLF, so a note pasted from Windows is one paragraph not two', () => {
    expect(parseNote('one\r\ntwo')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'one two' }] },
    ])
  })
})

describe('wikiLinks', () => {
  it('reports every unit a note points at, once each', () => {
    expect(wikiLinks('See [[rti:rti-8]] and [[rti:rti-8]] and [[gfr:gfr-21]].')).toEqual([
      { workId: 'rti', unitId: 'rti-8' },
      { workId: 'gfr', unitId: 'gfr-21' },
    ])
  })

  it('finds one inside a list item and inside bold', () => {
    expect(wikiLinks('- **[[osa:osa-5]]**')).toEqual([{ workId: 'osa', unitId: 'osa-5' }])
  })

  it('is empty for a note with none', () => {
    expect(wikiLinks('plain words')).toEqual([])
  })
})

describe('noteToPlainText', () => {
  it('strips the markers and keeps the words — what My Study searches', () => {
    expect(noteToPlainText('**Rule 3** and [the Act](https://x.gov.in)')).toBe('Rule 3 and the Act')
  })

  it('reads a wiki-link as its label', () => {
    expect(noteToPlainText('see [[rti:rti-8|the exemptions]]')).toBe('see the exemptions')
  })

  it('puts each block on its own line', () => {
    expect(noteToPlainText('one\n\n- a\n- b')).toBe('one\na b')
  })
})
