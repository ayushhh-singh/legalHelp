import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

import { TIER_DISCLOSURES, acceptConsentPatch, tierAvailable, tierPickable } from '@/ai/consent'
import { hasConsent, isAiEnabled, proxyUrlFromEnv, tierReady } from '@/ai/flags'
import { AI_MODELS, findModel } from '@/ai/models'
import { ANTHROPIC_KEY_ID, clearSecret, hasStoredKey, storeSecret } from '@/ai/secrets'
import { AI_TIERS, type AiTier } from '@/ai/types'
import { budgetState, type BudgetState } from '@/ai/usage'
import { useAppStore } from '@/app/store'
import { AiBanner } from '@/components/ai/AiBanner'
import { AiConsentModal } from '@/components/ai/AiConsentModal'
import { AiKillSwitch } from '@/components/ai/AiKillSwitch'
import { Badge, OptionRow, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * Settings → "AI features (off)".
 *
 * Every control here is disabled until the consent notice has been accepted.
 * That is not a nicety: `isAiEnabled()` reads the same `consentVersion`, so an
 * un-consented device cannot be talked into a request by any sequence of
 * clicks — the UI and the feature flag agree because they read one field.
 *
 * The only thing on this screen that makes a network request is "Test
 * connection", and only on a click. Nothing here fires on mount.
 */

/**
 * Tier 0's own section, and the ~6 MB `@mlc-ai/web-llm` chunk it can reach.
 *
 * Lazy for the same reason every other AI import in this app is lazy, one
 * level deeper: a reader who opens Settings on Tier 1 must not download the
 * on-device machinery, and a reader on Tier 0 downloads the SECTION here while
 * the library itself waits for the Download button inside it.
 */
const LocalModelSection = lazy(() => import('@/components/ai/LocalModelSection'))

const TIER_LABEL = {
  off: 'ai.tier.off',
  local: 'ai.tier.local',
  byok: 'ai.tier.byok',
  proxy: 'ai.tier.proxy',
} as const

const TIER_HINT = {
  off: 'ai.tierHint.off',
  local: 'ai.tierHint.local',
  byok: 'ai.tierHint.byok',
  proxy: 'ai.tierHint.proxy',
} as const

type TestState =
  { status: 'idle' } | { status: 'running' } | { status: 'ok' } | { status: 'failed'; reason: string }

export default function AiSettingsSection() {
  const { t } = useT()
  const settings = useAppStore((state) => state.ai)
  const setAi = useAppStore((state) => state.setAi)

  const [consentOpen, setConsentOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyNotice, setKeyNotice] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [budget, setBudget] = useState<BudgetState | null>(null)
  const [purged, setPurged] = useState(false)

  const proxyUrl = proxyUrlFromEnv()
  const consented = hasConsent(settings)
  const enabled = isAiEnabled(settings)
  const ready = tierReady(settings, proxyUrl)

  /**
   * Reconciles `hasKey` with what is actually in the vault. The two can drift
   * if storage was cleared behind the app's back, and a settings screen that
   * claims a key exists when none does is worse than one that says nothing.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [stored, state] = await Promise.all([hasStoredKey(), budgetState(settings.monthlyTokenBudget)])
      if (cancelled) return
      setBudget(state)
      if (stored !== settings.hasKey) await setAi({ hasKey: stored })
    })()
    return () => {
      cancelled = true
    }
  }, [settings.hasKey, settings.monthlyTokenBudget, setAi])

  const saveKey = useCallback(async () => {
    const value = keyInput.trim()
    setKeyNotice(null)
    setKeyError(null)
    if (!value.startsWith('sk-ant-')) {
      setKeyError(t('ai.key.invalid'))
      return
    }
    try {
      await storeSecret(ANTHROPIC_KEY_ID, value)
    } catch (error) {
      // WebCrypto is absent on an insecure origin and IndexedDB can be blocked
      // outright. Without this the failure was a silent no-op plus an unhandled
      // rejection, and the reader would think the key had been saved.
      setKeyError(error instanceof Error ? error.message : t('ai.key.invalid'))
      return
    }
    await setAi({ hasKey: true })
    setKeyInput('')
    setTest({ status: 'idle' })
    setKeyNotice(t('ai.key.saved'))
  }, [keyInput, setAi, t])

  const removeKey = useCallback(async () => {
    setKeyError(null)
    try {
      await clearSecret(ANTHROPIC_KEY_ID)
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : t('ai.key.invalid'))
      return
    }
    await setAi({ hasKey: false })
    setTest({ status: 'idle' })
    setKeyNotice(t('ai.key.cleared'))
  }, [setAi, t])

  /**
   * ONE request, on this click and nowhere else. The provider is imported here
   * rather than at module scope so that opening Settings does not even load the
   * code that can reach the network.
   */
  const runTest = useCallback(async () => {
    setTest({ status: 'running' })
    try {
      const { AnthropicDirectProvider } = await import('@/ai/providers/anthropic-direct')
      await new AnthropicDirectProvider({ model: settings.model }).testConnection()
      setTest({ status: 'ok' })
    } catch (error) {
      setTest({ status: 'failed', reason: error instanceof Error ? error.message : 'unknown' })
    }
  }, [settings.model])

  const status = !consented || !enabled ? 'off' : ready ? 'on' : 'notReady'

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ai-settings-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="ai-settings-heading" className="text-lg font-semibold">
          {t('ai.sectionTitle')}
        </h2>
        <Badge tone={status === 'on' ? 'success' : status === 'notReady' ? 'warning' : 'neutral'}>
          {status === 'on'
            ? t('ai.statusOn')
            : status === 'notReady'
              ? t('ai.statusNotReady')
              : t('ai.statusOff')}
        </Badge>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{t('ai.sectionSubtitle')}</p>

      {/* Which banner text applies is a property of the tier, declared once in
          consent.ts, not a string comparison repeated per surface. */}
      {enabled && settings.tier !== 'off' ? (
        <AiBanner localOnly={TIER_DISCLOSURES[settings.tier].localOnly} />
      ) : null}

      {consented ? null : (
        <div className="flex flex-col items-start gap-2">
          <p className="max-w-prose text-sm text-muted-foreground">{t('ai.consentRequired')}</p>
          <Button type="button" onClick={() => setConsentOpen(true)}>
            {t('ai.openConsent')}
          </Button>
        </div>
      )}

      <fieldset disabled={!consented} className="flex flex-col gap-6 disabled:opacity-60">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('ai.tier.label')}</h3>
          <div role="radiogroup" aria-label={t('ai.tier.label')} className="flex flex-col gap-2">
            {AI_TIERS.filter((tier: AiTier) => tierPickable(tier, proxyUrl)).map((tier: AiTier) => {
              const selectable = tier === 'off' || tierAvailable(tier, proxyUrl)
              return (
                <OptionRow
                  key={tier}
                  selected={settings.tier === tier}
                  disabled={!consented || !selectable}
                  label={t(TIER_LABEL[tier])}
                  hint={t(TIER_HINT[tier])}
                  onSelect={() => {
                    setTest({ status: 'idle' })
                    void setAi({ tier })
                  }}
                />
              )
            })}
          </div>
        </div>

        {settings.tier === 'local' ? (
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <LocalModelSection />
          </Suspense>
        ) : null}

        {settings.tier === 'byok' ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="ai-key" className="text-sm font-semibold">
              {t('ai.key.label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('ai.key.hint')}</p>
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              placeholder={t('ai.key.placeholder')}
              onChange={(event) => setKeyInput(event.target.value)}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasKey ? t('ai.key.present') : t('ai.key.absent')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void saveKey()} disabled={keyInput.trim().length === 0}>
                {t('ai.key.save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!settings.hasKey || test.status === 'running'}
                onClick={() => void runTest()}
              >
                {test.status === 'running' ? t('ai.test.running') : t('ai.test.button')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!settings.hasKey}
                onClick={() => void removeKey()}
              >
                {t('ai.key.clear')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('ai.test.note')}</p>
            <p role="status" className="text-sm">
              {keyError ? <span className="text-destructive">{keyError}</span> : null}
              {keyNotice ? <span className="text-muted-foreground">{keyNotice}</span> : null}
              {test.status === 'ok' ? <span className="text-tulsi-foreground">{t('ai.test.ok')}</span> : null}
              {test.status === 'failed' ? (
                <span className="text-destructive">{t('ai.test.failed', { reason: test.reason })}</span>
              ) : null}
            </p>
          </div>
        ) : null}

        {/* The API model picker names Anthropic models, none of which Tier 0
            runs — the on-device model is chosen in the section above. Showing
            both at once was two pickers for one word.

            Not rendered rather than hidden with a class: `display: none` leaves
            a labelled <select> in the DOM, which is a control that exists for
            anything reading the document and does not exist for the reader.
            The same rule the drafting panel's brief box follows (ADR-032 §5). */}
        {settings.tier === 'local' ? null : (
          <div className="flex flex-col gap-2">
            <label htmlFor="ai-model" className="text-sm font-semibold">
              {t('ai.model.label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('ai.model.hint')}</p>
            <select
              id="ai-model"
              value={settings.model}
              onChange={(event) => {
                // A result proved the key against the old model, not this one.
                setTest({ status: 'idle' })
                void setAi({ model: event.target.value })
              }}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {AI_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
              {/* A row written by a newer build names a model this one does not
                  know. Showing it keeps the control honest — silently rendering
                  the first option would tell the reader they had chosen
                  something they had not. */}
              {findModel(settings.model) ? null : <option value={settings.model}>{settings.model}</option>}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="ai-budget" className="text-sm font-semibold">
            {t('ai.budget.label')}
          </label>
          <p className="text-xs text-muted-foreground">{t('ai.budget.hint')}</p>
          {/* Uncontrolled, and only committed when it parses. A controlled
              number input cannot be cleared to retype — `Number('')` is 0, and
              a budget of 0 blocks every run — so an empty or half-typed field
              must leave the stored value alone. */}
          <input
            id="ai-budget"
            type="number"
            min={0}
            step={10_000}
            inputMode="numeric"
            defaultValue={settings.monthlyTokenBudget}
            onChange={(event) => {
              const raw = event.target.value.trim()
              if (raw === '') return
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              void setAi({ monthlyTokenBudget: Math.floor(parsed) })
            }}
            className="h-11 w-48 rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {budget ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('ai.budget.used', {
                used: budget.used.toLocaleString(),
                limit: budget.limit.toLocaleString(),
              })}
              {budget.exhausted ? ` · ${t('ai.budget.exhausted')}` : ''}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('ai.cache.label')}</h3>
          <p className="text-xs text-muted-foreground">{t('ai.cache.hint')}</p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.answerCache}
              onChange={(event) => void setAi({ answerCache: event.target.checked })}
              className="h-5 w-5 rounded-sm border-input accent-action"
            />
            {t('ai.cache.label')}
          </label>
        </div>
      </fieldset>

      {consented || settings.hasKey ? <AiKillSwitch onPurged={() => setPurged(true)} /> : null}

      {/* Owned here, not by the kill switch: turning AI off unmounts the kill
          switch, so a confirmation it rendered itself would vanish in the same
          tick it appeared. */}
      {purged ? (
        <p role="status" className="text-sm text-tulsi-foreground">
          {t('ai.kill.done')}
        </p>
      ) : null}

      <AiConsentModal
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onAccept={() => {
          setConsentOpen(false)
          void setAi(acceptConsentPatch())
        }}
      />
    </section>
  )
}
