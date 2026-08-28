import { useState } from 'react'

import { diffVersions, fetchLatestVersions, hasUpdates, type UpdateCheckResult } from '@/lib/dataUpdates'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: UpdateCheckResult }
  | { status: 'error' }

/**
 * "Check for data updates" (Settings): is there a newer `data/_meta/
 * versions.json` on the origin than the one this build shipped with?
 *
 * The comparison itself (`diffVersions`) is pure and tested without a
 * network; this component is the thin, un-tested-by-design shell around the
 * one `fetch` call `src/lib/dataUpdates.ts` makes (ADR-028).
 */
export function CheckForUpdates() {
  const { t, language } = useT()
  const [state, setState] = useState<CheckState>({ status: 'idle' })

  const check = async () => {
    setState({ status: 'checking' })
    try {
      const remote = await fetchLatestVersions()
      setState({ status: 'done', result: diffVersions(remote) })
    } catch {
      setState({ status: 'error' })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void check()}
          disabled={state.status === 'checking'}
        >
          {state.status === 'checking'
            ? t('pages.settings.updates.checking')
            : t('pages.settings.updates.check')}
        </Button>
      </div>

      {state.status === 'error' ? (
        <p className="text-sm text-destructive">{t('pages.settings.updates.error')}</p>
      ) : null}

      {state.status === 'done' && !hasUpdates(state.result) ? (
        <p className="text-sm text-tulsi-foreground">{t('pages.settings.updates.upToDate')}</p>
      ) : null}

      {state.status === 'done' && hasUpdates(state.result) ? (
        <div className="flex flex-col gap-3 rounded-lg border border-marigold/40 bg-marigold/10 p-3">
          <p className="text-sm font-medium text-marigold-foreground">{t('pages.settings.updates.found')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {state.result.changed.map((change) => (
              <li key={change.id}>
                {change.label[language] ?? change.label.en} — {change.localVersion ?? '—'} →{' '}
                {change.remoteVersion}
              </li>
            ))}
            {state.result.added.map((id) => (
              <li key={id}>{t('pages.settings.updates.added', { id })}</li>
            ))}
            {state.result.removed.map((id) => (
              <li key={id}>{t('pages.settings.updates.removed', { id })}</li>
            ))}
          </ul>
          <div>
            <Button type="button" size="sm" onClick={() => window.location.reload()}>
              {t('pages.settings.updates.reload')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
