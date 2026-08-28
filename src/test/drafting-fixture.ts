import type { DocTemplate } from '@/modules/drafting/schema'

/**
 * A minimal two-block template, for testing the engine rather than the data.
 *
 * The committed templates are exercised against the real files in
 * `tests/drafting-data.test.ts`; this one exists so a test can ask what the
 * engine does with an empty optional field or an unknown placeholder without
 * editing a document type an officer relies on.
 */
export function fixtureTemplate(overrides: Partial<DocTemplate> = {}): DocTemplate {
  const bl = (en: string, hi: string) => ({ en, hi })

  const template: DocTemplate = {
    id: 'fixture',
    name: bl('Fixture', 'नमूना'),
    shortName: bl('Fixture', 'नमूना'),
    person: 'third',
    usedBy: bl('Tests.', 'परीक्षण।'),
    whenToUse: bl('Never, in production.', 'उत्पादन में कभी नहीं।'),
    salutation: null,
    subscription: null,
    urgencyAllowed: true,
    csmopRef: { edition: 'CSMOP 2022, sixteenth edition', paras: ['8.4(3)'] },
    fields: [
      {
        id: 'fileNumber',
        label: bl('Number', 'संख्या'),
        type: 'text',
        required: true,
        sample: bl('A-1/2026', 'ए-1/2026'),
      },
      {
        id: 'date',
        label: bl('Date', 'दिनांक'),
        type: 'date',
        required: true,
        sample: bl('2026-08-28', '2026-08-28'),
      },
      {
        id: 'subject',
        label: bl('Subject', 'विषय'),
        type: 'text',
        required: false,
        sample: bl('Testing', 'परीक्षण'),
      },
      {
        id: 'urgency',
        label: bl('Urgency', 'तात्कालिकता'),
        type: 'select',
        required: false,
        sample: bl('none', 'none'),
        options: [
          { value: 'none', label: bl('None', 'कोई नहीं') },
          { value: 'immediate', label: bl('IMMEDIATE', 'तत्काल') },
        ],
      },
      {
        id: 'paras',
        label: bl('Body', 'मुख्य भाग'),
        type: 'paras',
        required: true,
        sample: { en: ['First.', 'Second.', 'Third.'], hi: ['पहला।', 'दूसरा।', 'तीसरा।'] },
      },
      {
        id: 'enclosures',
        label: bl('Enclosures', 'संलग्नक'),
        type: 'list',
        required: false,
        sample: { en: [], hi: [] },
      },
    ],
    layout: {
      en: [
        { role: 'urgency', align: 'right', lines: ['{{urgency}}'], omitWhenEmpty: true },
        { role: 'fileNumber', lines: ['No. {{fileNumber}}'] },
        { role: 'dateLine', align: 'right', lines: ['New Delhi, the {{date}}'] },
        { role: 'subject', lines: ['Subject: {{subject}}'], omitWhenEmpty: true },
        { role: 'body', source: 'paras', numbered: true },
        {
          role: 'enclosures',
          source: 'enclosures',
          lead: 'List of enclosures:',
          itemPrefix: 'ordinal',
          omitWhenEmpty: true,
        },
      ],
      hi: [
        { role: 'urgency', align: 'right', lines: ['{{urgency}}'], omitWhenEmpty: true },
        { role: 'fileNumber', lines: ['संख्या {{fileNumber}}'] },
        { role: 'dateLine', align: 'right', lines: ['नई दिल्ली, दिनांक {{date}}'] },
        { role: 'subject', lines: ['विषय : {{subject}}'], omitWhenEmpty: true },
        { role: 'body', source: 'paras', numbered: true },
        {
          role: 'enclosures',
          source: 'enclosures',
          lead: 'संलग्नकों की सूची :',
          itemPrefix: 'ordinal',
          omitWhenEmpty: true,
        },
      ],
    },
    checklist: [
      {
        id: 'no-placeholders',
        label: bl('No placeholder left', 'कोई प्लेसहोल्डर नहीं छूटा'),
        why: bl('Because.', 'क्योंकि।'),
        severity: 'must',
        rule: { kind: 'noPlaceholders' },
      },
    ],
    source: { name: 'Fixture', url: 'https://example.invalid/fixture' },
    fetchedAt: '2026-08-28T00:00:00Z',
    verify: true,
  }

  return { ...template, ...overrides }
}
