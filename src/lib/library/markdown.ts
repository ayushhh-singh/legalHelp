/**
 * Markdown-lite for a margin note, parsed to an AST rather than to HTML.
 *
 * An officer's note is prose with the occasional emphasis, list and link. It is
 * not a document format, so this implements exactly five things — bold, italic,
 * links, wiki-links and lists — and deliberately no headings, images, tables,
 * blockquotes or code fences.
 *
 * IT RETURNS AN AST, NEVER A STRING OF HTML. Nothing in this app calls
 * `dangerouslySetInnerHTML`, and a note is the one place in the whole app where
 * text a person typed is rendered with any structure at all; handing a renderer
 * markup rather than nodes is how that ends up being an injection surface. The
 * component walks these nodes and React escapes every leaf.
 *
 * A LINK IS SCHEME-CHECKED HERE, not in the component. `javascript:` and
 * `data:` are refused and the link renders as its own text — a refusal a reader
 * can see, rather than a silently inert control.
 */

export interface TextNode {
  type: 'text'
  value: string
}

export interface StrongNode {
  type: 'strong'
  children: InlineNode[]
}

export interface EmphasisNode {
  type: 'emphasis'
  children: InlineNode[]
}

export interface LinkNode {
  type: 'link'
  href: string
  children: InlineNode[]
}

/**
 * `[[work:unit]]` — a reference to another unit of the Library.
 *
 * Unresolved on purpose: this file is pure and knows nothing about which works
 * exist, so it reports what was written and the caller decides whether it names
 * a real unit. An unresolved wiki-link renders as plain text with a title
 * saying so, never as a link to a page that does not exist.
 */
export interface WikiLinkNode {
  type: 'wikiLink'
  workId: string
  unitId: string
  /** What the reader typed, for rendering an unresolved link honestly. */
  raw: string
}

export type InlineNode = TextNode | StrongNode | EmphasisNode | LinkNode | WikiLinkNode

export interface ParagraphNode {
  type: 'paragraph'
  children: InlineNode[]
}

export interface ListNode {
  type: 'list'
  ordered: boolean
  items: InlineNode[][]
}

export type BlockNode = ParagraphNode | ListNode

/**
 * Schemes a note may link to.
 *
 * Relative links (`/library/rti/rti-8`) are allowed because a note pointing at
 * another screen of this app is the common case and cannot leave the device.
 * Everything else must be http(s) — `mailto:` is excluded too, since a note is
 * not a place to build an address book.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed
  return null
}

/** `[[rti:rti-8]]` and `[[rti:rti-8|the exemptions]]` both name one unit. */
const WIKI = /\[\[([a-z0-9-]+):([^\]|]+?)(?:\|([^\]]+))?\]\]/iy
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/y
/**
 * Lazy, and `[\s\S]` rather than `[^*]`: bold has to be able to contain
 * emphasis, because "**Rule 3** is *not* the same as **Rule 4**" is a sentence
 * somebody will write in a note. `[^*]+` cannot cross the inner marker at all,
 * and the lazy quantifier is what stops one pair of bold swallowing the next.
 */
const STRONG = /\*\*([\s\S]+?)\*\*/y
const EMPHASIS = /(?:\*([^*\n]+)\*|_([^_\n]+)_)/y

/**
 * Inline nodes for one line.
 *
 * A hand-written scanner rather than a chain of `replace` calls: the ordering
 * that matters is `**bold**` before `*italic*` (a `replace` chain gets that
 * wrong for `**a**` and emits an empty emphasis around nothing), and the sticky
 * `y` flag is what makes "try each pattern AT this position" cheap and exact.
 *
 * EVERY MATCH READS `lastIndex` BEFORE IT RECURSES, and that is not a style
 * choice. These patterns are module-level and this function calls itself for
 * the contents of a bold or a link, so the inner call reassigns the very
 * `lastIndex` the outer call was about to advance by. Written the obvious way —
 * push the node, then `at = STRONG.lastIndex` — the cursor walks BACKWARDS on
 * any nested emphasis and the loop never ends. It does not throw; it allocates
 * until the process dies, which is how it presented: a worker killed by the
 * heap limit with no failing assertion to point at.
 */
export function parseInline(line: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let plain = ''

  const flush = () => {
    if (plain) nodes.push({ type: 'text', value: plain })
    plain = ''
  }

  let at = 0
  while (at < line.length) {
    WIKI.lastIndex = at
    const wiki = WIKI.exec(line)
    if (wiki) {
      const end = WIKI.lastIndex
      flush()
      nodes.push({
        type: 'wikiLink',
        workId: (wiki[1] ?? '').toLowerCase(),
        unitId: (wiki[2] ?? '').trim(),
        raw: wiki[3]?.trim() || `${wiki[1] ?? ''}:${(wiki[2] ?? '').trim()}`,
      })
      at = end
      continue
    }

    LINK.lastIndex = at
    const link = LINK.exec(line)
    if (link) {
      const end = LINK.lastIndex
      const href = safeHref(link[2] ?? '')
      flush()
      const label = link[1] ?? ''
      if (href) nodes.push({ type: 'link', href, children: parseInline(label) })
      // A refused scheme still shows what was written — the label and the URL —
      // so the reader can see why it is not a link rather than losing the text.
      else nodes.push({ type: 'text', value: `${label} (${link[2] ?? ''})` })
      at = end
      continue
    }

    STRONG.lastIndex = at
    const strong = STRONG.exec(line)
    if (strong) {
      const end = STRONG.lastIndex
      flush()
      nodes.push({ type: 'strong', children: parseInline(strong[1] ?? '') })
      at = end
      continue
    }

    EMPHASIS.lastIndex = at
    const emphasis = EMPHASIS.exec(line)
    if (emphasis) {
      const end = EMPHASIS.lastIndex
      flush()
      nodes.push({ type: 'emphasis', children: parseInline(emphasis[1] ?? emphasis[2] ?? '') })
      at = end
      continue
    }

    plain += line[at]
    at += 1
  }

  flush()
  return nodes
}

const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

/** Blocks for a whole note. Blank lines separate paragraphs; runs of list items group. */
export function parseNote(source: string): BlockNode[] {
  const blocks: BlockNode[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const closeParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const closeList = () => {
    if (!list) return
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    list = null
  }

  for (const line of lines) {
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)

    if (bullet ?? numbered) {
      closeParagraph()
      const ordered = bullet === null
      const item = (bullet?.[1] ?? numbered?.[1] ?? '').trim()
      if (list && list.ordered === ordered) list.items.push(item)
      else {
        closeList()
        list = { ordered, items: [item] }
      }
      continue
    }

    closeList()
    if (line.trim() === '') closeParagraph()
    else paragraph.push(line.trim())
  }

  closeParagraph()
  closeList()
  return blocks
}

/** Every unit a note points at, for resolving previews in one pass. */
export function wikiLinks(source: string): { workId: string; unitId: string }[] {
  const out: { workId: string; unitId: string }[] = []
  const seen = new Set<string>()
  const walk = (nodes: readonly InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'wikiLink') {
        const key = `${node.workId}:${node.unitId}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ workId: node.workId, unitId: node.unitId })
        }
      } else if (node.type !== 'text') walk(node.children)
    }
  }
  for (const block of parseNote(source)) {
    if (block.type === 'paragraph') walk(block.children)
    else for (const item of block.items) walk(item)
  }
  return out
}

/** Plain text of a note — what My Study searches and what an export falls back to. */
export function noteToPlainText(source: string): string {
  const render = (nodes: readonly InlineNode[]): string =>
    nodes
      .map((node) => {
        if (node.type === 'text') return node.value
        if (node.type === 'wikiLink') return node.raw
        return render(node.children)
      })
      .join('')

  return parseNote(source)
    .map((block) =>
      block.type === 'paragraph' ? render(block.children) : block.items.map((item) => render(item)).join(' '),
    )
    .join('\n')
}
