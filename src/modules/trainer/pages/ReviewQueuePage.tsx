import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Bot, Check, FileJson, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { isBulkApprovable, pendingReviewQueue, type QueueEntry } from '../reviewQueue'
import { bulkApprove, decideCard } from '../store'
import { useRawCards } from '../useCatalogue'

import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, Chip, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'

/**
 * `/learn/review-queue` — cards `data/rules` shipped `unreviewed`, plus
 * `propose_card`'s AI output, one at a time. Approving or rejecting writes a
 * `cardOverrideRow`; nothing here ever writes a `Card` field directly, and
 * nothing is scheduled until `effectiveCatalogue` (`../reviewQueue.ts`) folds
 * the decision back over the dataset.
 */
export default function ReviewQueuePage() {
  const { t, language } = useT()
  const raw = useRawCards()
  const overrides = useLiveQuery(() => db.cardOverrides.toArray(), [], undefined)
  const proposed = useLiveQuery(() => db.proposedCards.toArray(), [], undefined)

  const entries = useMemo(() => {
    if (raw.status !== 'ready' || !overrides || !proposed) return null
    return pendingReviewQueue(raw.data, overrides, proposed)
  }, [raw, overrides, proposed])

  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [frontEn, setFrontEn] = useState('')
  const [frontHi, setFrontHi] = useState('')
  const [backEn, setBackEn] = useState('')
  const [backHi, setBackHi] = useState('')
  // The id the edit form above was last loaded for — not shown anywhere, only
  // compared against below.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const current: QueueEntry | null = entries && entries.length > 0 ? (entries[Math.min(index, entries.length - 1)] ?? null) : null

  // Adjusted during render, not in an effect: "the focused card changed" is a
  // value derived from `entries`/`index`, and resetting the form here — rather
  // than one render later, from an effect — is what stops a keystroke's worth
  // of stale text flashing in the box for the card that just scrolled away.
  if (current && loadedFor !== current.card.id) {
    setLoadedFor(current.card.id)
    setFrontEn(current.card.front.en)
    setFrontHi(current.card.front.hi)
    setBackEn(current.card.back.en)
    setBackHi(current.card.back.hi)
    setEditing(false)
  }

  const approve = async (entry: QueueEntry) => {
    await decideCard({ qId: entry.card.id, action: 'approved' })
  }
  const reject = async (entry: QueueEntry) => {
    await decideCard({ qId: entry.card.id, action: 'rejected' })
  }
  const saveEdit = async (entry: QueueEntry) => {
    await decideCard({
      qId: entry.card.id,
      action: 'approved',
      patch: { front: { en: frontEn, hi: frontHi }, back: { en: backEn, hi: backHi } },
    })
    setEditing(false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (typing || !entries || entries.length === 0) return

      if (event.key === 'j') setIndex((i) => Math.min(entries.length - 1, i + 1))
      else if (event.key === 'k') setIndex((i) => Math.max(0, i - 1))
      else if (event.key === 'a' && current) void approve(current)
      else if (event.key === 'r' && current) void reject(current)
      else if (event.key === 'e') setEditing((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entries, current])

  if (!entries) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const bulkEligible = entries.filter((entry) => isBulkApprovable(entry.card))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.reviewQueue.title')}
        subtitle={t('trainer.reviewQueue.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState icon={FileJson} title={t('trainer.reviewQueue.emptyTitle')} body={t('trainer.reviewQueue.emptyBody')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('trainer.reviewQueue.progress', { current: Math.min(index, entries.length - 1) + 1, total: entries.length })}</span>
            <span>{t('trainer.reviewQueue.keyboardHint')}</span>
          </div>

          {bulkEligible.length > 0 ? (
            <SectionCard className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{t('trainer.reviewQueue.bulkApproveHint')}</p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void bulkApprove(bulkEligible.map((entry) => entry.card.id))}
                >
                  {t('trainer.reviewQueue.bulkApprove', { count: bulkEligible.length })}
                </Button>
              </div>
            </SectionCard>
          ) : null}

          {current ? (
            <SectionCard active className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{current.card.act}</Chip>
                <Chip tone="marigold">{current.card.ruleRef.citation[language] || current.card.ruleRef.citation.en}</Chip>
                <Badge tone={current.source === 'ai' ? 'info' : 'neutral'}>
                  {current.source === 'ai' ? (
                    <>
                      <Bot aria-hidden="true" className="h-3 w-3" /> {t('trainer.reviewQueue.sourceAi')}
                    </>
                  ) : (
                    t('trainer.reviewQueue.sourceDataset')
                  )}
                </Badge>
              </div>

              {!editing ? (
                <div className="mt-4 space-y-2">
                  <p className="text-base font-medium">{current.card.front[language] || current.card.front.en}</p>
                  <p className="text-sm text-muted-foreground">{current.card.back[language] || current.card.back.en}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-front-en">
                      {t('trainer.reviewQueue.editFrontLabel')} (EN)
                    </label>
                    <textarea id="edit-front-en" value={frontEn} onChange={(e) => setFrontEn(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-front-hi">
                      {t('trainer.reviewQueue.editFrontLabel')} (HI)
                    </label>
                    <textarea id="edit-front-hi" value={frontHi} onChange={(e) => setFrontHi(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-back-en">
                      {t('trainer.reviewQueue.editBackLabel')} (EN)
                    </label>
                    <textarea id="edit-back-en" value={backEn} onChange={(e) => setBackEn(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-back-hi">
                      {t('trainer.reviewQueue.editBackLabel')} (HI)
                    </label>
                    <textarea id="edit-back-hi" value={backHi} onChange={(e) => setBackHi(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" />
                  </div>
                </div>
              )}

              {current.card.generationMeta ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3 text-xs">
                  <Chip tone={current.card.generationMeta.critic.verdict === 'approve' ? 'tulsi' : 'coral'}>
                    {t('trainer.reviewQueue.criticLabel')}:{' '}
                    {current.card.generationMeta.critic.verdict === 'approve'
                      ? t('trainer.reviewQueue.criticApprove')
                      : t('trainer.reviewQueue.criticReject')}
                  </Chip>
                  {current.card.generationMeta.blindVerify ? (
                    <Chip tone={current.card.generationMeta.blindVerify.matched ? 'tulsi' : 'coral'}>
                      {current.card.generationMeta.blindVerify.matched
                        ? t('trainer.reviewQueue.blindVerifyMatched')
                        : t('trainer.reviewQueue.blindVerifyMismatched')}
                    </Chip>
                  ) : null}
                  <Chip tone={current.card.generationMeta.dedup.verdict === 'keep' ? 'tulsi' : 'coral'}>
                    {t('trainer.reviewQueue.dedupLabel')}:{' '}
                    {current.card.generationMeta.dedup.verdict === 'keep'
                      ? t('trainer.reviewQueue.dedupKeep')
                      : t('trainer.reviewQueue.dedupDuplicate')}
                  </Chip>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                {editing ? (
                  <>
                    <Button type="button" size="sm" onClick={() => void saveEdit(current)}>
                      {t('trainer.reviewQueue.save')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                      {t('trainer.reviewQueue.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" size="sm" onClick={() => void approve(current)}>
                      <Check aria-hidden="true" />
                      {t('trainer.reviewQueue.approve')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                      {t('trainer.reviewQueue.edit')}
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => void reject(current)}>
                      <X aria-hidden="true" />
                      {t('trainer.reviewQueue.reject')}
                    </Button>
                  </>
                )}
              </div>
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  )
}
