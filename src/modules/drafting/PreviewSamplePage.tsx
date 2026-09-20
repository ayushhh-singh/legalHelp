import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { A4Preview } from './components/A4Preview'
import { useTemplate } from './useDraftingData'

import { useAppStore } from '@/app/store'
import { FocusSlot } from '@/app/layouts/FocusSlot'
import { useFocusTitle } from '@/app/layouts/focusSlots'
import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { renderBilingual, renderDocument, sampleValues } from '@/lib/drafting/engine'
import type { BilingualRenderResult, RenderOptions, RenderResult } from '@/lib/drafting/types'
import type { DocTemplate } from './schema'

type PreviewView = 'en' | 'hi' | 'both'
const VIEWS: readonly PreviewView[] = ['en', 'hi', 'both']

/** `sessionStorage` key for the "example content only" banner's dismissal. */
const BANNER_DISMISSED_KEY = 'draft.preview.sample.bannerDismissed'

/**
 * `/draft/new/:type/preview` — the template's own worked example, read-only.
 *
 * This is deliberately a SEPARATE screen from `/draft/new/:type`, which
 * creates a real document and never renders the sample. `sampleValues()` was
 * pulled out of the engine specifically because filling a document with the
 * specimen's telephone number and "(A.B.C.)" was a real defect (`engine.ts`'s
 * own comment on `sampleValues`) — this page exists to let an officer see that
 * SAME specimen before choosing a form, without ever feeding it into
 * `documentFromTemplate` (ADR-041 §5). "Use this template" below is the exact
 * `<Link to="/draft/new/:type">` the gallery card itself renders, so creating
 * a document from here goes through the identical `NewDocumentPage` →
 * `createDocument` → `documentFromTemplate` path — never this page's own
 * `sampleValues()` call — and a reader can never end up with sample text in a
 * document they keep.
 *
 * Renders through the OLD, flat `renderDocument`/`renderBilingual` — the same
 * pair `sampleValues()` is built for — and the same `A4Preview` component the
 * real editor's live preview uses, so a worked example looks exactly like the
 * page it is a preview of.
 */
export default function PreviewSamplePage() {
  const { t } = useT()
  const { type = '' } = useParams()
  const template = useTemplate(type)

  if (template.status === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="sr-only">{t('draft.editor.tabs.preview')}</h1>
        <PageHeader title={t('draft.editor.unknownType')} subtitle={t('draft.editor.unknownTypeBody')} />
        <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={template.retry} />
      </div>
    )
  }
  if (template.status === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="sr-only">{t('draft.editor.tabs.preview')}</h1>
        <Skeleton className="h-10 w-2/3 max-w-md" />
        <Skeleton className="h-96 w-full" />
        <p className="sr-only" aria-live="polite">
          {t('common.loading')}
        </p>
      </div>
    )
  }
  return <Loaded template={template.data} />
}

function Loaded({ template }: { template: DocTemplate }) {
  const { t, language } = useT()
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const [view, setView] = useState<PreviewView>(language)
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(BANNER_DISMISSED_KEY) === '1'
    } catch {
      // A browser that refuses sessionStorage (a locked-down managed device,
      // a private window with storage denied) just shows the banner every
      // time — never a thrown error over a dismiss button.
      return false
    }
  })

  const title = t('draft.preview.sample.title', { name: template.name[language] })
  useFocusTitle(title)

  const values = useMemo(() => sampleValues(template), [template])
  const options: RenderOptions = useMemo(() => ({ devanagariDigits }), [devanagariDigits])
  const single: RenderResult | null = useMemo(
    () => (view === 'both' ? null : renderDocument(template, values, view, options)),
    [template, values, view, options],
  )
  const bilingual: BilingualRenderResult | null = useMemo(
    () => (view === 'both' ? renderBilingual(template, values, options) : null),
    [template, values, view, options],
  )

  const dismissBanner = () => {
    setBannerDismissed(true)
    try {
      sessionStorage.setItem(BANNER_DISMISSED_KEY, '1')
    } catch {
      // Nothing to persist without storage — the banner simply returns next
      // time this route is opened, which is a fine fallback.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FocusSlot host="actions">
        <label className="flex items-center">
          <span className="sr-only">{t('draft.preview.view.label')}</span>
          <select
            value={view}
            onChange={(event) => setView(event.target.value as PreviewView)}
            className="h-9 rounded-full border border-input bg-card px-3 text-xs"
          >
            {VIEWS.map((entry) => (
              <option key={entry} value={entry}>
                {t(`draft.preview.view.${entry}`)}
              </option>
            ))}
          </select>
        </label>
        <Button asChild size="sm">
          <Link to={`/draft/new/${template.id}`}>{t('draft.preview.sample.use')}</Link>
        </Button>
      </FocusSlot>

      <h1 className="sr-only">{title}</h1>

      {!bannerDismissed ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-lg border-l-[3px] border-marigold bg-marigold/15 p-3 text-sm text-marigold-foreground"
        >
          <p>{t('draft.preview.sample.banner')}</p>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label={t('draft.preview.sample.dismiss')}
            className="shrink-0 text-marigold-foreground/80 transition-colors hover:text-marigold-foreground"
          >
            ×
          </button>
        </div>
      ) : null}

      <A4Preview view={view} single={single} bilingual={bilingual} />
    </div>
  )
}
