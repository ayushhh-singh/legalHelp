import { CircleCheck, Laptop, ShieldOff, UserRoundX } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { trainerActHintsForJob } from './actHints'

import { useAppStore } from '@/app/store'
import { PageHeader } from '@/components/common/PageHeader'
import { OptionRow, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@/i18n'
import { useT } from '@/i18n/useT'
import { saveSettings } from '@/lib/srs'
import { jobFor } from '@/lib/pay/tables'
import { scenarioForJob } from '@/lib/pay/scenario'
import { writeLastScenario } from '@/modules/pay/scenarios'
import { usePayTables } from '@/modules/pay/usePayTables'
import { CityPicker, JobPicker } from '@/modules/pay/components/Pickers'
import type { JobOption } from '@/modules/pay/pick'
import { HOME_PATH } from '@/lib/nav'

type Step = 1 | 2 | 3

const TOTAL_STEPS = 3

/**
 * First-run onboarding: three skippable steps, shown once.
 *
 * Reached ONLY from a bare `/` on a device that has never completed or
 * skipped it (App.tsx). A deep link — a shared law section, a saved pay
 * scenario, a direct navigation in a test — is never redirected here: an
 * officer who was sent a link did not ask to be walked through a welcome
 * flow before seeing it.
 *
 * Nothing here is a dead end. Skipping is always one tap away
 * (`skipToEnd`), and every choice made on the way — language, post, city —
 * is exactly what the equivalent control in Settings or the Pay calculator
 * would set, so a reader who changes their mind is not undoing something
 * special, just changing an ordinary preference.
 */
export default function OnboardingPage() {
  const { t, language } = useT()
  const navigate = useNavigate()
  const setLanguage = useAppStore((s) => s.setLanguage)
  const setOnboarded = useAppStore((s) => s.setOnboarded)
  const tables = usePayTables()

  const [step, setStep] = useState<Step>(1)
  const [job, setJob] = useState<JobOption | null>(null)
  const [cityId, setCityId] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const finish = async () => {
    if (finishing) return
    setFinishing(true)
    try {
      if (job && tables.status === 'ready') {
        const scenario = scenarioForJob(job.job.id, tables.tables, cityId ? { cityId } : {})
        await writeLastScenario(scenario)

        const fullJob = jobFor(tables.tables.jobs, job.job.id)
        if (fullJob) {
          const hint = trainerActHintsForJob(fullJob)
          if (hint.acts.length > 0) await saveSettings({ actsEnabled: hint.acts })
        }
      }
      await setOnboarded(true)
      void navigate(HOME_PATH, { replace: true })
    } finally {
      setFinishing(false)
    }
  }

  const skipToEnd = () => {
    void setOnboarded(true).then(() => navigate(HOME_PATH, { replace: true }))
  }

  const hint = job ? trainerActHintsForJob(job.job) : null

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground tabular-nums">
          {t('onboarding.stepOf', { step, total: TOTAL_STEPS })}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={skipToEnd} disabled={finishing}>
          {t('onboarding.skipSetup')}
        </Button>
      </div>

      {step === 1 ? (
        <SectionCard className="p-4 sm:p-6" aria-label={t('onboarding.step1.title')}>
          <PageHeader title={t('onboarding.step1.title')} subtitle={t('onboarding.step1.subtitle')} />
          <div
            role="radiogroup"
            aria-label={t('onboarding.step1.title')}
            className="mt-4 flex flex-col gap-2"
          >
            {LANGUAGES.map((code: Language) => (
              <OptionRow
                key={code}
                selected={language === code}
                label={LANGUAGE_NAMES[code]}
                onSelect={() => void setLanguage(code)}
              />
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button type="button" onClick={() => setStep(2)}>
              {t('onboarding.continue')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === 2 ? (
        <SectionCard className="p-4 sm:p-6" aria-label={t('onboarding.step2.title')}>
          <PageHeader title={t('onboarding.step2.title')} subtitle={t('onboarding.step2.subtitle')} />
          {tables.status === 'error' ? (
            <p className="mt-4 text-sm text-muted-foreground">{t('onboarding.step2.unavailable')}</p>
          ) : tables.status === 'loading' ? (
            <div className="mt-4 flex flex-col gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              <JobPicker
                tables={tables.tables}
                selectedId={job?.job.id ?? null}
                onSelect={setJob}
                onClear={() => setJob(null)}
                id="onboarding-job-picker"
              />
              <CityPicker
                tables={tables.tables}
                selectedId={cityId}
                onSelect={(city) => setCityId(city.id)}
                onClear={() => setCityId(null)}
                id="onboarding-city-picker"
              />
              {hint?.note ? (
                <p className="rounded-md bg-marigold/15 p-3 text-sm text-marigold-foreground">
                  {hint.note[language]}
                </p>
              ) : null}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {t('onboarding.back')}
            </Button>
            <Button type="button" onClick={() => setStep(3)}>
              {t('onboarding.continue')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === 3 ? (
        <SectionCard className="p-4 sm:p-6" aria-label={t('onboarding.step3.title')}>
          <PageHeader title={t('onboarding.step3.title')} subtitle={t('onboarding.step3.subtitle')} />
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            <li className="flex items-start gap-3">
              <Laptop aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-tulsi" />
              <span>{t('onboarding.step3.onDevice')}</span>
            </li>
            <li className="flex items-start gap-3">
              <UserRoundX aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-tulsi" />
              <span>{t('onboarding.step3.noAccounts')}</span>
            </li>
            <li className="flex items-start gap-3">
              <ShieldOff aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-tulsi" />
              <span>{t('onboarding.step3.noAnalytics')}</span>
            </li>
          </ul>
          <div className="mt-6 flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={finishing}>
              {t('onboarding.back')}
            </Button>
            <Button type="button" onClick={() => void finish()} disabled={finishing}>
              <CircleCheck aria-hidden="true" />
              {t('onboarding.understood')}
            </Button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}
