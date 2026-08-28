import type { Lang } from '@/lib/drafting/types'

/**
 * The editor's view state, in the URL.
 *
 * Same reasoning as the Law Converter (ADR-013/015) and the Pay calculator
 * (ADR-018): the URL is the state, so the back button works, a reload lands on
 * the same screen, and a link is worth sending. What is NOT in the URL is the
 * draft's content — that is in IndexedDB and must never be in a link, because a
 * URL is the one part of a page that gets pasted into an e-mail. The URL
 * carries the draft's *id* and nothing else about it.
 *
 * This is deliberately pure string work with no dataset behind it, exactly as
 * `parsePayParams` is: `/draft/office-memorandum` must render its form skeleton
 * on the first frame, before the 24 KB template has been imported.
 */

/** Which language the preview shows. `both` is the side-by-side view. */
export type PreviewView = Lang | 'both'

/** Which half is on screen below the lg breakpoint, where they do not fit. */
export type Pane = 'form' | 'preview'

export interface DraftParams {
  /** The row in `drafts`, or null for a draft that has not been started. */
  draftId: string | null
  view: PreviewView
  pane: Pane
  checklistOpen: boolean
}

const VIEWS: readonly PreviewView[] = ['en', 'hi', 'both']
const PANES: readonly Pane[] = ['form', 'preview']

/**
 * A draft id as this module writes them: 18 hex characters from
 * `crypto.getRandomValues`. Anything else in `?d=` is a deep link someone
 * edited by hand, and is dropped rather than used to query IndexedDB.
 */
const DRAFT_ID = /^[0-9a-f]{18}$/

export function parseDraftParams(params: URLSearchParams, fallbackView: PreviewView): DraftParams {
  const draftId = params.get('d')
  const view = params.get('view')
  const pane = params.get('pane')

  return {
    draftId: draftId && DRAFT_ID.test(draftId) ? draftId : null,
    view: VIEWS.includes(view as PreviewView) ? (view as PreviewView) : fallbackView,
    pane: PANES.includes(pane as Pane) ? (pane as Pane) : 'form',
    checklistOpen: params.get('check') === '1',
  }
}

/**
 * Back to a query string, omitting every default.
 *
 * A URL that spells out the values it did not change is a URL nobody can read,
 * and it makes `?d=…` — the only part worth keeping — the hardest thing to
 * find in it.
 */
export function draftParamsToSearch(next: DraftParams, defaultView: PreviewView): URLSearchParams {
  const params = new URLSearchParams()
  if (next.draftId) params.set('d', next.draftId)
  if (next.view !== defaultView) params.set('view', next.view)
  if (next.pane !== 'form') params.set('pane', next.pane)
  if (next.checklistOpen) params.set('check', '1')
  return params
}
