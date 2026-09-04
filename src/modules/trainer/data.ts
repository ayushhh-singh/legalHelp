import type { Card, RulesCards, RulesIndex, RulesText } from './schema'

/**
 * Loading `data/rules` — the index, and the twelve acts' cards.
 *
 * Same arrangement as the law, pay, drafting and glossary datasets (ADR-013):
 * a `?raw` dynamic import, never a `fetch` of `/data/*.json`. That is what
 * keeps `src/ai/providers/wire.ts` the only module in the app allowed to call
 * `fetch`, and what makes the Trainer work offline on a device that has never
 * opened `/study/practise` online — the service worker precaches the chunks through the
 * ordinary JavaScript glob. The twelve specifiers are written out one per act
 * for the reason `src/modules/drafting/data.ts` records: a bundler can only
 * chunk a specifier it can see.
 *
 * `data/rules/text/*.json` — the full extracted rule text, ~2.9 MB — is
 * deliberately NOT loaded here. Nothing this session builds needs it: a
 * card's own `front`/`back`/`cloze`/`explanation` carry everything a review
 * needs, and `ruleRef.citation` (already on every card) carries what Browse
 * and the explanation panel show beside it. Loading it would double what a
 * reader downloads to open the Trainer for a citation string.
 */

const parse = <T>(raw: string): T => JSON.parse(raw) as T

const TEXT_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  'ccs-conduct': () => import('../../../data/rules/text/ccs-conduct.json?raw'),
  'ccs-cca': () => import('../../../data/rules/text/ccs-cca.json?raw'),
  'ccs-leave': () => import('../../../data/rules/text/ccs-leave.json?raw'),
  'ccs-pension': () => import('../../../data/rules/text/ccs-pension.json?raw'),
  gfr: () => import('../../../data/rules/text/gfr.json?raw'),
  rti: () => import('../../../data/rules/text/rti.json?raw'),
  osa: () => import('../../../data/rules/text/osa.json?raw'),
  posh: () => import('../../../data/rules/text/posh.json?raw'),
  'ol-act': () => import('../../../data/rules/text/ol-act.json?raw'),
  'ol-rules': () => import('../../../data/rules/text/ol-rules.json?raw'),
  'fr-sr': () => import('../../../data/rules/text/fr-sr.json?raw'),
  csmop: () => import('../../../data/rules/text/csmop.json?raw'),
}

const CARD_LOADERS: Record<string, () => Promise<{ default: string }>> = {
  'ccs-conduct': () => import('../../../data/rules/cards/ccs-conduct.json?raw'),
  'ccs-cca': () => import('../../../data/rules/cards/ccs-cca.json?raw'),
  'ccs-leave': () => import('../../../data/rules/cards/ccs-leave.json?raw'),
  'ccs-pension': () => import('../../../data/rules/cards/ccs-pension.json?raw'),
  gfr: () => import('../../../data/rules/cards/gfr.json?raw'),
  rti: () => import('../../../data/rules/cards/rti.json?raw'),
  osa: () => import('../../../data/rules/cards/osa.json?raw'),
  posh: () => import('../../../data/rules/cards/posh.json?raw'),
  'ol-act': () => import('../../../data/rules/cards/ol-act.json?raw'),
  'ol-rules': () => import('../../../data/rules/cards/ol-rules.json?raw'),
  'fr-sr': () => import('../../../data/rules/cards/fr-sr.json?raw'),
  csmop: () => import('../../../data/rules/cards/csmop.json?raw'),
}

/** Every act id the Trainer knows how to load cards for. */
export const ACT_IDS = Object.keys(CARD_LOADERS)

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

/** The picker's data: twelve act names and counts, no card text. */
export function loadRulesIndex(): Promise<RulesIndex> {
  return once('index', async () => {
    const module = await import('../../../data/rules/index.json?raw')
    return parse<RulesIndex>(module.default)
  })
}

/**
 * ONE act's cards.
 *
 * Exported since Session 28's edge pass: the Library's coverage heat-map needs
 * a card → unit map for a single work, and `loadAllCards` is 1.1 MB across
 * twelve acts to answer a question about one of them. A work page that wants
 * to know which of ITS rules have been quizzed should pay for its own act and
 * nothing else.
 */
export function loadCardsForAct(actId: string): Promise<RulesCards> {
  return loadActCards(actId)
}

function loadActCards(actId: string): Promise<RulesCards> {
  const loader = CARD_LOADERS[actId]
  if (!loader) return Promise.reject(new Error(`unknown rules act: ${actId}`))
  return once(`cards:${actId}`, async () => parse<RulesCards>((await loader()).default))
}

/**
 * One act's full extracted rule text — the ~2.9 MB `loadAllCards` deliberately
 * skips. Loaded on its own, only by the two things that actually want a rule's
 * full text rather than its citation: `get_rule_text` (`src/ai/tools/rules.ts`)
 * and Browse's rule-detail panel.
 */
export function loadActText(actId: string): Promise<RulesText> {
  const loader = TEXT_LOADERS[actId]
  if (!loader) return Promise.reject(new Error(`unknown rules act: ${actId}`))
  return once(`text:${actId}`, async () => parse<RulesText>((await loader()).default))
}

/**
 * Every card in every act, flattened. This is "the catalogue" every function
 * in `src/lib/srs` and every page in this module is handed — due counts, weak
 * areas and the mock test all reason across acts, so there is no cheaper
 * subset to load once the reader has opened the Trainer at all.
 */
export async function loadAllCards(): Promise<Card[]> {
  return once('all-cards', async () => {
    const files = await Promise.all(ACT_IDS.map((actId) => loadActCards(actId)))
    return files.flatMap((file) => file.cards)
  })
}

/** Test seam. Production never needs to drop what it has parsed. */
export function resetRulesCache(): void {
  cache.clear()
}
