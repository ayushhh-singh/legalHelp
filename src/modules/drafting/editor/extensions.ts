import { Node, mergeAttributes } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'

import type { Extensions } from '@tiptap/core'

/**
 * The editor's node vocabulary — the eleven kinds a document may contain, and
 * no more.
 *
 * `BODY_NODES` in `src/lib/drafting/model.ts` is the authoritative list and
 * `bodySchema` rejects anything else on the way into storage. This file is the
 * other half of the same claim: it configures Tiptap to PRODUCE only those
 * nodes, so the editor cannot write something the model would refuse to store.
 * `editor.test.ts` asserts the two agree.
 *
 * Three of the nodes are this app's own.
 */

/**
 * A numbered paragraph.
 *
 * `level` is 1 for a top-level paragraph and 2 for a sub-paragraph, and the
 * renderer counts — `2.`, `2.1` — rather than reading a number off the node.
 * That is the whole reason this is a node type rather than an ordered list:
 * a statutory paragraph number has to survive a paragraph being moved, and it
 * has to be able to sit beside an unnumbered paragraph in the same block.
 */
export const NumberedPara = Node.create({
  name: 'numberedPara',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element) => Number(element.getAttribute('data-level') ?? 1),
        renderHTML: (attributes) => ({ 'data-level': String(attributes.level ?? 1) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'p[data-numbered]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-numbered': '' }), 0]
  },
  addKeyboardShortcuts() {
    return {
      // Tab and Shift-Tab move a paragraph between top level and sub-paragraph,
      // which is what an officer reaches for and what a list would do.
      Tab: () => {
        const { level } = this.editor.getAttributes('numberedPara')
        if (!this.editor.isActive('numberedPara')) return false
        return this.editor.commands.updateAttributes('numberedPara', {
          level: Math.min(3, Number(level ?? 1) + 1),
        })
      },
      'Shift-Tab': () => {
        const { level } = this.editor.getAttributes('numberedPara')
        if (!this.editor.isActive('numberedPara')) return false
        return this.editor.commands.updateAttributes('numberedPara', {
          level: Math.max(1, Number(level ?? 1) - 1),
        })
      },
    }
  },
})

/**
 * An unfilled `{{field}}`.
 *
 * An inline ATOM, so it is one thing to a caret and cannot be half-deleted into
 * `{{fileNumb`. It renders in the plain text as the literal `{{field}}`, which
 * is what `checklist.ts`'s `noPlaceholders` rule matches and what the export
 * gate refuses — the placeholder has to be visible in the text, or the one rule
 * stopping a document going out with a hole in it stops seeing it.
 */
export const PlaceholderChip = Node.create({
  name: 'placeholder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      field: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-field') ?? '',
        renderHTML: (attributes) => ({ 'data-field': String(attributes.field ?? '') }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-field]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'draft-placeholder' }),
      `{{${String(node.attrs.field ?? '')}}}`,
    ]
  },
})

/** A page break. Renders as a rule on screen and as a break in print and .docx. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'draft-page-break', 'aria-hidden': 'true' }]
  },
})

export interface EditorExtensionOptions {
  /** The empty-document hint, in the reader's own language. */
  placeholder: string
}

/**
 * Every extension, in one list.
 *
 * `heading` is capped at three levels: a Central Secretariat document has a
 * subject, sections and sub-sections, and a fourth level of heading in a
 * four-page O.M. is a structure nobody reads. `horizontalRule` and `codeBlock`
 * are off because neither belongs in an official communication and both would
 * be a node `bodySchema` refuses.
 */
export function editorExtensions(options: EditorExtensionOptions): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      horizontalRule: false,
      codeBlock: false,
      code: false,
      strike: false,
      link: false,
      underline: {},
    }),
    Placeholder.configure({ placeholder: options.placeholder }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    NumberedPara,
    PlaceholderChip,
    PageBreak,
  ]
}
