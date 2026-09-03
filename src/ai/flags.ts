import { DEFAULT_LOCAL_MODEL, findLocalModel } from './local/catalogue'
import { DEFAULT_MODEL } from './models'
import { isAiTier, type AiTier } from './types'

/**
 * The AI layer's feature flags, and the ONLY part of it that the initial route
 * is allowed to load. Everything else — providers, the agent loop, WebCrypto,
 * the tool registry — sits behind a dynamic import, so a reader who never turns
 * AI on never downloads it.
 *
 * This module therefore has almost no runtime imports: a default model id, a
 * type guard, and — since Tier 0 shipped — `src/ai/local/catalogue.ts`, which
 * is five object literals and two `Array.find` wrappers with no URL and no
 * further import of its own. It is here because `parseAiSettings` has to be
 * able to reject a `localModel` this build does not offer, and a parser that
 * cannot check a value is not a parser. Nothing else may be added: no zod, no
 * WebCrypto, no provider, no dataset. `tests/bundle-budget.test.ts` is what
 * holds the line.
 */

/**
 * Bumping this invalidates every stored consent: readers must read the notice
 * again before anything can leave the device. Bump it whenever the "what leaves
 * the device" text changes in substance, not for a typo.
 *
 * 1 → 2 (Tier 0). Tier 0 was described in version 1's notice as an option that
 * did not exist yet; it now does, and choosing it downloads roughly a gigabyte
 * of model weights from a public host. Nothing the reader TYPES leaves the
 * device, which is what the tier promises and what it still delivers — but a
 * device that makes no request at all and a device that fetches a gigabyte
 * once are not the same device, and a reader who consented on the strength of
 * the first sentence is owed the second one. That is a change of substance,
 * so every device reads the notice again.
 *
 * 2 → 3 (Tier 3, the OpenAI-compatible endpoint). Versions 1 and 2 could name
 * every recipient: nobody, Anthropic, or the operator and Anthropic. Version 3
 * cannot. The reader chooses the host, so the honest sentence is "whatever
 * service you configure, at the URL you gave" — which is a genuinely different
 * disclosure and not a rewording of the old one. It also has to say the thing
 * the other tiers did not need to: a free tier is usually free BECAUSE the
 * provider may use the traffic, and this app cannot audit anybody's terms on
 * the reader's behalf.
 */
export const CONSENT_VERSION = 3

/** Tokens per calendar month, across input and output. Zero means "no calls". */
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 200_000

export interface AiSettings {
  tier: AiTier
  /** The CONSENT_VERSION the reader accepted; 0 when they never have. */
  consentVersion: number
  /** ISO-8601, or null when consent was never given. */
  consentAt: string | null
  model: string
  monthlyTokenBudget: number
  /**
   * Mirrors "a key exists in the secrets table". The key itself never enters
   * the settings row, the zustand store or any React prop.
   */
  hasKey: boolean
  /** Serve repeat non-personal questions from the local answer cache. */
  answerCache: boolean
  /** Tier 0: which model from `src/ai/local/catalogue.ts` the reader chose. */
  localModel: string
  /**
   * Tier 3: the endpoint's base URL, without `/chat/completions`.
   *
   * Empty until the reader configures one, and `tierReady` refuses the tier
   * until it is set — the same shape `hasKey` gives Tier 1 and
   * `localModelInstalled` gives Tier 0.
   */
  openAiBaseUrl: string
  /** Tier 3: the model name, exactly as that endpoint spells it. */
  openAiModel: string
  /**
   * Tier 3: what the reader says the endpoint supports.
   *
   * Stored rather than probed, because there is no reliable probe: an endpoint
   * that ignores an unknown `tools` field and one that honours it answer the
   * same 200. What this buys is honesty — `capabilityNote()` tells the reader
   * what their run will actually do, and the agent downgrades visibly instead
   * of dropping the tools and letting the model invent a call.
   */
  openAiSupportsTools: boolean
  openAiSupportsJson: boolean
  /** Mirrors "a Tier 3 key exists in the secrets table". Never the key itself. */
  hasOpenAiKey: boolean
  /**
   * Mirrors "the weights are in this browser's Cache API".
   *
   * Like `hasKey`, it is a mirror and not the truth: the truth is what
   * `hasModelInCache()` answers, and `LocalModelSection` reconciles the two
   * whenever it renders. It is stored at all because `tierReady()` is
   * synchronous — a surface has to decide whether to render itself without
   * awaiting a Cache API round trip.
   */
  localModelInstalled: boolean
}

/**
 * Off, with no consent and no key. A fresh install, a cleared browser and a
 * settings row this version cannot parse all land here.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  tier: 'off',
  consentVersion: 0,
  consentAt: null,
  model: DEFAULT_MODEL,
  monthlyTokenBudget: DEFAULT_MONTHLY_TOKEN_BUDGET,
  hasKey: false,
  answerCache: true,
  localModel: DEFAULT_LOCAL_MODEL,
  localModelInstalled: false,
  openAiBaseUrl: '',
  openAiModel: '',
  openAiSupportsTools: false,
  openAiSupportsJson: false,
  hasOpenAiKey: false,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Anything unrecognised is discarded rather than trusted — same posture as the
 * theme and language rows in src/app/store.ts. A hand-edited row cannot turn AI
 * on, because `tier` must parse AND `consentVersion` must equal the current
 * CONSENT_VERSION before `isAiEnabled` returns true.
 */
export function parseAiSettings(value: unknown): AiSettings {
  if (!isRecord(value)) return DEFAULT_AI_SETTINGS

  const tier = isAiTier(value.tier) ? value.tier : DEFAULT_AI_SETTINGS.tier
  const consentVersion =
    typeof value.consentVersion === 'number' && Number.isInteger(value.consentVersion)
      ? value.consentVersion
      : 0
  const budget =
    typeof value.monthlyTokenBudget === 'number' && Number.isFinite(value.monthlyTokenBudget)
      ? Math.max(0, Math.floor(value.monthlyTokenBudget))
      : DEFAULT_AI_SETTINGS.monthlyTokenBudget

  return {
    tier,
    consentVersion,
    consentAt: typeof value.consentAt === 'string' ? value.consentAt : null,
    model: typeof value.model === 'string' && value.model ? value.model : DEFAULT_AI_SETTINGS.model,
    monthlyTokenBudget: budget,
    hasKey: value.hasKey === true,
    answerCache: value.answerCache !== false,
    // An id this build does not offer falls back to the default rather than
    // through: `ensureLocalEngine` would refuse it anyway, and a settings
    // screen showing a model that cannot be selected is worse than one showing
    // the model that will actually run.
    localModel:
      typeof value.localModel === 'string' && findLocalModel(value.localModel)
        ? value.localModel
        : DEFAULT_AI_SETTINGS.localModel,
    localModelInstalled: value.localModelInstalled === true,
    openAiBaseUrl: typeof value.openAiBaseUrl === 'string' ? value.openAiBaseUrl : '',
    openAiModel: typeof value.openAiModel === 'string' ? value.openAiModel : '',
    openAiSupportsTools: value.openAiSupportsTools === true,
    openAiSupportsJson: value.openAiSupportsJson === true,
    hasOpenAiKey: value.hasOpenAiKey === true,
  }
}

/** True only when consent for THIS version is on record and a tier is chosen. */
export function isAiEnabled(settings: AiSettings): boolean {
  return settings.tier !== 'off' && settings.consentVersion === CONSENT_VERSION
}

/** The reader has read the current notice; the tier may still be `off`. */
export function hasConsent(settings: AiSettings): boolean {
  return settings.consentVersion === CONSENT_VERSION
}

/**
 * A tier is only usable once its prerequisite is met. `byok` needs a key;
 * `proxy` needs the build to have been given a proxy URL; `local` needs the
 * weights to be in this browser's Cache API already.
 */
export function tierReady(settings: AiSettings, proxyUrl: string | undefined): boolean {
  switch (settings.tier) {
    case 'off':
      return false
    case 'byok':
      return settings.hasKey
    case 'proxy':
      return Boolean(proxyUrl)
    case 'local':
      // The weights have to be on the device. Anything else would mean a
      // reader pressing "Ask" and triggering a gigabyte of download they never
      // asked for — the download is a deliberate act in Settings.
      return settings.localModelInstalled
    case 'openai':
      // A URL and a model name, both the reader's. NOT a key: a local Ollama
      // needs none, and requiring one would rule out the only option on this
      // tier that sends nothing over a network at all.
      return settings.openAiBaseUrl.trim().length > 0 && settings.openAiModel.trim().length > 0
  }
}

/** `VITE_AI_PROXY_URL`, read in one place so tests can reason about it. */
export function proxyUrlFromEnv(): string | undefined {
  const raw: unknown = import.meta.env.VITE_AI_PROXY_URL
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}
