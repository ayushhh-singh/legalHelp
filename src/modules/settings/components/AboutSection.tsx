import pkg from '../../../../package.json'

import { useT } from '@/i18n/useT'
import { reportMailto } from '@/lib/reportMailto'

/**
 * `__BUILD_SHA__` is substituted at build time (vite.config.ts's `define`),
 * so `pnpm dev` and a unit test both see whatever `git rev-parse --short
 * HEAD` resolved to when the config last loaded — 'unknown' where there is
 * no `.git` to ask.
 */

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
