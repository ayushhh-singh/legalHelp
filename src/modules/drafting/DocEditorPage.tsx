import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  Copy,
  Eye,
  FileDown,
  History,
  Link2,
  PanelRight,
  Printer,
  Save,
  Trash2,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { A4Preview } from './components/A4Preview'
import { DocExportPanel } from './components/DocExportPanel'
import { GlossarySheet } from './components/GlossarySheet'
import { PhraseSheet } from './components/PhraseSheet'
import { CommentsPanel } from './editor/CommentsPanel'
import { DocumentEditor } from './editor/DocumentEditor'
import { DocumentOutline } from './editor/DocumentOutline'
import { FindReplace } from './editor/FindReplace'
import { MetaPanel } from './editor/MetaPanel'
import { ReviewPanel } from './editor/ReviewPanel'
import { SaveAsTemplate } from './editor/SaveAsTemplate'
import { ShortcutsSheet } from './editor/ShortcutsSheet'
import { VersionsPanel } from './editor/VersionsPanel'
import {
  addComment,
  deleteComment,
  deleteDocument,
  duplicateDocument,
  listComments,
  listDocuments,
  listVersions,
  restoreVersion,
  setCommentResolved,
  snapshot,
} from './documents'
import { getPattern, issueNumber, listPatterns } from './numberingStore'
import { duplicatesOf, listEntries, recordIssuedNumber } from './register/registerStore'
import { listAddressees, putAddressee, readProfile } from './profileStore'
import { getPersonal, listPersonal, personalId, savePersonal } from './personalStore'
import { useOfficialDoc, useStorageQuota } from './useOfficialDoc'
import { useTemplate } from './useDraftingData'
import { useGlossary } from '@/modules/utils/glossary/useGlossaryData'
import { useAi } from '@/ai/useAi'

/*
  The "Change" panel is lazy for the reason the whole AI layer is: laziness here
  is a privacy property, not a performance one (`docs/AI.md`). It pulls
  `@/ai/agents/modify` only when a run starts, so opening the tab to use the
  consistency check costs nothing.
*/
const ModifyPanel = lazy(() =>
  import('./editor/ModifyPanel').then((module) => ({ default: module.ModifyPanel })),
)

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { FOCUS_MENU_ITEM } from '@/app/layouts/FocusLayout'
import { FocusSlot } from '@/app/layouts/FocusSlot'
import { useFocusMenuClose, useFocusStatus } from '@/app/layouts/focusSlots'
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
import { cn } from '@/lib/utils'
import type { DocTemplate } from './schema'

/**
 * The document editor, at level 3 (ADR-046, Session 35).
 *
 * Eight tabs became a WORKSPACE: the document's outline down the left, a
 * page-like editing surface in the middle, and one panel on the right whose
 * four tabs are the things an officer looks at WHILE writing — what is wrong
 * with it, how to change it, what it used to say, and what they told themselves
 * about it. Nothing was removed; the details became a card at the head of the
 * surface, the preview and the export moved to the ⋯ menu, and the ⋯ menu is in
 * the focus bar because there is no app top bar at this level.
 *
 * Everything the page shows about the document — the preview, the checklist,
 * the lint — comes from `renderOfficialDoc`, so if the preview is wrong the
 * template or the renderer is wrong. That is the property Session 8 built the
 * old preview on and it is preserved exactly (ADR-041 §3).
 *
 * ### Two URL parameters, and why not one
 *
 * `view` is what the MIDDLE shows and `panel` is what the RIGHT shows, and on a
 * desktop both are on screen at once — so one parameter could not describe the
 * screen. `view=panel` is the phone's way of saying "the panel instead of the
 * document", and on a desktop it reads as `write`, because there the panel is
 * never instead of anything.
 */

/** What the middle column shows. */
type View = 'write' | 'preview' | 'panel' | 'export'
const VIEWS: readonly View[] = ['write', 'preview', 'panel', 'export']

/** What the right-hand panel shows. */
type Panel = 'check' | 'assist' | 'versions' | 'comments'
/*
  Both the union and this array need a new id, or the tab renders as a blank
  panel — the tablist maps over the array and the panel switch is keyed on the
  union, so adding to one and not the other is a tab that exists and shows
  nothing. Session 30 warned about exactly that when they added `export`.
*/
const PANELS: readonly Panel[] = ['check', 'assist', 'versions', 'comments']

/** The phone's three-way strip. `panel` is labelled by its first tab. */
const PHONE_VIEWS: readonly View[] = ['write', 'preview', 'panel']

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
  const ai = useAi()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = VIEWS.find((entry) => entry === params.get('view')) ?? 'write'
  const panel = PANELS.find((entry) => entry === params.get('panel')) ?? 'check'

  /*
    Both written through `window.location.search` rather than the `params`
    object this render closed over: two menu entries in a row (open Versions,
    then go back to the text) would otherwise have the second overwrite the
    first's parameter with the value it had before the first ran.
  */
  const setSearch = useCallback(
    (patch: Record<string, string>) => {
      const search = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(patch)) search.set(key, value)
      setParams(search, { replace: true })
    },
    [setParams],
  )
  const setView = useCallback((next: View) => setSearch({ view: next }), [setSearch])
  /*
    Choosing a panel also brings it into VIEW, which matters only on a phone —
    on a desktop `view: 'panel'` renders as `write` and the panel was already
    beside the text. One call rather than a branch on the viewport, because a
    branch on the viewport in React disagrees with the rendered layout for a
    frame after every resize (`src/lib/nav.ts`'s own rule).
  */
  const setPanel = useCallback((next: Panel) => setSearch({ panel: next, view: 'panel' }), [setSearch])

  const [findOpen, setFindOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [versionNotice, setVersionNotice] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [threadOpen, setThreadOpen] = useState(false)
  /*
    The Rajbhasha glossary sheet and the phrase library.

    Both shipped in Session 8, both were mounted only by the form-and-preview
    editor, and deleting that screen left them in the tree with every unit test
    green and no route reaching them — `docs/DATA-GAPS.md` #94. The toolbar
    still carried their two buttons, which opened the details card instead: a
    control that does something other than what it says. They are re-homed here
    on the editor's own caret, which is what #94 said it would take.
  */
  const [sheet, setSheet] = useState<'glossary' | 'phrase' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const quota = useStorageQuota()
  const closeMenu = useFocusMenuClose()
  useFocusStatus(useSaveStatus(state))

  /*
    The outline jumps the caret, and it does it through a function the editor
    hands up rather than by reaching into ProseMirror.

    A ref because it is written from an effect in a child and read from an
    event handler here — an external system's handle, which is the one thing a
    ref is for. `setJump` is stable, so the child's effect fires once per editor
    instance rather than once per render.
  */
  const jump = useRef<((index: number) => void) | null>(null)
  const setJump = useCallback((fn: (index: number) => void) => {
    jump.current = fn
  }, [])
  const insert = useRef<((text: string) => void) | null>(null)
  const setInsert = useCallback((fn: (text: string) => void) => {
    insert.current = fn
  }, [])

  const book = useLiveQuery(() => listAddressees(), []) ?? []
  const versions = useLiveQuery(() => listVersions(doc.id), [doc.id]) ?? []
  const comments = useLiveQuery(() => listComments(doc.id), [doc.id]) ?? []
  const patterns = useLiveQuery(() => listPatterns(), []) ?? []
  /*
    The register entry for the letter this document answers, so issuing a
    number files the reply on the letter's own thread.

    `null` when the document answers nothing — which is most documents — and the
    lookup is by `intakeId` rather than by subject or number, because those are
    both things an officer edits.
  */
  const inboundEntryId = useLiveQuery(async () => {
    if (!doc.linkedIntakeId) return null
    const found = (await listEntries()).find(
      (entry) => entry.direction === 'received' && entry.intakeId === doc.linkedIntakeId,
    )
    return found?.id ?? null
  }, [doc.linkedIntakeId])
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

    `useGlossary(enabled)` is the same lazy gate `/tools/glossary` uses: the
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
   * Ctrl+S a version, Ctrl+P print, Ctrl+E export, Ctrl+Shift+F find, Ctrl+/ help.
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
        /*
          Print is the PRINT ROUTE, not the preview tab it used to be.

          `/draft/d/:id/print` is where paper, language, letterhead and page
          numbers are chosen and where the `@page` rule is generated — going
          straight to `window.print()` from here would print the editing
          surface, and going to the preview would leave the officer one more
          press from the thing they asked for (ADR-042 §5).
        */
        event.preventDefault()
        void navigate(`/draft/d/${doc.id}/print`)
      } else if (key === 'e') {
        event.preventDefault()
        setView('export')
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
  }, [state, setView, navigate, doc.id])

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
      onIssued={(number) => {
        const at = new Date().toISOString()
        state.update({ ...doc, meta: { ...doc.meta, number }, issuedAt: at })
        /*
          The register's automatic entry (ADR-043 §5).

          It is HERE and not inside `issueNumber`, deliberately: issuing a
          number is a fact about the numbering series, and the register is a
          different ledger — wiring one into the other would mean a build with
          the register turned off could no longer issue a number. It is
          idempotent on the document id, so renumbering updates the entry
          rather than filing the same communication twice.

          `void` and not `await`: the officer's number is already on screen, and
          a register write that fails must not take the issue with it. The
          register is a record of what happened, and what happened is that the
          number was issued.
        */
        void recordIssuedNumber({
          docId: doc.id,
          number,
          date: doc.meta.date,
          subject: doc.meta.subject[language] || doc.title,
          at,
          intakeId: doc.linkedIntakeId ?? null,
          ...(inboundEntryId ? { inReplyTo: inboundEntryId } : {}),
        })
      }}
      onNotice={setNotice}
    />
  )

  /*
    The threads this officer already has, for "Move to thread".

    Read from the documents themselves rather than from the register, because
    the register's threads include inbound letters this app never drafted and
    the question here is which of MY documents this one belongs with. `''` is
    "no thread", which is what most documents are.
  */
  const threads =
    useLiveQuery(async () => {
      const rows = await listDocuments()
      const seen = new Map<string, string>()
      for (const row of rows) {
        if (!row.threadId || seen.has(row.threadId)) continue
        seen.set(row.threadId, row.title || t('draft.editor.untitled'))
      }
      return [...seen].map(([id, title]) => ({ id, title }))
    }, [t]) ?? []

  const surface = (
    <div className="flex min-w-0 flex-col gap-4">
      {/*
        The document's own chrome — number, date, subject, addressees,
        enclosures, urgency, status — as a card at the HEAD of the surface
        rather than a page of its own.

        A `<details>`, so it is one press to open and one to put away and its
        state costs nothing to remember. It is shut by default because an
        officer opening a document is opening it to write, and the fields it
        holds are already rendered in the preview from the same values.
      */}
      <details
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className="rounded-xl border border-border bg-card"
      >
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
          {/*
            The label is its own element, so it can be addressed as itself: the
            summary also carries the reference number, and anything matching on
            the summary's whole text is matching "Document detailsA-11011/1/…".
          */}
          <span>{t('draft.editor.details')}</span>
          <span className="font-normal text-muted-foreground">
            {doc.meta.number || t('draft.editor.detailsNoNumber')}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {/*
            Which form this document came from, and whether it came from one of
            the officer's OWN. Both used to be the page's masthead and subtitle;
            at level 3 the masthead is the document's title in the bar, and this
            is where a fact about the document rather than about the officer's
            writing belongs.
          */}
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t('draft.editor.openedFrom', { name: personalName ?? template.name[language] })}
            {personalName ? <Badge tone="warning">{t('draft.editor.yours')}</Badge> : null}
          </p>
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
        </div>
      </details>

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
        A bilingual document is one the officer SAID has two issues. Until then
        one body serves both, exactly as `values.ts#splitField` does for a field
        in the Session 8 form — and separating seeds the Hindi from what is
        written now rather than blanking it, for the same reason: an officer
        pressing this wants to edit, not retype.
      */}
      {language === 'hi' && slot === 'body' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <span className="min-w-0 flex-1 text-muted-foreground">{t('draft.editor.separateHindiHint')}</span>
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
        onJumpReady={setJump}
        onInsertReady={setInsert}
        onFindReplace={() => setFindOpen(true)}
        onInsertPhrase={() => setSheet('phrase')}
        onInsertGlossary={() => setSheet('glossary')}
        onAddEnclosure={() => setDetailsOpen(true)}
        onAddCopyTo={() => setDetailsOpen(true)}
        onNotice={setNotice}
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/*
        The document's name, as the page's ONE level-1 heading.

        `sr-only`, because the visible equivalent is the editable title box in
        the focus bar three lines below — a heading and a text input saying the
        same thing twice is what the bar was for. But a screen with no `<h1>` is
        a screen a reader tabbing in cannot place, which is the defect CLAUDE.md
        records all four exam routes shipping with; losing the masthead to the
        bar must not lose the heading with it.
      */}
      <h1 className="sr-only">{doc.title || doc.meta.subject[language] || t('draft.editor.untitled')}</h1>

      {/* ------------------------------------------------ the focus bar */}

      <FocusSlot host="title">
        {/*
          The title is EDITABLE in the bar, because the bar is where it is, and
          a document whose name can only be changed on another screen is one
          that stays called "Office Memorandum" for ever. It writes on every
          keystroke through the same debounced save as the body.
        */}
        <label className="flex min-w-0 flex-1 items-center">
          <span className="sr-only">{t('draft.editor.titleLabel')}</span>
          <input
            value={doc.title}
            onChange={(event) => state.update({ ...doc, title: event.target.value })}
            placeholder={t('draft.editor.untitled')}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold transition-colors hover:border-input focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
      </FocusSlot>

      <FocusSlot host="actions">
        {/*
          Draft / Final / Sent, as a control rather than a badge. It is one of
          the two things an officer changes about a document without opening
          it, and the other — the title — is beside it.
        */}
        {/*
          Visible at EVERY width, and the duplicate in `MetaPanel` is gone.

          It is the one control this bar has that a phone could plausibly do
          without, and the reason it stays is that the alternative was keeping a
          second copy in the details card — which is the "a control that
          duplicates one now in the bar" this session set out to delete. A
          `<select>` reading "Draft" is narrower than the title box it borrows
          from.
        */}
        <label className="flex items-center">
          <span className="sr-only">{t('draft.editor.status.label')}</span>
          <select
            value={doc.status}
            onChange={(event) =>
              state.update({ ...doc, status: event.target.value as OfficialDoc['status'] })
            }
            className="h-9 rounded-full border border-input bg-card px-3 text-xs"
          >
            <option value="draft">{t('draft.editor.status.draft')}</option>
            <option value="final">{t('draft.editor.status.final')}</option>
            <option value="sent">{t('draft.editor.status.sent')}</option>
          </select>
        </label>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 lg:hidden"
          aria-pressed={view === 'panel'}
          aria-label={view === 'panel' ? t('draft.panel.hide') : t('draft.panel.show')}
          onClick={() => setView(view === 'panel' ? 'write' : 'panel')}
        >
          <PanelRight aria-hidden="true" />
        </Button>
      </FocusSlot>

      <FocusSlot host="menu">
        {/*
          The bilingual preview, at EVERY width.

          The phone reaches it from its own Write/Preview/Check strip; a desktop
          has no strip, because the panel is beside the document rather than
          instead of it — so without this entry the one screen that shows the
          document as it will print would be reachable on a phone and not on a
          workstation. `view=preview` is the same state either control sets.
        */}
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setView(view === 'preview' ? 'write' : 'preview')
          }}
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          {view === 'preview' ? t('draft.view.write') : t('draft.editor.tabs.preview')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setView('export')
          }}
        >
          <FileDown aria-hidden="true" className="h-4 w-4" />
          {t('draft.export.menuDocx')}
        </button>
        <Link to={`/draft/d/${doc.id}/print`} className={FOCUS_MENU_ITEM} onClick={closeMenu}>
          <Printer aria-hidden="true" className="h-4 w-4" />
          {t('draft.export.printPdf')}
        </Link>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setPanel('versions')
          }}
        >
          <History aria-hidden="true" className="h-4 w-4" />
          {t('draft.editor.tabs.versions')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            void duplicateDocument(
              doc.id,
              t('draft.editor.duplicateOf', { name: doc.title || t('draft.editor.untitled') }),
            ).then((copy) => {
              // Straight into the copy: duplicating a document and staying on
              // the original is a press whose only visible effect is a row
              // appearing on a list the officer is not looking at.
              if (copy) void navigate(`/draft/d/${copy.id}`)
              else setNotice(t('draft.editor.duplicateFailed'))
            })
          }}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {t('draft.editor.duplicate')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setTemplateOpen(true)
          }}
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {t('draft.personal.saveAs')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setView('write')
            setDetailsOpen(true)
          }}
        >
          <span aria-hidden="true" className="w-4 text-center text-xs">
            №
          </span>
          {t('draft.meta.numberIssue')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setThreadOpen(true)
          }}
        >
          <Link2 aria-hidden="true" className="h-4 w-4" />
          {t('draft.editor.moveToThread')}
        </button>
        <button
          type="button"
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            closeMenu()
            setConfirmDelete(true)
          }}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          {t('draft.editor.delete')}
        </button>
      </FocusSlot>

      {/* ------------------------------------------------ the page */}

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

      {state.save.kind === 'error' ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {t('draft.editor.saveFailed')}
        </p>
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

      {/*
        Deleting is a two-press confirmation rather than a dialog, the same
        shape the address book uses — and it says what it is deleting, because a
        document is somebody's afternoon.
      */}
      {confirmDelete ? (
        <SectionCard className="border-destructive/50 p-4">
          <p className="text-sm">
            {t('draft.editor.deleteConfirm', { name: doc.title || t('draft.editor.untitled') })}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                /*
                  Cancel the queued write BEFORE the delete.

                  The page unmounts on the way to the document list and
                  `useOfficialDoc`'s unmount flush would otherwise write the
                  debounced document straight back — a deleted document that
                  reappears, silently, on the list the officer is now looking
                  at. Found by the test below, which asserted the row was gone
                  rather than that the screen had changed.
                */
                state.discard()
                void deleteDocument(doc.id).then(() => {
                  void navigate('/draft/documents')
                })
              }}
            >
              {t('draft.editor.delete')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {threadOpen ? (
        <SectionCard className="p-4">
          <h2 className="text-sm font-semibold">{t('draft.editor.moveToThread')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('draft.editor.moveToThreadHint')}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">{t('draft.editor.thread')}</span>
              <select
                value={doc.threadId ?? ''}
                onChange={(event) => {
                  /*
                    `new` means "start one here", and it is the option that
                    makes this control usable at all: the list is built from the
                    threads the officer's OTHER documents are on, and `newReply`
                    is the only thing that has ever set one — so on a device
                    where nobody has replied to a letter the menu opened a card
                    whose single option was the state the document was already
                    in. A document's own id is what `threadIdFor` uses for the
                    first communication on a thread, so this is the register's
                    own convention rather than a second one.
                  */
                  const chosen = event.target.value
                  const next = chosen === 'new' ? doc.id : chosen
                  /*
                    `threadId` is OPTIONAL on the model, so "no thread" is the
                    key being absent rather than an empty string — a stored
                    `threadId: ''` would group every document that has no
                    thread into one thread called nothing, which is what
                    `DraftHome`'s filter would then offer.
                  */
                  const withoutThread = { ...doc }
                  delete withoutThread.threadId
                  state.update(next ? { ...withoutThread, threadId: next } : withoutThread)
                  setNotice(next ? t('draft.editor.threadMoved') : t('draft.editor.threadCleared'))
                }}
                className="h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
              >
                <option value="">{t('draft.editor.threadNone')}</option>
                {doc.threadId === doc.id ? null : (
                  <option value="new">{t('draft.editor.threadStart')}</option>
                )}
                {threads
                  .filter((entry) => entry.id !== doc.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={() => setThreadOpen(false)}>
              {t('draft.find.close')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {sheet === 'glossary' ? (
        <GlossarySheet
          onInsert={(text) => {
            insert.current?.(text)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'phrase' ? (
        <PhraseSheet
          templateId={template.id}
          onInsert={(text) => {
            insert.current?.(text)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {/*
        Mounted only while it is open, which is what lets it seed its Name field
        from the document with a lazy initialiser rather than an effect. Radix's
        `onOpenChange` never fires for a controlled `open` that is simply true,
        so the seed has to happen at mount or not at all — and it did not, which
        is how the menu's way in produced an empty required field.
      */}
      {templateOpen ? (
        <SaveAsTemplate
          doc={doc}
          template={template}
          existingNames={myTemplates.map((entry) => entry.name)}
          open
          onOpenChange={setTemplateOpen}
          onSave={(personal) => {
            const at = new Date().toISOString()
            void savePersonal({ ...personal, id: personalId(), createdAt: at, updatedAt: at }).then((saved) =>
              setNotice(t('draft.personal.saved', { name: saved.name })),
            )
          }}
        />
      ) : null}

      {/*
        The phone's three-way strip. A real tab widget: one panel is swapped in
        place, in the same document, with no navigation — which is exactly what
        ADR-046 §6 says the sub-tab STRIPS are not, and why they are links and
        this is not.
      */}
      <div
        role="tablist"
        aria-label={t('draft.editor.title')}
        className="flex gap-1 border-b border-border lg:hidden"
      >
        {PHONE_VIEWS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`draft-view-${entry}`}
            aria-selected={view === entry || (entry === 'write' && view === 'export')}
            aria-controls="draft-view-panel"
            onClick={() => setView(entry)}
            className={
              view === entry
                ? 'min-h-11 flex-1 border-b-[3px] border-marigold text-sm font-semibold'
                : 'min-h-11 flex-1 border-b-[3px] border-transparent text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t(`draft.view.${entry}`)}
            {/*
              The "something must be fixed" marker.

              `aria-hidden` on the dot and a real sentence beside it, because a
              bullet inside a tab's accessible name is both meaningless to a
              screen reader ("Check bullet") and enough to make a substring
              match ambiguous with a neighbour.
            */}
            {entry === 'panel' && blocked ? (
              <>
                <span aria-hidden="true"> •</span>
                <span className="sr-only"> — {t('draft.review.errors', { count: 1 })}</span>
              </>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <DocumentOutline
          className="hidden lg:sticky lg:top-20 lg:block lg:h-fit"
          body={body}
          onChange={setBody}
          onJump={(index) => jump.current?.(index)}
        />

        <div
          id="draft-view-panel"
          role="tabpanel"
          aria-labelledby={`draft-view-${view === 'export' ? 'write' : view}`}
          tabIndex={-1}
          className={view === 'panel' ? 'hidden min-w-0 lg:block' : 'min-w-0'}
        >
          {view === 'preview' ? (
            <A4Preview view="both" single={null} bilingual={bilingual} />
          ) : view === 'export' ? (
            <DocExportPanel
              doc={doc}
              single={single}
              bilingual={bilingual}
              checklist={checklist}
              lintBlocked={blocked}
              fallbackName={personalName ?? template.shortName[language]}
              onGoToText={() => setView('write')}
              onOpenChecklist={() => setPanel('check')}
            />
          ) : (
            surface
          )}
        </div>

        <aside className={cn('min-w-0', view === 'panel' ? '' : 'hidden lg:block')}>
          <div
            role="tablist"
            aria-label={t('draft.panel.label')}
            className="flex gap-1 border-b border-border"
          >
            {PANELS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                id={`draft-panel-${entry}`}
                aria-selected={panel === entry}
                aria-controls="draft-panel-body"
                tabIndex={panel === entry ? 0 : -1}
                onClick={() => setPanel(entry)}
                className={
                  panel === entry
                    ? 'min-h-11 flex-1 border-b-[3px] border-marigold px-1 text-xs font-semibold'
                    : 'min-h-11 flex-1 border-b-[3px] border-transparent px-1 text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {t(
                  `draft.editor.tabs.${entry === 'check' ? 'review' : entry === 'assist' ? 'modify' : entry}`,
                )}
                {entry === 'check' && blocked ? (
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
            id="draft-panel-body"
            aria-labelledby={`draft-panel-${panel}`}
            tabIndex={-1}
            className="min-w-0 pt-4"
          >
            {panel === 'check' ? (
              <ReviewPanel checklist={checklist} findings={findings} language={language} />
            ) : null}

            {/*
              "Assist" — modify by instruction (Session 31, ADR-043 §3).

              Lazy AND behind `draftingAiAvailable`, the same gate the Session 8
              editor put on the drafting panel: a reader with AI off downloads
              none of the agent. The panel itself still renders in that case,
              because its consistency check is `lintDocument` and needs no model
              — see its own note.
            */}
            {panel === 'assist' ? (
              <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
                <ModifyPanel
                  doc={doc}
                  template={template}
                  lang={language}
                  devanagariDigits={devanagariDigits}
                  ai={ai}
                  onApply={async (next) => {
                    // A version FIRST, so the state being changed away from is
                    // recoverable even after the officer accepts.
                    // `restoreVersion` follows the same non-destructive rule one
                    // level up.
                    await snapshot(doc, 'manual', t('draft.modify.tab'))
                    state.update(next)
                  }}
                />
              </Suspense>
            ) : null}

            {panel === 'versions' ? (
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

            {panel === 'comments' ? (
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
        </aside>
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

/**
 * "Saved 3 s ago", as a STRING for the focus bar's status slot.
 *
 * A hook rather than the `SaveIndicator` component it replaces, because
 * `useFocusStatus` takes a string: a string is a stable dependency, so the slot
 * cannot loop the way an effect over a freshly-built element would
 * (`src/app/layouts/focusSlots.tsx` has the long version).
 *
 * The elapsed seconds are STATE moved by a timer, not `Date.now()` read during
 * render: a render is meant to be a pure function of its inputs, and a clock
 * read inside one produces a different answer every time React happens to
 * re-render (`react-hooks/purity`).
 *
 * A save FAILURE is deliberately not returned here. The bar's status slot is a
 * quiet `role="status"`; a failure needs an alert and gets one in the page.
 */
function useSaveStatus(state: ReturnType<typeof useOfficialDoc>): string | null {
  const { t } = useT()
  const [now, setNow] = useState(() => Date.now())
  const saved = state.save.kind === 'saved' ? state.save.at : null

  useEffect(() => {
    if (saved === null) return
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [saved])

  if (state.save.kind === 'saving') return t('draft.editor.saving')
  if (state.dirty) return t('draft.editor.unsaved')
  if (saved !== null) {
    return t('draft.editor.savedAgo', { seconds: Math.max(0, Math.round((now - saved) / 1000)) })
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
          <Link to="/settings/numbering">{t('draft.meta.numberAddPattern')}</Link>
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
            /*
              The duplicate warning has TWO sources, and this is where they meet.

              `issueNumber` returns what THIS APP issued (`numberIssues`, matched
              as an exact string). `duplicatesOf` also finds what the officer
              recorded by hand in the register for a communication issued before
              they had the app — and it folds whitespace and case, because
              `A-11011/2/2026-Estt.` and `A-11011/2/2026 -Estt.` are the same
              number written twice and warning about neither is worse than
              warning about both.

              It is a warning rather than a bar for the reason `validatePattern`'s
              `no-seq` case gives: an office genuinely re-issues a number — a
              corrigendum carries the number of the communication it corrects.
            */
            const alsoInRegister = (await duplicatesOf(result.number)).filter(
              // Not this document. `onIssued` below files an entry for it, and
              // reading the register AFTER that would have the document warn
              // about itself — so the read happens first and excludes it
              // anyway, because a renumber to the same number would collide
              // with the entry the last issue left.
              (entry) => entry.docId !== doc.id,
            )
            const duplicateCount = result.duplicates.length + alsoInRegister.length

            onIssued(result.number)
            onNotice(
              duplicateCount > 0
                ? t('draft.meta.numberDuplicate', {
                    number: result.number,
                    date: (
                      result.duplicates[0]?.issuedAt ??
                      alsoInRegister[0]?.date ??
                      alsoInRegister[0]?.createdAt ??
                      ''
                    ).slice(0, 10),
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
