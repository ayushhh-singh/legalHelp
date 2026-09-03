/**
 * A minimal HTML reader, for the two places this module is handed markup it did
 * not write: mammoth's rendering of a `.docx`, and whatever a word processor
 * put on the clipboard.
 *
 * ### Why this is not `DOMParser`
 *
 * `DOMParser` exists in every browser and in jsdom, so using it would have
 * worked. It is not used, for one reason that is about this directory rather
 * than about parsing: **nothing under `src/lib/drafting/` may reach outside
 * itself.** No React, no Dexie, no `fetch`, no Tiptap (ADR-041 §2), and
 * `purity.test.ts` reads the files and enforces it. A browser global is the
 * same kind of dependency one step less visible — it would make this file
 * untestable anywhere the global is absent and, more to the point, it would
 * make the parse depend on a host's error recovery, which differs between
 * engines and is not something a document importer should be at the mercy of.
 *
 * The input this actually sees is machine-generated and small: mammoth emits
 * `<p>`, `<h1>`-`<h6>`, `<ul>`/`<ol>`/`<li>`, `<table>`/`<tr>`/`<td>`/`<th>`,
 * `<strong>`, `<em>`, `<u>`, `<sup>`, `<sub>`, `<br />`, `<img>` and `<a>`.
 * Word and Google Docs add `<span style>`, `<b>`, `<i>`, `<font>` and a great
 * deal of class noise. That is the whole grammar, and it is a grammar a
 * hundred lines can read exactly rather than approximately.
 *
 * ### What it deliberately does NOT do
 *
 * No entities beyond the five XML ones plus `&nbsp;` and numeric references —
 * a full HTML entity table is 2,231 names and this input has never contained
 * one of the others. No scripts, no styles, no comments: `<script>`, `<style>`
 * and `<!-- -->` are dropped whole, including their contents, because a paste
 * from a browser carries all three and none of them is a document.
 */

export interface HtmlText {
  kind: 'text'
  text: string
}

export interface HtmlElement {
  kind: 'element'
  /** Lower-cased tag name. */
  tag: string
  attrs: Record<string, string>
  children: HtmlNode[]
}

export type HtmlNode = HtmlText | HtmlElement

/** Elements that never have a closing tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is not markup, and which are dropped whole. */
const RAW_TAGS = new Set(['script', 'style', 'title'])

/**
 * Tags that close an open one of the same name — the two places real-world
 * markup omits an end tag. `<li>` inside a list and `<p>` before a block are
 * both legal HTML and both appear in a Word paste.
 */
const AUTO_CLOSE: Record<string, ReadonlySet<string>> = {
  li: new Set(['li']),
  p: new Set(['p']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['tr']),
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Word's own three, which arrive as entities rather than as characters.
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
}

/**
 * Decode the entity forms this input actually carries.
 *
 * A numeric reference is decoded with `String.fromCodePoint`, guarded: a
 * surrogate half or an out-of-range value is left as written rather than
 * throwing, because a malformed entity in somebody's document must not be the
 * thing that stops the whole import.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * The last entry a predicate accepts.
 *
 * Written out rather than `Array.prototype.findLastIndex`, which needs
 * `lib: es2023` and this project's `tsconfig.json` is on `es2022` — bumping a
 * shared compiler setting for one call in one file is a change to every other
 * file's contract, made by nobody who was reviewing it.
 */
function lastIndexOf<T>(items: readonly T[], accepts: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index] as T
    if (accepts(item)) return index
  }
  return -1
}

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g

function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR.exec(source)) !== null) {
    const name = (match[1] ?? '').toLowerCase()
    if (!name) continue
    const raw = match[2] ?? ''
    const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw
    out[name] = decodeEntities(value)
  }
  return out
}

/**
 * The markup as a tree.
 *
 * Never throws and never returns nothing for input it could not understand: an
 * unbalanced close tag is ignored, an unclosed element is closed at the end of
 * the document, and text outside any element is a top-level text node. An
 * importer that refused a slightly wrong document would refuse most of what a
 * word processor produces.
 */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = { kind: 'element', tag: '#root', attrs: {}, children: [] }
  const stack: HtmlElement[] = [root]
  const top = (): HtmlElement => stack[stack.length - 1] as HtmlElement

  const pushText = (raw: string) => {
    if (!raw) return
    top().children.push({ kind: 'text', text: decodeEntities(raw) })
  }

  let index = 0
  while (index < html.length) {
    const lt = html.indexOf('<', index)
    if (lt === -1) {
      pushText(html.slice(index))
      break
    }
    pushText(html.slice(index, lt))

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      index = end === -1 ? html.length : end + 3
      continue
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt)
      index = end === -1 ? html.length : end + 1
      continue
    }

    const gt = html.indexOf('>', lt)
    if (gt === -1) {
      // A stray `<` with no tag after it is text, which is exactly what it
      // looks like on the page it came from.
      pushText(html.slice(lt))
      break
    }

    const inner = html.slice(lt + 1, gt)
    index = gt + 1

    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase()
      // Close the nearest open element with this name; ignore a close tag for
      // something that was never opened.
      const at = lastIndexOf(stack, (node) => node.tag === tag)
      if (at > 0) stack.length = at
      continue
    }

    const nameEnd = inner.search(/[\s/>]/)
    const tag = (nameEnd === -1 ? inner : inner.slice(0, nameEnd)).toLowerCase()
    if (!tag) continue
    const attrs = parseAttrs(nameEnd === -1 ? '' : inner.slice(nameEnd))
    const selfClosing = inner.trimEnd().endsWith('/')

    if (RAW_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, index)
      index = close === -1 ? html.length : html.indexOf('>', close) + 1 || html.length
      continue
    }

    const closes = AUTO_CLOSE[tag]
    if (closes) {
      const at = lastIndexOf(stack, (node) => closes.has(node.tag))
      if (at > 0) stack.length = at
    }

    const element: HtmlElement = { kind: 'element', tag, attrs, children: [] }
    top().children.push(element)
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(element)
  }

  return root.children
}

/** Every element in a tree, depth first. */
export function* walkHtml(nodes: readonly HtmlNode[]): Generator<HtmlNode> {
  for (const node of nodes) {
    yield node
    if (node.kind === 'element') yield* walkHtml(node.children)
  }
}

/** The text of a subtree, with no markup and no normalisation. */
export function htmlText(nodes: readonly HtmlNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text
    else if (node.tag === 'br') out += '\n'
    else out += htmlText(node.children)
  }
  return out
}

/** One inline style declaration, by property name. */
export function styleOf(element: HtmlElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (element.attrs.style ?? '').split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    if (name) out[name] = part.slice(colon + 1).trim()
  }
  return out
}
