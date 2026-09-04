import { totalDurationMinutes } from './types'

import type { ExamProfile } from '@/schemas/exam'

/**
 * The exam-day checklist.
 *
 * Items as DATA, never as copy. Each is an id and its parameters; the i18n
 * catalogue carries the sentence, so the list reads in either language and a
 * change of wording is not a change to this file — the arrangement
 * `readiness.ts#NextAction` uses for the same reason.
 *
 * **Every item is something the fetched notification actually says.** Not
 * general exam advice, and not a guess about what a centre will allow: the
 * prohibited-articles item is clause 7(xii) of the Rules, the medium item is
 * paragraph 5 of the Appendix, the numerals item is paragraph 12, the
 * handwriting deduction is paragraph 10, and "appearance in all three papers is
 * a must" is paragraph 8. An item this app cannot source is not on the list,
 * because a checklist a candidate follows on the morning of an examination is
 * the worst place in this app to be confidently wrong.
 *
 * Items are conditional on the profile where the notification makes them so —
 * the negative-marking reminder is omitted from a profile whose papers carry no
 * penalty, rather than warning about a rule that does not apply.
 */

export type ChecklistGroup = 'before' | 'carry' | 'inside'

export interface ChecklistItem {
  id: string
  group: ChecklistGroup
  /** Values the i18n sentence interpolates. Empty where it needs none. */
  params: Record<string, string | number>
}

const item = (
  id: string,
  group: ChecklistGroup,
  params: Record<string, string | number> = {},
): ChecklistItem => ({ id, group, params })

/**
 * The list for one profile, in the order a candidate meets it: the night
 * before, then what to take, then what happens in the hall.
 */
export function checklistFor(profile: ExamProfile): ChecklistItem[] {
  const items: ChecklistItem[] = [
    // Clause 6: "No candidate will be admitted to the examination unless he
    // holds certificate of admission from the Commission."
    item('admission-certificate', 'carry'),
    item('photo-id', 'carry'),
    // Clause 7(xii): mobile phone "(even in switched off mode)", pager,
    // electronic equipment, programmable device, storage media, smart watches,
    // camera, Bluetooth devices — "either in working or switched off mode".
    item('prohibited-articles', 'carry'),
    // Appendix paragraph 8: "Appearance of candidates in all the three papers
    // is a must for qualifying in the examination."
    item('all-papers', 'before', { papers: profile.papers.length }),
    // `totalDurationMinutes`, not a second `reduce` over the same field — the
    // caller-sweep found this file quietly reimplementing it.
    item('venue-and-time', 'before', { minutes: totalDurationMinutes(profile) }),
  ]

  // Appendix paragraph 5 and its Notes: the option to answer the subjective
  // paper in Hindi is exercised on the application form and is FINAL, and a
  // paper written in the other medium is not evaluated at all. That is the
  // single most expensive thing on this list to get wrong, so it is only shown
  // where the profile actually has a subjective paper.
  const subjective = profile.papers.filter((paper) => !paper.objective)
  if (subjective.length > 0) {
    items.push(item('medium-is-final', 'before', { paper: subjective[0]!.id }))
    // Appendix paragraph 12: international numerals in the subjective paper.
    items.push(item('international-numerals', 'inside'))
    // Appendix paragraph 10: up to 5% of the maximum marks deducted for
    // illegible handwriting; paragraph 7: no scribe.
    items.push(item('legible-handwriting', 'inside'))
  }

  const penalised = profile.papers.filter((paper) => paper.negativeMarking !== undefined)
  if (penalised.length > 0) {
    const rate = penalised[0]!.negativeMarking ?? 0
    items.push(
      item('negative-marking', 'inside', {
        // As a "1 in N" rather than as 0.3333, which is what a candidate
        // deciding whether to guess actually reasons in.
        oneIn: Math.round(1 / rate),
        papers: penalised.length,
      }),
    )
    // The corollary, and the one worth saying out loud because it is the rule
    // an implementation and a candidate both get wrong: a blank costs nothing.
    items.push(item('blank-costs-nothing', 'inside'))
  }

  items.push(item('confirm-circular', 'before'))
  return items
}

export const CHECKLIST_GROUPS: readonly ChecklistGroup[] = ['before', 'carry', 'inside']
