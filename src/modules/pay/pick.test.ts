import { describe, expect, it } from 'vitest'

import { buildCityIndex, buildJobIndex, groupByOrganisation, searchCities, searchJobs } from './pick'

import { loadPayTables } from '@/test/payTables'

const tables = loadPayTables()
const jobs = buildJobIndex(tables.jobs)
const cities = buildCityIndex(tables.cities)

const ids = (query: string, limit?: number) => searchJobs(jobs, query, limit).map((option) => option.job.id)

describe('searchJobs', () => {
  it('finds a post by the acronym an officer actually types', () => {
    // Nothing in "Assistant Central Intelligence Officer, Grade-II/Executive"
    // reads "ACIO"; the post id does, which is why the id is indexed segment
    // by segment.
    expect(ids('ACIO')).toEqual(['ib-acio-i-executive', 'ib-acio-ii-executive'])
  })

  it('finds the same post in English, in Hindi and in roman-Hindi', () => {
    expect(ids('Assistant Section Officer')).toContain('aso-css')
    const hindi = tables.jobs.jobs.find((job) => job.id === 'aso-css')?.title.hi ?? ''
    expect(ids(hindi)).toContain('aso-css')
    expect(ids('sahayak anubhag adhikari')).toContain('aso-css')
  })

  it('finds every post of an organisation by its short name', () => {
    expect(ids('CAPF').length).toBeGreaterThanOrEqual(5)
    expect(ids('railways')).toContain('railway-loco-pilot')
  })

  it('finds posts by the exam that recruits to them', () => {
    expect(ids('SSC CGL').length).toBeGreaterThan(0)
    expect(ids('UPSC').length).toBeGreaterThan(0)
  })

  it('reads a multi-word query as an AND over fields, not as a phrase', () => {
    // "Railway" is the organisation and "Loco Pilot" is the title, so folding
    // the phrase into one skeleton and looking for it would find nothing.
    expect(ids('railway loco pilot')[0]).toBe('railway-loco-pilot')
    expect(ids('delhi police constable')[0]).toBe('delhi-police-constable')
    expect(ids('income tax inspector')).toContain('inspector-income-tax')
  })

  it('finds posts by Level and by grade pay', () => {
    expect(ids('level 7').length).toBeGreaterThan(0)
    expect(ids('4600').length).toBeGreaterThan(0)
  })

  it('puts the post whose name IS the query first', () => {
    expect(ids('Tax Assistant')[0]).toBe('tax-assistant')
    expect(ids('Auditor')[0]).toBe('auditor')
  })

  it('returns the whole list for an empty query, so the picker opens full', () => {
    expect(searchJobs(jobs, '', 100)).toHaveLength(tables.jobs.jobs.length)
  })

  it('returns nothing rather than everything for a query that matches nothing', () => {
    expect(ids('zzzzqqq')).toEqual([])
  })

  it('tells an empty box from a query that folded away to nothing', () => {
    // Folding strips punctuation, so "???" reduced to '' and was read as "show
    // me everything" — sixty-one posts presented as though each had matched.
    expect(searchJobs(jobs, '', 100)).toHaveLength(tables.jobs.jobs.length)
    expect(searchJobs(jobs, '   ', 100)).toHaveLength(tables.jobs.jobs.length)
    expect(ids('???')).toEqual([])
    expect(ids('!!! ...')).toEqual([])
  })
})

describe('groupByOrganisation', () => {
  it('groups every post under a body with a name in both languages', () => {
    const groups = groupByOrganisation(jobs.options)
    expect(groups.length).toBe(Object.keys(tables.jobs.organisations).length)
    expect(groups.reduce((sum, group) => sum + group.jobs.length, 0)).toBe(tables.jobs.jobs.length)
    for (const group of groups) {
      expect(group.name.hi.length).toBeGreaterThan(0)
      expect(group.ministry.hi.length).toBeGreaterThan(0)
    }
  })
})

describe('searchCities', () => {
  const cityIds = (query: string) => searchCities(cities, query).map((city) => city.id)

  it('finds a city by the name the annexure does not use', () => {
    expect(cityIds('Gurgaon')[0]).toBe('gurugram')
    expect(cityIds('Bangalore')[0]).toBe('bengaluru')
    expect(cityIds('Poona')[0]).toBe('pune')
  })

  it('finds a city in Hindi and in roman-Hindi', () => {
    expect(cityIds('दिल्ली')).toContain('delhi')
    expect(cityIds('kolkata')).toContain('kolkata')
  })

  it('finds every city of a State', () => {
    expect(cityIds('Kerala').length).toBeGreaterThan(1)
  })
})
