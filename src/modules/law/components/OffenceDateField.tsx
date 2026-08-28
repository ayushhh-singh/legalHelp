import { CalendarDays, Info, X } from 'lucide-react'

import { COMMENCEMENT_DATE, eraForOffenceDate } from '../dateRule'

import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The date of the offence, and the banner that says what it decides.
 *
 * This sits above the search box rather than beside the results because it is
 * not a filter — it does not change which sections are shown. It changes which
 * of the two answers on every card is the operative one, and a reader who has
 * not given a date must be told that the app does not know.
 *
 * The banner is `role="status"`, not `role="alert"`: it reports the consequence
 * of something the reader just did, and interrupting them for it would be
 * wrong.
 */
export function OffenceDateField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const { t } = useT()
  const era = eraForOffenceDate(value)
  // A value that is present but unreadable is its own state: the date picker
  // cannot produce one, a deep link can.
  const invalid = Boolean(value) && era === null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <label htmlFor="law-offence-date" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
            <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
            {t('law.date.label')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="law-offence-date"
              type="date"
              value={value ?? ''}
              max="2099-12-31"
              onChange={(event) => onChange(event.target.value || null)}
              aria-describedby="law-offence-date-hint"
              aria-invalid={invalid || undefined}
              className="h-11 rounded-lg border border-input bg-card px-3 text-base tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            />
            {value ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                aria-label={t('law.date.clear')}
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <p id="law-offence-date-hint" className="pb-3 text-xs text-muted-foreground">
          {t('law.date.hint')}
        </p>
      </div>

      <div role="status" aria-live="polite">
        {invalid ? <DateBanner tone="coral" title={t('law.date.invalid')} /> : null}
        {!value ? <DateBanner tone="muted" title={t('law.date.none')} /> : null}
        {era === 'old' ? (
          <DateBanner tone="marigold" title={t('law.date.oldTitle')} body={t('law.date.oldBody')} />
        ) : null}
        {era === 'new' ? (
          <DateBanner tone="tulsi" title={t('law.date.newTitle')} body={t('law.date.newBody')} />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Every tone is that colour's `/15` tint with its paired `-foreground` on top —
 * never the raw accent as text (see .claude/skills/frontend-design/SKILL.md).
 */
const TONES = {
  marigold: 'border-marigold bg-marigold/15 text-marigold-foreground',
  tulsi: 'border-tulsi bg-tulsi/15 text-tulsi-foreground',
  coral: 'border-coral bg-coral/15 text-coral-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
} as const

function DateBanner({ tone, title, body }: { tone: keyof typeof TONES; title: string; body?: string }) {
  return (
    <aside className={cn('flex items-start gap-2 rounded-md border-l-[3px] px-3 py-2 text-sm', TONES[tone])}>
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{title}</p>
        {body ? <p>{body}</p> : null}
      </div>
    </aside>
  )
}

export { COMMENCEMENT_DATE }
