import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { useT } from '@/i18n/useT'

/**
 * The exam-mode row in Settings.
 *
 * It reads `examChoices` DIRECTLY rather than through `src/lib/exam`'s
 * `activeExamChoice`, and the name it renders comes from the profile id rather
 * than from `data/exams`. Both are the same decision: Settings is on the
 * initial route's own chunk graph, and pulling the exam library or the profile
 * dataset in here to render one line would put them on every reader's device —
 * including every reader who never opens `/learn/exam`.
 *
 * `clearActiveExam` is the one exception, and it is a dynamic import inside the
 * handler for the same reason `useDraftingAi` dynamic-imports its agent on the
 * press: the code that WRITES only has to exist once somebody presses the
 * button that writes.
 */
export function ExamModeSection() {
  const { t } = useT()
  const rows = useLiveQuery(() => db.examChoices.toArray(), [], undefined)
  const active = rows?.find((row) => row.active) ?? null

  const stop = async () => {
    const { clearActiveExam } = await import('@/lib/exam')
    await clearActiveExam()
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('trainer.exam.settings.title')}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {active ? t('trainer.exam.settings.current', { name: active.id }) : t('trainer.exam.settings.none')}
      </p>
      <div className="flex flex-wrap gap-2">
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
