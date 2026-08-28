import pkg from '../../../../package.json'

import { useT } from '@/i18n/useT'

/**
 * `__BUILD_SHA__` is substituted at build time (vite.config.ts's `define`),
 * so `pnpm dev` and a unit test both see whatever `git rev-parse --short
 * HEAD` resolved to when the config last loaded — 'unknown' where there is
 * no `.git` to ask.
 */

/**
 * "Report a data error" (Settings): a prefilled `mailto:`, never a form this
 * app submits anywhere. The master context rules out a backend for anything
 * the reader types, and a bug report about a wrong figure is exactly that.
 */
const REPORT_EMAIL = 'asingh9@ee.iitr.ac.in'

function reportMailto(language: string): string {
  const subject = language === 'hi' ? 'Sahayak — डेटा में त्रुटि' : 'Sahayak — data error report'
  const body =
    language === 'hi'
      ? 'कृपया बताएं कि कौन-सा आँकड़ा गलत है, और सही स्रोत का लिंक हो तो जोड़ें:\n\n'
      : 'Which figure or record is wrong, and (if you have it) a link to the correct source:\n\n'
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function AboutSection() {
  const { t, language } = useT()

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 tabular-nums">
        <dt className="text-muted-foreground">{t('pages.settings.about.version')}</dt>
        <dd>{pkg.version}</dd>
        <dt className="text-muted-foreground">{t('pages.settings.about.build')}</dt>
        <dd>{__BUILD_SHA__}</dd>
        <dt className="text-muted-foreground">{t('pages.settings.about.licence')}</dt>
        <dd className="not-tabular-nums">{pkg.license}</dd>
      </dl>
      <p className="max-w-prose text-muted-foreground">{t('pages.settings.about.disclaimer')}</p>
      <a href={reportMailto(language)} className="text-primary underline-offset-4 hover:underline">
        {t('pages.settings.about.reportError')}
      </a>
    </div>
  )
}
