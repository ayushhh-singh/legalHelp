import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useEffectiveCatalogue, useRulesIndex } from '../useCatalogue'

import { PageHeader } from '@/components/common/PageHeader'
import { ProgressBar, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'
import { isServed, type Card } from '@/modules/trainer/schema'

/**
 * `/learn/browse` — every rule book, opened one at a time, with a per-rule
 * mastery bar built from `srsCards`.
 *
 * Rule headings are not loaded here — `data/rules/text/*.json` (~2.9 MB) is
 * deliberately out of this module's eager load (see `data.ts`), and a card's
 * own `ruleRef.citation` is enough to label a row. A rule with no approved
 * card at all still gets a row, so coverage reads honestly.
 */
export default function BrowsePage() {
  const { t, language } = useT()
  const index = useRulesIndex()
  const catalogue = useEffectiveCatalogue()
  const [openAct, setOpenAct] = useState<string | null>(null)

  const cardsByAct = useMemo(() => {
    const map = new Map<string, Card[]>()
    if (!catalogue) return map
    for (const card of catalogue) {
      if (!isServed(card)) continue
      const list = map.get(card.act)
      if (list) list.push(card)
      else map.set(card.act, [card])
    }
    return map
  }, [catalogue])

  const srsStates = useLiveQuery(() => db.srsCards.toArray(), [], undefined)

  if (index.status !== 'ready' || !catalogue || srsStates === undefined) {
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const masteryOf = (qId: string): number => {
    const row = srsStates.find((r) => r.qId === qId)
    if (!row || row.reps === 0) return 0
    if (row.state === 'review') return 100
    if (row.state === 'relearning') return 25
    return 50
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={t('trainer.browse.title')}
        subtitle={t('trainer.browse.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        {index.data.acts.map((act) => {
          const cards = cardsByAct.get(act.id) ?? []
          const rules = new Map<string, typeof cards>()
          for (const card of cards) {
            const list = rules.get(card.rule)
            if (list) list.push(card)
            else rules.set(card.rule, [card])
          }
          const isOpen = openAct === act.id

          return (
            <SectionCard key={act.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenAct(isOpen ? null : act.id)}
                aria-expanded={isOpen}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold">{act.name[language] || act.name.en}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('trainer.browse.rulesCount', { count: rules.size })} · {t('trainer.browse.cardsCount', { count: cards.length })}
                  </span>
                </span>
                {isOpen ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>

              {isOpen ? (
                <ul className="divide-y divide-border border-t border-border">
                  {[...rules.entries()].map(([rule, ruleCards]) => {
                    const citation = ruleCards[0]?.ruleRef.citation
                    const mastery = Math.round(ruleCards.reduce((sum, c) => sum + masteryOf(c.id), 0) / ruleCards.length)
                    return (
                      <li key={rule} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{citation?.[language] || citation?.en || rule}</p>
                          <p className="text-xs text-muted-foreground">{t('trainer.browse.cardsCount', { count: ruleCards.length })}</p>
                        </div>
                        <div className="flex w-28 shrink-0 flex-col items-end gap-1">
                          <span className="text-xs text-muted-foreground">
                            {mastery === 0 ? t('trainer.browse.masteryNotStarted') : `${mastery}%`}
                          </span>
                          <ProgressBar value={mastery} label={t('trainer.browse.masteryLabel')} className="w-full" />
                        </div>
                      </li>
                    )
                  })}
                  {rules.size === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">{t('trainer.browse.noCardsYet')}</li> : null}
                </ul>
              ) : null}
            </SectionCard>
          )
        })}
      </div>
    </div>
  )
}
