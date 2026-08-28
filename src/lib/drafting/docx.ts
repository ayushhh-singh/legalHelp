import { AlignmentType, Document, Packer, PageBreak, Paragraph, TextRun, type IParagraphOptions } from 'docx'

import type { DocumentModel, RenderedBlock } from './types'

/**
 * The document as a `.docx`.
 *
 * **Import this module dynamically.** `docx` is ~340 KB of JavaScript and is
 * needed only by a reader who presses Export, which is once per document at
 * most and never at all for a reader who prints instead. `ExportBar.tsx` pulls
 * it in on the click; a static import would put it in the editor chunk and
 * charge every visit to `/draft` for it.
 *
 * The rendering rule is that **the engine has already made every decision**.
 * Paragraph numbers are text in `block.lines`, because CSMOP numbers the first
 * paragraph of an O.M. differently from the first paragraph of a note and
 * Word's own numbering engine would renumber both to suit itself. Alignment,
 * emphasis and the enclosure count are on the block. This file turns a
 * `DocumentModel` into Word's XML and decides nothing about the document.
 *
 * ### The fonts, and what a `.docx` can and cannot promise
 *
 * A Word run names ONE font per script slot; there is no fallback list. So
 * every run here sets `ascii`/`hAnsi` to a Latin face and `cs` — the complex
 * script slot — to a Devanagari one, and Word and LibreOffice pick between them
 * **per character**. That is what makes a bilingual signature block come out
 * right: `(A.B.C.)` in Times New Roman and `अवर सचिव, भारत सरकार` in Nirmala UI,
 * inside one run, with no scanning of the string here.
 *
 * Nirmala UI ships with Windows 8 and later and Mangal with every Windows since
 * XP, which is what government desktops have. Neither exists on a stock Linux
 * or macOS, where the reader's word processor substitutes its own Devanagari
 * face — the text is correct, the shaping is correct, the face is whatever that
 * machine has. That is a property of `.docx` itself and not something this
 * module can fix; embedding a font would put ~200 KB of Noto into every
 * exported file and is a licence question besides.
 */

export interface DocxOptions {
  /** The Latin face, in the `ascii` and `hAnsi` slots. */
  latinFont?: string
  /** The Devanagari face, in the complex-script slot. */
  devanagariFont?: string
  /** Body size in points. Headings are not scaled — CSMOP prints one size. */
  fontSizePt?: number
}

const DEFAULTS = {
  latinFont: 'Times New Roman',
  devanagariFont: 'Nirmala UI',
  fontSizePt: 12,
} satisfies Required<DocxOptions>

/** A4 in twentieths of a point: 210mm x 297mm. */
const A4 = { width: 11906, height: 16838 }

/** One inch, the margin CSMOP 7.2(xvi) asks for on all four sides. */
const INCH = 1440

const ALIGNMENT = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const

/**
 * Blocks whose lines are a list of people or papers, and which therefore want
 * their items kept together rather than orphaned across a page break.
 */
const KEEP_TOGETHER: ReadonlySet<RenderedBlock['role']> = new Set([
  'signature',
  'enclosures',
  'copyTo',
  'endorsement',
  'addressee',
])

function runFor(text: string, options: Required<DocxOptions>, bold: boolean): TextRun {
  return new TextRun({
    text,
    bold,
    // Both halves, or a bold Hindi heading comes out regular: Word tracks the
    // complex-script weight separately from the Latin one.
    boldComplexScript: bold,
    size: options.fontSizePt * 2,
    sizeComplexScript: options.fontSizePt * 2,
    font: {
      ascii: options.latinFont,
      hAnsi: options.latinFont,
      cs: options.devanagariFont,
    },
  })
}

function paragraphsFor(block: RenderedBlock, options: Required<DocxOptions>): Paragraph[] {
  const bold = block.emphasis !== 'normal'
  const alignment = ALIGNMENT[block.align]

  return block.lines.map((line, index) => {
    const shape: IParagraphOptions = {
      alignment,
      children: [runFor(line, options, bold)],
      spacing: {
        // Space after the block, not after every line of it: an address whose
        // three lines are a paragraph apart is not an address.
        after: index === block.lines.length - 1 ? 200 : 0,
        line: 276,
      },
      ...(KEEP_TOGETHER.has(block.role) && index < block.lines.length - 1 ? { keepNext: true } : {}),
    }
    return new Paragraph(shape)
  })
}

/**
 * One or more rendered documents as a Word file.
 *
 * Pass one `DocumentModel` for a single-language export, or two for the
 * bilingual one — English then Hindi, separated by a page break, which is how
 * a bilingual issue is actually filed. They are separated by a break rather
 * than by two sections because it is one document with two halves, and two
 * sections would let a word processor number them independently.
 */
export function buildDocxDocument(documents: readonly DocumentModel[], options: DocxOptions = {}): Document {
  const resolved = { ...DEFAULTS, ...options }
  const children: Paragraph[] = []

  documents.forEach((document, index) => {
    if (index > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    for (const block of document.blocks) {
      children.push(...paragraphsFor(block, resolved))
    }
  })

  return new Document({
    // Word shows these in File > Info. Deliberately says nothing about who
    // made it: this app knows no officer's name beyond what is in the document
    // itself, and a `creator` naming the app is a claim the app should not make
    // about a document an officer signs.
    creator: '',
    description: '',
    title: '',
    styles: {
      default: {
        document: {
          run: {
            size: resolved.fontSizePt * 2,
            font: {
              ascii: resolved.latinFont,
              hAnsi: resolved.latinFont,
              cs: resolved.devanagariFont,
            },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height },
            margin: { top: INCH, right: INCH, bottom: INCH, left: INCH },
          },
        },
        children,
      },
    ],
  })
}

/** The same, packed. Browser only — `Packer.toBlob` needs a `Blob`. */
export function toDocxBlob(documents: readonly DocumentModel[], options: DocxOptions = {}): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(documents, options))
}

/**
 * A file name an officer can find again.
 *
 * The file number first where there is one, because that is how a document is
 * filed and how it will be searched for; the form's name otherwise. Everything
 * a file system dislikes is replaced, and Devanagari is kept — a Hindi O.M.
 * deserves a Hindi file name, and every platform this app runs on handles it.
 */
export function docxFileName(parts: { fileNumber?: string; fallback: string; lang: string }): string {
  const base = (parts.fileNumber?.trim() || parts.fallback).trim()
  const safe = base
    // Windows forbids these outright; the rest are merely a nuisance in a shell.
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
  return `${safe || 'draft'} (${parts.lang}).docx`
}
