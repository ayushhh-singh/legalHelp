import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Printer } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { A4Preview } from './components/A4Preview'
import { getLetterhead } from './letterheadStore'
import { useObjectUrl } from './useObjectUrl'
import { getPersonal } from './personalStore'
import { useOfficialDoc } from './useOfficialDoc'
import { useTemplate } from './useDraftingData'

import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/app/store'
import { useT } from '@/i18n/useT'
import type { OfficialDoc } from '@/lib/drafting/model'
import { resolvePersonal } from '@/lib/drafting/personal'
import { renderOfficialDoc, renderOfficialDocBilingual } from '@/lib/drafting/renderDoc'
import {
  bilingualMismatch,
  defaultPageSetup,
  isPageSize,
  pageRuleCss,
  PAGE_SIZES,
  type PageSize,
} from '@/lib/drafting/print'
import type { DocTemplate } from './schema'

/**
 * The print route — `/draft/d/:id/print`.
 *
 * A route of its own rather than a print stylesheet over the editor, because
 * what is printed is a DECISION: which language, which paper, whether the
 * letterhead goes on, whether page numbers do. Those are controls, and a
 * control that only reveals its effect in a print preview belongs on a page
 * whose whole content is the thing being printed.
 *
 * ### The `@page` rule is generated
 *
 * `size` and `margin` inside `@page` cannot read a custom property — a browser
 * treats `@page { size: var(--x) }` as invalid and falls back to the printer's
 * own default, which is Letter in some locales. So the rule is built as literal
 * text by `pageRuleCss` and injected; it is NAMED, for the reason `draft-a4`
 * and `library-a4` are named, so asking for a margin here cannot move the pay
 * slip or the law card.
 *
 * ### Which paper the sheet is
 *
 * `.a4-page` paints fixed white paper with dark ink in both themes because it
 * is a FACSIMILE of a Government letter — that is the right surface for the
 * document itself. Everything AROUND it on this screen is app chrome and keeps
 * the theme tokens, which is the distinction ADR-040's notes record a session
 * getting wrong in the other direction.
 */

type View = 'en' | 'hi' | 'both'
const VIEWS: readonly View[] = ['en', 'hi', 'both']

export default function PrintPage() {
  const { t } = useT()
  const { id = '' } = useParams()
  const state = useOfficialDoc(id)

  if (state.status === 'loading') return <Skeleton className="h-64 w-full" />
  if (state.status !== 'ready' || !state.doc) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('draft.editor.missing')} />
        <div>
          <Button asChild variant="outline">
            <Link to="/draft/documents">{t('draft.editor.back')}</Link>
          </Button>
        </div>
      </div>
    )
  }
  return <Loaded doc={state.doc} />
}

function Loaded({ doc }: { doc: OfficialDoc }) {
  const { t } = useT()
  const template = useTemplate(doc.templateId)
  const personal = useLiveQuery(
    () => (doc.personalTemplateId ? getPersonal(doc.personalTemplateId) : Promise.resolve(null)),
    [doc.personalTemplateId],
  )

  if (template.status === 'error') {
    return <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={template.retry} />
  }
  if (template.status === 'loading') return <Skeleton className="h-64 w-full" />

  return <Sheet doc={doc} template={personal ? resolvePersonal(template.data, personal) : template.data} />
}

function Sheet({ doc, template }: { doc: OfficialDoc; template: DocTemplate }) {
  const { t, language } = useT()
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const [params, setParams] = useSearchParams()

  const view: View =
    VIEWS.find((entry) => entry === params.get('view')) ??
    (doc.lang === 'bilingual' ? 'both' : doc.lang === 'hi' ? 'hi' : language)
  const size: PageSize = isPageSize(params.get('paper')) ? (params.get('paper') as PageSize) : 'A4'
  const letterheadOn = params.get('letterhead') !== '0'
  const pageNumbers = params.get('pages') !== '0'

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const setup = useMemo(() => ({ ...defaultPageSetup(size) }), [size])
  const options = useMemo(() => ({ devanagariDigits }), [devanagariDigits])
  const single = useMemo(
    () => (view === 'both' ? null : renderOfficialDoc(doc, template, view, options)),
    [doc, template, view, options],
  )
  const bilingual = useMemo(
    () => (view === 'both' ? renderOfficialDocBilingual(doc, template, options) : null),
    [doc, template, view, options],
  )
  const mismatch = bilingual ? bilingualMismatch(bilingual.en.document, bilingual.hi.document) : null

  const letterheadRow = useLiveQuery(() => getLetterhead(), [])
  const letterheadImage = useObjectUrl(letterheadOn ? letterheadRow?.data : null)

  /*
    The running header carries the IMAGE and nothing else.

    The profile's letterhead LINES are already in the document — `applyStationery`
    prepends them to the first `header` block — so repeating them here would
    print them twice on page one. An image cannot travel that way and a
    repeating one is right anyway: it is the mark at the top of every sheet,
    while a letterhead is the address at the head of the first.
  */

  return (
    <div className="flex flex-col gap-4">
      {/*
        The generated page rule. `<style>` rather than an inline style, because
        `@page` is an at-rule and there is no element to hang it on.
      */}
      <style>{pageRuleCss(setup)}</style>

      <div data-print-hide className="flex flex-col gap-4">
        <PageHeader title={t('draft.print.title')} subtitle={t('draft.print.subtitle')} />

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/draft/d/${doc.id}`}>
              <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
              {t('draft.print.close')}
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="mr-1 size-4" />
            {t('draft.print.open')}
          </Button>
        </div>

        <SectionCard className="flex flex-wrap gap-4 p-4">
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="font-medium">{t('draft.print.view')}</legend>
            <div className="flex gap-2">
              {VIEWS.map((entry) => (
                <label key={entry} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="print-view"
                    checked={view === entry}
                    onChange={() => set('view', entry)}
                  />
                  {t(
                    entry === 'en'
                      ? 'draft.print.viewEn'
                      : entry === 'hi'
                        ? 'draft.print.viewHi'
                        : 'draft.print.viewBoth',
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.print.pageSize')}</span>
            <select
              value={size}
              onChange={(event) => set('paper', event.target.value)}
              className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
            >
              {PAGE_SIZES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(entry === 'A4' ? 'draft.print.a4' : 'draft.print.letter')}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={letterheadOn}
              onChange={(event) => set('letterhead', event.target.checked ? '1' : '0')}
            />
            {t('draft.print.letterheadOn')}
          </label>

          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={pageNumbers}
              onChange={(event) => set('pages', event.target.checked ? '1' : '0')}
            />
            {t('draft.print.pageNumbers')}
          </label>
        </SectionCard>

        {mismatch ? (
          <p
            role="status"
            className="rounded-lg border-l-[3px] border-marigold bg-marigold/15 p-3 text-sm text-marigold-foreground"
          >
            {t('draft.print.mismatch', { en: mismatch.en, hi: mismatch.hi })}
          </p>
        ) : null}

        <SectionCard className="p-4">
          <h2 className="text-sm font-semibold">{t('draft.print.instructions.title')}</h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>{t('draft.print.instructions.one')}</li>
            <li>{t('draft.print.instructions.two')}</li>
            <li>{t('draft.print.instructions.three')}</li>
            <li>{t('draft.print.instructions.four')}</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">{t('draft.print.pdfNote')}</p>
        </SectionCard>
      </div>

      <div className="draft-print-root">
        {letterheadOn && letterheadRow ? (
          <div className="draft-running-header" aria-hidden="true">
            {/*
              Gated on the ROW, not on a URL. `useObjectUrl` writes the `src` on
              to this element in an effect, so the element has to exist for the
              effect to find — gating on the URL would mean the image never
              rendered at all.
            */}
            <img ref={letterheadImage} alt="" className="draft-letterhead-image" />
          </div>
        ) : null}

        <A4Preview view={view} single={single} bilingual={bilingual} />

        {pageNumbers ? (
          <div className="draft-running-footer" aria-hidden="true">
            <span className="draft-page-number" /> {t('draft.print.pageOf')}{' '}
            <span className="draft-page-total" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
