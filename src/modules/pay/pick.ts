import type { Bilingual } from '@/lib/pay/tables'
import { romanKey } from '@/lib/transliterate'
import type { HraCities, HraCity, Job, Jobs } from './schema'

/**
 * Matching for the two comboboxes — the job-title picker and the city picker.
 *
 * Deliberately not `fuse.js`. The law module indexes 1,059 records of statute
 * and needs fuzzy scoring; this is 67 posts and 102 cities, where a fuzzy match
 * is not a help but a hazard: "Inspector" fuzzily matches "Inspector of Income
 * Tax", "Inspector (Examiner), Customs" and "Sub-Inspector" about equally, and
 * the reader has to read all three anyway. Exact and prefix matching over a
 * precomputed term list is faster, is explainable, and puts the post someone
 * typed the name of at the top.
 *
 * Every term is folded through `romanKey`, the same function the Law
 * Converter's index uses, so English, Hindi and roman-Hindi reach the same
 * record: "आयकर निरीक्षक", "Inspector of Income Tax" and "aaykar nirikshak" are
 * one query as far as this file is concerned.
 */

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

const SCORE = {
  /** A term is exactly the query. */
  exact: 0,
  /** A term begins with the query. */
  prefix: 0.2,
  /** The query appears somewhere inside the record's own name. */
  contains: 0.4,
  /** The match came through the organisation, the exam or the Level. */
  context: 0.6,
} as const

/** Shorter than this, a prefix match is noise — "in" prefixes half the list. */
const MIN_PREFIX = 2

interface Indexed<T> {
  item: T
  /** Folded terms that identify the record itself. */
  own: string[]
  /** Folded terms that merely place it — organisation, exam, Level. */
  context: string[]
  /** The whole name, folded, for a substring pass. */
  whole: string
  sortKey: string
}

function scoreEntry<T>(entry: Indexed<T>, query: string): number | null {
  if (entry.own.includes(query)) return SCORE.exact
  if (query.length >= MIN_PREFIX && entry.own.some((term) => term.startsWith(query))) return SCORE.prefix
  if (query.length >= MIN_PREFIX && entry.whole.includes(query)) return SCORE.contains
  if (entry.context.includes(query)) return SCORE.context
  if (query.length >= MIN_PREFIX && entry.context.some((term) => term.startsWith(query)))
    return SCORE.context + 0.1
  return null
}

/**
 * A multi-word query is an AND over its words, not a phrase.
 *
 * "railway loco pilot" has to reach a post titled "Loco Pilot (Goods /
 * Passenger / Mail)" whose organisation is Railways — the words come from two
 * different fields, so folding the phrase into one skeleton and looking for it
 * finds nothing. Every word has to match SOMETHING, and the score is what the
 * words averaged, with a small handicap so a single exact match still wins.
 *
 * Words of one character are ignored rather than failed: "ACIO II" would
 * otherwise return nothing, because "ii" folds to "i" and a one-character term
 * is not indexed.
 */
function rank<T>(entries: ReadonlyArray<Indexed<T>>, query: string, limit: number): T[] {
  const whole = romanKey(query)
  if (!whole) return entries.slice(0, limit).map((entry) => entry.item)

  const words = query
    .split(/\s+/)
    .map(romanKey)
    .filter((word) => word.length >= MIN_PREFIX)

  const scoreOf = (entry: Indexed<T>): number | null => {
    const asPhrase = scoreEntry(entry, whole)
    if (words.length < 2) return asPhrase

    const perWord = words.map((word) => scoreEntry(entry, word))
    if (!perWord.every((score): score is number => score !== null)) return asPhrase
    const average = perWord.reduce<number>((sum, score) => sum + score, 0) / perWord.length + 0.05
    return asPhrase === null ? average : Math.min(asPhrase, average)
  }

  return entries
    .map((entry) => ({ entry, score: scoreOf(entry) }))
    .filter((hit): hit is { entry: Indexed<T>; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.entry.sortKey.localeCompare(b.entry.sortKey))
    .slice(0, limit)
    .map((hit) => hit.entry.item)
}

/** Split a phrase into folded terms, plus the folded phrase itself. */
function terms(...phrases: Array<string | undefined>): string[] {
  const out = new Set<string>()
  for (const phrase of phrases) {
    if (!phrase) continue
    const whole = romanKey(phrase)
    if (whole) out.add(whole)
    for (const word of phrase.split(/[^\p{L}\p{N}]+/u)) {
      const folded = romanKey(word)
      if (folded.length >= 2) out.add(folded)
    }
  }
  return [...out]
}

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

export interface JobOption {
  job: Job
  organisationId: string
  organisation: Bilingual
  ministry: Bilingual
  exam?: { name: Bilingual; authority: Bilingual; url: string }
}

export interface JobIndex {
  options: JobOption[]
  entries: Array<Indexed<JobOption>>
}

export function buildJobIndex(jobs: Jobs): JobIndex {
  const options: JobOption[] = jobs.jobs.map((job) => {
    const organisation = jobs.organisations[job.organisation]
    const exam = job.recruitment.exam ? jobs.exams[job.recruitment.exam] : undefined
    return {
      job,
      organisationId: job.organisation,
      organisation: organisation?.name ?? { en: job.organisation, hi: job.organisation },
      ministry: organisation?.ministry ?? { en: '', hi: '' },
      ...(exam ? { exam } : {}),
    }
  })

  const entries = options.map((option) => ({
    item: option,
    // The id is indexed segment by segment because that is where the acronyms
    // live: nothing in "Assistant Central Intelligence Officer, Grade-II" says
    // "ACIO", and "ACIO" is what an officer types.
    own: terms(
      option.job.title.en,
      option.job.title.hi,
      option.job.cadre?.en,
      option.job.cadre?.hi,
      option.job.id.split('-').join(' '),
    ),
    context: terms(
      option.organisation.en,
      option.organisation.hi,
      option.organisationId,
      option.ministry.en,
      option.exam?.name.en,
      option.exam?.name.hi,
      option.job.recruitment.exam ?? undefined,
      `level ${option.job.entryLevel}`,
      `l${option.job.entryLevel}`,
      option.job.gradePay ? `gp ${option.job.gradePay}` : undefined,
      option.job.gradePay ? String(option.job.gradePay) : undefined,
    ),
    whole: romanKey(`${option.job.title.en} ${option.job.title.hi}`),
    sortKey: `${option.organisationId}:${option.job.title.en}`,
  }))

  return { options, entries }
}

export function searchJobs(index: JobIndex, query: string, limit = 40): JobOption[] {
  return rank(index.entries, query, limit)
}

export interface JobGroup {
  id: string
  name: Bilingual
  ministry: Bilingual
  jobs: JobOption[]
}

/**
 * Grouped by recruiting body, in the order the organisations are declared —
 * which is roughly the order an officer would look for them, and is stable
 * across renders in a way an alphabetical sort of two languages is not.
 */
export function groupByOrganisation(options: readonly JobOption[]): JobGroup[] {
  const groups = new Map<string, JobGroup>()
  for (const option of options) {
    const existing = groups.get(option.organisationId)
    if (existing) existing.jobs.push(option)
    else
      groups.set(option.organisationId, {
        id: option.organisationId,
        name: option.organisation,
        ministry: option.ministry,
        jobs: [option],
      })
  }
  return [...groups.values()]
}

/* ------------------------------------------------------------------ *
 * Cities
 * ------------------------------------------------------------------ */

export interface CityIndex {
  cities: HraCity[]
  entries: Array<Indexed<HraCity>>
}

export function buildCityIndex(cities: HraCities): CityIndex {
  const entries = cities.cities.map((city) => ({
    item: city,
    // Aliases are the whole point: the annexure spells it Gurgaon and the
    // reader types Gurugram, or the other way round.
    own: terms(city.name.en, city.name.hi, city.id.split('-').join(' '), ...(city.aliases ?? [])),
    context: terms(city.state.en, city.state.hi, city.class),
    whole: romanKey(`${city.name.en} ${city.name.hi} ${(city.aliases ?? []).join(' ')}`),
    sortKey: city.name.en,
  }))
  return { cities: [...cities.cities], entries }
}

export function searchCities(index: CityIndex, query: string, limit = 30): HraCity[] {
  return rank(index.entries, query, limit)
}
