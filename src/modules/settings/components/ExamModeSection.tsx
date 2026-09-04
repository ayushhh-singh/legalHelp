import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'

/**
 * The exam-mode row in Settings.
 *
 * It reads `examChoices` DIRECTLY rather than through `src/lib/exam`, and every
 * import that would reach the exam layer is dynamic. Settings sits on the
 * initial route's chunk graph, and a static import of `@/lib/exam` or of
 * `data/exams` for one line would put the plan builder, the mock draw and the
 * readiness engine on the device of every reader who never opens `/learn/exam`.
 *
 * The NAME is loaded rather than derived from the id. The first version rendered
 * `active.id` — "Preparing for css-so-ldce." — which is a slug shown to a human,
 * and the chunk-weight reasoning above is what produced it. `data/exams/index.json`
 * is 2 KB, it is its own chunk, and it is fetched only once there is a row to
 * name: a reader with no examination pays nothing for this.
 */
export function ExamModeSection() {
  const { t, language } = useT()
  const rows = useLiveQuery(() => db.examChoices.toArray(), [], undefined)
  const active = rows?.find((row) => row.active) ?? null
  /*
    The resolved name, tagged with the id it was resolved FOR.

    Read at render time rather than reset in an effect: `react-hooks/set-state-
    in-effect` is right to reject `setName(null)` in the effect body, and the
    repair is the one this codebase already uses for `ReviewPage`'s
    `wrongAnswer` and for `TrainerActHint` — derive, do not resynchronise. A
    stale name from a profile the reader has since switched away from simply
    does not match, so it is not shown.
  */
  const [resolved, setResolved] = useState<{ id: string; name: string } | null>(null)
  const name = resolved && resolved.id === active?.id ? resolved.name : null

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const id = active.id
    void import('@/modules/trainer/exam/data')
      .then((module) => module.loadExamIndex())
      .then((index) => {
        if (cancelled) return
        const entry = index.profiles.find((profile) => profile.id === id)
        // A row naming a profile this build no longer has keeps its id rather
        // than rendering nothing — the reader still needs to see that SOMETHING
        // is set, and `/learn/exam` is where they change it.
        setResolved({ id, name: entry ? entry.name[language] || entry.name.en : id })
      })
      .catch(() => {
        if (!cancelled) setResolved({ id, name: id })
      })
    return () => {
      cancelled = true
    }
  }, [active, language])

  const stop = async () => {
    if (!active) return
    // `forgetExam`, not `clearActiveExam`: "Stop preparing" means the row goes.
    // Clearing the flag alone would leave a record on the device of which
    // departmental examination this officer was preparing for, which is not
    // what the control says it does. The hub's "Change examination" is the
    // other affordance, and it deliberately keeps the date.
    const { forgetExam } = await import('@/lib/exam')
    await forgetExam(active.id)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('trainer.exam.settings.title')}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {active ? t('trainer.exam.settings.current', { name: name ?? '…' }) : t('trainer.exam.settings.none')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/learn/exam" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('trainer.exam.settings.open')}
        </Link>
        {active ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void stop()}>
            {t('trainer.exam.settings.stop')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
