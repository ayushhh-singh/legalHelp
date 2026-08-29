import { Bookmark, Check, ExternalLink, Flag, Languages, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { intervalLabel } from '../intervalLabel'

import { Chip, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { createCard, GRADES, previewGrades, type Grade, type SrsCardRow } from '@/lib/srs'
import { cn } from '@/lib/utils'

import type { Card } from '../schema'

const GRADE_TONE: Record<Grade, string> = {
  Again: 'border-coral text-coral-foreground hover:bg-coral/10',
  Hard: 'border-marigold text-marigold-foreground hover:bg-marigold/10',
  Good: 'border-tulsi text-tulsi-foreground hover:bg-tulsi/10',
  Easy: 'border-action text-foreground hover:bg-accent',
}

interface CardViewProps {
  card: Card
  language: Language
  srsRow: SrsCardRow | null
  now: Date
  desiredRetention: number
  bookmarked: boolean
  onGrade: (grade: Grade, durationMs: number) => void
  onToggleBookmark: () => void
  onReport: () => void
  /** Hidden during a mock test: no explanation, no grade preview, no bookmark/report. */
  mode?: 'review' | 'mock'
  /** Mock test only — the reader's raw pick, reported without grading. */
  onAnswer?: (correct: boolean) => void
  /**
   * Review mode only — fired once, the moment the card reveals whether the
   * reader was right or wrong. `picked`/`correctText` are the option (or
   * typed cloze) text in the reader's own language, which is what "Explain"
   * sends to the tutor agent — the agent is never asked to re-derive what was
   * on screen.
   */
  onAnswered?: (result: { correct: boolean; picked: string; correctText: string }) => void
}

const bilingual = (value: { en: string; hi: string }, language: Language, otherShown: boolean) =>
  otherShown ? value : { [language]: value[language] || value.en } as Partial<{ en: string; hi: string }>

/**
 * One card, however it must be asked: a rule's flip card, a cloze reader can
 * type into or reveal, and the option list mcq/trueFalse/scenario all share
 * (they differ in `front`'s length, not in shape — every one of the three
 * carries `options` + `answerIndex` on the same `Card`).
 *
 * Keyed by the caller on `card.id` so a card change remounts this component
 * and resets every piece of local state — the reveal, the typed answer, the
 * pick and the elapsed-time clock — rather than needing an effect to notice
 * the id changed and reset seven pieces of state by hand.
 */
export function CardView({
  card,
  language,
  srsRow,
  now,
  desiredRetention,
  bookmarked,
  onGrade,
  onToggleBookmark,
  onReport,
  mode = 'review',
  onAnswer,
  onAnswered,
}: CardViewProps) {
  const { t } = useT()
  const [revealed, setRevealed] = useState(false)
  const [otherLanguageShown, setOtherLanguageShown] = useState(false)
  const [clozeInput, setClozeInput] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  // A lazy `useState` initialiser, not `useRef(Date.now())` — the ref form calls
  // `Date.now()` on every render even though only the first result is kept,
  // which is the impure-render call the lint (react-hooks/purity) is right to
  // reject; the function form runs it once, at mount, which is what a "when did
  // this card appear" clock actually wants.
  const [startedAt] = useState(() => Date.now())

  const previews = useMemo(() => {
    const row = srsRow ?? createCard(card.id, now)
    return previewGrades(row, now, desiredRetention)
  }, [srsRow, card.id, now, desiredRetention])

  const reveal = () => {
    setRevealed(true)
    if (mode === 'review' && card.kind === 'cloze' && card.cloze) {
      const normalise = (s: string) => s.trim().toLowerCase()
      const answer = card.cloze.answer[language] || card.cloze.answer.en
      onAnswered?.({ correct: normalise(clozeInput) === normalise(answer), picked: clozeInput, correctText: answer })
    }
  }

  const selectOption = (index: number) => {
    if (mode === 'review' && revealed) return
    setSelectedIndex(index)
    if (mode === 'review') {
      setRevealed(true)
      if (card.options) {
        const picked = card.options[index]
        const correctOption = card.answerIndex !== undefined ? card.options[card.answerIndex] : undefined
        onAnswered?.({
          correct: index === card.answerIndex,
          picked: picked ? picked[language] || picked.en : '',
          correctText: correctOption ? correctOption[language] || correctOption.en : '',
        })
      }
    }
    // Mock mode never sets `revealed` — the reader may change their pick until
    // the parent advances to the next question, and "no explanations until
    // the end" means the option list must never show which one was right.
    if (mode === 'mock') onAnswer?.(index === card.answerIndex)
  }

  const grade = (g: Grade) => {
    onGrade(g, Math.max(0, Date.now() - startedAt))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (!revealed && event.key === ' ' && !typing && card.kind !== 'mcq' && card.kind !== 'trueFalse' && card.kind !== 'scenario') {
        event.preventDefault()
        reveal()
        return
      }
      if (revealed && mode === 'review' && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        grade(GRADES[Number(event.key) - 1] ?? 'Good')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, card.kind, mode])

  const front = bilingual(card.front, language, otherLanguageShown)
  const back = bilingual(card.back, language, otherLanguageShown)

  return (
    <SectionCard active className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{card.act}</Chip>
          <Chip tone="marigold">{card.ruleRef.citation[language] || card.ruleRef.citation.en}</Chip>
        </div>
        {mode === 'review' ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-pressed={otherLanguageShown}
              aria-label={t('trainer.card.showOtherLanguage')}
              onClick={() => setOtherLanguageShown((v) => !v)}
            >
              <Languages aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-pressed={bookmarked}
              aria-label={t(bookmarked ? 'trainer.card.unbookmark' : 'trainer.card.bookmark')}
              onClick={onToggleBookmark}
            >
              <Bookmark aria-hidden="true" className={bookmarked ? 'fill-marigold text-marigold' : ''} />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={t('trainer.card.report')} onClick={onReport}>
              <Flag aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-1">
        {Object.entries(front).map(([lang, text]) => (
          <p key={lang} className="text-lg leading-relaxed font-medium">
            {text}
          </p>
        ))}
      </div>

      {card.kind === 'cloze' && card.cloze ? (
        <ClozeBody
          card={card}
          language={language}
          otherLanguageShown={otherLanguageShown}
          revealed={revealed}
          value={clozeInput}
          onChange={setClozeInput}
          onReveal={reveal}
        />
      ) : null}

      {(card.kind === 'mcq' || card.kind === 'trueFalse' || card.kind === 'scenario') && card.options ? (
        <div className="mt-4 space-y-2" role="radiogroup" aria-label={t('trainer.card.options')}>
          {card.options.map((option, index) => {
            const isCorrect = index === card.answerIndex
            const isPicked = index === selectedIndex
            const showCorrectness = mode === 'review' && revealed
            const tone = !showCorrectness
              ? isPicked
                ? 'border-action bg-accent'
                : 'border-border hover:bg-muted'
              : isCorrect
                ? 'border-tulsi bg-tulsi/15'
                : isPicked
                  ? 'border-coral bg-coral/15'
                  : 'border-border opacity-70'
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={isPicked}
                disabled={mode === 'review' && revealed}
                onClick={() => selectOption(index)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                  'disabled:cursor-not-allowed',
                  tone,
                )}
              >
                <span>{option[language] || option.en}</span>
                {showCorrectness && isCorrect ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-tulsi-foreground" /> : null}
                {showCorrectness && isPicked && !isCorrect ? <X aria-hidden="true" className="h-4 w-4 shrink-0 text-coral-foreground" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {card.kind === 'rule' && !revealed ? (
        <Button type="button" className="mt-5" onClick={reveal}>
          {t('trainer.card.showAnswer')}
        </Button>
      ) : null}

      {revealed && card.kind === 'rule' ? (
        <div className="mt-4 space-y-1 border-t border-border pt-4">
          {Object.entries(back).map(([lang, text]) => (
            <p key={lang} className="leading-relaxed">
              {text}
            </p>
          ))}
        </div>
      ) : null}

      {revealed && mode === 'review' && card.explanation ? (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {card.explanation[language] || card.explanation.en}
        </p>
      ) : null}

      {revealed && mode === 'review' ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{card.ruleRef.citation[language] || card.ruleRef.citation.en}</span>
          <a
            href={card.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          >
            {t('trainer.card.sourceLink')}
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      {revealed && mode === 'review' ? (
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-5 sm:grid-cols-4">
          {GRADES.map((g, i) => (
            <Button
              key={g}
              type="button"
              variant="outline"
              onClick={() => grade(g)}
              className={cn('h-auto flex-col gap-0.5 py-2.5', GRADE_TONE[g])}
            >
              <span className="text-sm font-semibold">
                {t(`trainer.grade.${g}`)}
                <span className="ml-1 text-xs text-muted-foreground">({i + 1})</span>
              </span>
              <span className="text-xs text-muted-foreground">{intervalLabel(previews[g].due, now, language)}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </SectionCard>
  )
}

interface ClozeBodyProps {
  card: Card
  language: Language
  otherLanguageShown: boolean
  revealed: boolean
  value: string
  onChange: (value: string) => void
  onReveal: () => void
}

function ClozeBody({ card, language, otherLanguageShown, revealed, value, onChange, onReveal }: ClozeBodyProps) {
  const { t } = useT()
  if (!card.cloze) return null
  const answer = bilingual(card.cloze.answer, language, otherLanguageShown)
  const normalise = (s: string) => s.trim().toLowerCase()
  const matched = revealed && normalise(value) === normalise(card.cloze.answer[language] || card.cloze.answer.en)

  return (
    <div className="mt-4 space-y-3">
      <input
        type="text"
        value={value}
        disabled={revealed}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('trainer.card.clozePlaceholder')}
        aria-label={t('trainer.card.clozePlaceholder')}
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-70"
      />
      {!revealed ? (
        <div className="flex gap-2">
          <Button type="button" onClick={onReveal}>
            {t('trainer.card.checkAnswer')}
          </Button>
          <Button type="button" variant="outline" onClick={onReveal}>
            {t('trainer.card.reveal')}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            'rounded-md border p-3 text-sm',
            matched ? 'border-tulsi bg-tulsi/15 text-tulsi-foreground' : 'border-border bg-muted',
          )}
        >
          <p className="font-medium">
            {matched ? t('trainer.card.typedCorrect') : t('trainer.card.typedAnswer')}
          </p>
          {Object.entries(answer).map(([lang, text]) => (
            <p key={lang} className="mt-1">
              {text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
