import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import {
  hasNotificationPermission,
  loadReminderSetting,
  requestNotificationPermission,
  saveReminderSetting,
} from '../reminder'
import { useRulesIndex } from '../useCatalogue'
import { saveSettings, useTrainerSettings } from '../useTrainerSettings'

import { PageHeader } from '@/components/common/PageHeader'
import { Chip, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { MAX_DESIRED_RETENTION, MIN_DESIRED_RETENTION } from '@/lib/srs'

/**
 * `/learn/settings` — daily new, the review cap, target retention, which rule
 * books, and the local daily reminder.
 */
export default function TrainerSettingsPage() {
  const { t, language } = useT()
  const settings = useTrainerSettings()
  const index = useRulesIndex()
  const reminder = useLiveQuery(() => loadReminderSetting(), [], undefined)
  const [saved, setSaved] = useState(false)

  if (!settings || index.status !== 'ready' || reminder === undefined) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const flash = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const toggleAct = async (actId: string) => {
    const current = settings.actsEnabled
    const next = current.includes(actId) ? current.filter((id) => id !== actId) : [...current, actId]
    await saveSettings({ actsEnabled: next })
    flash()
  }

  const enableReminder = async (checked: boolean) => {
    if (checked && !hasNotificationPermission()) {
      const granted = await requestNotificationPermission()
      if (!granted) return
    }
    await saveReminderSetting({ enabled: checked })
    flash()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={t('trainer.settings.title')}
        subtitle={t('trainer.settings.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/learn">
              <ArrowLeft aria-hidden="true" />
              {t('trainer.review.backHome')}
            </Link>
          </Button>
        }
      />

      {saved ? (
        <p role="status" className="rounded-md bg-tulsi/15 p-2 text-sm text-tulsi-foreground">
          {t('trainer.settings.saved')}
        </p>
      ) : null}

      <SectionCard className="p-4">
        <label htmlFor="dailyNew" className="text-sm font-semibold">
          {t('trainer.settings.dailyNewLabel')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t('trainer.settings.dailyNewHint')}</p>
        <input
          id="dailyNew"
          type="number"
          min={0}
          max={200}
          value={settings.dailyNew}
          onChange={(event) => {
            void saveSettings({ dailyNew: Math.max(0, Number(event.target.value) || 0) }).then(flash)
          }}
          className="mt-2 h-11 w-32 rounded-md border border-input bg-background px-3 text-sm"
        />
      </SectionCard>

      <SectionCard className="p-4">
        <label htmlFor="dailyReviewCap" className="text-sm font-semibold">
          {t('trainer.settings.dailyReviewCapLabel')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t('trainer.settings.dailyReviewCapHint')}</p>
        <input
          id="dailyReviewCap"
          type="number"
          min={0}
          max={1000}
          value={settings.dailyReviewCap}
          onChange={(event) => {
            void saveSettings({ dailyReviewCap: Math.max(0, Number(event.target.value) || 0) }).then(flash)
          }}
          className="mt-2 h-11 w-32 rounded-md border border-input bg-background px-3 text-sm"
        />
      </SectionCard>

      <SectionCard className="p-4">
        <label htmlFor="desiredRetention" className="text-sm font-semibold">
          {t('trainer.settings.desiredRetentionLabel')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t('trainer.settings.desiredRetentionHint')}</p>
        <div className="mt-2 flex items-center gap-3">
          <input
            id="desiredRetention"
            type="range"
            min={MIN_DESIRED_RETENTION}
            max={MAX_DESIRED_RETENTION}
            step={0.01}
            value={settings.desiredRetention}
            onChange={(event) => {
              void saveSettings({ desiredRetention: Number(event.target.value) }).then(flash)
            }}
            className="w-full accent-[var(--action)]"
          />
          <span className="font-display w-14 text-right text-sm">
            {Math.round(settings.desiredRetention * 100)}%
          </span>
        </div>
      </SectionCard>

      <SectionCard className="p-4">
        <h2 className="text-sm font-semibold">{t('trainer.settings.actsEnabledLabel')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('trainer.settings.actsEnabledHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {index.data.acts.map((act) => {
            const active = settings.actsEnabled.length === 0 || settings.actsEnabled.includes(act.id)
            return (
              <button key={act.id} type="button" onClick={() => void toggleAct(act.id)}>
                <Chip tone={active ? 'action' : 'neutral'}>{act.short[language] || act.short.en}</Chip>
              </button>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('trainer.settings.reminderLabel')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('trainer.settings.reminderHint')}</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-checked={reminder.enabled}
            aria-label={t('trainer.settings.reminderLabel')}
            checked={reminder.enabled}
            onChange={(event) => void enableReminder(event.target.checked)}
            className="h-6 w-11 shrink-0 accent-[var(--action)]"
          />
        </div>

        {!hasNotificationPermission() ? (
          <p className="mt-2 text-xs text-marigold-foreground">
            {typeof Notification !== 'undefined' && Notification.permission === 'denied'
              ? t('trainer.settings.reminderPermissionDenied')
              : t('trainer.settings.reminderPermissionNeeded')}
          </p>
        ) : null}

        {reminder.enabled ? (
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="reminderTime" className="text-xs font-medium text-muted-foreground">
              {t('trainer.settings.reminderTimeLabel')}
            </label>
            <input
              id="reminderTime"
              type="time"
              value={`${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number)
                if (hour === undefined || minute === undefined) return
                void saveReminderSetting({ hour, minute }).then(flash)
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}
