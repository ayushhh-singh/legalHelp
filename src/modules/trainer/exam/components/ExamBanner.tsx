import { Info } from 'lucide-react'

import { InfoCard } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

import type { ExamProfile } from '@/schemas/exam'

/**
 * The banner every exam surface carries, and the two things under it.
 *
 * Unconditional, and deliberately not the `verify: true` treatment. That flag
 * says whether the pattern was read from a document this repository fetched;
 * this says something true either way — a notification is published for one
 * examination in one year, and it is the reader's own department's current
 * circular that governs them.
 *
 * The second line is the weights caveat. No notification apportions a paper
 * between its topics, so every weight on every screen is this app's own even
 * split, and saying so once per screen is the price of showing them at all.
 */
export function ExamBanner({ profile }: { profile: ExamProfile }) {
  const { t, language } = useT()

  return (
    <InfoCard title={t('trainer.exam.banner')} icon={Info} className="border-marigold/50">
      <p className="text-sm">{profile.weightBasis[language] || profile.weightBasis.en}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('trainer.exam.sourceLabel')}:{' '}
        <a
          href={profile.patternSource.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline decoration-dotted underline-offset-2"
        >
          {profile.patternSource.name}
        </a>
      </p>
    </InfoCard>
  )
}
