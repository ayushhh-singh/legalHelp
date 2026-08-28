import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDraft } from './useDraft'
import { putDraft } from './drafts'

import { db } from '@/db'
import { fixtureTemplate } from '@/test/drafting-fixture'

/**
 * The load, under StrictMode.
 *
 * These run inside `<StrictMode>` deliberately, because `src/main.tsx` does —
 * and because StrictMode's mount → cleanup → mount is the only thing that
 * exercises the guard that decides whether the form ever leaves its skeleton.
 * It double-invokes effects in DEVELOPMENT ONLY, which is why the Playwright
 * suite, which runs against a production build, cannot see a failure here.
 */

const template = fixtureTemplate()

describe('useDraft under StrictMode', () => {
  it('leaves the skeleton — a cancelled first mount must not disarm the second', async () => {
    const { result } = renderHook(
      () => useDraft({ template, draftId: null, lang: 'en', onCreated: vi.fn() }),
      { wrapper: StrictMode },
    )
    await waitFor(() => expect(result.current.values).not.toBeNull())
    expect(Object.keys(result.current.values ?? {})).toContain('fileNumber')
  })

  it('resumes an existing row', async () => {
    await putDraft({
      id: 'aaaaaaaaaaaaaaaaaa',
      templateId: template.id,
      title: 'Resumed',
      values: { fileNumber: 'A-9/2026' },
    })
    const { result } = renderHook(
      () => useDraft({ template, draftId: 'aaaaaaaaaaaaaaaaaa', lang: 'en', onCreated: vi.fn() }),
      { wrapper: StrictMode },
    )
    await waitFor(() => expect(result.current.values).not.toBeNull())
    expect(result.current.values?.fileNumber).toBe('A-9/2026')
  })
})

describe('creating the row', () => {
  it('tells the caller the new id, so `?d=` reaches the URL', async () => {
    const onCreated = vi.fn()
    const { result } = renderHook(() => useDraft({ template, draftId: null, lang: 'en', onCreated }), {
      wrapper: StrictMode,
    })
    await waitFor(() => expect(result.current.values).not.toBeNull())

    act(() => result.current.replaceValues({ fileNumber: 'A-1/2026' }))

    // Under StrictMode the flush effect's cleanup runs once before the second
    // mount. It disarms the "still on screen" flag, and nothing re-armed it —
    // so this never fired, and a reload in dev opened an empty form.
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(String(onCreated.mock.calls[0]?.[0])).toMatch(/^[0-9a-f]{18}$/)
  })

  it('does not create a second row for the same draft', async () => {
    const onCreated = vi.fn()
    const { result } = renderHook(() => useDraft({ template, draftId: null, lang: 'en', onCreated }), {
      wrapper: StrictMode,
    })
    await waitFor(() => expect(result.current.values).not.toBeNull())

    act(() => result.current.replaceValues({ fileNumber: 'A-1/2026' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    act(() => result.current.replaceValues({ fileNumber: 'A-2/2026' }))
    await waitFor(() => expect(result.current.saveState).toBe('saved'))

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(await db.drafts.count()).toBe(1)
  })
})
