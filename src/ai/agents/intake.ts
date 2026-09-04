import { z } from 'zod'

import { runAgent, type AgentRun, type UsageLedger } from '../agent'
import { buildContext, type BuiltContext, type Snippet } from '../context'
import { buildSystem } from '../prompts'
import type { AiProvider } from '../provider'
import { toJsonSchema, type RegisteredTool } from '../tools/registry'
import {
  EMPTY_USAGE,
  type AiErrorCode,
  type AiEventHandler,
  type AiOutputMeta,
  type AiTier,
  type Bilingual,
  type TokenUsage,
} from '../types'
import { estimateCost } from '../usage'
import { screenOutbound, type BriefRefusal } from './drafting'

import type { Language } from '@/i18n'
import { sanitiseField } from '@/lib/drafting/instructions'
import type { IntakeAnalysis, ResolvedProvision } from '@/lib/drafting/intake'
import type { RetrievedSnippet } from '@/lib/retrieval'

/**
 * The intake analysis agent — the second pass over a letter that arrived.
 *
 * ### It is the SECOND pass, and that is the whole design
 *
 * `src/lib/drafting/intake.ts` has already read the letter: its number, its
 * date, its subject, its urgency, its enclosure count, the provisions it cites
 * and the sentences that ask for something. That pass runs on every device with
 * AI off, which is every device's default, and the officer has already had the
 * chance to correct every chip it produced. Nothing this agent returns is
 * allowed to contradict it.
 *
 * What a model adds is the thing extraction genuinely cannot do: a summary in
 * both languages, a reading of what is being asked in sentences an officer can
 * act on, the risks in answering badly, and a suggestion of which of the
 * forty-three forms answers it. `docs/AI.md` §13's ordering — precomputed
 * first, retrieval always, a model last — is not a slogan here; it is why this
 * file is short.
 *
 * ### The one rule that fails a run closed
 *
 * **A cited provision must be backed by a snippet.** The model is given
 * numbered snippets, each one a provision the DETERMINISTIC pass found in the
 * letter and `src/lib/retrieval.ts` resolved against this app's own corpus, and
 * it may cite those and nothing else. A `citedProvisions` entry naming a
 * snippet id that was not given, or naming a provision text that no snippet
 * contains, ends the run — it is not dropped and reported, because a letter
 * analysis is read as a summary of the letter, and a provision the letter never
 * cited appearing in that summary is an officer answering the wrong point.
 *
 * That is stricter than `parseFieldValues` in the drafting agent, which drops
 * and reports. The difference is what the output IS: there, an unknown field is
 * a value nobody asked for and the rest of the draft is still usable; here, the
 * whole output is one claim about what the letter says.
 *
 * ### What leaves the device
 *
 * The letter. That is the point of the feature and it is why the confirmation
 * dialog states it in those words before the first run, and why
 * `screenOutbound` — the same screen the drafting agent uses, over everything a
 * run would send — refuses a letter naming classified or departmental material
 * BEFORE the provider is constructed. `intake.test.ts` counts
 * `MockProvider.calls` to prove it.
 */

const AGENT_ID = 'intake-analyse' as const

/* ------------------------------------------------------------------ *
 * The shape the model must answer in
 * ------------------------------------------------------------------ */

const bilingual = z.object({ en: z.string(), hi: z.string() })

/**
 * A provision the ANSWER cites, named by the snippet that carries it.
 *
 * `snippetId` and not a citation string: a citation the model composes is a
 * citation nobody checked, and this app's rule since ADR-035 is that a handle
 * is re-derived from the tool result rather than believed. The citation the
 * officer sees is the one the retrieval snippet carried.
 */
const citedProvisionSchema = z.object({
  snippetId: z.string(),
  /** Why the letter cites it, in one clause. Not what the provision says. */
  relevance: bilingual,
})

const analysisSchema = z.object({
  summary: bilingual,
  whatIsAsked: z.array(bilingual).max(8),
  /** ISO date, or empty. Never inferred from a period — see `periodIn`. */
  deadline: z.string().default(''),
  citedProvisions: z.array(citedProvisionSchema).max(10).default([]),
  /** One of the forty-three template ids, or empty when none fits. */
  suggestedType: z.string().default(''),
  risks: z.array(bilingual).max(5).default([]),
  nextSteps: z.array(bilingual).max(6).default([]),
})

export type IntakeAnalysisJson = z.infer<typeof analysisSchema>

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export interface IntakeCitedProvision {
  snippetId: string
  /** Re-derived from the snippet, never taken from the model. */
  citation: string
  href: string
  relevance: Bilingual
}

export interface IntakeAiAnalysis {
  status: 'analysis'
  summary: Bilingual
  whatIsAsked: Bilingual[]
  deadline: string
  citedProvisions: IntakeCitedProvision[]
  suggestedType: string
  risks: Bilingual[]
  nextSteps: Bilingual[]
  /** Anything dropped or corrected on the way, in English, for the panel's log. */
  problems: string[]
  usage: TokenUsage
  cost: number
  meta: AiOutputMeta
}

export interface IntakeRefused {
  status: 'refused'
  refusal: BriefRefusal
}

export interface IntakeFailed {
  status: 'error'
  code: AiErrorCode
  message: string
  usage: TokenUsage
  cost: number
}

export type IntakeAgentResult = IntakeAiAnalysis | IntakeRefused | IntakeFailed

export const INTAKE_PHASES = ['screening', 'reading', 'checking', 'done'] as const
export type IntakePhase = (typeof INTAKE_PHASES)[number]

export interface IntakeStep {
  phase: IntakePhase
  tool?: string
}

export interface IntakeAgentParams {
  provider: AiProvider
  /** The letter itself. Screened before it is sent. */
  text: string
  /** What the deterministic pass read, after the officer corrected it. */
  extracted: IntakeAnalysis
  /** The provisions the letter cited, already resolved against our corpus. */
  provisions?: readonly ResolvedProvision[]
  /** What retrieval found for those provisions. The only citable snippets. */
  snippets?: readonly RetrievedSnippet[]
  /** The forty-three form ids, so `suggestedType` can be checked against them. */
  templateIds: readonly string[]
  language: Language
  tools?: readonly RegisteredTool[]
  signal?: AbortSignal
  onProgress?: (step: IntakeStep) => void
  onEvent?: AiEventHandler
  tier?: AiTier
  budgetLimit?: number | null
  model?: string
  ledger?: UsageLedger
  now?: () => Date
}

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

/**
 * How much of the letter is sent.
 *
 * A whole letter with its annexures can run to twenty pages, and the analysis
 * is about what it ASKS FOR, which is on the first two. This is a cap on the
 * body rather than a summary of it: a truncated letter is visible in the panel
 * and the officer can paste a shorter extract, whereas a letter this file chose
 * to summarise before sending would be an unreviewed edit to the input.
 */
export const LETTER_CAP = 12_000

/**
 * The snippets, numbered, with the deterministic reading first.
 *
 * `[1]` is always what the app already knows — the number, the date, the
 * subject, the urgency, the enclosure count and the sentences the extractor
 * found. It is snippet 1 for the same reason the officer's brief is snippet 1
 * in the drafting agent: a fact the app extracted is a fact the model may
 * repeat, and giving it a citable handle is what stops `validateCitations`
 * rejecting an answer for quoting the letter's own file number.
 */
function intakeContext(params: {
  text: string
  extracted: IntakeAnalysis
  snippets: readonly RetrievedSnippet[]
  language: Language
}): BuiltContext {
  const { extracted } = params
  const facts = [
    `Reference number: ${extracted.meta.number || '(none on the page)'}`,
    `Date of the letter: ${extracted.letterDate || '(none found)'}`,
    `Received on: ${extracted.receiptDate || '(no receipt stamp)'}`,
    `Subject: ${extracted.meta.subject || '(none stated)'}`,
    `Urgency grading: ${extracted.urgency}`,
    `Enclosures: ${extracted.enclosures.count}`,
    ...extracted.asks.map((ask, index) => `Request ${index + 1}: ${ask.text}`),
  ].join('\n')

  const snippets: Snippet[] = [
    {
      type: 'note',
      id: 'extracted',
      source: 'read from the letter by this app',
      text: facts,
    },
    {
      type: 'note',
      id: 'letter',
      source: 'the letter, as received',
      text: sanitiseField(params.text).text.slice(0, LETTER_CAP),
    },
    ...params.snippets.map((snippet): Snippet => ({
      type: snippet.kind === 'section' ? 'section' : 'rule',
      id: snippet.id,
      source: snippet.citation,
      text: snippet.text,
    })),
  ]
  return buildContext(snippets, params.language)
}

const userMessage = (params: { extracted: IntakeAnalysis; templateIds: readonly string[] }): string =>
  [
    'Read the communication in PLATFORM CONTEXT and report what it asks for.',
    '',
    'Answer as JSON with these members:',
    '- summary: {en, hi} — two sentences at most, saying what the letter is about.',
    '- whatIsAsked: [{en, hi}] — one entry per thing the office is being asked to do. If it asks for nothing, return an empty list.',
    '- deadline: an ISO date (YYYY-MM-DD) the letter sets, or "". Never compute one from a period like "within 15 days" — the office counts that from a date you do not have.',
    '- citedProvisions: [{snippetId, relevance:{en,hi}}] — ONLY provisions that appear as a numbered snippet above. Never name a provision that is not one of them.',
    `- suggestedType: the id of the form that answers this, from: ${params.templateIds.join(', ')}. Use "" if none fits.`,
    '- risks: [{en, hi}] — what could go wrong in answering this badly. At most three.',
    '- nextSteps: [{en, hi}] — what the officer should do, in order. At most four.',
    '',
    'Do not restate the reference number, the date or the enclosure count: the app has them and shows them beside your answer.',
  ].join('\n')

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export async function runIntakeAgent(params: IntakeAgentParams): Promise<IntakeAgentResult> {
  const {
    provider,
    text,
    extracted,
    snippets = [],
    templateIds,
    language,
    tools = [],
    signal,
    onProgress,
    onEvent,
    tier = 'byok',
    budgetLimit = null,
    model,
    ledger,
    now = () => new Date(),
  } = params

  const step = (phase: IntakePhase, tool?: string) => onProgress?.(tool ? { phase, tool } : { phase })

  /* ---- 1. screen, before a provider exists ----------------------- */

  step('screening')
  const refusal = screenOutbound([
    text,
    extracted.meta.subject,
    extracted.asks.map((ask) => ask.text).join('\n'),
  ])
  if (refusal) return { status: 'refused', refusal }

  /* ---- 2. read --------------------------------------------------- */

  step('reading')
  const context = intakeContext({ text, extracted, snippets, language })
  const run: AgentRun = await runAgent({
    agentId: AGENT_ID,
    provider,
    tools,
    /*
      Off, and for the reason ADR-035 §1 gives: this pass has no tools, so
      "cite a tool result" is unsatisfiable by construction — everything the
      model is allowed to use is numbered PLATFORM CONTEXT. Four checks in
      this file replace the one, and all four are in code below: a cited
      provision must be one of the snippets it was shown (and fails the run if
      it is not), the citation an officer sees is re-derived from that snippet,
      a suggested form must be one of the forty-three, and the deadline the
      extractor read off the letter beats the one the model wrote.
      `validateCitations` still runs over the answer with `requireCitation`
      off, so a provision number the context does not contain is still caught.
    */
    groundedRequired: false,
    system: buildSystem({ agentId: AGENT_ID, language, context }),
    userMessage: userMessage({ extracted, templateIds }),
    jsonSchema: { name: 'intake_analysis', schema: toJsonSchema(analysisSchema) },
    context,
    language,
    tier,
    budgetLimit,
    ledger,
    now,
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
    onEvent: (event) => {
      if (event.type === 'toolCall') step('reading', event.call.name)
      onEvent?.(event)
    },
  })

  const usage: TokenUsage = run.usage ?? { ...EMPTY_USAGE }
  const cost = estimateCost(run.meta.model, usage)

  if (!run.ok || run.json === undefined) {
    return {
      status: 'error',
      code: run.error?.code ?? 'provider',
      message: run.error?.message ?? 'The analysis produced no answer.',
      usage,
      cost,
    }
  }

  const parsed = analysisSchema.safeParse(run.json)
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'provider',
      message: `The analysis did not match the expected shape — ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      usage,
      cost,
    }
  }

  /* ---- 3. check, in code ----------------------------------------- */

  step('checking')
  const problems: string[] = []
  const byId = new Map(snippets.map((snippet) => [snippet.id, snippet]))
  const cited: IntakeCitedProvision[] = []

  for (const entry of parsed.data.citedProvisions) {
    const snippet = byId.get(entry.snippetId)
    if (!snippet) {
      // Fails the run rather than dropping the entry. See the header: the
      // output is one claim about what the letter says, and a provision the
      // letter never cited inside that claim is an officer answering the wrong
      // point.
      return {
        status: 'error',
        code: 'ungrounded',
        message:
          `The analysis cited a provision that is not in what it was shown ("${entry.snippetId}"), ` +
          'so it has been discarded. Nothing invented reaches the reply.',
        usage,
        cost,
      }
    }
    cited.push({
      snippetId: snippet.id,
      // Re-derived from the snippet, never taken from the model (ADR-035).
      citation: snippet.citation,
      href: snippet.href,
      relevance: entry.relevance,
    })
  }

  let suggestedType = parsed.data.suggestedType
  if (suggestedType && !templateIds.includes(suggestedType)) {
    problems.push(`The suggested form "${suggestedType}" is not one this app has; it was dropped.`)
    suggestedType = ''
  }

  /*
    A deadline the app already found beats one the model wrote. The extractor
    read it off the letter with a regex over a labelled sentence; the model read
    the same sentence and may have done the arithmetic on a period, which the
    prompt forbids and which nothing else would catch.
  */
  const extractedDeadline = extracted.asks.find((ask) => ask.deadline)?.deadline ?? ''
  let deadline = parsed.data.deadline
  if (extractedDeadline && deadline && deadline !== extractedDeadline) {
    problems.push(
      `The analysis gave ${deadline} as the deadline; the letter itself says ${extractedDeadline}, which is what is shown.`,
    )
    deadline = extractedDeadline
  }
  if (!deadline) deadline = extractedDeadline
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    problems.push(`The analysis gave "${deadline}" as a date, which is not one; it was dropped.`)
    deadline = ''
  }

  step('done')
  return {
    status: 'analysis',
    summary: parsed.data.summary,
    whatIsAsked: parsed.data.whatIsAsked,
    deadline,
    citedProvisions: cited,
    suggestedType,
    risks: parsed.data.risks,
    nextSteps: parsed.data.nextSteps,
    problems,
    usage,
    cost,
    meta: run.meta,
  }
}
