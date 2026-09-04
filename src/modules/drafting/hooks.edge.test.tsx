import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { useIntakeAi } from './intake/useIntakeAi'
import { useModifyAi } from './editor/useModifyAi'

import { analyseIntake } from '@/lib/drafting/intake'
import { newDoc } from '@/lib/drafting/model'
import { docTemplateFileSchema, type DocTemplate } from './schema'
import { INTAKE_LETTERS } from '../../../tests/fixtures/drafting/intake'

/**
 * The two new hooks under StrictMode, which is where this project has been
 * bitten three times.
 *
 * `pnpm test:e2e` runs a PRODUCTION build, where StrictMode is inert, so a
 * hook whose effects are not idempotent across mount → cleanup → mount passes
 * every Playwright spec and is broken the moment anybody opens `pnpm dev`
 * (CLAUDE.md, and `useDraft.test.tsx` exists for exactly this).
 *
 * The specific hazard here is the unmount abort. Both hooks abort in a
 * mount-only cleanup; StrictMode runs that cleanup once before the second
 * mount, so a controller stored in a ref that the second mount does not
 * re-create would leave every run aborted before it started.
 */

const AT = '2026-09-04T10:00:00.000Z'

/**
 * A mutable holder for the hook's return value.
 *
 * `let api: X | null = null` assigned only inside a callback is narrowed by
 * TypeScript to `null` at every later use, which the type-aware lint rules
 * then report as unsafe member access. A field on an object is not narrowed.
 */
interface Held<T> {
  api: T | null
}

/**
 * Wait until the hook's run has actually reached the provider.
 *
 * Both hooks import `@/ai/agents/{intake,modify}` at RUN time rather than at
 * module load — the laziness that keeps the agent off the device of a reader
 * who never turns AI on — and evaluating that graph takes tens of milliseconds
 * under vitest. A fixed `setTimeout(0)`, or a `Promise.resolve()`, lands long
 * before it: the first version of this file used one and asserted on an empty
 * `seen`, which looked exactly like a hook that never called its provider.
 *
 * Polling the thing being asserted about, rather than a proxy for it, is
 * CLAUDE.md's own rule from `ai-local.spec.ts` — where waiting on a progress
 * region that appears instantly reported "the download reached no host at all".
 */
const reachedProvider = async (seen: readonly AbortSignal[]) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (seen.length > 0) return
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)))
  }
  throw new Error('the run never reached the provider')
}

const DOC = newDoc({
  id: 'd1',
  templateId: 'office-memorandum',
  lang: 'en',
  at: AT,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A paragraph.' }] }] },
})

/*
  The REAL committed form, not a shape invented here.

  A `{ id, checklist: [] }` cast was the first version and it made
  `buildInstruction` throw on `template.layout.en` — which the hook caught and
  reported as an error state, so the run never reached the provider and the
  assertion below failed with "the run never reached the provider". That is the
  hook behaving correctly and the fixture lying; a stub of a dataset type is a
  stub of every field the code under test happens to read.
*/
const TEMPLATE: DocTemplate = docTemplateFileSchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'data', 'drafting', 'templates', 'office-memorandum.json'),
      'utf8',
    ),
  ),
).template

/**
 * A provider that never resolves, so a run is in flight when we look at it —
 * and that hands back the `AbortSignal` it was given.
 *
 * The signal is the only honest way to assert "the run was cancelled": `busy`
 * going false says the hook stopped waiting, and says nothing about whether the
 * request was actually abandoned. `ChatParams.signal` is what `wire.ts` passes
 * to `fetch`, so a test that watches it is watching the thing that decides
 * whether the officer goes on paying.
 */
const hangingProvider = () => {
  const seen: AbortSignal[] = []
  const provider = {
    id: 'mock',
    capabilities: { streaming: false, tools: false, jsonMode: true, maxContext: 1, localOnly: true },
    chat: (params: { signal?: AbortSignal }) => {
      if (params.signal) seen.push(params.signal)
      return new Promise(() => {})
    },
  } as unknown as Parameters<typeof useModifyAi>[0]['provider']
  return { provider, seen }
}

function Harness({
  onReady,
  provider,
}: {
  onReady: (api: ReturnType<typeof useIntakeAi>) => void
  provider: Parameters<typeof useModifyAi>[0]['provider']
}) {
  const api = useIntakeAi({
    provider,
    tier: 'byok',
    // A real ceiling, not 0: `runAgent` stops on an exhausted budget before it
    // ever constructs a request, so a 0 here would make every assertion below
    // pass for the wrong reason.
    budgetLimit: 1_000_000,
    language: 'en',
    templateIds: ['letter'],
  })
  useEffect(() => {
    onReady(api)
  })
  return null
}

function ModifyHarness({
  onReady,
  provider,
}: {
  onReady: (api: ReturnType<typeof useModifyAi>) => void
  provider: Parameters<typeof useModifyAi>[0]['provider']
}) {
  const api = useModifyAi({
    doc: DOC,
    template: TEMPLATE,
    lang: 'en',
    language: 'en',
    devanagariDigits: false,
    provider,
    tier: 'byok',
    budgetLimit: 1_000_000,
  })
  useEffect(() => {
    onReady(api)
  })
  return null
}

describe('useIntakeAi under StrictMode', () => {
  it('can still start a run after the double mount', () => {
    const held: Held<ReturnType<typeof useIntakeAi>> = { api: null }
    render(
      <StrictMode>
        <Harness
          provider={hangingProvider().provider}
          onReady={(value) => {
            held.api = value
          }}
        />
      </StrictMode>,
    )

    act(() => {
      held.api?.analyse({
        text: INTAKE_LETTERS.englishOm,
        extracted: analyseIntake(INTAKE_LETTERS.englishOm),
        provisions: [],
        snippets: [],
      })
    })
    // The run is in flight, not aborted by the first mount's cleanup.
    expect(held.api?.busy).toBe(true)
    expect(held.api?.state.kind).toBe('running')
  })

  it('aborts the request when the component goes away', async () => {
    /*
      A screen the officer has navigated away from must not go on spending
      their tokens — and the assertion is on the SIGNAL the provider was given,
      not on `busy`. `busy` going false only says the hook stopped waiting; the
      signal is what `wire.ts` hands to `fetch`, so it is what decides whether
      the request is actually abandoned.

      The first version of this test called `expect(vi.fn()).not.toHaveBeenCalled()`
      on a mock nothing could ever call. That passes against every version of
      the hook, including one with no cleanup at all — a test that cannot fail
      is not evidence (`network.sentinel`'s own story, CLAUDE.md).
    */
    const held: Held<ReturnType<typeof useIntakeAi>> = { api: null }
    const { provider, seen } = hangingProvider()
    const view = render(
      <Harness
        provider={provider}
        onReady={(value) => {
          held.api = value
        }}
      />,
    )
    act(() => {
      held.api?.analyse({
        text: INTAKE_LETTERS.englishOm,
        extracted: analyseIntake(INTAKE_LETTERS.englishOm),
        provisions: [],
        snippets: [],
      })
    })
    await reachedProvider(seen)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.aborted).toBe(false)

    view.unmount()
    expect(seen[0]?.aborted).toBe(true)
  })
})

describe('useModifyAi under StrictMode', () => {
  it('can still start a run after the double mount', () => {
    const held: Held<ReturnType<typeof useModifyAi>> = { api: null }
    render(
      <StrictMode>
        <ModifyHarness
          provider={hangingProvider().provider}
          onReady={(value) => {
            held.api = value
          }}
        />
      </StrictMode>,
    )

    act(() => {
      held.api?.run({ instruction: 'Make it firmer.' })
    })
    expect(held.api?.busy).toBe(true)
    expect(held.api?.state.kind).toBe('running')
  })

  it('reports the phases of a run in order, and cancelling clears them', async () => {
    const held: Held<ReturnType<typeof useModifyAi>> = { api: null }
    const { provider, seen } = hangingProvider()
    render(
      <ModifyHarness
        provider={provider}
        onReady={(value) => {
          held.api = value
        }}
      />,
    )
    act(() => {
      held.api?.run({ instruction: 'Make it firmer.' })
    })
    expect(held.api?.state.kind).toBe('running')

    await reachedProvider(seen)

    act(() => {
      held.api?.cancel()
    })
    expect(held.api?.state.kind).toBe('idle')
    expect(held.api?.busy).toBe(false)
    // And the request the officer cancelled is actually abandoned.
    expect(seen[0]?.aborted).toBe(true)
  })
})
