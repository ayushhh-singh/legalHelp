import type { Editor } from '@tiptap/core'

import { toAsciiDigits, toDevanagariDigits } from '@/lib/drafting/format'
import type { BodyDoc, BodyNode } from '@/lib/drafting/model'

/**
 * Editor commands that are more than one Tiptap call — the ones worth testing
 * without a DOM.
 *
 * Everything here takes plain data or an `Editor` and returns plain data.
 * `findMatches`, `replaceAll` and `convertDigits` are pure over a `BodyDoc`,
 * which is what lets a regular expression the officer typed be tested against
 * a fixture rather than against a browser.
 */

// ------------------------------------------------------------ find/replace

export interface FindOptions {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface FindMatch {
  /** Index into the flattened list of text nodes. */
  node: number
  start: number
  end: number
  text: string
}

export type FindError = 'bad-regex'

/**
 * Build the pattern a find runs.
 *
 * A regular expression the officer typed is untrusted input in the ordinary
 * sense — it can fail to compile — so this returns the error rather than
 * throwing inside a keystroke handler. A literal search escapes every
 * metacharacter, which is what makes searching for `A-11011/5(i)/2026` work at
 * all.
 */
export function buildPattern(query: string, options: FindOptions): RegExp | FindError | null {
  if (!query) return null
  const flags = options.caseSensitive ? 'gu' : 'giu'
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `\b` is not applied to a Devanagari query: JavaScript defines a word
  // boundary over [A-Za-z0-9_], so `/\bनियम\b/` matches nothing, ever. That is
  // the trap ADR-035 and ADR-038 both record, and the honest answer here is to
  // ignore "whole word" for a query with no ASCII word character in it rather
  // than to return a pattern that silently finds nothing.
  const canWholeWord = options.wholeWord && /[A-Za-z0-9_]/.test(query)
  try {
    return new RegExp(canWholeWord ? `\\b(?:${source})\\b` : source, flags)
  } catch {
    return 'bad-regex'
  }
}

/** Every text node in a body, in document order, with its path. */
function textNodes(body: BodyDoc): { node: BodyNode; path: number[] }[] {
  const out: { node: BodyNode; path: number[] }[] = []
  const walk = (node: BodyNode, path: number[]) => {
    if (node.type === 'text') {
      out.push({ node, path })
      return
    }
    ;(node.content ?? []).forEach((child, index) => walk(child, [...path, index]))
  }
  walk(body, [])
  return out
}

export function findMatches(
  body: BodyDoc,
  query: string,
  options: FindOptions = {},
): FindMatch[] | FindError {
  const pattern = buildPattern(query, options)
  if (pattern === 'bad-regex') return 'bad-regex'
  if (!pattern) return []

  const out: FindMatch[] = []
  textNodes(body).forEach((entry, index) => {
    const text = entry.node.text ?? ''
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      out.push({ node: index, start: match.index, end: match.index + match[0].length, text: match[0] })
      // A zero-length match — `/x*/` against anything — would loop for ever.
      if (match[0].length === 0) pattern.lastIndex += 1
    }
  })
  return out
}

/**
 * Replace every match, and say how many.
 *
 * Pure over the body rather than driven through the editor's transaction API,
 * because a replace-all across a hundred paragraphs is one edit to an officer
 * and should be one undo step. The caller sets the result with
 * `editor.commands.setContent`, which Tiptap records as a single history entry.
 */
export function replaceAll(
  body: BodyDoc,
  query: string,
  replacement: string,
  options: FindOptions = {},
): { body: BodyDoc; count: number } | FindError {
  const pattern = buildPattern(query, options)
  if (pattern === 'bad-regex') return 'bad-regex'
  if (!pattern) return { body, count: 0 }

  let count = 0
  const rewrite = (node: BodyNode): BodyNode => {
    if (node.type === 'text') {
      const text = node.text ?? ''
      pattern.lastIndex = 0
      const next = text.replace(pattern, (...args) => {
        count += 1
        // `$1` in the replacement only means anything in regex mode; in a
        // literal search the officer typed a dollar sign and means one.
        return options.regex ? expandGroups(replacement, args) : replacement
      })
      return next === text ? node : { ...node, text: next }
    }
    if (!node.content) return node
    return { ...node, content: node.content.map(rewrite) }
  }

  return { body: rewrite(body) as BodyDoc, count }
}

/** `$1`..`$9` in a replacement, against one match's capture groups. */
function expandGroups(replacement: string, args: unknown[]): string {
  return replacement.replace(/\$(\d)/g, (whole, digit: string) => {
    const group = args[Number(digit)]
    return typeof group === 'string' ? group : whole
  })
}

// --------------------------------------------------------------- numerals

/**
 * Convert every numeral in the document between Devanagari and ASCII.
 *
 * A whole-document operation rather than a preference, because it is what an
 * officer actually wants: a Hindi issue typed with the number pad and then
 * converted once. The app-wide `devanagariDigits` setting is a different thing
 * — it controls the numbers the ENGINE generates (dates, paragraph numbers,
 * list markers) and never touches what was typed.
 */
export function convertDigits(body: BodyDoc, to: 'devanagari' | 'ascii'): BodyDoc {
  const convert = to === 'devanagari' ? toDevanagariDigits : toAsciiDigits
  const rewrite = (node: BodyNode): BodyNode => {
    if (node.type === 'text') return { ...node, text: convert(node.text ?? '') }
    if (!node.content) return node
    return { ...node, content: node.content.map(rewrite) }
  }
  return rewrite(body) as BodyDoc
}

// ----------------------------------------------------------------- counts

export interface DocumentCounts {
  words: number
  characters: number
  paragraphs: number
  /** An A4 page at this app's margins and leading holds about 380 words. */
  pages: number
}

const WORDS_PER_PAGE = 380

export function countDocument(body: BodyDoc): DocumentCounts {
  let words = 0
  let characters = 0
  let paragraphs = 0
  const walk = (node: BodyNode) => {
    if (node.type === 'text') {
      const text = node.text ?? ''
      characters += text.length
      words += text.split(/\s+/u).filter(Boolean).length
      return
    }
    if (node.type === 'paragraph' || node.type === 'numberedPara' || node.type === 'heading') paragraphs += 1
    for (const child of node.content ?? []) walk(child)
  }
  walk(body)
  return { words, characters, paragraphs, pages: Math.max(1, Math.ceil(words / WORDS_PER_PAGE)) }
}

// ------------------------------------------------------- editor shortcuts

/** Insert a `{{field}}` chip at the caret. */
export const insertPlaceholder = (editor: Editor, field: string): void => {
  editor.chain().focus().insertContent({ type: 'placeholder', attrs: { field } }).run()
}

/** Insert a phrase or a glossary term as plain text at the caret. */
export const insertText = (editor: Editor, text: string): void => {
  editor.chain().focus().insertContent(text).run()
}

export const insertTable = (editor: Editor, rows = 3, cols = 3): void => {
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
}

export const insertPageBreak = (editor: Editor): void => {
  editor.chain().focus().insertContent({ type: 'pageBreak' }).run()
}

/** Turn the paragraph the caret is in into a numbered one, or back. */
export const toggleNumberedPara = (editor: Editor): void => {
  if (editor.isActive('numberedPara')) editor.chain().focus().setNode('paragraph').run()
  else editor.chain().focus().setNode('numberedPara', { level: 1 }).run()
}
