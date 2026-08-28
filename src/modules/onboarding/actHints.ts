import type { Job } from '@/modules/pay/schema'

/**
 * Onboarding step 2's "enable relevant trainer acts" — a starting preset for
 * `TrainerSettings.actsEnabled`, from the post the reader picked. Nothing
 * here is permanent: `/learn/settings` lets the reader change it in one tap,
 * and the note this returns says so.
 *
 * `actsEnabled: []` means "every rule book" (`src/lib/srs/types.ts`'s own
 * default), so an empty `acts` here is read by the caller as "make no
 * change" rather than "enable nothing" — most posts get the ordinary,
 * unrestricted Trainer a fresh install would give them anyway. Only
 * organisations whose work is self-evidently about intelligence,
 * investigation or classified material get a narrower starting set, and even
 * then it names only two rule books, not "everything except". This is
 * deliberately conservative rather than an exhaustive classification of all
 * twenty-two organisations in `data/pay/jobs.json` against, say, the RTI
 * Act's Second Schedule — that is a real legal question this app is not
 * positioned to answer for every post, and a wrong "your organisation is
 * exempt from X" is worse than saying nothing. The RTI s.24 note is added
 * only for the two organisations named in that Second Schedule beyond any
 * reasonable dispute (Intelligence Bureau, National Investigation Agency) —
 * the brief's own worked example.
 */

const INTELLIGENCE_AND_ENFORCEMENT = new Set([
  'ib',
  'nia',
  'cbi',
  'ncb',
  'ed',
  'capf',
  'delhi-police',
  'mod-civ',
  'drdo',
])

const RTI_SECOND_SCHEDULE_NOTE = new Set(['ib', 'nia'])

export interface TrainerActHint {
  /** `[]` means "make no change" — leave `actsEnabled` at its default of every rule book. */
  acts: string[]
  note?: { en: string; hi: string }
}

export function trainerActHintsForJob(job: Pick<Job, 'organisation'>): TrainerActHint {
  if (!INTELLIGENCE_AND_ENFORCEMENT.has(job.organisation)) return { acts: [] }

  const acts = ['ccs-conduct', 'osa']

  if (!RTI_SECOND_SCHEDULE_NOTE.has(job.organisation)) {
    return { acts }
  }

  return {
    acts,
    note: {
      en: 'Your organisation is named in the RTI Act’s Second Schedule, which exempts it from some proactive-disclosure duties — turned on Official Secrets Act cards as well. Change this any time in Trainer settings.',
      hi: 'आपके संगठन का नाम आरटीआई अधिनियम की दूसरी अनुसूची में है, इसलिए शासकीय गुप्त बात अधिनियम के कार्ड भी जोड़ दिए गए हैं। इसे कभी भी अभ्यास सेटिंग्स में बदलें।',
    },
  }
}
