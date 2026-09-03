import { Pause, Play } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useRunningSession } from '../useStudy'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  DEFAULT_POMODORO,
  completedPomodoros,
  focusedMinutes,
  formatDuration,
  phaseAt,
  startSession,
  stopSession,
  type PomodoroConfig,
} from '@/lib/study'
import { useNow } from '@/modules/trainer/useNow'
import { cn } from '@/lib/utils'

export interface SessionTimerProps {
  workId: string
  workLabel: string
  nodeId?: string | null
  className?: string
}

/**
 * The study session timer.
 *
 * Every figure it shows is computed from `startedAt` and the WALL CLOCK, not
 * from a counter this component increments. A tab backgrounded for an hour, a
 * laptop that slept, a tick React skipped under load — all of them give the
 * right answer, because the answer was never being accumulated in the first
 * place. `useNow(1000)` only decides how often the same arithmetic is redrawn.
 *
 * The session is stored the moment it starts, so it survives a reload; what is
 * NOT stored is the minute count, which `stopSession` computes at the end. That
 * is also why a session under a minute is discarded rather than logged as zero.
 */
export function SessionTimer({ workId, workLabel, nodeId = null, className }: SessionTimerProps) {
  const { t } = useT()
  const running = useRunningSession()
  const now = useNow(1000)
  const [config] = useState<PomodoroConfig>(DEFAULT_POMODORO)
  const [mode, setMode] = useState<'free' | 'pomodoro'>('free')
  const [stopped, setStopped] = useState<number | null>(null)

  const start = useCallback(async () => {
    setStopped(null)
    await startSession({ workId, nodeId, mode, config })
  }, [config, mode, nodeId, workId])

  const stop = useCallback(async () => {
    if (!running) return
    const closed = await stopSession(running.id, new Date(), config)
    setStopped(closed ? closed.minutes : -1)
  }, [config, running])

  // `undefined` is Dexie still answering. Nothing here blocks on it — the
  // start control is the same control either way.
  const active = running ?? null
  const phase = active ? phaseAt(active, now, config) : null

  return (
    <SectionCard className={className}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('library.study.session.title')}</h2>
          {active ? (
            <Badge tone={phase?.phase === 'break' ? 'neutral' : 'success'}>
              {t(
                phase?.phase === 'break'
                  ? 'library.study.session.phaseBreak'
                  : 'library.study.session.phaseWork',
              )}
            </Badge>
          ) : null}
        </div>

        {active && phase ? (
          <>
            <p className="font-sans text-3xl font-extrabold tabular-nums" aria-live="off">
              {active.mode === 'pomodoro'
                ? formatDuration(phase.remainingSeconds)
                : formatDuration(phase.elapsedSeconds)}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('library.study.session.running', { time: formatDuration(phase.elapsedSeconds) })}
              {' · '}
              {t('library.study.session.onWork', { work: workLabel })}
            </p>
            {active.mode === 'pomodoro' ? (
              <p className="text-sm text-muted-foreground">
                {t('library.study.session.completed', { count: completedPomodoros(active, now, config) })}
                {' · '}
                {t('library.study.session.remaining', { time: formatDuration(phase.remainingSeconds) })}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t('library.study.review.minutes')}: {focusedMinutes(active, now, config)}
            </p>
            <div>
              <Button type="button" variant="outline" onClick={() => void stop()}>
                <Pause aria-hidden="true" />
                {t('library.study.session.stop')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                {t('library.study.session.mode')}
              </legend>
              <div className="flex flex-wrap gap-2">
                {(['free', 'pomodoro'] as const).map((option) => (
                  <label
                    key={option}
                    className={cn(
                      'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm',
                      mode === option ? 'border-action bg-action text-action-foreground' : 'border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="session-mode"
                      className="sr-only"
                      checked={mode === option}
                      onChange={() => setMode(option)}
                    />
                    {t(option === 'free' ? 'library.study.session.free' : 'library.study.session.pomodoro')}
                  </label>
                ))}
              </div>
            </fieldset>
            {mode === 'pomodoro' ? (
              <p className="text-xs text-muted-foreground">
                {t('library.study.session.pomodoroHint', {
                  work: config.workMinutes,
                  break: config.breakMinutes,
                })}
              </p>
            ) : null}
            <div>
              <Button type="button" onClick={() => void start()}>
                <Play aria-hidden="true" />
                {t('library.study.session.start')}
              </Button>
            </div>
          </>
        )}

        {stopped !== null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {stopped < 0
              ? t('library.study.session.discarded')
              : t('library.study.session.stopped', { minutes: stopped })}
          </p>
        ) : null}
      </div>
    </SectionCard>
  )
}
