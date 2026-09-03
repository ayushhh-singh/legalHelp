import { AlertTriangle } from 'lucide-react'

import { SourceChip } from '@/components/common/SourceChip'
import { useT } from '@/i18n/useT'
import type { Amendment } from '@/schemas/library'

/**
 * "This provision has changed and the text below has not caught up."
 *
 * The banner exists because the alternative was worse in both directions:
 * editing the base text would make `data/library` a second, divergent copy of a
 * statute the ingest owns (ADR-038 §1), and saying nothing would leave an
 * officer reading the RTI Act's section 8 the clause Parliament substituted in
 * November 2025 with no hint of it.
 *
 * It is marigold, not destructive: the text below is not WRONG, it is what the
 * source publishes, and this says what has happened since. It carries the
 * source of the change, because a claim that a provision has changed needs a
 * citation at least as much as the provision does.
 */

interface AmendmentBannerProps {
  notes: readonly Amendment[]
  language: 'en' | 'hi'
}

export function AmendmentBanner({ notes, language }: AmendmentBannerProps) {
  const { t } = useT()
  if (notes.length === 0) return null

  return (
    <section
      aria-label={t('library.amend.title')}
      className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-marigold-foreground"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {t('library.amend.title')}
      </h2>
      <ul className="mt-1 flex flex-col gap-2">
        {notes.map((note) => (
          <li key={`${note.date}-${note.source.url}`} className="text-sm">
            <p>{note.note[language]}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="tabular-nums">{t('library.amend.effectiveFrom', { date: note.date })}</span>
              <SourceChip name={note.source.name} url={note.source.url} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
