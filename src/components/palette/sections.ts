import type { PaletteItem } from './types'

import { toGlossaryHref } from '@/modules/utils/glossary/url'
import type { GlossaryIndex } from '@/modules/utils/glossary/search'
import { searchGlossary } from '@/modules/utils/glossary/search'
import type { DraftingIndex } from '@/modules/drafting/schema'
import type { LawSearchEngine } from '@/modules/law/search'
import { actOf, searchLaw } from '@/modules/law/search'
import { toLawHref } from '@/modules/law/url'
import { toLibrarySearchHref, toWorkHref } from '@/modules/library/url'
import type { LibraryIndex } from '@/schemas/library'
import type { JobIndex } from '@/modules/pay/pick'
import { searchJobs } from '@/modules/pay/pick'
import type { Portal, PortalsDataset } from '@/modules/utils/portals/schema'
import type { RulesIndex } from '@/modules/trainer/schema'
import { toTrainerTopicHref } from '@/modules/trainer/url'
import { romanKey } from '@/lib/transliterate'

/**
 * Turning a query into a ranked slice of each section — Law, Job posts,
 * Glossary, Document types, Trainer topics, Portals, Library.
 *
 * Every section reuses the module's OWN existing search — `searchLaw`,
 * `searchJobs`, `searchGlossary` — rather than a second, palette-shaped index
 * over the same data. That is what makes "hatya" reach BNS 103 here: it is
 * the same bilingual offence lexicon and the same `romanKey` folding
 * `/law` already ships, not a re-implementation that could disagree with it.
 * Document types and Trainer topics have no reusable search of their own —
 * fourteen templates and twelve rule books are small enough that a plain
 * `romanKey` substring match, folded like every other query in this app, is
 * the whole job.
 */

const RESULTS_PER_SECTION = 6

export function lawItems(engine: LawSearchEngine, query: string): PaletteItem[] {
  if (!query.trim()) return []
  const result = searchLaw(engine, { query, direction: 'old-new' })
  return result.hits.slice(0, RESULTS_PER_SECTION).map((hit) => {
    const { doc } = hit
    const code = doc.ref.code
    const act = actOf(code)
    return {
      id: `law:${doc.id}`,
      en: doc.headingEn || doc.section,
      hi: doc.headingHi || doc.section,
      hint: `${act} ${doc.section}`,
      // Naming the Act, not just the bare number: BNS, BNSS and BSA each
      // restart their own numbering, and several of those numbers ALSO exist
      // as a real section of the repealed Act this hit's own number happens
      // to share — a bare `?q=101&code=bns` re-parses on the Law page as "old
      // IPC 101" (the default old->new direction) rather than "BNS 101,
      // Murder" the reader actually selected. `"BNS 101"` pins the reading:
      // `directionContradicted` in src/modules/law/search.ts rules out the
      // old-Act interpretation once an Act is named.
      to: toLawHref({ query: `${act} ${doc.section}`, code }),
      recordRecent: true,
    }
  })
}

export function jobItems(jobIndex: JobIndex, query: string): PaletteItem[] {
  if (!query.trim()) return []
  return searchJobs(jobIndex, query, RESULTS_PER_SECTION).map((option) => ({
    id: `pay:${option.job.id}`,
    en: option.job.title.en,
    hi: option.job.title.hi,
    hint: option.organisation.en,
    to: `/tools/salary?job=${encodeURIComponent(option.job.id)}`,
    recordRecent: true,
  }))
}

export function glossaryItems(index: GlossaryIndex, query: string): PaletteItem[] {
  if (!query.trim()) return []
  return searchGlossary(index, query, 'all')
    .slice(0, RESULTS_PER_SECTION)
    .map((term) => ({
      id: `glossary:${term.id}`,
      en: term.en,
      hi: term.hi,
      hint: term.category,
      to: toGlossaryHref(term.id),
      recordRecent: true,
    }))
}

/** Letters only, upper-cased — `"O.M."` → `"OM"`, `"D.O."` → `"DO"`. */
function acronymOf(text: string): string {
  return text.replace(/[^A-Za-z]/g, '').toUpperCase()
}

export function draftingItems(index: DraftingIndex, query: string): PaletteItem[] {
  const needle = query.trim()
  if (!needle) return []
  const folded = romanKey(needle)
  const upper = needle.toUpperCase()

  const scored = index.templates
    .map((template) => {
      const acronym = acronymOf(template.shortName.en)
      const foldedName = romanKey(template.name.en)
      const foldedShort = romanKey(template.shortName.en)
      let score: number | null = null
      if (acronym === upper && upper.length >= 2) score = 0
      else if (
        foldedName.includes(folded) ||
        foldedShort.includes(folded) ||
        template.name.hi.includes(needle) ||
        template.shortName.hi.includes(needle)
      )
        score = 1
      else if (upper.length >= 2 && acronym.includes(upper)) score = 2
      return score === null ? null : { template, score }
    })
    .filter((hit): hit is { template: DraftingIndex['templates'][number]; score: number } => hit !== null)
    .sort((a, b) => a.score - b.score)

  return scored.slice(0, RESULTS_PER_SECTION).map(({ template }) => ({
    id: `draft:${template.id}`,
    en: template.name.en,
    hi: template.name.hi,
    hint: template.shortName.en,
    to: `/draft/new/${template.id}`,
    recordRecent: true,
  }))
}

export function trainerTopicItems(index: RulesIndex, query: string): PaletteItem[] {
  const needle = query.trim()
  if (!needle) return []
  const folded = romanKey(needle)

  return index.acts
    .filter((act) => {
      const hay = romanKey(`${act.name.en} ${act.short.en}`)
      return hay.includes(folded) || act.name.hi.includes(needle) || act.short.hi.includes(needle)
    })
    .slice(0, RESULTS_PER_SECTION)
    .map((act) => ({
      id: `trainer:${act.id}`,
      en: act.name.en,
      hi: act.name.hi,
      hint: act.short.en,
      to: toTrainerTopicHref(act.id),
      recordRecent: true,
    }))
}

export function portalItems(dataset: PortalsDataset, query: string): PaletteItem[] {
  const needle = query.trim()
  if (!needle) return []
  const folded = romanKey(needle)

  const matches = (portal: Portal) => {
    const hay = romanKey(`${portal.name.en} ${portal.shortName.en} ${portal.purpose.en}`)
    return hay.includes(folded) || portal.name.hi.includes(needle) || portal.purpose.hi.includes(needle)
  }

  return dataset.portals
    .filter(matches)
    .slice(0, RESULTS_PER_SECTION)
    .map((portal) => ({
      id: `portal:${portal.id}`,
      en: portal.name.en,
      hi: portal.name.hi,
      hint: portal.purpose.en,
      to: `/tools/portals?q=${encodeURIComponent(portal.shortName.en)}`,
      recordRecent: true,
    }))
}

/**
 * The Library section: the works whose names match, and one row that runs the
 * query across every book.
 *
 * IT DOES NOT SEARCH THE CORPORA. Every other section here reuses an index its
 * module already builds; the Library's equivalent would be fifteen corpora and
 * 5.5 MB of statute parsed to answer a keystroke, which `/study/read/search` makes
 * a deliberate, progress-reported act for exactly that reason. So the palette
 * offers what it can answer instantly — the fifteen names, from the 11 KB shelf
 * index — and hands the expensive question to the screen built for it.
 *
 * The "search everything" row is last and is never recorded as a recent: it is
 * a query, not a place, and `commandRecents` is a list of places to go back to.
 */
export function libraryItems(index: LibraryIndex, query: string): PaletteItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const folded = romanKey(needle)

  const works = index.works
    .filter((work) => {
      const haystack = [work.title.en, work.title.hi, work.shortTitle.en, work.shortTitle.hi]
      return haystack.some(
        (value) => value.toLowerCase().includes(needle) || romanKey(value).includes(folded),
      )
    })
    .slice(0, RESULTS_PER_SECTION - 1)
    .map((work): PaletteItem => ({
      id: `library:${work.id}`,
      en: work.title.en,
      hi: work.title.hi,
      hint: work.publisher,
      to: toWorkHref(work.id),
      recordRecent: true,
    }))

  return [
    ...works,
    {
      id: `library:search:${needle}`,
      en: `Search the whole Library for “${query.trim()}”`,
      hi: `पूरे पुस्तकालय में “${query.trim()}” खोजें`,
      to: toLibrarySearchHref(query.trim()),
      recordRecent: false,
    },
  ]
}
