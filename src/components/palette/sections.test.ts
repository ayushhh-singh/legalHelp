import { describe, expect, it } from 'vitest'

import { draftingItems, portalItems, trainerTopicItems } from './sections'

import type { DraftingIndex } from '@/modules/drafting/schema'
import type { RulesIndex } from '@/modules/trainer/schema'
import type { PortalsDataset } from '@/modules/utils/portals/schema'

/**
 * Law, Job posts and Glossary all reuse their module's own, already-tested
 * search engine (`searchLaw`, `searchJobs`, `searchGlossary`) — see those
 * modules' own suites. Document types, Trainer topics and Portals have no
 * reusable search of their own, so the small matcher this file writes for
 * each is what needs its own coverage.
 */

const DRAFTING_INDEX: DraftingIndex = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  templates: [
    {
      id: 'office-memorandum',
      name: { en: 'Office Memorandum (O.M.)', hi: 'कार्यालय ज्ञापन' },
      shortName: { en: 'O.M.', hi: 'का.ज्ञा.' },
      useWhen: { en: 'Everyday business between Departments.', hi: 'विभागों के बीच रोज़मर्रा का कामकाज।' },
      group: 'communication',
      person: 'third',
      csmopParas: ['8.4(3)'],
      verify: false,
    },
    {
      id: 'demi-official',
      name: { en: 'Demi-official letter (D.O.)', hi: 'अर्ध-सरकारी पत्र (डी.ओ.)' },
      shortName: { en: 'D.O. letter', hi: 'अ.स. पत्र' },
      useWhen: { en: 'One officer to another.', hi: 'एक अधिकारी से दूसरे को।' },
      group: 'communication',
      person: 'first',
      csmopParas: ['8.4(2)'],
      verify: false,
    },
  ],
}

const RULES_INDEX: RulesIndex = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  totals: { rules: 1, cards: 1, served: 1, byKind: {} },
  acts: [
    {
      id: 'ccs-conduct',
      name: {
        en: 'Central Civil Services (Conduct) Rules, 1964',
        hi: 'केंद्रीय सिविल सेवा (आचरण) नियम, 1964',
      },
      short: { en: 'CCS (Conduct)', hi: 'सीसीएस (आचरण)' },
      unit: { en: 'Rule', hi: 'नियम' },
      publisher: 'DoPT',
      text: 'text/ccs-conduct.json',
      cards: 'cards/ccs-conduct.json',
      counts: { rules: 1, cards: 1, served: 1, byKind: {} },
      source: { name: 'DoPT', url: 'https://dopt.gov.in/x' },
    },
    {
      id: 'rti',
      name: { en: 'Right to Information Act, 2005', hi: 'सूचना का अधिकार अधिनियम, 2005' },
      short: { en: 'RTI Act', hi: 'आरटीआई अधिनियम' },
      unit: { en: 'Section', hi: 'धारा' },
      publisher: 'DoPT',
      text: 'text/rti.json',
      cards: 'cards/rti.json',
      counts: { rules: 1, cards: 1, served: 1, byKind: {} },
      source: { name: 'DoPT', url: 'https://dopt.gov.in/y' },
    },
  ],
}

const PORTALS: PortalsDataset = {
  version: '1.0.0',
  generatedAt: '2026-08-28T00:00:00Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ के लिए।' },
  portals: [
    {
      id: 'ehrms',
      name: { en: 'e-HRMS', hi: 'ई-एचआरएमएस' },
      shortName: { en: 'e-HRMS', hi: 'ई-एचआरएमएस' },
      purpose: {
        en: 'Human resource management for central government employees.',
        hi: 'केंद्र सरकार कर्मचारियों के लिए मानव संसाधन प्रबंधन।',
      },
      url: 'https://ehrms.gov.in',
      category: 'hr-service',
      helpline: null,
      administeredBy: { en: 'DoPT', hi: 'कार्मिक विभाग' },
      verify: true,
    },
  ],
}

describe('draftingItems', () => {
  it('matches a document type by an acronym its own shortName never spells letter-for-letter', () => {
    const items = draftingItems(DRAFTING_INDEX, 'OM')
    expect(items[0]?.id).toBe('draft:office-memorandum')
  })

  it('matches by English name and by Hindi name', () => {
    expect(draftingItems(DRAFTING_INDEX, 'memorandum')[0]?.id).toBe('draft:office-memorandum')
    expect(draftingItems(DRAFTING_INDEX, 'कार्यालय ज्ञापन')[0]?.id).toBe('draft:office-memorandum')
  })

  it('returns nothing for an empty query', () => {
    expect(draftingItems(DRAFTING_INDEX, '   ')).toEqual([])
  })
})

describe('trainerTopicItems', () => {
  it('matches an act by its short English name', () => {
    const items = trainerTopicItems(RULES_INDEX, 'conduct')
    expect(items[0]?.id).toBe('trainer:ccs-conduct')
  })

  it('matches an act by its own Hindi name', () => {
    const items = trainerTopicItems(RULES_INDEX, 'सूचना का अधिकार')
    expect(items[0]?.id).toBe('trainer:rti')
  })
})

describe('portalItems', () => {
  it('matches a portal by its purpose text', () => {
    const items = portalItems(PORTALS, 'human resource')
    expect(items[0]?.id).toBe('portal:ehrms')
  })

  it('points at the portals page with the portal’s own name prefilled', () => {
    const items = portalItems(PORTALS, 'e-HRMS')
    expect(items[0]?.to).toBe('/utils/portals?q=e-HRMS')
  })
})
