import { describe, expect, it } from 'vitest'

import { isAnalyticalQuery, isPersonalQuery, normaliseQuestion } from './heuristics'

describe('isPersonalQuery', () => {
  it.each([
    'What is my leave balance?',
    'How much will I get after the increment?',
    'Can I carry forward earned leave?',
    'मेरा वेतन कितना होगा?',
    'मुझे कितनी छुट्टी मिलेगी?',
    'अपनी पेंशन कैसे देखें?',
  ])('treats %j as personal', (question) => {
    expect(isPersonalQuery(question)).toBe(true)
  })

  it.each([
    'What is the DA rate from January 2026?',
    'Which BNS section replaces IPC 302?',
    'CCS Conduct Rules में आचरण नियम 18 क्या कहता है?',
    'Level 7 cell 1 basic pay',
  ])('treats %j as general', (question) => {
    expect(isPersonalQuery(question)).toBe(false)
  })

  it('does not read the roman numeral I as first person', () => {
    // "Annexure I" and "Level I" appear constantly in this domain.
    expect(isPersonalQuery('Annexure I of the CSMOP')).toBe(false)
  })

  it.each([
    'Give me the DA rate from January 2026',
    'Show me the gazetted holiday list',
    'Tell me which BNS section replaces IPC 302',
  ])('does not read the "give me" of an ordinary request as personal: %j', (question) => {
    // A false positive here is not free: it excludes a large share of ordinary
    // lookups from the answer cache, which is what keeps a BYOK bill down.
    expect(isPersonalQuery(question)).toBe(false)
  })

  it.each(['Calculate the arrears for me', 'What does this rule mean for me?'])(
    'still reads a dative "me" as personal: %j',
    (question) => {
      expect(isPersonalQuery(question)).toBe(true)
    },
  )
})

describe('isAnalyticalQuery', () => {
  it.each([
    'Compare NPS and UPS for a Level 7 officer',
    'Why does HRA drop in a Y-class city?',
    'What is the difference between CCA and CCS rules?',
    'NPS और UPS में क्या अंतर है?',
    'यह नियम क्यों लागू होता है?',
    'इसे समझाइए',
  ])('treats %j as analytical', (question) => {
    expect(isAnalyticalQuery(question)).toBe(true)
  })

  it.each(['Level 7 cell 1 basic pay', 'IPC 302', 'गजटेड अवकाश की सूची'])(
    'treats %j as a lookup',
    (question) => {
      expect(isAnalyticalQuery(question)).toBe(false)
    },
  )
})

describe('normaliseQuestion', () => {
  it('folds case, punctuation and the danda', () => {
    expect(normaliseQuestion('  IPC 302 — what is it?  ')).toBe('ipc 302 what is it')
    expect(normaliseQuestion('धारा 302 क्या है।')).toBe('धारा 302 क्या है')
  })

  it('keeps digits, because a level number is the whole question', () => {
    expect(normaliseQuestion('Level 7')).not.toBe(normaliseQuestion('Level 8'))
  })
})
