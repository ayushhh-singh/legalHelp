// The LEAF module, never the `@/lib/exam` barrel: the barrel re-exports
// `store.ts` (Dexie), the plan builder and the mock draw, and onboarding sits
// on the initial route's chunk graph. `coverage.ts` on its own is the walk and
// nothing else.
import { actsOf } from '@/lib/exam/coverage'
import type { Job } from '@/modules/pay/schema'
import type { ExamProfile } from '@/schemas/exam'

/**
 * Onboarding step 2's "enable relevant trainer acts" — a starting preset for
 * `TrainerSettings.actsEnabled`, from the post the reader picked. Nothing
 * here is permanent: `/settings/trainer` lets the reader change it in one tap,
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

/**
 * The same hint, taken from the examination the reader has actually chosen.
 *
 * This is the better of the two sources and the difference is not a matter of
 * degree. ADR-044 §8 puts it in one line: *enabling a rule book because of
 * somebody's job is a guess about their work; putting it on a syllabus is a
 * claim about an examination.* `trainerActHintsForJob` above reads an
 * organisation name and infers; a profile's units are read off a gazette-
 * notified recruitment rule whose sha256 is in its own `patternSource`, so the
 * acts come with a citation rather than with an assumption.
 *
 * That is what docs/DATA-GAPS.md #56 was actually stuck on. Its next step asked
 * for a human to classify the remaining thirteen organisations one at a time
 * against the RTI Act's Second Schedule — real work, and work this app is not
 * positioned to do. Where a profile exists the question does not need asking:
 * the syllabus already says which rule books the examination covers.
 *
 * Two things it deliberately keeps from the job version. `[]` still means "make
 * no change" rather than "enable nothing", which matters more here than there —
 * a profile whose units are all `{ external: true }` (`actsOf` skips those)
 * legitimately maps no act at all, and narrowing `actsEnabled` to nothing would
 * leave a reader with a Trainer that shows them no cards. And it stays pure and
 * takes the profile as an ARGUMENT: onboarding sits on the initial route's
 * chunk graph, so a static import of `data/exams` here would put the plan
 * builder and the mock draw on every reader's device (the shape
 * `ExamModeSection.tsx` already uses a dynamic import to avoid). `actsOf` is a
 * pure function over a value that is already in hand at every call site.
 */
export function trainerActHintsForProfile(profile: ExamProfile): TrainerActHint {
  const acts = actsOf(profile)
  if (acts.length === 0) return { acts: [] }

  return {
    acts,
    note: {
      en: 'These rule books are the ones your examination’s own reference list names. Change this any time in Trainer settings.',
      hi: 'ये नियम-पुस्तकें आपकी परीक्षा की अपनी संदर्भ-सूची में नामित हैं। इसे कभी भी अभ्यास सेटिंग्स में बदलें।',
    },
  }
}
