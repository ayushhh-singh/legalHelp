/**
 * Turning what the reader dragged into the two numbers a highlight stores.
 *
 * The offsets are into `anchorText()` — one normalised string per unit per
 * language — and the rendered paragraphs are slices of exactly that string, each
 * carrying its own start offset in `data-para-start`. So the whole job is: which
 * paragraph did the selection begin and end in, and how many characters into
 * each.
 *
 * `Range.toString().length` is what counts those characters, rather than walking
 * text nodes by hand. It is the only method that already knows what the browser
 * considers to be inside the range, across the spans a highlight or a defined
 * term splits a paragraph into — and this markup nests those three deep.
 *
 * ONE RULE THIS DEPENDS ON: nothing inside a paragraph may render text that is
 * not part of the provision. No `sr-only` label, no counter, no visually-hidden
 * heading — `toString()` would count it and every offset after it would be
 * wrong. Decoration goes on attributes (`aria-label`, `title`) and controls go
 * outside the paragraph.
 */

export interface SelectionOffsets {
  start: number
  end: number
  /** The selected text, as the browser reports it. */
  text: string
}

const paragraphOf = (node: Node | null, root: HTMLElement): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : node?.parentElement
  const paragraph = element?.closest<HTMLElement>('[data-para-start]') ?? null
  return paragraph && root.contains(paragraph) ? paragraph : null
}

const offsetWithin = (paragraph: HTMLElement, node: Node, offset: number): number => {
  const range = paragraph.ownerDocument.createRange()
  range.selectNodeContents(paragraph)
  range.setEnd(node, offset)
  return range.toString().length
}

/**
 * The current selection as whole-unit offsets, or `null`.
 *
 * `null` for a collapsed selection (a click, not a drag), for one that starts or
 * ends outside this unit's text, and for one that is only whitespace — none of
 * which is something to offer a highlight toolbar for.
 */
export function selectionOffsets(root: HTMLElement | null): SelectionOffsets | null {
  if (!root) return null
  const selection = root.ownerDocument.defaultView?.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const from = paragraphOf(range.startContainer, root)
  const to = paragraphOf(range.endContainer, root)
  if (!from || !to) return null

  const fromStart = Number(from.dataset.paraStart)
  const toStart = Number(to.dataset.paraStart)
  if (!Number.isFinite(fromStart) || !Number.isFinite(toStart)) return null

  const start = fromStart + offsetWithin(from, range.startContainer, range.startOffset)
  const end = toStart + offsetWithin(to, range.endContainer, range.endOffset)
  const text = range.toString()

  if (end <= start || !text.trim()) return null
  return { start, end, text }
}

/**
 * Where to put a floating toolbar, in coordinates the page can use.
 *
 * `null` when the selection has no geometry — which happens for a selection
 * inside a collapsed element, and in jsdom, where `getBoundingClientRect`
 * returns zeroes for everything. The caller falls back to a fixed position
 * rather than drawing a toolbar in the corner of the screen.
 */
export function selectionAnchor(root: HTMLElement | null): { top: number; left: number } | null {
  if (!root) return null
  const selection = root.ownerDocument.defaultView?.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { top: rect.top, left: rect.left + rect.width / 2 }
}

/** Drop the selection once it has been acted on, so the toolbar does not linger. */
export function clearSelection(root: HTMLElement | null): void {
  root?.ownerDocument.defaultView?.getSelection()?.removeAllRanges()
}
