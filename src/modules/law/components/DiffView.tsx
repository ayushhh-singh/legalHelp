import { diffCounts, hasChanges, type DiffPart } from '@/lib/diff'

import { useT } from '@/i18n/useT'

/**
 * A word-level diff, rendered as `<ins>` and `<del>`.
 *
 * The elements are the point. Colour alone would tell a reader who cannot
 * separate green from red nothing at all, and a `<span>` with a tint tells
 * assistive technology nothing either. `<ins>` and `<del>` carry the meaning in
 * the markup; the strike-through and the tint are the visual half of the same
 * statement, and each `<ins>`/`<del>` also carries a visually-hidden label so
 * the announcement is unambiguous in screen readers that do not voice them.
 */
export function DiffView({ parts }: { parts: readonly DiffPart[] | null }) {
  const { t } = useT()

  if (!parts) return null
  if (!hasChanges(parts)) {
    return <p className="text-sm text-muted-foreground">{t('law.card.diffNone')}</p>
  }

  const counts = diffCounts(parts)

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground tabular-nums">
        {t('law.card.diffCounts', { added: counts.added, removed: counts.removed })}
      </p>
      <p className="text-sm leading-relaxed">
        {parts.map((part, index) => {
          const text = part.tokens.join(' ').replace(/ ?\n ?/g, '\n')

          if (part.op === 'equal') return <span key={index}>{text} </span>

          if (part.op === 'insert') {
            return (
              <ins
                key={index}
                className="rounded-sm bg-tulsi/15 px-1 text-tulsi-foreground underline decoration-2"
              >
                <span className="sr-only">({t('law.card.added')}) </span>
                {text}{' '}
              </ins>
            )
          }

          return (
            <del key={index} className="rounded-sm bg-coral/15 px-1 text-coral-foreground line-through">
              <span className="sr-only">({t('law.card.removed')}) </span>
              {text}{' '}
            </del>
          )
        })}
      </p>
    </div>
  )
}
