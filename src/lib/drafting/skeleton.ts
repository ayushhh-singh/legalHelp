import { isBlank, type BodyDoc, type BodyNode } from './model'

/**
 * A template's `bodySkeleton`, turned into a document body.
 *
 * A skeleton is ordinary editor JSON with three things in it a finished
 * document never has:
 *
 * ```
 *   {{field}}            an inline placeholder
 *   {{#if field}} … {{/if}}      a block kept only when the field has a value
 *   {{#each list}} … {{/each}}   a block repeated once per entry, {{.}} the entry
 * ```
 *
 * The markers are whole PARAGRAPHS of their own rather than fragments inside a
 * sentence, which is what makes them safe to author by hand in JSON and safe to
 * parse without a grammar: this file scans the top level for a marker
 * paragraph, matches it to its closer, and recurses. A sentence with a
 * conditional in the middle of it is a sentence with two versions, and a form
 * that needs one should have two paragraphs.
 *
 * Pure, no Tiptap. `instantiate` returns a body AND a list of issues, and it
 * never throws: a template whose skeleton has an unclosed `{{#if}}` still
 * produces a document — with the rest of it included and the problem reported —
 * because a form that renders nothing at all teaches an officer nothing about
 * why.
 */

export interface SkeletonIssue {
  code: 'unclosed' | 'unopened' | 'unknown-field'
  marker: string
  message: { en: string; hi: string }
}

export interface InstantiateResult {
  body: BodyDoc
  issues: SkeletonIssue[]
  /** Fields named by a `{{placeholder}}` that no value filled — what blocks export. */
  unfilled: string[]
}

const IF_OPEN = /^\{\{#if\s+([a-zA-Z][\w.]*)\}\}$/
const EACH_OPEN = /^\{\{#each\s+([a-zA-Z][\w.]*)\}\}$/
const IF_CLOSE = /^\{\{\/if\}\}$/
const EACH_CLOSE = /^\{\{\/each\}\}$/

/** The whole text of a node, ignoring structure — how a marker is recognised. */
function flatText(node: BodyNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(flatText).join('')
}

type Marker =
  | { kind: 'if'; field: string }
  | { kind: 'each'; field: string }
  | { kind: 'endif' }
  | { kind: 'endeach' }
  | null

function markerOf(node: BodyNode): Marker {
  // Only a bare block can be a marker. A table cell that happens to contain the
  // characters is content, not control flow.
  if (node.type !== 'paragraph' && node.type !== 'numberedPara') return null
  const text = flatText(node).trim()
  const ifOpen = IF_OPEN.exec(text)
  if (ifOpen?.[1]) return { kind: 'if', field: ifOpen[1] }
  const eachOpen = EACH_OPEN.exec(text)
  if (eachOpen?.[1]) return { kind: 'each', field: eachOpen[1] }
  if (IF_CLOSE.test(text)) return { kind: 'endif' }
  if (EACH_CLOSE.test(text)) return { kind: 'endeach' }
  return null
}

const message = (code: SkeletonIssue['code'], marker: string): SkeletonIssue['message'] => {
  if (code === 'unclosed') {
    return {
      en: `The skeleton opens "${marker}" and never closes it.`,
      hi: `रूपरेखा में "${marker}" खोला गया है पर बंद नहीं किया गया।`,
    }
  }
  if (code === 'unopened') {
    return {
      en: `The skeleton closes "${marker}" that was never opened.`,
      hi: `रूपरेखा में "${marker}" बंद किया गया है जो कभी खोला ही नहीं गया।`,
    }
  }
  return {
    en: `"${marker}" is not a field this document has.`,
    hi: `"${marker}" इस दस्तावेज़ का कोई फ़ील्ड नहीं है।`,
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z@.][\w.]*|\.)\s*\}\}/g

interface Scope {
  values: Record<string, string | string[]>
  /** The current `{{.}}` inside an `{{#each}}`, and its 1-based `{{@index}}`. */
  item?: { value: string; index: number }
}

function lookup(name: string, scope: Scope): string | string[] | undefined {
  if (name === '.') return scope.item?.value
  if (name === '@index') return scope.item ? String(scope.item.index) : undefined
  return scope.values[name]
}

const asText = (value: string | string[] | undefined): string =>
  value === undefined ? '' : Array.isArray(value) ? value.join(', ') : value

/**
 * Substitute the placeholders inside one text node.
 *
 * A name with a value becomes plain text. A name WITHOUT one becomes a
 * `placeholder` node — a chip in the editor and a blocked export — rather than
 * disappearing or printing `{{fileNumber}}` on the page. That is the same rule
 * `checklist.ts`'s `noPlaceholders` already enforces on the rendered document
 * (`/\{\{[a-zA-Z]/` is a `must` on ten of the fourteen forms), stated one layer
 * earlier so the officer sees the gap while typing rather than at export.
 */
function substituteText(node: BodyNode, scope: Scope, unfilled: string[]): BodyNode[] {
  const text = node.text ?? ''
  if (!text.includes('{{')) return [node]

  const out: BodyNode[] = []
  let cursor = 0
  PLACEHOLDER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER.exec(text)) !== null) {
    // Read `lastIndex` before anything else touches the regex: this loop shares
    // one module-level sticky pattern, and `markdown.ts` records what happens
    // when a nested call moves the cursor backwards (ADR-039's addendum).
    const at = match.index
    const end = PLACEHOLDER.lastIndex
    const name = match[1] ?? ''
    if (at > cursor) out.push({ ...node, text: text.slice(cursor, at) })

    const value = lookup(name, scope)
    if (value === undefined || isBlank(value)) {
      if (!unfilled.includes(name)) unfilled.push(name)
      out.push({ type: 'placeholder', attrs: { field: name } })
    } else {
      out.push({ ...node, text: asText(value) })
    }
    cursor = end
  }
  if (cursor < text.length) out.push({ ...node, text: text.slice(cursor) })
  return out
}

function expandNode(node: BodyNode, scope: Scope, unfilled: string[]): BodyNode[] {
  if (node.type === 'text') return substituteText(node, scope, unfilled)
  if (!node.content) return [node]
  return [{ ...node, content: expandRun(node.content, scope, unfilled).nodes }]
}

/**
 * One run of sibling nodes: markers matched to their closers, everything else
 * substituted.
 *
 * Nesting is counted rather than assumed, so `{{#each}}` inside `{{#if}}`
 * works and the closer that ends an outer block is not stolen by an inner one.
 */
function expandRun(
  nodes: BodyNode[],
  scope: Scope,
  unfilled: string[],
): { nodes: BodyNode[]; issues: SkeletonIssue[] } {
  const out: BodyNode[] = []
  const issues: SkeletonIssue[] = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    const marker = markerOf(node)

    if (marker === null) {
      out.push(...expandNode(node, scope, unfilled))
      continue
    }

    if (marker.kind === 'endif' || marker.kind === 'endeach') {
      issues.push({
        code: 'unopened',
        marker: marker.kind === 'endif' ? '{{/if}}' : '{{/each}}',
        message: message('unopened', marker.kind === 'endif' ? '{{/if}}' : '{{/each}}'),
      })
      continue
    }

    const closerKind = marker.kind === 'if' ? 'endif' : 'endeach'
    let depth = 1
    let close = -1
    for (let scan = index + 1; scan < nodes.length; scan += 1) {
      const inner = markerOf(nodes[scan] ?? { type: 'paragraph' })
      if (inner?.kind === marker.kind) depth += 1
      else if (inner?.kind === closerKind) {
        depth -= 1
        if (depth === 0) {
          close = scan
          break
        }
      }
    }

    const opener = marker.kind === 'if' ? `{{#if ${marker.field}}}` : `{{#each ${marker.field}}}`
    const inner = nodes.slice(index + 1, close === -1 ? nodes.length : close)
    if (close === -1) issues.push({ code: 'unclosed', marker: opener, message: message('unclosed', opener) })

    const value = lookup(marker.field, scope)
    if (marker.kind === 'if') {
      // A condition on a field the document does not have is FALSE, not an
      // error. Half the conditions in the library are on optional fields, and a
      // template that reported an issue for every one an officer left blank
      // would report nothing worth reading.
      if (!isBlank(value)) {
        const expanded = expandRun(inner, scope, unfilled)
        out.push(...expanded.nodes)
        issues.push(...expanded.issues)
      }
    } else {
      const items = Array.isArray(value) ? value : isBlank(value) ? [] : [String(value)]
      // Zero rows emits nothing at all — not an empty paragraph, which would
      // print as a blank line on A4 and read as a mistake.
      items.forEach((item, position) => {
        const expanded = expandRun(inner, { ...scope, item: { value: item, index: position + 1 } }, unfilled)
        out.push(...expanded.nodes)
        if (position === 0) issues.push(...expanded.issues)
      })
    }

    index = close === -1 ? nodes.length : close
  }

  return { nodes: out, issues }
}

/**
 * A skeleton and a set of bindings, as a body.
 *
 * `values` is what `bindings(doc, lang)` produces, so a skeleton's `{{subject}}`
 * and a legacy layout's `{{subject}}` mean the same thing — which is the whole
 * reason `bindings` exists as one function.
 */
export function instantiate(skeleton: BodyDoc, values: Record<string, string | string[]>): InstantiateResult {
  const unfilled: string[] = []
  const { nodes, issues } = expandRun(skeleton.content ?? [], { values }, unfilled)
  // A body with no blocks at all gives the editor no caret; every empty
  // document in this app is one empty paragraph.
  return {
    body: { type: 'doc', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] },
    issues,
    unfilled,
  }
}
