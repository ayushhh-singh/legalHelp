import { describe, expect, it } from 'vitest'

import { citationFor, correspondingRefs, formatCitation, shareText } from './citation'
import type { Bilingual, LawSection } from './types'

/**
 * A citation is the one thing that leaves this app and goes into a file
 * somebody else acts on, so the exact wording is fixed here.
 *
 * The two forms are NOT translations of each other's word order: Hindi puts the
 * Act first and the section second, which is what the Sanhitas themselves do.
 */

const BNS_NAME: Bilingual = { en: 'Bharatiya Nyaya Sanhita, 2023', hi: 'भारतीय न्याय संहिता, 2023' }

function section(overrides: Partial<LawSection> = {}): LawSection {
  return {
    section: '103',
    act: 'BNS',
    heading: { en: 'Punishment for murder.', hi: 'हत्या के लिए दण्ड।' },
    status: 'changed',
    chapter: { number: 'VI', title: { en: '', hi: '' } },
    mappings: [
      {
        clause: '103',
        old: [{ act: 'IPC', section: '302', base: '302', heading: { en: 'Punishment for murder.', hi: '' } }],
        isNewProvision: false,
        changed: true,
      },
    ],
    repeals: ['302'],
    text: { en: '', hi: '' },
    classification: [],
    punishment: { en: '', hi: '' },
    keywords: { en: [], hi: [], roman: [] },
    notes: [],
    sources: ['ncrb-sankalan-table'],
    verify: false,
    ...overrides,
  }
}

describe('formatCitation', () => {
  it('writes the English form exactly as the brief specifies', () => {
    expect(
      formatCitation(
        { actName: BNS_NAME, section: '103(1)', corresponding: [{ act: 'IPC', section: '302' }] },
        'en',
      ),
    ).toBe('Section 103(1) of the Bharatiya Nyaya Sanhita, 2023 (corresponding to Section 302 IPC)')
  })

  it('writes the Hindi form exactly as the brief specifies', () => {
    expect(
      formatCitation(
        { actName: BNS_NAME, section: '103(1)', corresponding: [{ act: 'IPC', section: '302' }] },
        'hi',
      ),
    ).toBe('भारतीय न्याय संहिता, 2023 की धारा 103(1) (भा.दं.सं. की धारा 302 के तत्स्थानी)')
  })

  it('omits the parenthesis entirely when there is no counterpart', () => {
    expect(formatCitation({ actName: BNS_NAME, section: '111' }, 'en')).toBe(
      'Section 111 of the Bharatiya Nyaya Sanhita, 2023',
    )
    expect(formatCitation({ actName: BNS_NAME, section: '111' }, 'hi')).toBe(
      'भारतीय न्याय संहिता, 2023 की धारा 111',
    )
  })

  it('joins several repealed provisions in each language', () => {
    const input = {
      actName: BNS_NAME,
      section: '318',
      corresponding: [
        { act: 'IPC' as const, section: '415' },
        { act: 'IPC' as const, section: '420' },
      ],
    }
    expect(formatCitation(input, 'en')).toContain('Section 415 IPC and Section 420 IPC')
    expect(formatCitation(input, 'hi')).toContain('भा.दं.सं. की धारा 415 तथा भा.दं.सं. की धारा 420')
  })

  it('uses the Rajbhasha abbreviation for each repealed Act', () => {
    for (const [act, abbreviation] of [
      ['IPC', 'भा.दं.सं.'],
      ['CrPC', 'दं.प्र.सं.'],
      ['IEA', 'भा.सा.अ., 1872'],
    ] as const) {
      expect(
        formatCitation({ actName: BNS_NAME, section: '1', corresponding: [{ act, section: '1' }] }, 'hi'),
      ).toContain(abbreviation)
    }
  })

  it('ignores a corresponding reference with no section number', () => {
    expect(
      formatCitation(
        { actName: BNS_NAME, section: '111', corresponding: [{ act: 'IPC', section: '  ' }] },
        'en',
      ),
    ).toBe('Section 111 of the Bharatiya Nyaya Sanhita, 2023')
  })
})

describe('citationFor', () => {
  it('cites the section when given no clause', () => {
    expect(citationFor(section(), BNS_NAME, 'en')).toBe(
      'Section 103 of the Bharatiya Nyaya Sanhita, 2023 (corresponding to Section 302 IPC)',
    )
  })

  it('cites only what a sub-section actually replaced', () => {
    // BNS 318 absorbed four IPC sections; 318(4) is the one that was "420".
    // A citation of 318(4) that named all four would be wrong.
    const bns318 = section({
      section: '318',
      mappings: [
        {
          clause: '318(1)',
          old: [{ act: 'IPC', section: '415', base: '415', heading: { en: 'Cheating.', hi: '' } }],
          isNewProvision: false,
          changed: false,
        },
        {
          clause: '318(4)',
          old: [{ act: 'IPC', section: '420', base: '420', heading: { en: '', hi: '' } }],
          isNewProvision: false,
          changed: false,
        },
      ],
    })

    const citation = citationFor(bns318, BNS_NAME, 'en', '318(4)')
    expect(citation).toContain('Section 318(4)')
    expect(citation).toContain('Section 420 IPC')
    expect(citation).not.toContain('415')
  })

  it('falls back to every counterpart when the clause matches no mapping', () => {
    expect(citationFor(section(), BNS_NAME, 'en', '103(9)')).toContain('Section 302 IPC')
  })

  it('treats a blank clause as no clause', () => {
    expect(citationFor(section(), BNS_NAME, 'en', '   ')).toContain('Section 103 of')
  })
})

describe('correspondingRefs', () => {
  it('de-duplicates a provision that several sub-sections replaced', () => {
    const record = section({
      mappings: [
        {
          clause: '103(1)',
          old: [{ act: 'IPC', section: '302', base: '302', heading: { en: '', hi: '' } }],
          isNewProvision: false,
          changed: false,
        },
        {
          clause: '103(2)',
          old: [{ act: 'IPC', section: '302', base: '302', heading: { en: '', hi: '' } }],
          isNewProvision: false,
          changed: false,
        },
      ],
    })
    expect(correspondingRefs(record)).toEqual([{ act: 'IPC', section: '302' }])
  })
})

describe('shareText', () => {
  const disclaimer: Bilingual = {
    en: 'Reference only; verify with the official gazette/order or your DDO.',
    hi: 'केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।',
  }

  it('carries the disclaimer, because shared text loses the UI around it', () => {
    const text = shareText(section(), BNS_NAME, disclaimer, 'en')
    expect(text).toContain('Section 103 of the Bharatiya Nyaya Sanhita, 2023')
    expect(text).toContain('Punishment for murder.')
    expect(text).toContain(disclaimer.en)
  })

  it('shares in the reader’s language throughout', () => {
    const text = shareText(section(), BNS_NAME, disclaimer, 'hi')
    expect(text).toContain('भारतीय न्याय संहिता, 2023 की धारा 103')
    expect(text).toContain('हत्या के लिए दण्ड।')
    expect(text).toContain(disclaimer.hi)
  })

  it('falls back to the English heading where no Hindi one exists', () => {
    // 965 of 1,059 headings have no Hindi (docs/DATA-GAPS.md #16). A blank line
    // in a shared citation would be worse than an English one.
    const text = shareText(section({ heading: { en: 'Snatching.', hi: '' } }), BNS_NAME, disclaimer, 'hi')
    expect(text).toContain('Snatching.')
  })
})
