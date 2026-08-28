import { useT } from '@/i18n/useT'
import type { BilingualRenderResult, RenderResult, RenderedBlock } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'
import type { PreviewView } from '../url'

/**
 * The live A4 preview.
 *
 * Everything on this page was decided by the engine: the paragraph numbers,
 * the enclosure count, the normalised date, which blocks dropped out because
 * they were empty and `omitWhenEmpty`. This component sets type and does not
 * interpret — if the preview is wrong, the template or the engine is wrong,
 * and that is the property that makes the preview worth trusting.
 *
 * ### Why `layoutIndex` is the key and `role` is not
 *
 * Roles repeat. A demi-official letter has two `header` blocks (the writer's
 * personal stationery at the top left, and Government of India below it) and
 * two `closing` blocks. Keying a React list on `role` would collapse them, and
 * pairing the side-by-side view on `role` puts both headers at the first one's
 * position — which pushed `D.O. No.` above the letterhead in exactly this
 * component before the engine started carrying `layoutIndex`.
 *
 * ### `lang` on the right element
 *
 * The Hindi sheet, and the Hindi column of the side-by-side view, carry
 * `lang="hi"`. That is not politeness for screen readers alone: `index.css`
 * hangs the ≥ 1.75 Devanagari line-height rule off `:lang(hi)`, and matras sit
 * above AND below the baseline, so a Hindi document rendered at a Latin
 * leading collides its own vowel signs. Without the attribute the preview is
 * the one place in the app where that would happen.
 */

const ALIGN = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const

export function A4Preview({
  view,
  single,
  bilingual,
  className,
}: {
  view: PreviewView
  /** The rendered document for `en` or `hi`. Null while `view` is `both`. */
  single: RenderResult | null
  /** Both, paired. Null unless `view` is `both`. */
  bilingual: BilingualRenderResult | null
  className?: string
}) {
  const { t } = useT()

  if (view === 'both' && bilingual) {
    return (
      <div className={cn('a4-print-root', className)}>
        <div className="a4-bilingual grid gap-4 lg:grid-cols-2">
          <Sheet lang="en" heading={t('draft.preview.columnEn')}>
            {bilingual.en.document.blocks.map((block) => (
              <Block key={block.layoutIndex} block={block} />
            ))}
          </Sheet>
          <Sheet lang="hi" heading={t('draft.preview.columnHi')}>
            {bilingual.hi.document.blocks.map((block) => (
              <Block key={block.layoutIndex} block={block} />
            ))}
          </Sheet>
        </div>
      </div>
    )
  }

  if (!single) return null

  const blocks = single.document.blocks
  if (blocks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/60 p-8 text-center text-sm text-muted-foreground">
        {t('draft.preview.empty')}
      </p>
    )
  }

  return (
    <div className={cn('a4-print-root', className)}>
      <Sheet lang={single.document.lang}>
        {blocks.map((block) => (
          <Block key={block.layoutIndex} block={block} />
        ))}
      </Sheet>
    </div>
  )
}

/**
 * One sheet of paper.
 *
 * Always white with dark ink, in both themes and deliberately so. This is a
 * preview of a printed page, and a "dark mode document" would be a preview of
 * something that does not exist — the officer would be checking their spacing
 * against a page that is not the one coming out of the printer. The card
 * around it is themed; the paper is paper.
 */
function Sheet({
  lang,
  heading,
  children,
}: {
  lang: 'en' | 'hi'
  heading?: string
  children: React.ReactNode
}) {
  const { t } = useT()
  return (
    <div className="min-w-0">
      {heading ? (
        <p
          data-print-hide
          className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {heading}
        </p>
      ) : null}
      <div
        lang={lang}
        role="document"
        aria-label={t('draft.preview.page')}
        className="a4-page mx-auto overflow-x-auto rounded-lg border border-border text-[13px] shadow-sm"
      >
        {children}
      </div>
    </div>
  )
}

const EMPHASIS = {
  normal: '',
  bold: 'font-semibold',
  title: 'font-bold tracking-wide',
} as const

function Block({ block }: { block: RenderedBlock }) {
  return (
    <div className={cn('mb-3 last:mb-0', ALIGN[block.align], EMPHASIS[block.emphasis])}>
      {block.lines.map((line, index) => (
        /*
          One element per line, and `whitespace-pre-wrap` so that leading
          spaces an officer typed inside a paragraph survive. The engine has
          already split multi-line values into separate entries, so there is
          never a newline inside `line` — but a wrapped paragraph must still
          break on words, which is why this is `pre-wrap` and not `pre`.
        */
        <p key={index} className="whitespace-pre-wrap">
          {line}
        </p>
      ))}
    </div>
  )
}
