import { ArrowLeft, FileUp, Upload } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { importFile, type ImportFailure, type ImportedDocument } from './import/readFile'
import { loadTemplate } from './data'
import { docId, putDocument } from './documents'
import { readProfile } from './profileStore'
import { useDraftingIndex } from './useDraftingData'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cleanPastedText } from '@/lib/drafting/paste'
import { extractMeta } from '@/lib/drafting/extract'
import { senderFromProfile, signatureFromProfile } from '@/lib/drafting/profile'
import { emptyMeta, newDoc, type OfficialDoc } from '@/lib/drafting/model'
import type { ImportNotice } from '@/lib/drafting/importDocx'

/**
 * Importing a document an officer already has.
 *
 * Three claims this screen makes and keeps:
 *
 * 1. **The file is read here.** Nothing is uploaded — the two readers are
 *    `mammoth` and `pdfjs-dist`, both running in this tab — and the screen says
 *    so above the control rather than in a footnote.
 * 2. **Nothing is imported silently.** Every lossy step in the conversion
 *    produces a notice, and the notices are on the review screen BEFORE the
 *    document is created, not in a toast after it. An officer who sees "3
 *    images were left out" before pressing Create can go back to Word.
 * 3. **Nothing is invented.** The four facts read off the first page are
 *    offered with how confident the extractor is about each, and a box the file
 *    did not fill is empty. An officer correcting a wrong file number they did
 *    not type is worse off than one typing it.
 */

type Stage =
  | { kind: 'choose' }
  | { kind: 'reading'; name: string }
  | { kind: 'failed'; reason: ImportFailure }
  | { kind: 'review'; imported: ImportedDocument }

export default function ImportPage() {
  const { t, language } = useT()
  const navigate = useNavigate()
  const index = useDraftingIndex()
  const [stage, setStage] = useState<Stage>({ kind: 'choose' })
  const [paste, setPaste] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const take = useCallback(async (file: File) => {
    setStage({ kind: 'reading', name: file.name })
    const result = await importFile(file)
    setStage(
      result.ok ? { kind: 'review', imported: result.document } : { kind: 'failed', reason: result.reason },
    )
  }, [])

  const usePasted = useCallback(() => {
    const cleaned = cleanPastedText(paste)
    setStage({
      kind: 'review',
      imported: {
        body: cleaned.body,
        notices: [],
        meta: extractMeta(paste),
        letterhead: [],
        footer: [],
        garbledHindi: false,
        source: 'text',
      },
    })
  }, [paste])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={t('draft.import.title')} subtitle={t('draft.import.lead')} />

      <div>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/documents">
            <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
            {t('draft.import.back')}
          </Link>
        </Button>
      </div>

      <p className="rounded-lg border-l-[3px] border-marigold bg-marigold/15 p-3 text-sm text-marigold-foreground">
        {t('draft.import.privacy')}
      </p>

      {stage.kind === 'review' ? (
        <ReviewStep
          imported={stage.imported}
          templates={index.status === 'ready' ? index.data.templates : []}
          language={language}
          onRestart={() => setStage({ kind: 'choose' })}
          onCreated={(id) => void navigate(`/draft/d/${id}`)}
        />
      ) : (
        <>
          {/*
            A label wrapping a visually hidden file input, not a button that
            calls `input.click()`. The native control is what a screen reader
            announces as a file picker and what a keyboard opens with Enter; a
            button proxy loses both and gains nothing.
          */}
          <label
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center ${
              dragging ? 'border-primary bg-accent/40' : 'border-border bg-muted/40'
            }`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files[0]
              if (file) void take(file)
            }}
          >
            <Upload aria-hidden="true" className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">{t('draft.import.drop')}</span>
            <span className="text-xs text-muted-foreground">{t('draft.import.cap')}</span>
            <input
              ref={input}
              type="file"
              accept=".docx,.pdf,.txt,.md"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared so that choosing the SAME file twice — after a
                // failure the officer has gone away and fixed — fires `change`
                // again. Without this the second attempt does nothing at all.
                event.target.value = ''
                if (file) void take(file)
              }}
            />
            <span className="rounded-[10px] border border-input px-3 py-2 text-sm font-medium">
              {t('draft.import.choose')}
            </span>
          </label>

          <p aria-live="polite" className="text-sm text-muted-foreground">
            {stage.kind === 'reading' ? t('draft.import.readingFile', { name: stage.name }) : ''}
          </p>

          {stage.kind === 'failed' ? (
            <p
              role="alert"
              className="rounded-lg border border-coral/30 bg-coral/15 p-3 text-sm text-coral-foreground"
            >
              {t(FAILURE_KEY[stage.reason])}
            </p>
          ) : null}

          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold">{t('draft.import.pasteInstead')}</h2>
            <label className="mt-2 flex flex-col gap-1 text-sm">
              <span className="sr-only">{t('draft.import.pasteLabel')}</span>
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                rows={6}
                placeholder={t('draft.import.pastePlaceholder')}
                className="w-full rounded-[10px] border border-input bg-card p-3 text-sm"
              />
            </label>
            <div className="mt-2">
              <Button size="sm" disabled={paste.trim().length === 0} onClick={usePasted}>
                {t('draft.import.pasteApply')}
              </Button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}

/**
 * A failure to the key that explains it.
 *
 * A literal map rather than a computed key, because `useT`'s `t` is typed
 * against the catalogue: an entry naming a key that does not exist is a compile
 * error here, and a template-string key would not be checked at all.
 */
const FAILURE_KEY = {
  'too-big': 'draft.import.errors.tooBig',
  empty: 'draft.import.errors.empty',
  unsupported: 'draft.import.errors.unsupported',
  'wrong-kind': 'draft.import.errors.wrongKind',
  'pdf-password': 'draft.import.errors.pdfPassword',
  'pdf-no-text': 'draft.import.errors.pdfNoText',
  'docx-empty': 'draft.import.errors.docxEmpty',
  failed: 'draft.import.errors.failed',
} as const satisfies Record<ImportFailure, string>

// ------------------------------------------------------------------ review

function ReviewStep({
  imported,
  templates,
  language,
  onRestart,
  onCreated,
}: {
  imported: ImportedDocument
  templates: { id: string; name: { en: string; hi: string } }[]
  language: 'en' | 'hi'
  onRestart: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useT()
  const [templateId, setTemplateId] = useState(
    templates.some((entry) => entry.id === 'letter') ? 'letter' : (templates[0]?.id ?? 'letter'),
  )
  const [lang, setLang] = useState<OfficialDoc['lang']>(language)
  const [useLetterhead, setUseLetterhead] = useState(imported.letterhead.length > 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const paragraphs = useMemo(() => (imported.body.content ?? []).length, [imported.body])

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      // Loaded before the row is written: a template id that will not load is
      // a document that opens onto an error, and finding that out now costs
      // nothing while finding it out later costs the officer their import.
      await loadTemplate(templateId)
      const profile = await readProfile()
      const at = new Date().toISOString()
      const meta = {
        ...emptyMeta(),
        number: imported.meta.number,
        date: imported.meta.dateIso || imported.meta.date,
        subject: {
          en: lang === 'hi' ? '' : imported.meta.subject,
          hi: lang === 'hi' ? imported.meta.subject : '',
        },
        from: {
          ...senderFromProfile(profile),
          ...(useLetterhead && imported.letterhead.length > 0
            ? { letterhead: imported.letterhead.slice(0, 4).map((line) => ({ en: line, hi: line })) }
            : {}),
        },
        signature: signatureFromProfile(profile),
        ...(imported.meta.to.length > 0
          ? {
              to: [
                {
                  id: 'to-1',
                  bookId: null,
                  name: { en: imported.meta.to[0] ?? '', hi: '' },
                  designation: { en: imported.meta.to[1] ?? '', hi: '' },
                  organisation: { en: imported.meta.to[2] ?? '', hi: '' },
                  address: imported.meta.to.slice(3),
                  phone: '',
                  email: '',
                },
              ],
            }
          : {}),
      }
      const document = newDoc({
        id: docId(),
        templateId,
        lang,
        at,
        meta,
        body: imported.body,
        title: imported.meta.subject || imported.meta.number,
      })
      await putDocument(document)
      onCreated(document.id)
    } catch {
      setError(t('draft.import.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {imported.garbledHindi ? (
        <div role="alert" className="rounded-lg border border-coral/30 bg-coral/15 p-3">
          <p className="text-sm font-semibold text-coral-foreground">{t('draft.import.garbled.title')}</p>
          <p className="mt-1 text-sm text-coral-foreground">{t('draft.import.garbled.body')}</p>
        </div>
      ) : null}

      <NoticesCard notices={imported.notices} />

      <SectionCard className="p-4">
        <h2 className="text-sm font-semibold">{t('draft.import.review.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('draft.import.review.lead')}</p>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <Fact
            label={t('draft.import.review.number')}
            value={imported.meta.number}
            confidence={imported.meta.confidence.number}
          />
          <Fact
            label={t('draft.import.review.date')}
            value={imported.meta.date}
            confidence={imported.meta.confidence.date}
          />
          <Fact
            label={t('draft.import.review.subject')}
            value={imported.meta.subject}
            confidence={imported.meta.confidence.subject}
          />
          <Fact
            label={t('draft.import.review.to')}
            value={imported.meta.to.join(', ')}
            confidence={imported.meta.confidence.to}
          />
          <Fact
            label={t('draft.import.review.reference')}
            value={imported.meta.reference}
            confidence={imported.meta.confidence.reference}
          />
        </dl>

        {imported.letterhead.length > 0 ? (
          <div className="mt-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{t('draft.import.review.letterhead')}</p>
            <ul className="mt-1 text-sm text-muted-foreground">
              {imported.letterhead.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useLetterhead}
                onChange={(event) => setUseLetterhead(event.target.checked)}
              />
              {t('draft.import.review.useLetterhead')}
            </label>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard className="p-4">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.import.review.template')}</span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
            >
              {templates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name[language]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.import.review.language')}</span>
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value as OfficialDoc['lang'])}
              className="rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="bilingual">English + हिंदी</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('draft.import.review.paragraphs', { count: paragraphs })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void create()} disabled={busy}>
            <FileUp aria-hidden="true" className="mr-1 size-4" />
            {busy ? t('draft.import.creating') : t('draft.import.create')}
          </Button>
          <Button variant="outline" onClick={onRestart}>
            {t('draft.import.choose')}
          </Button>
        </div>
        <p aria-live="assertive" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      </SectionCard>
    </div>
  )
}

function Fact({
  label,
  value,
  confidence,
}: {
  label: string
  value: string
  confidence: 'high' | 'low' | 'none'
}) {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-32 shrink-0 font-medium">{label}</dt>
      <dd className="min-w-0 flex-1">
        {value ? (
          <span className="break-words">{value}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}{' '}
        <Badge tone={confidence === 'high' ? 'success' : confidence === 'low' ? 'warning' : 'neutral'}>
          {t(`draft.import.review.confidence.${confidence}`)}
        </Badge>
      </dd>
    </div>
  )
}

function NoticesCard({ notices }: { notices: readonly ImportNotice[] }) {
  const { t } = useT()
  if (notices.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t('draft.import.notices.none')}
      </p>
    )
  }
  return (
    <SectionCard className="p-4">
      <h2 className="text-sm font-semibold">{t('draft.import.notices.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('draft.import.notices.lead')}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
        {notices.map((notice) => (
          <li key={notice.code}>
            {t(NOTICE_KEY[notice.code], {
              count: notice.count,
              items: notice.items.join(', '),
            })}
            {notice.items.length > 0 && notice.code !== 'unsupported' ? (
              <span className="block text-xs text-muted-foreground">
                {t('draft.import.notices.items', { items: notice.items.join(', ') })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/**
 * A notice code to the sentence that explains it.
 *
 * Spelled out rather than derived by case-converting the code, for the reason
 * `FAILURE_KEY` is: `t` is typed against the catalogue, so a notice added to
 * `ImportNoticeCode` without a sentence to go with it fails to compile — and
 * `satisfies Record<...>` is what makes the exhaustiveness real rather than
 * incidental.
 */
const NOTICE_KEY = {
  'tracked-changes': 'draft.import.notices.trackedChanges',
  images: 'draft.import.notices.images',
  'merged-cells': 'draft.import.notices.mergedCells',
  header: 'draft.import.notices.header',
  footer: 'draft.import.notices.footer',
  footnotes: 'draft.import.notices.footnotes',
  columns: 'draft.import.notices.columns',
  'numbered-paras': 'draft.import.notices.numberedParas',
  unsupported: 'draft.import.notices.unsupported',
} as const satisfies Record<ImportNotice['code'], string>
