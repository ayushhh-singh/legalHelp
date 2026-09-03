import { PenLine, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useAttempts } from '../useStudy'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { LibraryUnit } from '@/lib/library'
import {
  deleteAttempt,
  FEYNMAN_PROMPTS,
  isSubmittable,
  rateChapterCard,
  saveAttempt,
  scoreAttempt,
  confidenceFromAttempt,
  type Chapter,
  type FeynmanGrade,
  type FeynmanPrompt,
} from '@/lib/study'

/**
 * "Explain it in your own words", then read the rule beside what you wrote and
 * mark yourself.
 *
 * NO AI IS INVOLVED and none is required. What the reader typed is stored
 * exactly as typed and never sent anywhere; the three grades are their own
 * answers to three questions `src/lib/study/feynman.ts` states. Where the AI
 * tier is on, the panel above can add one grounded comment — that is an
 * addition, not the mechanism.
 *
 * The self-grade feeds the chapter revision deck at `reason: 'feynman'`, and
 * `confidenceFromAttempt` deliberately caps that at 3: a quiz is evidence and a
 * self-grade is an opinion, and a reader who wants to tell the deck they know a
 * chapter cold can rate it directly.
 */
interface FeynmanBoxProps {
  workId: string
  unit: LibraryUnit
  /** The chapter this unit sits in, so a self-grade can reach the deck. */
  chapter: Chapter | null
  className?: string
}

type Phase = 'closed' | 'writing' | 'grading'

const EMPTY_GRADES: FeynmanGrade[] = FEYNMAN_PROMPTS.map(() => 'missed')

export function FeynmanBox({ workId, unit, chapter, className }: FeynmanBoxProps) {
  const { t, language } = useT()
  const attempts = useAttempts(workId, unit.id)

  const [phase, setPhase] = useState<Phase>('closed')
  const [body, setBody] = useState('')
  const [grades, setGrades] = useState<FeynmanGrade[]>(EMPTY_GRADES)
  const [saved, setSaved] = useState(false)

  const reset = useCallback(() => {
    setPhase('closed')
    setBody('')
    setGrades(EMPTY_GRADES)
  }, [])

  const save = useCallback(async () => {
    const row = await saveAttempt({ workId, unitId: unit.id, body, grades })
    if (!row) return
    setSaved(true)
    reset()
    // The self-grade reaches the chapter deck, marked as having come from an
    // attempt rather than from a rating the reader gave directly.
    if (chapter) {
      await rateChapterCard({ chapter, confidence: confidenceFromAttempt(grades), reason: 'feynman' })
    }
  }, [body, chapter, grades, reset, unit.id, workId])

  const score = scoreAttempt(grades)

  return (
    <SectionCard className={className} aria-labelledby="feynman-heading">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <PenLine aria-hidden="true" className="h-4 w-4 shrink-0" />
        <h2 id="feynman-heading" className="text-sm font-semibold">
          {t('library.study.feynman.title')}
        </h2>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {phase === 'closed' ? (
          <>
            <p className="text-sm text-muted-foreground">{t('library.study.feynman.intro')}</p>
            <div>
              <Button type="button" onClick={() => setPhase('writing')}>
                {t('library.study.feynman.start')}
              </Button>
            </div>
            {saved ? (
              <p role="status" className="text-sm text-tulsi-foreground">
                {t('library.study.feynman.saved')}
              </p>
            ) : null}
          </>
        ) : null}

        {phase === 'writing' ? (
          <>
            <label htmlFor="feynman-body" className="sr-only">
              {t('library.study.feynman.title')}
            </label>
            <textarea
              id="feynman-body"
              rows={6}
              value={body}
              placeholder={t('library.study.feynman.placeholder')}
              onChange={(event) => setBody(event.target.value)}
              className="w-full rounded-lg border border-input bg-background p-3 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!isSubmittable(body)} onClick={() => setPhase('grading')}>
                {t('library.study.feynman.submit')}
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                {t('library.study.feynman.cancel')}
              </Button>
            </div>
            {!isSubmittable(body) && body.trim().length > 0 ? (
              <p className="text-xs text-muted-foreground">{t('library.study.feynman.tooShort')}</p>
            ) : null}
          </>
        ) : null}

        {phase === 'grading' ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <section aria-label={t('library.study.feynman.yours')}>
                <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
                  {t('library.study.feynman.yours')}
                </h3>
                <p className="rounded-lg border border-border bg-muted p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {body}
                </p>
              </section>
              <section aria-label={t('library.study.feynman.theirs')}>
                <h3 className="mb-1 font-sans text-xs font-semibold text-muted-foreground uppercase">
                  {t('library.study.feynman.theirs')}
                </h3>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-3 text-sm leading-relaxed">
                  {/* The English body, always: no work in this library has a
                      Hindi text layer (ADR-023), and a Hindi reader comparing
                      against an empty pane would be comparing against nothing. */}
                  {(unit.body[language].length > 0 ? unit.body[language] : unit.body.en).map(
                    (paragraph, at) => (
                      <p key={at} className="mb-2 last:mb-0">
                        {paragraph}
                      </p>
                    ),
                  )}
                </div>
              </section>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">
                {t('library.study.feynman.gradeHeading')}
              </legend>
              {FEYNMAN_PROMPTS.map((prompt: FeynmanPrompt, at) => (
                <div key={prompt} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-40 text-sm">{t(`library.study.feynman.prompt.${prompt}`)}</span>
                  <div
                    role="radiogroup"
                    aria-label={t(`library.study.feynman.prompt.${prompt}`)}
                    className="flex gap-1"
                  >
                    {(['missed', 'partial', 'got-it'] as const).map((grade) => (
                      <button
                        key={grade}
                        type="button"
                        role="radio"
                        aria-checked={grades[at] === grade}
                        onClick={() =>
                          setGrades((current) =>
                            current.map((value, index) => (index === at ? grade : value)),
                          )
                        }
                        className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                          grades[at] === grade
                            ? 'border-action bg-action text-action-foreground'
                            : 'border-border hover:border-input'
                        }`}
                      >
                        {t(`library.study.feynman.grade.${grade}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>

            <p className="text-sm">
              <Badge tone="neutral">
                {t('library.study.feynman.score', { points: score.points, max: score.max })}
              </Badge>
              {score.missed.length > 0 ? (
                <span className="ml-2 text-muted-foreground">
                  {t('library.study.feynman.missedNote', {
                    prompts: score.missed
                      .map((prompt) => t(`library.study.feynman.prompt.${prompt}`))
                      .join(', '),
                  })}
                </span>
              ) : null}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()}>
                {t('library.study.feynman.save')}
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                {t('library.study.feynman.cancel')}
              </Button>
            </div>
          </>
        ) : null}

        {phase === 'closed' && attempts && attempts.length > 0 ? (
          <section aria-label={t('library.study.feynman.previous')} className="border-t border-border pt-3">
            <h3 className="mb-2 font-sans text-xs font-semibold text-muted-foreground uppercase">
              {t('library.study.feynman.previous')}
            </h3>
            <ul className="flex flex-col gap-3">
              {attempts.slice(0, 3).map((attempt) => {
                const attemptScore = scoreAttempt(attempt.grades)
                return (
                  <li key={attempt.id} className="rounded-lg border border-border p-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {t('library.study.feynman.attemptOn', { date: attempt.at.slice(0, 10) })}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone="neutral">
                          {t('library.study.feynman.score', {
                            points: attemptScore.points,
                            max: attemptScore.max,
                          })}
                        </Badge>
                        <button
                          type="button"
                          aria-label={t('library.study.feynman.deleteAttempt')}
                          onClick={() => void deleteAttempt(attempt.id)}
                          className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{attempt.body}</p>
                    {attempt.comment ? (
                      <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                        <span className="font-semibold">{t('library.study.feynman.aiComment')}: </span>
                        {attempt.comment}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </SectionCard>
  )
}
