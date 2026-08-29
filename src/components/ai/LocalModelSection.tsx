import { useCallback, useEffect, useRef, useState } from 'react'

import { LOCAL_MODELS, type HindiQuality, type LocalModel } from '@/ai/local/catalogue'
import {
  deleteLocalModel,
  ensureLocalEngine,
  isLocalModelCached,
  loadedLocalModelId,
  unloadLocalEngine,
} from '@/ai/local/engine'
import {
  fitFor,
  isRunnable,
  probeWebGpu,
  UNSUPPORTED,
  type ModelFit,
  type WebGpuReport,
} from '@/ai/local/webgpu'
import { useAppStore } from '@/app/store'
import { Badge, OptionRow, ProgressBar } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * Settings → AI → "On this device", shown only when the reader has chosen
 * Tier 0.
 *
 * Nothing on this screen downloads anything until a button is pressed. What
 * runs on mount is the WebGPU probe — which allocates no device and fetches
 * nothing — and a Cache API read per model to tell the reader which ones are
 * already on the machine.
 *
 * The web-llm library itself is behind the dynamic imports inside
 * `src/ai/local/engine.ts`, so opening this section costs about a kilobyte;
 * pressing Download is what costs six megabytes of JavaScript and a gigabyte
 * of weights, in that order, and the reader is told both numbers first.
 */

/**
 * Literal maps, not template keys.
 *
 * i18next types `t()` against en.json, so `t(\`ai.local.hindi.${quality}\`)` is
 * a `string` rather than a known key and has to be cast — which is precisely
 * the check that catches a renamed string. Written out, a key that stops
 * existing is a compile error. Same reason `AiConsentModal`'s TIER_COPY is a
 * literal list.
 */
const FIT_HINT = {
  ok: null,
  tight: 'ai.local.fit.tight',
  'too-large': 'ai.local.fit.tooLarge',
  'needs-shader-f16': 'ai.local.fit.needsF16',
  'no-webgpu': 'ai.local.fit.noWebgpu',
} as const satisfies Record<ModelFit, string | null>

const HINDI_NOTE = {
  poor: 'ai.local.hindi.poor',
  limited: 'ai.local.hindi.limited',
  usable: 'ai.local.hindi.usable',
} as const satisfies Record<HindiQuality, string>

type Install =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; modelId: string; progress: number; text: string }
  | { state: 'failed'; message: string }

/** Bytes are the reader's unit, not megabytes; 879 MB reads as 0.9 GB. */
function sizeLabel(model: LocalModel): string {
  return `${(model.vramMB / 1024).toFixed(1)} GB`
}

export default function LocalModelSection() {
  const { t } = useT()
  const settings = useAppStore((state) => state.ai)
  const setAi = useAppStore((state) => state.setAi)

  const [report, setReport] = useState<WebGpuReport | null>(null)
  const [cached, setCached] = useState<ReadonlySet<string>>(new Set())
  const [install, setInstall] = useState<Install>({ state: 'idle' })
  const [loaded, setLoaded] = useState<string | null>(loadedLocalModelId())
  const abort = useRef<AbortController | null>(null)

  /**
   * Reconciles the stored `localModelInstalled` against the Cache API, exactly
   * as the key section reconciles `hasKey` against the vault. The two drift
   * whenever storage is cleared behind the app's back, and a settings screen
   * claiming a model is installed when it is not sends the reader to an "Ask"
   * button that will refuse them.
   */
  const refresh = useCallback(async () => {
    const entries = await Promise.all(
      LOCAL_MODELS.map(async (model) => [model.id, await isLocalModelCached(model.id)] as const),
    )
    const present = new Set(entries.filter(([, yes]) => yes).map(([id]) => id))
    setCached(present)
    setLoaded(loadedLocalModelId())
    const installed = present.has(settings.localModel)
    if (installed !== settings.localModelInstalled) await setAi({ localModelInstalled: installed })
  }, [settings.localModel, settings.localModelInstalled, setAi])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const probed = await probeWebGpu()
      if (!cancelled) setReport(probed)
      await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Cancels an in-flight download if the reader navigates away mid-transfer.
  // What has already arrived stays in the Cache API and the next attempt
  // resumes from there — see `ensureLocalEngine`'s note on cancellation.
  useEffect(() => () => abort.current?.abort(), [])

  const download = useCallback(
    async (modelId: string) => {
      const controller = new AbortController()
      abort.current = controller
      setInstall({ state: 'downloading', modelId, progress: 0, text: '' })
      try {
        await ensureLocalEngine(modelId, {
          signal: controller.signal,
          onProgress: ({ progress, text }) => setInstall({ state: 'downloading', modelId, progress, text }),
        })
        setInstall({ state: 'idle' })
      } catch (error) {
        setInstall({
          state: 'failed',
          message: error instanceof Error ? error.message : t('ai.local.failed'),
        })
      } finally {
        abort.current = null
        await refresh()
      }
    },
    [refresh, t],
  )

  const unload = useCallback(async () => {
    await unloadLocalEngine()
    await refresh()
  }, [refresh])

  const remove = useCallback(
    async (modelId: string) => {
      setInstall({ state: 'checking' })
      try {
        await deleteLocalModel(modelId)
        setInstall({ state: 'idle' })
      } catch (error) {
        setInstall({
          state: 'failed',
          message: error instanceof Error ? error.message : t('ai.local.failed'),
        })
      }
      await refresh()
    },
    [refresh, t],
  )

  const gpu = report ?? UNSUPPORTED
  const selected = settings.localModel
  const selectedCached = cached.has(selected)
  const downloading = install.state === 'downloading'

  return (
    <div className="flex flex-col gap-4" aria-labelledby="ai-local-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="ai-local-heading" className="text-sm font-semibold">
          {t('ai.local.title')}
        </h3>
        {report === null ? null : (
          <Badge tone={gpu.supported ? 'success' : 'warning'}>
            {gpu.supported ? t('ai.local.webgpu.yes') : t('ai.local.webgpu.no')}
          </Badge>
        )}
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">{t('ai.local.intro')}</p>

      {report !== null && !gpu.supported ? (
        <p className="max-w-prose text-sm text-destructive">
          {gpu.reason === 'no-adapter' ? t('ai.local.webgpu.noAdapter') : t('ai.local.webgpu.absent')}
        </p>
      ) : null}

      <div role="radiogroup" aria-label={t('ai.local.title')} className="flex flex-col gap-2">
        {LOCAL_MODELS.map((model) => {
          const fit = fitFor(model, gpu)
          const hintKey = FIT_HINT[fit]
          return (
            <OptionRow
              key={model.id}
              selected={selected === model.id}
              // A model the device cannot run stays visible with its reason.
              // Hiding it would leave a reader on an older graphics card with a
              // shorter list and no idea why.
              disabled={downloading || !isRunnable(fit)}
              label={`${model.label} · ${sizeLabel(model)}`}
              hint={[
                t(HINDI_NOTE[model.hindi]),
                cached.has(model.id) ? t('ai.local.installed') : t('ai.local.notInstalled'),
                hintKey ? t(hintKey) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              onSelect={() => {
                setInstall({ state: 'idle' })
                void setAi({ localModel: model.id, localModelInstalled: cached.has(model.id) })
              }}
            />
          )
        })}
      </div>

      <p className="max-w-prose text-xs text-muted-foreground">{t('ai.local.sizeNote')}</p>

      {downloading ? (
        <div className="flex flex-col gap-2">
          <ProgressBar
            value={install.progress * 100}
            label={t('ai.local.downloading', { model: selected })}
          />
          {/* The percentage is announced, not just drawn: a progress bar with
              no live region tells a screen-reader user nothing is happening. */}
          <p role="status" className="text-xs text-muted-foreground tabular-nums">
            {t('ai.local.progress', { percent: Math.round(install.progress * 100) })}
            {install.text ? ` — ${install.text}` : ''}
          </p>
          <div>
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              {t('ai.local.cancel')}
            </Button>
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">{t('ai.local.cancelNote')}</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={
              !isRunnable(fitFor(LOCAL_MODELS.find((m) => m.id === selected) ?? LOCAL_MODELS[0]!, gpu))
            }
            onClick={() => void download(selected)}
          >
            {selectedCached ? t('ai.local.reload') : t('ai.local.download')}
          </Button>
          <Button type="button" variant="outline" disabled={loaded === null} onClick={() => void unload()}>
            {t('ai.local.unload')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedCached}
            onClick={() => void remove(selected)}
          >
            {t('ai.local.delete')}
          </Button>
        </div>
      )}

      <p role="status" className="text-sm">
        {install.state === 'failed' ? (
          <span className="text-destructive">{install.message}</span>
        ) : loaded ? (
          <span className="text-muted-foreground">{t('ai.local.loaded', { model: loaded })}</span>
        ) : null}
      </p>
    </div>
  )
}
