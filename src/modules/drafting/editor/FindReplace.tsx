import { useMemo, useState } from 'react'

import { findMatches, replaceAll, type FindOptions } from './commands'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { BodyDoc } from '@/lib/drafting/model'

/**
 * Find and replace, with a regular-expression option.
 *
 * Everything is computed by the pure functions in `commands.ts` over the body
 * JSON, so a pattern the officer typed is tested against a document rather than
 * against a DOM — and a pattern that does not compile is reported instead of
 * throwing inside a keystroke handler.
 *
 * "Whole word" is announced as ignored on a Devanagari query rather than
 * silently doing nothing: JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so
 * `/\bनियम\b/` matches nothing, ever — the trap ADR-035 and ADR-038 both
 * record, and one this control would otherwise reproduce exactly.
 */
export function FindReplace({
  body,
  onReplace,
  onClose,
}: {
  body: BodyDoc
  onReplace: (next: BodyDoc, count: number) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState<FindOptions>({})
  const [notice, setNotice] = useState('')

  const result = useMemo(() => findMatches(body, query, options), [body, query, options])
  const devanagariWholeWord = options.wholeWord === true && query.length > 0 && !/[A-Za-z0-9_]/.test(query)

  const summary =
    result === 'bad-regex'
      ? t('draft.find.badRegex')
      : query === ''
        ? ''
        : result.length === 0
          ? t('draft.find.noMatches')
          : t('draft.find.matches', { count: result.length })

  const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

  return (
    <section aria-label={t('draft.find.heading')} className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('draft.find.heading')}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('draft.find.close')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.find.find')}</span>
          <input className={field} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.find.replace')}</span>
          <input
            className={field}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {(
          [
            ['regex', t('draft.find.regex')],
            ['caseSensitive', t('draft.find.caseSensitive')],
            ['wholeWord', t('draft.find.wholeWord')],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={options[key] === true}
              onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.checked }))}
            />
            {label}
          </label>
        ))}
      </div>

      {devanagariWholeWord ? (
        <p className="mt-2 rounded-lg border border-marigold/40 bg-marigold/15 p-2 text-sm text-marigold-foreground">
          {t('draft.find.wholeWordDevanagari')}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {notice || summary}
        </p>
        <Button
          size="sm"
          disabled={result === 'bad-regex' || query === '' || (Array.isArray(result) && result.length === 0)}
          onClick={() => {
            const next = replaceAll(body, query, replacement, options)
            if (next === 'bad-regex') {
              setNotice(t('draft.find.badRegex'))
              return
            }
            onReplace(next.body, next.count)
            setNotice(t('draft.find.replaced', { count: next.count }))
          }}
        >
          {t('draft.find.replaceAll')}
        </Button>
      </div>
    </section>
  )
}
