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
 * would put all fourteen templates into every chunk. Fourteen lines is the
 * price of a picker that downloads one form.
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

/** The picker's data: fourteen names, no layouts. */
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
