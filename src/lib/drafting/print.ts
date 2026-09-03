/**
 * Page geometry, shared by the three things that put a document on a page: the
 * A4 preview, the print route and the `.docx` writer.
 *
 * One file, because a paper size that is A4 in the preview, A4 in the CSS and
 * Letter in the Word file is the kind of disagreement nobody finds until the
 * document is in a folder. `docx.ts` reads `twipsOf`, `PrintPage` reads
 * `pageRuleCss`, and both start from the same two constants.
 *
 * ### Why the app prints rather than generating a PDF
 *
 * `docs/DECISIONS.md` ADR-042 §5 has the full reasoning; the short form is that
 * a JavaScript PDF library cannot SHAPE Devanagari. jsPDF and pdf-lib both draw
 * a string by mapping code points to glyph ids one at a time, and Devanagari
 * needs reordering (the `i` matra is typed after its consonant and printed
 * before it), conjunct substitution and mark positioning — a HarfBuzz job. The
 * browser's own print pipeline already does all of it, correctly, with the
 * fonts this app ships. So "Export PDF" is `window.print()` and an instruction
 * sheet, and the output is right in both languages.
 */

export const PAGE_SIZES = ['A4', 'Letter'] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export const PAGE_DIMENSIONS: Record<PageSize, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  // 8.5in × 11in. Offered because an officer in a joint office with an American
  // organisation occasionally needs it, and never the default: a Letter page in
  // an A4 folder is the kind of thing an office notices.
  Letter: { widthMm: 215.9, heightMm: 279.4 },
}

/** CSMOP 7.2(xvi): about one inch on all four sides of a Government document. */
export const CSMOP_MARGIN_MM = 25.4

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageSetup {
  size: PageSize
  /** Millimetres. */
  margin: Margins
  /** Draw the letterhead and page number in the running header and footer. */
  runningHeader: boolean
  runningFooter: boolean
}

export const defaultPageSetup = (size: PageSize = 'A4'): PageSetup => ({
  size,
  margin: {
    top: CSMOP_MARGIN_MM,
    right: CSMOP_MARGIN_MM,
    bottom: CSMOP_MARGIN_MM,
    left: CSMOP_MARGIN_MM,
  },
  runningHeader: true,
  runningFooter: true,
})

const round = (value: number): number => Math.round(value * 100) / 100

export function isPageSize(value: unknown): value is PageSize {
  return typeof value === 'string' && (PAGE_SIZES as readonly string[]).includes(value)
}

/** Millimetres to twentieths of a point, which is what OOXML measures in. */
export const mmToTwip = (mm: number): number => Math.round((mm / 25.4) * 1440)

/** The page and its margins, in the units `docx` wants. */
export function twipsOf(setup: PageSetup): {
  size: { width: number; height: number }
  margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number }
} {
  const dimensions = PAGE_DIMENSIONS[setup.size]
  return {
    size: { width: mmToTwip(dimensions.widthMm), height: mmToTwip(dimensions.heightMm) },
    margin: {
      top: mmToTwip(setup.margin.top),
      right: mmToTwip(setup.margin.right),
      bottom: mmToTwip(setup.margin.bottom),
      left: mmToTwip(setup.margin.left),
      // Half the margin, so a running header sits inside the top margin rather
      // than pushing the first paragraph down the page.
      header: mmToTwip(setup.margin.top / 2),
      footer: mmToTwip(setup.margin.bottom / 2),
    },
  }
}

/**
 * The `@page` rule for a print route.
 *
 * Emitted as a string and injected into a `<style>` element rather than written
 * into `index.css`, for the one reason CSS cannot help with: `size` and
 * `margin` inside `@page` cannot be set from a custom property. A browser reads
 * `@page { size: var(--x) }` as invalid and falls back to the printer's
 * default, which is Letter in some locales — so a page size the officer CHOSE
 * has to arrive as literal text in a generated rule.
 *
 * The rule is NAMED, for the reason `draft-a4` and `library-a4` are named
 * (`src/styles/index.css`): a margin asked for here must not move the pay slip
 * or the law card, which print at the global 15mm.
 */
export function pageRuleCss(setup: PageSetup, name = 'draft-print'): string {
  const dimensions = PAGE_DIMENSIONS[setup.size]
  const { top, right, bottom, left } = setup.margin
  return [
    `@page ${name} {`,
    `  size: ${round(dimensions.widthMm)}mm ${round(dimensions.heightMm)}mm;`,
    `  margin: ${round(top)}mm ${round(right)}mm ${round(bottom)}mm ${round(left)}mm;`,
    `}`,
    /*
      BOTH selectors, and the second one is the one that does the work.

      `A4Preview` renders `.a4-print-root`, and `src/styles/index.css` sets
      `page: draft-a4` on it — a fixed A4 at CSMOP margins, which is right for
      the editor's preview. The print route wraps that same element, so a rule
      on the ancestor alone was overridden by the inner named page for
      everything inside it: the paper control changed the stylesheet and could
      not change the page.

      The override is scoped to `.draft-print-root` deliberately. A bare
      `.a4-print-root` rule here would follow the officer's choice of paper into
      the editor's preview and out to every other printable surface that shares
      the class.
    */
    `.draft-print-root,`,
    `.draft-print-root .a4-print-root { page: ${name}; }`,
  ].join('\n')
}

/**
 * The width of the text column, in millimetres.
 *
 * Used by the preview to size the sheet and by nothing else — but it is here
 * rather than in the component because it is arithmetic over the page setup,
 * and a component that recomputes it is a second place for the margins to be
 * wrong.
 */
export const textWidthMm = (setup: PageSetup): number =>
  round(PAGE_DIMENSIONS[setup.size].widthMm - setup.margin.left - setup.margin.right)

// ------------------------------------------------------ bilingual pairing

/**
 * How many body paragraphs each language has, when they disagree.
 *
 * A bilingual document whose two halves have a different number of paragraphs
 * is not necessarily wrong — a Hindi paragraph may legitimately carry two
 * English ones — but it is always worth saying, because the commonest cause is
 * an officer who edited one side and not the other. The side-by-side views pad
 * the shorter half with a visible em dash rather than an empty cell, so the gap
 * reads as a gap instead of as a document that happens to be shorter.
 *
 * `null` when they agree, so the caller renders nothing at all rather than a
 * reassurance nobody asked for.
 */
export function bilingualMismatch(
  en: { blocks: readonly { role: string; lines: readonly string[] }[] },
  hi: { blocks: readonly { role: string; lines: readonly string[] }[] },
): { en: number; hi: number } | null {
  const count = (document: { blocks: readonly { role: string; lines: readonly string[] }[] }): number =>
    document.blocks
      .filter((block) => block.role === 'body')
      .reduce((total, block) => total + block.lines.length, 0)
  const left = count(en)
  const right = count(hi)
  return left === right ? null : { en: left, hi: right }
}
