import { useCallback, useEffect, useRef } from 'react'

import { AiBanner } from '@/components/ai/AiBanner'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

interface AiConsentModalProps {
  open: boolean
  onAccept: () => void
  onCancel: () => void
}

/**
 * Written out rather than derived from TIER_DISCLOSURES so every key is a
 * literal: i18next types `t()` against en.json, and a key built by template
 * string would have to be cast, which is exactly the check that catches a
 * renamed string.
 */
const TIER_COPY = [
  {
    name: 'ai.consent.tiers.local.name',
    leaves: 'ai.consent.tiers.local.leaves',
    cost: 'ai.consent.tiers.local.cost',
  },
  {
    name: 'ai.consent.tiers.byok.name',
    leaves: 'ai.consent.tiers.byok.leaves',
    cost: 'ai.consent.tiers.byok.cost',
  },
  {
    name: 'ai.consent.tiers.proxy.name',
    leaves: 'ai.consent.tiers.proxy.leaves',
    cost: 'ai.consent.tiers.proxy.cost',
  },
] as const

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The opt-in notice. It is the only way `consentVersion` is ever written, and
 * `isAiEnabled()` will not return true without it — so this is a gate, not a
 * courtesy.
 *
 * It states, per tier, what leaves the device; it states what a BYOK key costs
 * and who bills it; and it repeats the classified-content rule at the top,
 * where it will actually be read, rather than at the bottom where notices go
 * to be skipped.
 *
 * Built from a plain element rather than <dialog>: `showModal()` is not
 * implemented in jsdom, and a consent gate that cannot be tested is not a gate.
 */
export function AiConsentModal({ open, onAccept, onCancel }: AiConsentModalProps) {
  const { t } = useT()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = 'ai-consent-title'

  const focusables = useCallback(
    () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])],
    [],
  )

  useEffect(() => {
    if (!open) return
    // Focus the panel itself rather than the first control, so a screen reader
    // reads the title and the warning before it reads a button label.
    panel.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onCancel, focusables])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4">
      {/* The backdrop is a sibling button so the panel itself stays a plain
          region — a click target wrapped around a dialog swallows its keys.
          It is named "Close", not "Not now": two controls with the same
          accessible name are indistinguishable to a screen-reader user. */}
      <button
        type="button"
        aria-label={t('nav.close')}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-lg border border-border bg-card p-5 shadow-lg focus-visible:outline-none sm:rounded-lg sm:p-6"
      >
        <h2 id={titleId} className="font-heading text-lg font-semibold">
          {t('ai.consent.title')}
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">{t('ai.consent.intro')}</p>

        <AiBanner className="mt-4" />

        <section className="mt-5">
          <h3 className="text-sm font-semibold">{t('ai.consent.tiersHeading')}</h3>
          <dl className="mt-2 space-y-3">
            {TIER_COPY.map((copy) => (
              <div key={copy.name} className="rounded-lg border border-border p-3">
                <dt className="text-sm font-semibold">{t(copy.name)}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{t(copy.leaves)}</dd>
                <dd className="mt-1 text-sm text-muted-foreground">{t(copy.cost)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-5 space-y-1">
          <h3 className="text-sm font-semibold">{t('ai.consent.classifiedHeading')}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">{t('ai.consent.classified')}</p>
        </section>

        <section className="mt-4 space-y-1">
          <h3 className="text-sm font-semibold">{t('ai.consent.storageHeading')}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">{t('ai.consent.storage')}</p>
        </section>

        <section className="mt-4 space-y-1">
          <h3 className="text-sm font-semibold">{t('ai.consent.costHeading')}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">{t('ai.consent.cost')}</p>
        </section>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" onClick={onAccept}>
            {t('ai.consent.accept')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('ai.consent.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
