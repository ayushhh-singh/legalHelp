import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { A4Preview } from './components/A4Preview'
import { DocExportPanel } from './components/DocExportPanel'
import { CommentsPanel } from './editor/CommentsPanel'
import { DocumentEditor } from './editor/DocumentEditor'
import { FindReplace } from './editor/FindReplace'
import { MetaPanel } from './editor/MetaPanel'
import { ReviewPanel } from './editor/ReviewPanel'
import { SaveAsTemplate } from './editor/SaveAsTemplate'
import { ShortcutsSheet } from './editor/ShortcutsSheet'
import { VersionsPanel } from './editor/VersionsPanel'
import {
  addComment,
  deleteComment,
  listComments,
  listVersions,
  restoreVersion,
  setCommentResolved,
} from './documents'
import { getPattern, issueNumber, listPatterns } from './numberingStore'
import { listAddressees, putAddressee, readProfile } from './profileStore'
import { getPersonal, listPersonal, personalId, savePersonal } from './personalStore'
import { useOfficialDoc, useStorageQuota } from './useOfficialDoc'
import { useTemplate } from './useDraftingData'
import { useGlossary } from '@/modules/utils/glossary/useGlossaryData'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/app/store'
import { useT } from '@/i18n/useT'
import { evaluateChecklist } from '@/lib/drafting/checklist'
import { lintBlocksExport, lintDocument } from '@/lib/drafting/lint'
import { entryFromAddressee, senderFromProfile, signatureFromProfile } from '@/lib/drafting/profile'
import { resolvePersonal } from '@/lib/drafting/personal'
import {
  bodyForLanguage,
  bodySlotForLanguage,
  separateHindiBody,
  yearOfDocument,
} from '@/lib/drafting/docLang'
import { placeholderFields, type Addressee, type BodyDoc, type OfficialDoc } from '@/lib/drafting/model'
import { renderOfficialDoc, renderOfficialDocBilingual } from '@/lib/drafting/renderDoc'
import type { DocTemplate } from './schema'

/**
 * The document editor.
 *
 * Six tabs on one document: write, details, preview, review, versions and notes
 * to self. Below `lg` they are the only navigation; above it, write and preview
 * sit side by side, which is what the form-and-preview editor did and the one
 * thing about that screen that was right.
 *
 * Everything the page shows about the document — the preview, the checklist,
 * the lint — comes from `renderOfficialDoc`, so if the preview is wrong the
 * template or the renderer is wrong. That is the property Session 8 built the
 * old preview on and it is preserved exactly (ADR-041 §3).
 */

type Tab = 'write' | 'details' | 'preview' | 'review' | 'export' | 'versions' | 'comments'
/*
  `export` sits after `review` deliberately: the checklist is what gates the
  export, so the tab that explains a refusal is the one before it in the strip.
*/
const TABS: readonly Tab[] = ['write', 'details', 'preview', 'review', 'export', 'versions', 'comments']

export default function DocEditorPage() {
  const { t } = useT()
  const { id = '' } = useParams()
  const state = useOfficialDoc(id)

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-2/3 max-w-md" />
        <Skeleton className="h-64 w-full" />
        <p className="sr-only" aria-live="polite">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  if (state.status !== 'ready' || !state.doc) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader
          title={
            state.status === 'too-new'
              ? t('draft.editor.tooNew')
              : state.status === 'malformed'
                ? t('draft.editor.malformed')
                : t('draft.editor.missing')
          }
          subtitle={
            state.status === 'too-new'
              ? t('draft.editor.tooNewBody', { version: state.storedVersion ?? '?', current: 1 })
              : undefined
          }
        />
        <div>
          <Button asChild variant="outline">
            <Link to="/draft/documents">
              <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
              {t('draft.editor.back')}
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return <Loaded state={state} />
}

function Loaded({ state }: { state: ReturnType<typeof useOfficialDoc> }) {
  const doc = state.doc as OfficialDoc
  const template = useTemplate(doc.templateId)
  const personal = useLiveQuery(
    () => (doc.personalTemplateId ? getPersonal(doc.personalTemplateId) : Promise.resolve(null)),
    [doc.personalTemplateId],
  )
  const { t } = useT()

  if (template.status === 'error') {
    return <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={template.retry} />
  }
  if (template.status === 'loading') return <Skeleton className="h-64 w-full" />

  const resolved = personal ? resolvePersonal(template.data, personal) : template.data
  return <Editor state={state} template={resolved} personalName={personal?.name ?? null} />
}

function Editor({
  state,
  template,
  personalName,
}: {
  state: ReturnType<typeof useOfficialDoc>
  template: DocTemplate
  personalName: string | null
}) {
  const { t, language } = useT()
  const doc = state.doc as OfficialDoc
  const devanagariDigits = useAppStore((s) => s.devanagariDigits)
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((entry) => entry === params.get('tab')) ?? 'write'
  const setTab = useCallback(
    (next: Tab) => {
      const search = new URLSearchParams(window.location.search)
      search.set('tab', next)
      setParams(search, { replace: true })
    },
    [setParams],
  )

  const [findOpen, setFindOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [versionNotice, setVersionNotice] = useState('')
  const quota = useStorageQuota()

  const book = useLiveQuery(() => listAddressees(), []) ?? []
  const versions = useLiveQuery(() => listVersions(doc.id), [doc.id]) ?? []
  const comments = useLiveQuery(() => listComments(doc.id), [doc.id]) ?? []
  const patterns = useLiveQuery(() => listPatterns(), []) ?? []
  const myTemplates = useLiveQuery(() => listPersonal(), []) ?? []

  const options = useMemo(() => ({ devanagariDigits }), [devanagariDigits])
  const single = useMemo(
    () => renderOfficialDoc(doc, template, language, options),
    [doc, template, language, options],
  )
  const bilingual = useMemo(
    () => renderOfficialDocBilingual(doc, template, options),
    [doc, template, options],
  )
  const checklist = useMemo(() => evaluateChecklist(template, single), [template, single])
  const nowIso = useNowIso()
  /*
    The terminology check needs the glossary, and the glossary is 970 KB.

    `lintDocument` takes it as an ARGUMENT rather than importing it, so the
    970 KB stays out of whatever imports the lint (ADR-041 §6). The consequence
    is that somebody has to hand it over — and nobody did, so the check that
    suggests the standard Hindi term for an English word was implemented,
    tested, labelled in both languages, and could never fire. That is the shape
    ADR-039's second addendum named, found again here.

    `useGlossary(enabled)` is the same lazy gate `/utils/glossary` uses: the
    dataset is fetched only when the officer is actually reading Hindi, and an
    English document downloads none of it.
  */
  const glossary = useGlossary(language === 'hi')
  const glossaryTerms = useMemo(
    () => (glossary.status === 'ready' ? glossary.data.terms : undefined),
    [glossary],
  )
  const findings = useMemo(
    () =>
      lintDocument({
        doc,
        template,
        lang: language,
        result: single,
        now: nowIso,
        ...(glossaryTerms ? { glossary: glossaryTerms } : {}),
      }),
    [doc, template, language, single, nowIso, glossaryTerms],
  )
  const blocked = lintBlocksExport(findings)

  /*
    Which slot this language edits is asked ONCE, by `bodySlotForLanguage`.

    It used to be asked twice — the read said `bodyHi ? bodyHi : body`, the
    write said `lang === 'bilingual' ? bodyHi : body` — and for a bilingual
    document whose `bodyHi` was absent the two disagreed: the officer saw the
    English text, typed one character, and the English vanished.
  */
  const slot = bodySlotForLanguage(doc, language)
  const body: BodyDoc = bodyForLanguage(doc, language)
  const setBody = useCallback(
    (next: BodyDoc) => {
      state.update({ ...doc, [bodySlotForLanguage(doc, language)]: next })
    },
    [doc, language, state],
  )

  const fields = useMemo(
    () => [
      ...new Set([...template.fields.map((f) => f.id), ...(template.variables ?? []).map((v) => v.key)]),
    ],
    [template],
  )

  /**
   * Ctrl+S saves a version, Ctrl+P previews, Ctrl+F finds.
   *
   * An ORDINARY dependency array, not the mount-only-plus-latest-ref shape
   * `useGlobalShortcuts` uses — and the difference is worth stating, because
   * copying that shape here would be cargo cult. That hook needs it because it
   * holds state ACROSS keypresses (a pending `g` chord and its timer) that a
   * re-subscription would throw away. This handler holds none: every press is
   * complete in itself, so re-subscribing when `setTab` changes identity costs
   * nothing and keeps the closure current (ADR-029).
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void state.saveVersion('')
      } else if (key === 'p') {
        event.preventDefault()
        setTab('preview')
      } else if (key === 'f') {
        event.preventDefault()
        setFindOpen(true)
      } else if (event.key === '/') {
        // `event.key`, not the lower-cased `key`: on a keyboard where `/` needs
        // a modifier the two differ, and `?` is what CLAUDE.md records the
        // global shortcuts sheet binding for the same reason.
        event.preventDefault()
        setShortcutsOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, setTab])

  // The navigation guard. `beforeunload` covers a reload and a closed tab; an
  // in-app navigation is covered by flushing on unmount, which is better than a
  // blocking prompt because the write always succeeds.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state.dirty])

  const flush = state.flush
  useEffect(() => () => void flush(), [flush])

  const saveToBook = async (person: Addressee) => {
    await putAddressee(entryFromAddressee(person, `ab-${Date.now().toString(36)}`, new Date().toISOString()))
    setNotice(t('draft.meta.savedToBook'))
  }

  const numberControl = (
    <IssueNumberButton
      doc={doc}
      template={template}
      patterns={patterns}
      onIssued={(number) =>
        state.update({ ...doc, meta: { ...doc.meta, number }, issuedAt: new Date().toISOString() })
      }
      onNotice={setNotice}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={doc.title || doc.meta.subject[language] || t('draft.editor.untitled')}
        subtitle={t('draft.editor.openedFrom', { name: personalName ?? template.name[language] })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/documents">
            <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
            {t('draft.editor.back')}
          </Link>
        </Button>
        {personalName ? <Badge tone="warning">{t('draft.editor.yours')}</Badge> : null}
        <SaveAsTemplate
          doc={doc}
          template={template}
          existingNames={myTemplates.map((entry) => entry.name)}
          onSave={(personal) => {
            const at = new Date().toISOString()
            void savePersonal({ ...personal, id: personalId(), createdAt: at, updatedAt: at }).then((saved) =>
              setNotice(t('draft.personal.saved', { name: saved.name })),
            )
          }}
        />
        <SaveIndicator state={state} />
      </div>

      {state.save.kind === 'conflict' ? (
        <SectionCard className="border-destructive/50 p-4">
          <h2 className="text-sm font-semibold">{t('draft.editor.conflict')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('draft.editor.conflictBody')}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void state.resolveConflict('mine')}>
              {t('draft.editor.conflictKeepMine')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void state.resolveConflict('theirs')}>
              {t('draft.editor.conflictTakeTheirs')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {state.save.kind === 'quota' ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {t('draft.editor.quotaFull')}
        </p>
      ) : quota.low ? (
        <p
          role="status"
          className="rounded-lg border border-marigold/40 bg-marigold/15 p-3 text-sm text-marigold-foreground"
        >
          {t('draft.editor.quotaLow', { percent: Math.round((quota.ratio ?? 0) * 100) })}
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <div
        role="tablist"
        aria-label={t('draft.editor.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`draft-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls={`draft-panel-${entry}`}
            onClick={() => setTab(entry)}
            className={
              tab === entry
                ? 'border-b-[3px] border-marigold px-3 py-2 text-sm font-semibold'
                : 'border-b-[3px] border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t(`draft.editor.tabs.${entry}`)}
            {/*
              The "something must be fixed" marker.

              `aria-hidden` on the dot and a real sentence beside it, because a
              bullet inside a tab's accessible name is both meaningless to a
              screen reader ("Review bullet") and — as the first browser run of
              this spec found — enough to make `getByRole('tab', { name: 'Review' })`
              ambiguous with "Preview". Active state is never a glyph alone.
            */}
            {entry === 'review' && blocked ? (
              <>
                <span aria-hidden="true"> •</span>
                <span className="sr-only"> — {t('draft.review.errors', { count: 1 })}</span>
              </>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`draft-panel-${tab}`}
        aria-labelledby={`draft-tab-${tab}`}
        className="min-w-0"
        tabIndex={-1}
      >
        {tab === 'write' ? (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              {findOpen ? (
                <FindReplace
                  body={body}
                  onReplace={(next, count) => {
                    setBody(next)
                    setNotice(t('draft.find.replaced', { count }))
                  }}
                  onClose={() => setFindOpen(false)}
                />
              ) : null}
              {/*
                A bilingual document is one the officer SAID has two issues.
                Until then one body serves both, exactly as `values.ts#splitField`
                does for a field in the Session 8 form — and separating seeds the
                Hindi from what is written now rather than blanking it, for the
                same reason: an officer pressing this wants to edit, not retype.
              */}
              {language === 'hi' && slot === 'body' ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {t('draft.editor.separateHindiHint')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      state.update(separateHindiBody(doc))
                      setNotice(t('draft.editor.separatedHindi'))
                    }}
                  >
                    {t('draft.editor.separateHindi')}
                  </Button>
                </div>
              ) : null}
              <DocumentEditor
                body={body}
                lang={language}
                label={t('draft.editor.body')}
                placeholders={fields}
                onChange={setBody}
                onFindReplace={() => setFindOpen(true)}
                onInsertPhrase={() => setTab('details')}
                onInsertGlossary={() => setTab('details')}
                onAddEnclosure={() => setTab('details')}
                onAddCopyTo={() => setTab('details')}
                onNotice={setNotice}
              />
            </div>
            <A4Preview view={language} single={single} bilingual={null} className="min-w-0" />
          </div>
        ) : null}

        {tab === 'details' ? (
          <MetaPanel
            doc={doc}
            variables={template.variables ?? []}
            book={book}
            numberControl={numberControl}
            onChange={state.update}
            onSaveToBook={(person) => void saveToBook(person)}
            onFillFromProfile={() =>
              void readProfile().then((profile) => {
                state.update({
                  ...doc,
                  meta: {
                    ...doc.meta,
                    from: senderFromProfile(profile),
                    signature: { ...signatureFromProfile(profile) },
                    place: profile.place || doc.meta.place,
                  },
                })
                setNotice(t('draft.profile.saved'))
              })
            }
          />
        ) : null}

        {tab === 'preview' ? <A4Preview view="both" single={null} bilingual={bilingual} /> : null}

        {tab === 'review' ? (
          <ReviewPanel checklist={checklist} findings={findings} language={language} />
        ) : null}

        {tab === 'export' ? (
          <DocExportPanel
            doc={doc}
            single={single}
            bilingual={bilingual}
            checklist={checklist}
            lintBlocked={blocked}
            fallbackName={personalName ?? template.shortName[language]}
            onGoToText={() => setTab('write')}
          />
        ) : null}

        {tab === 'versions' ? (
          <VersionsPanel
            live={doc}
            versions={versions}
            language={language}
            notice={versionNotice}
            onSaveVersion={(label) => void state.saveVersion(label)}
            onRestore={(versionId) =>
              void restoreVersion(doc.id, versionId).then((restored) => {
                if (restored) {
                  state.reload()
                  setVersionNotice(t('draft.versions.restored'))
                }
              })
            }
          />
        ) : null}

        {tab === 'comments' ? (
          <CommentsPanel
            body={body}
            lang={language}
            comments={comments}
            onAdd={(index, text, note) => void addComment(doc.id, index, text, note)}
            onResolve={(commentId, resolvedValue) => void setCommentResolved(commentId, resolvedValue)}
            onDelete={(commentId) => void deleteComment(commentId)}
          />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {placeholderFields(body).length > 0 || blocked ? t('draft.review.exportBlocked') : ''}
      </p>
    </div>
  )
}

/** The clock, ticking once a minute — enough for "the date is in the future". */
function useNowIso(): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => clearInterval(handle)
  }, [])
  return now
}

function SaveIndicator({ state }: { state: ReturnType<typeof useOfficialDoc> }) {
  const { t } = useT()
  // The elapsed seconds are STATE moved by a timer, not `Date.now()` read
  // during render: a render is meant to be a pure function of its inputs, and a
  // clock read inside one produces a different answer every time React happens
  // to re-render (`react-hooks/purity`).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [])

  if (state.save.kind === 'saving')
    return <span className="text-xs text-muted-foreground">{t('draft.editor.saving')}</span>
  if (state.save.kind === 'error')
    return (
      <span role="alert" className="text-xs text-destructive">
        {t('draft.editor.saveFailed')}
      </span>
    )
  if (state.dirty) return <span className="text-xs text-muted-foreground">{t('draft.editor.unsaved')}</span>
  if (state.save.kind === 'saved') {
    return (
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {t('draft.editor.savedAgo', { seconds: Math.max(0, Math.round((now - state.save.at) / 1000)) })}
      </span>
    )
  }
  return null
}

function IssueNumberButton({
  doc,
  template,
  patterns,
  onIssued,
  onNotice,
}: {
  doc: OfficialDoc
  template: DocTemplate
  patterns: Awaited<ReturnType<typeof listPatterns>>
  onIssued: (number: string) => void
  onNotice: (message: string) => void
}) {
  const { t, language } = useT()
  const [patternId, setPatternId] = useState(patterns[0]?.id ?? '')

  if (patterns.length === 0) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('draft.meta.numberNoPattern')}</span>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/numbering">{t('draft.meta.numberAddPattern')}</Link>
        </Button>
      </div>
    )
  }

  const year = yearOfDocument(doc, new Date().getFullYear())

  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">{t('draft.numbering.patterns')}</span>
        <select
          className="w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
          value={patternId || patterns[0]?.id}
          onChange={(event) => setPatternId(event.target.value)}
        >
          {patterns.map((pattern) => (
            <option key={pattern.id} value={pattern.id}>
              {pattern.name || pattern.pattern}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        onClick={() => {
          const chosen = patternId || patterns[0]?.id
          if (!chosen) return
          void getPattern(chosen).then(async (pattern) => {
            if (!pattern) return
            const result = await issueNumber({
              patternId: chosen,
              docId: doc.id,
              type: template.shortName[language],
              year,
            })
            if (!result) return
            if (result.unknownTokens.length > 0) {
              onNotice(t('draft.meta.numberUnknownToken', { token: `{${result.unknownTokens[0]}}` }))
              return
            }
            onIssued(result.number)
            onNotice(
              result.duplicates.length > 0
                ? t('draft.meta.numberDuplicate', {
                    number: result.number,
                    date: (result.duplicates[0]?.issuedAt ?? '').slice(0, 10),
                  })
                : t('draft.meta.numberIssued', { number: result.number }),
            )
          })
        }}
      >
        {t('draft.meta.numberIssue')}
      </Button>
    </div>
  )
}
