import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { db } from '@/db'
import { cardSchema, type Card } from '@/modules/trainer/schema'
import type { LibraryUnit } from '@/lib/library'

/**
 * A highlighted passage becomes a card waiting in the Trainer's own queue.
 *
 * IT REUSES THE EXISTING PROPOSAL PATH AND ADDS NO SECOND ONE. The row goes
 * into `proposedCards` with `reviewState: 'unreviewed'`, exactly as the AI
 * `propose_card` tool writes it, and `/learn/review-queue` is where a human
 * accepts it — `effectiveCatalogue` then folds the approval over the dataset
 * (ADR-027). Nothing here can reach the FSRS schedule, and nothing here mutates
 * `data/rules`.
 *
 * The confirmation is read back from the WRITE, never claimed: the card is
 * parsed through `cardSchema` first, and a shape the schema rejects is reported
 * as a failure rather than as a card the reader will go looking for.
 *
 * Only for a rule book this app ships. A personal document has no act id and no
 * citation `data/rules` would recognise, and a card citing "my-office-order-abc
 * rule 3" would sit in the queue forever with nothing to check it against.
 */

interface AddToTrainerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The rule book id — `ccs-conduct`. Null for a work no card can cite. */
  actId: string | null
  unit: LibraryUnit
  quote: string
  /**
   * Where the passage came from — the WORK's own citation, passed in.
   *
   * Not written here. `tests/no-external-urls.test.ts` refuses a citation host
   * named anywhere under `src/`, and it is right to: a URL in a component is a
   * citation nobody reviewed and that a dataset refresh cannot correct. The
   * work already carries the one this card should quote.
   */
  source: { name: string; url: string }
}

export function AddToTrainerDialog({
  open,
  onOpenChange,
  actId,
  unit,
  quote,
  source,
}: AddToTrainerDialogProps) {
  const { t } = useT()
  const [kind, setKind] = useState<'cloze' | 'rule'>('cloze')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'failed'>('idle')

  const add = async () => {
    if (!actId) return
    setStatus('saving')

    const id = `lib-${actId}-${unit.number}-${Date.now().toString(36)}`
    const front =
      kind === 'cloze'
        ? { en: `${unit.citation.en}: ____`, hi: `${unit.citation.hi}: ____` }
        : { en: quote, hi: quote }
    const back = kind === 'cloze' ? { en: quote, hi: quote } : { en: unit.citation.en, hi: unit.citation.hi }

    const draft: Card = {
      id,
      act: actId,
      rule: unit.number,
      kind: kind === 'cloze' ? 'cloze' : 'rule',
      front,
      back,
      ...(kind === 'cloze'
        ? { cloze: { text: { en: `____`, hi: `____` }, answer: { en: quote, hi: quote } } }
        : {}),
      ruleRef: { textId: unit.id, citation: unit.citation },
      difficulty: 'medium',
      reviewed: false,
      reviewState: 'unreviewed',
      version: '1.0.0',
      source,
    }

    const parsed = cardSchema.safeParse(draft)
    if (!parsed.success) {
      setStatus('failed')
      return
    }

    try {
      await db.proposedCards.put({ id, card: parsed.data, createdAt: new Date().toISOString() })
      setStatus('done')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">{t('library.trainer.title')}</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            {t('library.trainer.subtitle')}
          </Dialog.Description>

          {!actId ? (
            <p
              role="note"
              className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground"
            >
              {t('library.trainer.unavailable')}
            </p>
          ) : status === 'done' ? (
            <>
              <p role="status" className="text-sm text-tulsi-foreground">
                {t('library.trainer.added')}
              </p>
              <Button asChild variant="outline" size="sm" className="self-start">
                <Link to="/learn/review-queue" onClick={() => onOpenChange(false)}>
                  {t('library.trainer.openQueue')}
                </Link>
              </Button>
            </>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">
                  {t('library.trainer.kind')}
                </legend>
                {(['cloze', 'rule'] as const).map((option) => (
                  <div key={option} className="flex items-start gap-2 text-sm">
                    <input
                      id={`library-card-kind-${option}`}
                      type="radio"
                      name="library-card-kind"
                      checked={kind === option}
                      onChange={() => setKind(option)}
                      className="mt-1 accent-[var(--action)]"
                    />
                    <span className="min-w-0">
                      <label htmlFor={`library-card-kind-${option}`} className="font-medium">
                        {t(`library.trainer.${option}`)}
                      </label>
                      <span className="block text-xs text-muted-foreground">
                        {t(option === 'cloze' ? 'library.trainer.clozeHint' : 'library.trainer.ruleHint')}
                      </span>
                    </span>
                  </div>
                ))}
              </fieldset>

              <blockquote className="rounded-md border-l-[3px] border-border bg-muted/50 px-3 py-2 text-sm">
                {quote}
              </blockquote>

              {status === 'failed' ? (
                <p role="alert" className="text-sm text-destructive">
                  {t('library.trainer.failed')}
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <Button onClick={() => void add()} disabled={status === 'saving'}>
                  {t('library.trainer.add')}
                </Button>
                <Dialog.Close asChild>
                  <Button variant="outline">{t('library.terms.close')}</Button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
