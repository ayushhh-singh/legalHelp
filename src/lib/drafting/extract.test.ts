import { describe, expect, it } from 'vitest'

import { emptyExtractedMeta, extractMeta, findDate, findNumber } from './extract'

/**
 * The first-page extractor.
 *
 * The rule every case here is written against: **it never invents.** A field it
 * cannot find comes back empty with `confidence: 'none'`, and a field it found
 * without a label comes back `low` so the screen can say "please check". An
 * officer correcting a wrong file number they did not type is worse off than
 * one typing it.
 *
 * Session 31 reuses this over inbound paper, which is why it takes text rather
 * than a body — and why the Hindi cases are here rather than left for later.
 */

const OM = `No. A-11011/2/2026-Estt.(Allowances)
Government of India
Ministry of Personnel, Public Grievances and Pensions
Department of Personnel and Training

New Delhi, dated the 3rd September 2026

OFFICE MEMORANDUM

To
The Under Secretary
Department of Expenditure
North Block, New Delhi

Subject: Grant of Children Education Allowance in respect of a child studying
in a recognised institution — clarification regarding.

Sir,

With reference to your letter No. 12/2/2023-JCA dated 12.05.2026 on the subject
cited above, the undersigned is directed to say that the matter has been examined.`

describe('findDate', () => {
  it('reads the shapes a Government order actually prints', () => {
    expect(findDate('dated 12.05.2026')?.iso).toBe('2026-05-12')
    expect(findDate('12/05/2026')?.iso).toBe('2026-05-12')
    expect(findDate('12-05-2026')?.iso).toBe('2026-05-12')
    expect(findDate('dated the 3rd September 2026')?.iso).toBe('2026-09-03')
    expect(findDate('September 3, 2026')?.iso).toBe('2026-09-03')
  })

  it('reads a Hindi date, in Devanagari digits and with a Hindi month name', () => {
    expect(findDate('दिनांक ०३.०९.२०२६')?.iso).toBe('2026-09-03')
    expect(findDate('3 सितम्बर 2026')?.iso).toBe('2026-09-03')
    expect(findDate('3 सितंबर 2026')?.iso).toBe('2026-09-03')
  })

  it('is day-first and never guesses the other way', () => {
    // Every Government of India order prints day-first. A rule that tried to
    // guess would read this as 2 January on some documents and 1 February on
    // others, with nothing on the page to say which.
    expect(findDate('01.02.2026')?.iso).toBe('2026-02-01')
  })

  it('refuses a day that does not exist', () => {
    expect(findDate('31.02.2026')).toBeNull()
    expect(findDate('32.01.2026')).toBeNull()
  })

  it('refuses a word that is not a month', () => {
    expect(findDate('3 Fructidor 2026')).toBeNull()
  })

  it('finds nothing where there is nothing', () => {
    expect(findDate('A-11011/2/2026-Estt.')).toBeNull()
  })
})

describe('findNumber', () => {
  it('believes a labelled number', () => {
    expect(findNumber('No. A-11011/2/2026-Estt.(Allowances)')).toEqual({
      value: 'A-11011/2/2026-Estt.(Allowances)',
      confidence: 'high',
    })
    expect(findNumber('F.No. 12/2/2023-JCA')?.confidence).toBe('high')
    expect(findNumber('फा.सं. 1(3)/2026-E.II(B)')?.confidence).toBe('high')
  })

  it('takes an unlabelled one, and says it is a guess', () => {
    expect(findNumber('A-11011/2/2026-Estt.')).toEqual({
      value: 'A-11011/2/2026-Estt.',
      confidence: 'low',
    })
  })

  it('keeps a trailing full stop, because `Estt.` is an abbreviation', () => {
    // Every second file number in this corpus ends in one. Trimming it would
    // quietly shorten the field a document is filed under.
    expect(findNumber('No. A-11011/2/2026-Estt.')?.value).toBe('A-11011/2/2026-Estt.')
    expect(findNumber('No. 12/2/2023-JCA,')?.value).toBe('12/2/2023-JCA')
  })

  it('never mistakes a date for a file number', () => {
    expect(findNumber('12/05/2026')).toBeNull()
    expect(findNumber('dated 12.05.2026')).toBeNull()
  })

  it('finds nothing in a line with no slash in it', () => {
    expect(findNumber('Government of India')).toBeNull()
  })
})

describe('extractMeta', () => {
  const meta = extractMeta(OM)

  it('reads the file number and knows it was labelled', () => {
    expect(meta.number).toBe('A-11011/2/2026-Estt.(Allowances)')
    expect(meta.confidence.number).toBe('high')
  })

  it('takes the document own date, not the date of the letter it answers', () => {
    // "your letter … dated 12.05.2026" is a reference. The document's date is
    // the one on the top right.
    expect(meta.dateIso).toBe('2026-09-03')
  })

  it('reads a subject that runs onto a second line', () => {
    expect(meta.subject).toBe(
      'Grant of Children Education Allowance in respect of a child studying in a recognised institution — clarification regarding',
    )
    expect(meta.confidence.subject).toBe('high')
  })

  it('reads the addressee block and stops at the subject', () => {
    expect(meta.to).toEqual(['The Under Secretary', 'Department of Expenditure', 'North Block, New Delhi'])
  })

  it('finds the reference to the communication being answered', () => {
    expect(meta.reference).toContain('12/2/2023-JCA')
    expect(meta.confidence.reference).toBe('high')
  })

  it('reads a Hindi document the same way', () => {
    const hindi = extractMeta(`संख्या क-11011/2/2026-स्था.
भारत सरकार
कार्मिक और प्रशिक्षण विभाग

नई दिल्ली, दिनांक 03.09.2026

सेवा में
अवर सचिव
व्यय विभाग

विषय: बाल शिक्षा भत्ता की प्रतिपूर्ति के संबंध में।

महोदय,`)
    expect(hindi.number).toBe('क-11011/2/2026-स्था.')
    expect(hindi.dateIso).toBe('2026-09-03')
    expect(hindi.subject).toBe('बाल शिक्षा भत्ता की प्रतिपूर्ति के संबंध में')
    expect(hindi.to).toEqual(['अवर सचिव', 'व्यय विभाग'])
  })

  it('invents nothing when the page says nothing', () => {
    const nothing = extractMeta('Just a paragraph of prose with no chrome at all.')
    expect(nothing).toEqual(emptyExtractedMeta())
  })

  it('reads only the first page, however long the document is', () => {
    // A file number two hundred lines down is a paragraph quoting somebody
    // else's file, not this document's own number.
    const long = `${'filler\n'.repeat(60)}No. Z-9/2026-Buried`
    expect(extractMeta(long).number).toBe('')
  })

  it('does not fall over on an empty string', () => {
    expect(() => extractMeta('')).not.toThrow()
    expect(extractMeta('').confidence.number).toBe('none')
  })

  it('takes a labelled date over an earlier unlabelled one', () => {
    const text = 'Some line with 01.01.2026 in it\nDated: 05.02.2026'
    expect(extractMeta(text).dateIso).toBe('2026-02-05')
    expect(extractMeta(text).confidence.date).toBe('high')
  })

  it('reports an unlabelled date as a guess', () => {
    expect(extractMeta('01.01.2026\nsomething else').confidence.date).toBe('low')
  })
})
