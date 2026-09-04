import { beforeEach, describe, expect, it } from 'vitest'

import { createDocumentFromIntake } from './newReply'
import { saveIntake, getIntake, listIntakes, linkReply, deleteIntake } from './intakeStore'
import { recordIntake, recordIssuedNumber, listEntries } from '../register/registerStore'

import { clearAllData, db } from '@/db'
import { analyseIntake } from '@/lib/drafting/intake'
import { evaluateChecklist } from '@/lib/drafting/checklist'
import { renderOfficialDoc } from '@/lib/drafting/renderDoc'
import { threadOf } from '@/lib/drafting/register'
import { loadTemplate } from '../data'
import { INTAKE_LETTERS } from '../../../../tests/fixtures/drafting/intake'

/**
 * The reply flow end to end, without a browser: read a letter, keep it, draft
 * the reply, issue a number, and find the two joined in one thread.
 *
 * The assertion that matters most is the last one in "the reply document": a
 * reply built by hand rather than through `createDocument` would miss
 * `signatureFromProfile`, and `checklist.ts`'s `signature-block` rule is a
 * `must` — so the officer would meet an export gate on a rule they never
 * touched. Session 30 flagged exactly that, and this is what checks it.
 */

const AT = '2026-09-04T10:00:00.000Z'

beforeEach(async () => {
  await clearAllData()
})

describe('the reply document', () => {
  it('carries the letter’s subject, reference and addressee', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const doc = await createDocumentFromIntake({
      templateId: 'office-memorandum',
      analysis,
      intakeId: null,
      at: AT,
      language: 'en',
    })

    expect(doc.meta.subject.en).toMatch(/^Reply — Grant of Children Education Allowance/)
    expect(doc.meta.subject.hi).toMatch(/^उत्तर — /)
    expect(doc.meta.referenceLines[0]?.number).toBe('A-11011/4/2026-Estt.(Allowances)')
    expect(doc.meta.referenceLines[0]?.date).toBe('2026-08-12')
    expect(doc.meta.to[0]?.address.join(' ')).toMatch(/Under Secretary/)
  })

  it('does NOT copy the letter’s urgency onto the reply', async () => {
    // A grading is a claim about how urgently the RECIPIENT should act, and the
    // sender of the reply is the one making it. Copying it would have the app
    // grade an officer's own communication Top Priority because somebody else
    // did — and it prints at the top of a signed document.
    const analysis = analyseIntake(INTAKE_LETTERS.hindiOm)
    expect(analysis.urgency).toBe('topPriority')

    const doc = await createDocumentFromIntake({
      templateId: 'office-memorandum',
      analysis,
      intakeId: null,
      at: AT,
      language: 'en',
    })
    expect(doc.meta.urgency).toBe('none')
  })

  it('goes through the profile, so the signature block is complete', async () => {
    /*
      The one that would have bitten. `checklist.ts`'s `signature-block` rule is
      a `must` wanting the name, the designation, the telephone and the e-mail,
      and the export gate refuses a failing `must`. A reply assembled by hand
      would fail it with nothing on screen explaining why.
    */
    const at = AT
    await db.draftingProfile.put({
      id: 'profile',
      updatedAt: at,
      name: { en: 'R. K. Sharma', hi: 'र. क. शर्मा' },
      designation: { en: 'Under Secretary', hi: 'अवर सचिव' },
      office: { en: 'North Block', hi: 'नॉर्थ ब्लॉक' },
      section: { en: 'Establishment Section', hi: 'स्थापना अनुभाग' },
      ministry: { en: 'Ministry of Personnel', hi: 'कार्मिक मंत्रालय' },
      department: { en: 'DoPT', hi: 'कार्मिक और प्रशिक्षण विभाग' },
      addressLines: [],
      phone: '011-2309 4444',
      email: 'us-estt@gov.in',
      place: 'New Delhi',
      letterhead: [],
      signatureLayout: 'right',
      signatureShowSd: true,
      defaultLanguage: 'en',
      defaultUrgency: 'none',
      defaultCopyTo: [],
    })
    /*
      Note the shape: `addressLines` and `section` are required by
      `draftingProfileSchema`, and `readProfile` falls back to `emptyProfile`
      on a row that does not parse rather than throwing. The first version of
      this fixture used `address` and omitted `section`, so the profile came
      back EMPTY and the assertion below failed with "expected '' to be
      'R. K. Sharma'" — which reads like the reply flow ignoring the profile
      rather than like a malformed fixture.
    */

    const doc = await createDocumentFromIntake({
      templateId: 'office-memorandum',
      analysis: analyseIntake(INTAKE_LETTERS.englishOm),
      intakeId: null,
      at,
      language: 'en',
    })

    expect(doc.meta.signature.name.en).toBe('R. K. Sharma')
    expect(doc.meta.signature.designation.en).toBe('Under Secretary')
    expect(doc.meta.signature.phone).toBe('011-2309 4444')
    expect(doc.meta.signature.email).toBe('us-estt@gov.in')

    const template = await loadTemplate('office-memorandum')
    const checklist = evaluateChecklist(template, renderOfficialDoc(doc, template, 'en'))
    const signature = checklist.find((item) => item.id === 'signature-block')
    expect(signature?.passed).toBe(true)
  })

  it('links to the letter it answers', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const intake = await saveIntake({ text: INTAKE_LETTERS.englishOm, analysis, at: AT })
    const doc = await createDocumentFromIntake({
      templateId: 'office-memorandum',
      analysis,
      intakeId: intake.id,
      at: AT,
      language: 'en',
    })
    expect(doc.linkedIntakeId).toBe(intake.id)
    expect(doc.threadId).toBe(intake.id)

    await linkReply(intake.id, doc.id, AT)
    expect((await getIntake(intake.id))?.replyDocId).toBe(doc.id)
  })
})

describe('the whole flow', () => {
  it('joins the letter and the reply into one thread in the register', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.englishOm)
    const intake = await saveIntake({ text: INTAKE_LETTERS.englishOm, analysis, at: AT })
    const inbound = await recordIntake({
      intakeId: intake.id,
      number: intake.number,
      date: intake.date,
      receivedOn: '2026-08-14',
      subject: intake.subject,
      at: AT,
    })

    const doc = await createDocumentFromIntake({
      templateId: 'office-memorandum',
      analysis,
      intakeId: intake.id,
      at: AT,
      language: 'en',
    })
    const outbound = await recordIssuedNumber({
      docId: doc.id,
      number: 'B-1/2026-Estt.',
      date: '04.09.2026',
      subject: doc.meta.subject.en,
      at: '2026-09-04T11:00:00.000Z',
      intakeId: intake.id,
      inReplyTo: inbound.id,
    })

    const thread = threadOf(await listEntries(), outbound.id)
    expect(thread.map((entry) => entry.direction)).toEqual(['received', 'sent'])
    expect(thread[0]?.intakeId).toBe(intake.id)
    expect(thread[1]?.docId).toBe(doc.id)
  })
})

describe('the letter itself', () => {
  it('is not stored until it is kept', async () => {
    // The reply screen holds the letter in component state and writes nothing.
    // The e2e spec asserts it through the real screen; this is the store's half.
    expect(await listIntakes()).toEqual([])
  })

  it('keeps the officer’s corrections rather than re-reading the letter', async () => {
    const analysis = analyseIntake(INTAKE_LETTERS.noNumber)
    // The extractor found no number, correctly. The officer types one.
    const corrected = {
      ...analysis,
      meta: { ...analysis.meta, number: 'C-9/2026-Admn.' },
    }
    const saved = await saveIntake({ text: INTAKE_LETTERS.noNumber, analysis: corrected, at: AT })
    expect(saved.number).toBe('C-9/2026-Admn.')

    const read = await getIntake(saved.id)
    expect(read?.analysis.meta.number).toBe('C-9/2026-Admn.')
  })

  it('rebuilds an analysis it cannot read rather than losing the letter', async () => {
    // The opposite direction from `readDoc`'s refusal, deliberately: the letter
    // is stored verbatim and is the thing of value, so a re-read costs the
    // officer their chip corrections and nothing else. Dropping the row would
    // lose the letter.
    await db.intakes.put({
      id: 'in-broken',
      text: INTAKE_LETTERS.englishOm,
      subject: 'Something',
      number: '',
      date: '',
      receivedOn: '',
      createdAt: AT,
      updatedAt: AT,
      analysis: { written: 'by a later build' },
    })
    const read = await getIntake('in-broken')
    expect(read?.analysis.meta.number).toBe('A-11011/4/2026-Estt.(Allowances)')
  })

  it('hands back what was deleted, so an undo can put it back', async () => {
    const saved = await saveIntake({
      text: INTAKE_LETTERS.englishOm,
      analysis: analyseIntake(INTAKE_LETTERS.englishOm),
      at: AT,
    })
    const deleted = await deleteIntake(saved.id)
    expect(deleted?.id).toBe(saved.id)
    expect(await listIntakes()).toEqual([])
  })
})
