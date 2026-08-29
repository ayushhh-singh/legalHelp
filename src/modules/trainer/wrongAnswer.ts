/**
 * Which recorded wrong answer, if any, belongs to the card currently on
 * screen in `ReviewPage`.
 *
 * `qId` alone is not a stable instance key: a card graded `Again` comes
 * straight back into the queue a minute later (`ReviewPage`'s own docstring),
 * and grading always rewrites `srsCards.due` for the card just graded. So a
 * record is "active" only when BOTH the id and the `due` it was captured
 * against still match the card on screen — a due that has moved on means the
 * reader is looking at a fresh, unanswered presentation of the same card, not
 * the one the record was about.
 */

export interface WrongAnswerRecord {
  qId: string
  due: string | null
  picked: string
  correctText: string
}

export interface CurrentCard {
  qId: string
  srs: { due: string } | null
}

export function activeWrongAnswerFor(
  wrongAnswer: WrongAnswerRecord | null,
  current: CurrentCard | null,
): WrongAnswerRecord | null {
  if (!wrongAnswer || !current) return null
  return wrongAnswer.qId === current.qId && wrongAnswer.due === (current.srs?.due ?? null) ? wrongAnswer : null
}
