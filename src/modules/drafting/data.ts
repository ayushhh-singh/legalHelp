import type { DocTemplate, DocTemplateFile, DraftingIndex, PhraseLibrary, StructureTerms } from './schema'

/**
 * Loading `data/drafting` — the index first, one template at a time after that.
 *
 * Same arrangement as the law and pay datasets (ADR-013, ADR-018): a `?raw`
 * dynamic import, never a `fetch` of `/data/*.json`. That is what keeps
 * `src/ai/providers/wire.ts` the only module in the app allowed to call
 * `fetch`, and what makes the templates work offline on a device that has
 * never opened `/draft` online — the service worker precaches the chunks
 * through the ordinary JavaScript glob.
 *
 * The specifiers are written out one per file rather than built from a
 * template string, for the reason `src/modules/pay/data.ts` records: a bundler
 * can only make a chunk for a specifier it can see, and a computed specifier
 * would put all forty-three templates into every chunk. Forty-three lines is
 * the price of a picker that downloads one form.
 */

const parse = <T>(raw: string): T => JSON.parse(raw) as T

const TEMPLATE_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  letter: () => import('../../../data/drafting/templates/letter.json?raw'),
  'demi-official': () => import('../../../data/drafting/templates/demi-official.json?raw'),
  'office-memorandum': () => import('../../../data/drafting/templates/office-memorandum.json?raw'),
  circular: () => import('../../../data/drafting/templates/circular.json?raw'),
  endorsement: () => import('../../../data/drafting/templates/endorsement.json?raw'),
  'id-note': () => import('../../../data/drafting/templates/id-note.json?raw'),
  noting: () => import('../../../data/drafting/templates/noting.json?raw'),
  notification: () => import('../../../data/drafting/templates/notification.json?raw'),
  'leave-application': () => import('../../../data/drafting/templates/leave-application.json?raw'),
  representation: () => import('../../../data/drafting/templates/representation.json?raw'),
  'rti-reply': () => import('../../../data/drafting/templates/rti-reply.json?raw'),
  'show-cause-reply': () => import('../../../data/drafting/templates/show-cause-reply.json?raw'),
  'tour-programme': () => import('../../../data/drafting/templates/tour-programme.json?raw'),
  'ta-bill-cover': () => import('../../../data/drafting/templates/ta-bill-cover.json?raw'),

  // Session 29 — Template Library v2. Every one of these carries `variables`
  // and a `bodySkeleton`; the fourteen above gained a skeleton and kept their
  // worked example unchanged (ADR-041, drafting_seed.py#_add_legacy_skeletons).
  acknowledgement: () => import('../../../data/drafting/templates/acknowledgement.json?raw'),
  advisory: () => import('../../../data/drafting/templates/advisory.json?raw'),
  'agenda-note': () => import('../../../data/drafting/templates/agenda-note.json?raw'),
  appeal: () => import('../../../data/drafting/templates/appeal.json?raw'),
  certificate: () => import('../../../data/drafting/templates/certificate.json?raw'),
  'charge-report': () => import('../../../data/drafting/templates/charge-report.json?raw'),
  'charges-reply': () => import('../../../data/drafting/templates/charges-reply.json?raw'),
  'condolence-do': () => import('../../../data/drafting/templates/condolence-do.json?raw'),
  'explanation-letter': () => import('../../../data/drafting/templates/explanation-letter.json?raw'),
  'forwarding-letter': () => import('../../../data/drafting/templates/forwarding-letter.json?raw'),
  'gpf-advance': () => import('../../../data/drafting/templates/gpf-advance.json?raw'),
  grievance: () => import('../../../data/drafting/templates/grievance.json?raw'),
  'house-allotment': () => import('../../../data/drafting/templates/house-allotment.json?raw'),
  'interim-reply': () => import('../../../data/drafting/templates/interim-reply.json?raw'),
  'joining-report': () => import('../../../data/drafting/templates/joining-report.json?raw'),
  'ltc-application': () => import('../../../data/drafting/templates/ltc-application.json?raw'),
  'minutes-of-meeting': () => import('../../../data/drafting/templates/minutes-of-meeting.json?raw'),
  'noc-issue': () => import('../../../data/drafting/templates/noc-issue.json?raw'),
  'noc-request': () => import('../../../data/drafting/templates/noc-request.json?raw'),
  'office-order': () => import('../../../data/drafting/templates/office-order.json?raw'),
  'relieving-order': () => import('../../../data/drafting/templates/relieving-order.json?raw'),
  reminder: () => import('../../../data/drafting/templates/reminder.json?raw'),
  'rti-application': () => import('../../../data/drafting/templates/rti-application.json?raw'),
  'rti-first-appeal-reply': () => import('../../../data/drafting/templates/rti-first-appeal-reply.json?raw'),
  'sanction-order': () => import('../../../data/drafting/templates/sanction-order.json?raw'),
  'speaking-order': () => import('../../../data/drafting/templates/speaking-order.json?raw'),
  'tour-report': () => import('../../../data/drafting/templates/tour-report.json?raw'),
  'transfer-request': () => import('../../../data/drafting/templates/transfer-request.json?raw'),
  'vigilance-clearance': () => import('../../../data/drafting/templates/vigilance-clearance.json?raw'),
}

/** Every template id the Drafting Studio can open. */
export const TEMPLATE_IDS = Object.keys(TEMPLATE_LOADERS)

const cache = new Map<string, Promise<unknown>>()

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = load().catch((error: unknown) => {
    // A failed load is never cached: an offline first visit must be able to
    // succeed on the next attempt rather than being stuck for the tab's life.
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

/** The picker's data: forty-three names, no layouts. */
export function loadDraftingIndex(): Promise<DraftingIndex> {
  return once('index', async () => {
    const module = await import('../../../data/drafting/index.json?raw')
    return parse<DraftingIndex>(module.default)
  })
}

export function loadTemplate(id: string): Promise<DocTemplate> {
  const loader = TEMPLATE_LOADERS[id]
  if (!loader) return Promise.reject(new Error(`unknown drafting template: ${id}`))
  return once(`template:${id}`, async () => parse<DocTemplateFile>((await loader()).default).template)
}

export function loadPhrases(): Promise<PhraseLibrary> {
  return once('phrases', async () => {
    const module = await import('../../../data/drafting/phrases.json?raw')
    return parse<PhraseLibrary>(module.default)
  })
}

export function loadStructureTerms(): Promise<StructureTerms> {
  return once('terms', async () => {
    const module = await import('../../../data/drafting/structure-terms.json?raw')
    return parse<StructureTerms>(module.default)
  })
}

/** Test seam. Production never needs to drop what it has parsed. */
export function resetDraftingCache(): void {
  cache.clear()
}
