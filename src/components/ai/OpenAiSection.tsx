import { useCallback, useEffect, useState } from 'react'

import {
  capabilityNote,
  isLocalBaseUrl,
  isUsableBaseUrl,
  type OpenAiCapability,
} from '@/ai/providers/openaiCompatible'
import { clearSecret, hasStoredKey, OPENAI_KEY_ID, storeSecret } from '@/ai/secrets'
import { useAppStore } from '@/app/store'
import { Badge } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * Settings → AI features → "Another AI service".
 *
 * Three things it does that the Tier 1 key box does not, and each is about the
 * fact that the endpoint is the READER'S rather than one this app knows:
 *
 * 1. **The key is optional.** A local Ollama needs none, and refusing to run
 *    without one would rule out the single option on this tier that sends
 *    nothing over a network at all.
 * 2. **The capability switches are the reader's assertion, not a probe.** There
 *    is no reliable probe — an endpoint that ignores an unknown `tools` field
 *    and one that honours it answer the same 200 — so the app asks, and then
 *    SAYS what the run will actually do rather than silently downgrading.
 * 3. **A non-encrypted, non-local address is called out.** `http://` is allowed
 *    because `http://localhost:11434/v1` is the honest default for Ollama; an
 *    `http://` address that is not on this machine gets a warning, because
 *    everything the agent sends travels in the clear.
 *
 * It makes NO request. "Test connection" lives in the parent section beside the
 * Tier 1 one, so there is one place on this screen that can reach the network
 * and it is a button.
 */
export function OpenAiSection() {
  const { t } = useT()
  const settings = useAppStore((state) => state.ai)
  const setAi = useAppStore((state) => state.setAi)

  const [keyInput, setKeyInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * The settings row is a MIRROR of the vault, not the truth. Reconciled on
   * mount the way `LocalModelSection` reconciles `localModelInstalled` against
   * the Cache API: a reader who cleared site data in another tab has a row
   * saying a key exists and a vault that does not.
   */
  useEffect(() => {
    let cancelled = false
    void hasStoredKey(OPENAI_KEY_ID).then((present) => {
      if (!cancelled && present !== settings.hasOpenAiKey) void setAi({ hasOpenAiKey: present })
    })
    return () => {
      cancelled = true
    }
  }, [settings.hasOpenAiKey, setAi])

  const saveKey = useCallback(async () => {
    const value = keyInput.trim()
    if (!value) return
    try {
      await storeSecret(OPENAI_KEY_ID, value)
      await setAi({ hasOpenAiKey: true })
      setKeyInput('')
      setNotice(t('ai.openai.keySaved'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [keyInput, setAi, t])

  const removeKey = useCallback(async () => {
    await clearSecret(OPENAI_KEY_ID)
    await setAi({ hasOpenAiKey: false })
    setNotice(null)
  }, [setAi])

  const url = settings.openAiBaseUrl.trim()
  const urlUsable = url === '' || isUsableBaseUrl(url)
  const insecure = urlUsable && url.startsWith('http://') && !isLocalBaseUrl(url)
  const supports: OpenAiCapability[] = [
    ...(settings.openAiSupportsTools ? (['tools'] as const) : []),
    ...(settings.openAiSupportsJson ? (['json'] as const) : []),
  ]
  const note = capabilityNote(supports)

  return (
    <section aria-labelledby="ai-openai-heading" className="flex flex-col gap-3">
      <h3 id="ai-openai-heading" className="text-sm font-semibold">
        {t('ai.openai.heading')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('ai.openai.intro')}</p>
      <p className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t('ai.openai.free')}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="ai-openai-url" className="text-sm font-semibold">
          {t('ai.openai.baseUrl')}
        </label>
        <p className="text-xs text-muted-foreground">{t('ai.openai.baseUrlHint')}</p>
        <input
          id="ai-openai-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={settings.openAiBaseUrl}
          onChange={(event) => void setAi({ openAiBaseUrl: event.target.value })}
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        {url !== '' && !urlUsable ? (
          <p role="alert" className="text-xs text-destructive">
            {t('ai.openai.baseUrlInvalid')}
          </p>
        ) : null}
        {insecure ? (
          <p role="alert" className="text-xs text-destructive">
            {t('ai.openai.insecure')}
          </p>
        ) : null}
        {urlUsable && url !== '' && isLocalBaseUrl(url) ? (
          <p className="text-xs text-tulsi-foreground">{t('ai.openai.localOnly')}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ai-openai-model" className="text-sm font-semibold">
          {t('ai.openai.model')}
        </label>
        <p className="text-xs text-muted-foreground">{t('ai.openai.modelHint')}</p>
        <input
          id="ai-openai-model"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={settings.openAiModel}
          onChange={(event) => void setAi({ openAiModel: event.target.value })}
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ai-openai-key" className="text-sm font-semibold">
          {t('ai.openai.key')}
        </label>
        <p className="text-xs text-muted-foreground">{t('ai.openai.keyHint')}</p>
        <input
          id="ai-openai-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={() => void saveKey()} disabled={keyInput.trim().length === 0}>
            {t('ai.openai.saveKey')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!settings.hasOpenAiKey}
            onClick={() => void removeKey()}
          >
            {t('ai.openai.removeKey')}
          </Button>
          {settings.hasOpenAiKey ? <Badge tone="success">{t('ai.openai.keySaved')}</Badge> : null}
        </div>
        <p role="status" className="text-xs text-muted-foreground">
          {notice ?? ''}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">{t('ai.openai.capabilities')}</legend>
        <div className="flex min-h-11 items-start gap-3 text-sm">
          <input
            id="openai-supports-tools"
            type="checkbox"
            className="mt-1 size-4"
            checked={settings.openAiSupportsTools}
            onChange={(event) => void setAi({ openAiSupportsTools: event.target.checked })}
          />
          <span className="flex flex-col gap-0.5">
            <label htmlFor="openai-supports-tools" className="font-medium">
              {t('ai.openai.supportsTools')}
            </label>
            <span className="text-xs text-muted-foreground">{t('ai.openai.supportsToolsHint')}</span>
          </span>
        </div>
        <div className="flex min-h-11 items-start gap-3 text-sm">
          <input
            id="openai-supports-json"
            type="checkbox"
            className="mt-1 size-4"
            checked={settings.openAiSupportsJson}
            onChange={(event) => void setAi({ openAiSupportsJson: event.target.checked })}
          />
          <span className="flex flex-col gap-0.5">
            <label htmlFor="openai-supports-json" className="font-medium">
              {t('ai.openai.supportsJson')}
            </label>
            <span className="text-xs text-muted-foreground">{t('ai.openai.supportsJsonHint')}</span>
          </span>
        </div>
      </fieldset>

      {/* What the run will ACTUALLY do, said out loud. The downgrade from tool
          calling to JSON mode is a real difference in how an answer is
          gathered, and a reader whose endpoint cannot call tools deserves to
          know that rather than to wonder why answers differ. */}
      <p className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t(`ai.openai.note.${note.i18nKey}`)}
      </p>
    </section>
  )
}

export default OpenAiSection
