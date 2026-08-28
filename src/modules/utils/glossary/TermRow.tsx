import { Bookmark, BookmarkCheck, Check, Copy } from 'lucide-react'
import { useState } from 'react'

import type { GlossaryTerm } from './schema'

import { SourceChip } from '@/components/common/SourceChip'
import { Badge, Chip } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * One glossary term: English and Hindi side by side, a copy button for each,
 * a favourite toggle, and the source/verify treatment every data card in this
 * app owes the reader (master context).
 *
 * The copy confirmation is a live region tagged to which button was pressed,
 * not a toast — the same reasoning `SectionActions.tsx` gives: the result of
 * "Copy" is otherwise invisible to a screen reader.
 */
export function TermRow({
  term,
  favourite,
  onToggleFavourite,
  onCopy,
  language,
}: {
  term: GlossaryTerm
  favourite: boolean
  onToggleFavourite: (term: GlossaryTerm) => void
  onCopy: (term: GlossaryTerm, text: string) => void
  language: 'en' | 'hi'
}) {
  const { t } = useT()
  const [copied, setCopied] = useState<'en' | 'hi' | null>(null)
  const [message, setMessage] = useState('')

  const copy = async (which: 'en' | 'hi') => {
    const text = which === 'en' ? term.en : term.hi
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setMessage(t('utils.glossary.copied'))
      onCopy(term, text)
    } catch {
      setCopied(null)
      setMessage(t('utils.glossary.copyFailed'))
    }
  }

  return (
    <li className="rounded-lg border border-border p-3 transition-colors hover:border-input">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm font-medium">{term.en}</p>
          <p className="text-sm font-medium">{term.hi}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={favourite}
          aria-label={favourite ? t('utils.glossary.unfavourite') : t('utils.glossary.favourite')}
          onClick={() => onToggleFavourite(term)}
          className="h-9 w-9 shrink-0"
        >
          {favourite ? (
            <BookmarkCheck aria-hidden="true" className="h-4 w-4 text-marigold-foreground" />
          ) : (
            <Bookmark aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>
      </div>

      {term.alsoHi && term.alsoHi.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('utils.glossary.alsoKnown')}: {term.alsoHi.join(', ')}
        </p>
      ) : null}

      {term.note ? <p className="mt-1 text-xs text-muted-foreground">{term.note[language]}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy('en')}>
          {copied === 'en' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t('utils.glossary.copyEnglish')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy('hi')}>
          {copied === 'hi' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t('utils.glossary.copyHindi')}
        </Button>
        <Chip tone="neutral">{t(`utils.glossary.category.${term.category}`)}</Chip>
        {term.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
        <SourceChip name={term.source.name} url={term.source.url} />
      </div>

      <p role="status" aria-live="polite" className="mt-1 min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </li>
  )
}
