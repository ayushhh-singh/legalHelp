import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { applyChanges, changesOf } from '../suggestion'
import { diffWords } from '@/lib/diff'
import { cn } from '@/lib/utils'

/**
 * A proposed rewrite, shown as a word-level diff with accept and reject on
 * each change.
 *
 * **Nothing renders this today.** It is built now, and tested now, because it
 * is the review surface an AI suggestion would arrive through (Session 21,
 * `src/modules/drafting/ai-seam.ts`, ADR-021), and the day a model starts
 * proposing edits to an officer's draft is the wrong day to be writing the UI
 * that lets them refuse one. A suggestion that could only be taken whole or
 * left whole is a suggestion officers will take whole.
 *
 * ### How a partial accept is computed
 *
 * `diffWords` (Myers, `src/lib/diff.ts` — the same algorithm the Law Converter
 * uses to show what a Sanhita changed) returns runs of `equal`, `insert` and
 * `delete`. A **change** here is one such run that is not `equal`, and the
 * result text is rebuilt from the parts by asking, for each one:
 *
 *  - `equal` — always kept;
 *  - `insert` — kept only if that change was accepted;
 *  - `delete` — kept only if that change was REJECTED, because rejecting a
 *    deletion means keeping the original words.
 *
 * That inversion on `delete` is the whole of the logic and the one place it
 * can be got wrong, so it has a test of its own.
 *
 * Adjacent `delete`+`insert` runs are a replacement, and are grouped into one
 * change: offering "remove 'shall'" and "add 'may'" as two independent
 * decisions lets a reader produce a sentence with neither word in it, which is
 * a sentence neither side proposed.
 */

export function SuggestionDiff({
  before,
  after,
  csmopRef,
  onApply,
  onCancel,
}: {
  before: string
  after: string
  csmopRef?: string
  onApply: (text: string) => void
  onCancel: () => void
}) {
  const { t } = useT()
  const parts = useMemo(() => diffWords(before, after), [before, after])
  const changes = useMemo(() => (parts ? changesOf(parts) : []), [parts])
  // Every change starts accepted: a suggestion the reader asked for is a
  // suggestion they probably want, and rejecting three of twelve is less work
  // than accepting nine.
  const [accepted, setAccepted] = useState<boolean[]>(() => changes.map(() => true))

  // `diffWords` returns null when either side is too long to diff. The caller
  // must show both texts plainly rather than a wrong diff — so must this.
  if (!parts) {
    return <Fallback before={before} after={after} onApply={() => onApply(after)} onCancel={onCancel} />
  }

  if (changes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t('draft.suggestion.unchanged')}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onCancel}>
          {t('draft.suggestion.cancel')}
        </Button>
      </div>
    )
  }

  const result = applyChanges(parts, changes, accepted)
  const takenCount = accepted.filter(Boolean).length

  const setOne = (at: number, value: boolean) =>
    setAccepted((current) => current.map((each, index) => (index === at ? value : each)))

  return (
    <section
      aria-label={t('draft.suggestion.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('draft.suggestion.title')}</h3>
        <div className="flex items-center gap-2">
          {csmopRef ? <Badge tone="info">{csmopRef}</Badge> : null}
          <Badge tone="neutral">{t('draft.suggestion.changeCount', { count: changes.length })}</Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('draft.suggestion.accepted', { count: takenCount, total: changes.length })}
      </p>

      {/*
        The diff itself. `<ins>` and `<del>` carry the meaning, not the colour:
        the underline and the strike-through survive a monochrome print and a
        reader who cannot tell the two tints apart — the same rule the Law
        Converter's DiffView follows.
      */}
      <p className="rounded-md border border-border bg-muted p-3 text-sm leading-relaxed">
        {parts.map((part, partIndex) => {
          const at = changes.findIndex((change) => partIndex >= change.start && partIndex < change.end)
          const take = at === -1 ? false : (accepted[at] ?? false)
          const text = part.tokens.map((token) => (token === '\n' ? '\n' : token)).join(' ')

          if (part.op === 'equal') return <span key={partIndex}>{`${text} `}</span>

          const Tag = part.op === 'insert' ? 'ins' : 'del'
          return (
            <Tag
              key={partIndex}
              className={cn(
                'whitespace-pre-wrap',
                part.op === 'insert'
                  ? 'bg-tulsi/15 text-tulsi-foreground decoration-2'
                  : 'bg-coral/15 text-coral-foreground decoration-2',
                // A change the reader has turned off is shown, dimmed, rather
                // than removed: seeing what was proposed and declined is the
                // point of reviewing it.
                !take && part.op === 'insert' && 'opacity-50',
                take && part.op === 'delete' && 'opacity-50',
              )}
            >
              {`${text} `}
            </Tag>
          )
        })}
      </p>

      <ul className="flex flex-col gap-2">
        {changes.map((change, at) => {
          const removed = parts
            .slice(change.start, change.end)
            .filter((part) => part.op === 'delete')
            .flatMap((part) => part.tokens)
            .join(' ')
          const added = parts
            .slice(change.start, change.end)
            .filter((part) => part.op === 'insert')
            .flatMap((part) => part.tokens)
            .join(' ')

          return (
            <li
              key={`${change.start}-${change.end}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="min-w-0 text-sm">
                {removed ? (
                  <del className="text-coral-foreground">{removed}</del>
                ) : (
                  <span className="text-muted-foreground">{t('draft.suggestion.added')}</span>
                )}
                {removed && added ? ' → ' : ' '}
                {added ? <ins className="text-tulsi-foreground">{added}</ins> : null}
              </span>

              <span role="group" aria-label={`${removed} ${added}`.trim()} className="flex shrink-0 gap-1">
                <Toggle
                  pressed={accepted[at] === true}
                  label={t('draft.suggestion.accept')}
                  onClick={() => setOne(at, true)}
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                </Toggle>
                <Toggle
                  pressed={accepted[at] === false}
                  label={t('draft.suggestion.reject')}
                  onClick={() => setOne(at, false)}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Toggle>
              </span>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => onApply(result)}>
          {t('draft.suggestion.apply')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAccepted(changes.map(() => true))}
        >
          {t('draft.suggestion.acceptAll')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAccepted(changes.map(() => false))}
        >
          {t('draft.suggestion.rejectAll')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('draft.suggestion.cancel')}
        </Button>
      </div>
    </section>
  )
}

function Toggle({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        pressed
          ? 'border-action bg-action text-action-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** Both texts, plainly, when the diff was refused for length. */
function Fallback({
  before,
  after,
  onApply,
  onCancel,
}: {
  before: string
  after: string
  onApply: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  return (
    <section
      aria-label={t('draft.suggestion.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-semibold">{t('draft.suggestion.title')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="rounded-md border border-border bg-muted p-3 text-sm whitespace-pre-wrap">{before}</p>
        <p className="rounded-md border border-border bg-muted p-3 text-sm whitespace-pre-wrap">{after}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onApply}>
          {t('draft.suggestion.apply')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('draft.suggestion.cancel')}
        </Button>
      </div>
    </section>
  )
}
