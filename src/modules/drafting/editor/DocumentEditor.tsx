import { EditorContent, useEditor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EditorToolbar } from './Toolbar'
import { countDocument } from './commands'
import { editorExtensions } from './extensions'

import { useT } from '@/i18n/useT'
import { bodySchema, type BodyDoc } from '@/lib/drafting/model'
import { cn } from '@/lib/utils'

/**
 * The document body, in Tiptap.
 *
 * Two things about this component are load-bearing and easy to undo by
 * accident:
 *
 * **The editor is uncontrolled.** `body` seeds it once and is applied again
 * only when the caller hands it a document that is genuinely different — a
 * restore, a replace-all, a language switch. Feeding every keystroke back in
 * through `setContent` would move the caret to the end of the document on every
 * character, which is the classic way to make a rich-text editor unusable.
 * `lastEmitted` is how "different" is decided, and it compares against what
 * THIS editor last emitted rather than against the previous prop: the prop
 * comes back changed after every save, and comparing to it would resettle the
 * document constantly.
 *
 * **Everything it emits is validated.** `onChange` parses through `bodySchema`
 * before handing the JSON up, so a node type a future Tiptap release invents
 * cannot reach IndexedDB. A document that fails the parse is dropped with the
 * previous one kept — losing one keystroke is better than storing a row nothing
 * can read back.
 */
export function DocumentEditor({
  body,
  lang,
  onChange,
  onFindReplace,
  placeholders,
  onInsertPhrase,
  onInsertGlossary,
  onAddEnclosure,
  onAddCopyTo,
  readOnly = false,
  label,
  onNotice,
  onJumpReady,
  onInsertReady,
  className,
}: {
  body: BodyDoc
  lang: 'en' | 'hi'
  onChange: (next: BodyDoc) => void
  onFindReplace: () => void
  /** Field names offered when inserting a blank. */
  placeholders: readonly string[]
  onInsertPhrase: () => void
  onInsertGlossary: () => void
  onAddEnclosure: () => void
  onAddCopyTo: () => void
  readOnly?: boolean
  label: string
  onNotice: (message: string) => void
  /**
   * Hands the caller a way to put the caret at a top-level block.
   *
   * The outline column needs it and must not know that Tiptap exists — the
   * same line `src/lib/drafting`'s purity test draws one level down. Called
   * with a NEW function whenever the editor instance changes (a language
   * switch remounts it), so the caller should store the latest rather than the
   * first.
   */
  onJumpReady?: (jumpTo: (index: number) => void) => void
  /**
   * Hands the caller a way to type text in at the caret.
   *
   * The Rajbhasha glossary sheet and the phrase library are Session 8
   * components built around a textarea's caret and an `onInsert(text)`
   * callback; this is that callback, over a ProseMirror selection. Same
   * arrangement as `onJumpReady` and for the same reason — neither sheet may
   * know that Tiptap exists.
   */
  onInsertReady?: (insert: (text: string) => void) => void
  className?: string
}) {
  const { t } = useT()
  const lastEmitted = useRef<string>('')
  const [, forceRender] = useState(0)

  const editor = useEditor(
    {
      extensions: editorExtensions({ placeholder: t('draft.editor.bodyPlaceholder') }),
      content: body,
      editable: !readOnly,
      // The shell paints before this mounts, and Tiptap's own advice is to keep
      // the first render off the server/hydration path. `useEffect` below is
      // what makes the toolbar's active states track the caret.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'draft-editor-surface',
          'aria-label': label,
          role: 'textbox',
          'aria-multiline': 'true',
        },
        /*
          Escape LEAVES THE TEXT, and a second Escape leaves the screen.

          `FocusLayout`'s Escape handler bails while the caret is in an editable
          element, which is right — an officer mid-sentence must not lose the
          document to a stray keypress. But in this editor the caret is in an
          editable element almost all the time, so without this the way out
          would be unreachable from the keyboard exactly where it is most
          wanted. Blurring is the ordinary editor idiom for it and costs
          nothing: the text is untouched and the next Tab is back into it.
        */
        handleKeyDown: (view, event) => {
          if (event.key !== 'Escape') return false
          // `view.dom` rather than the editor instance: this closure is built
          // while `useEditor` is still constructing it, so there is nothing to
          // reach for yet — and blurring the contenteditable element IS the
          // whole operation.
          view.dom.blur()
          return true
        },
      },
      onUpdate: ({ editor: instance }) => {
        const json = instance.getJSON()
        const parsed = bodySchema.safeParse(json)
        if (!parsed.success) return
        lastEmitted.current = JSON.stringify(parsed.data)
        onChange(parsed.data)
      },
    },
    // The language is part of the identity of what is being edited: switching
    // to the Hindi body is a different document, not an edit to this one.
    [lang],
  )

  useEffect(() => {
    if (!editor) return
    const next = JSON.stringify(body)
    if (next === lastEmitted.current) return
    lastEmitted.current = next
    editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  useEffect(() => {
    if (!editor) return
    const rerender = () => forceRender((value) => value + 1)
    editor.on('selectionUpdate', rerender)
    editor.on('transaction', rerender)
    return () => {
      editor.off('selectionUpdate', rerender)
      editor.off('transaction', rerender)
    }
  }, [editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const counts = useMemo(() => countDocument(body), [body])

  const focus = useCallback(() => editor?.commands.focus(), [editor])

  /*
    Put the caret at the start of the Nth top-level block.

    ProseMirror positions are not array indices — every node occupies its own
    size — so this walks the document rather than arithmetic on the index.
    `+ 1` steps inside the block, which is where a caret can actually sit.
  */
  const jumpTo = useCallback(
    (index: number) => {
      if (!editor) return
      let target: number | null = null
      editor.state.doc.forEach((_node, offset, position) => {
        if (position === index) target = offset + 1
      })
      if (target === null) return
      /*
        `scrollIntoView: false`, and the scroll done here instead.

        Tiptap's `focus()` scrolls by default, and ProseMirror's scroller
        MEASURES — which throws `target.getClientRects is not a function` under
        jsdom, asynchronously, as an unhandled error a `try` around this call
        cannot catch. Moving the caret is the part that matters; scrolling to it
        is a courtesy, and `scrollIntoView?.()` on the element is the same
        guarded shape `ReaderPage` uses for exactly this reason: an environment
        with no layout must still be able to EDIT.
      */
      editor.chain().setTextSelection(target).focus(undefined, { scrollIntoView: false }).run()
      const at = editor.view.domAtPos(target).node
      const element = at instanceof HTMLElement ? at : at.parentElement
      element?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
    },
    [editor],
  )

  useEffect(() => {
    onJumpReady?.(jumpTo)
  }, [onJumpReady, jumpTo])

  const insert = useCallback(
    (text: string) => {
      /*
        At the current selection, which replaces it when there is one — the
        behaviour a textarea's caret gave the sheets before.

        `scrollIntoView: false` for the reason `jumpTo` above gives: Tiptap's
        `focus()` scrolls by default and ProseMirror's scroller measures, which
        throws asynchronously under jsdom. Typing at the caret needs no scroll —
        the caret is already where the officer is looking.
      */
      editor?.chain().focus(undefined, { scrollIntoView: false }).insertContent(text).run()
    },
    [editor],
  )

  useEffect(() => {
    onInsertReady?.(insert)
  }, [onInsertReady, insert])

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <EditorToolbar
        editor={editor}
        placeholders={placeholders}
        onFindReplace={onFindReplace}
        onInsertPhrase={onInsertPhrase}
        onInsertGlossary={onInsertGlossary}
        onAddEnclosure={onAddEnclosure}
        onAddCopyTo={onAddCopyTo}
        onChange={onChange}
        onNotice={onNotice}
        body={body}
      />
      {/*
        A sheet, not a box.

        `draft-editor-page` gives it A4 proportions and the manual's own
        margins, so the line length an officer writes at is the line length the
        document prints at — which is the point of editing in a page-like
        surface rather than a textarea beside a preview. Nothing here decides
        what the document says; the renderer still does that.
      */}
      <div
        className={cn(
          'draft-editor-page rounded-xl border border-border bg-card text-[15px] leading-relaxed',
          'focus-within:ring-2 focus-within:ring-primary/60',
        )}
        lang={lang}
        onClick={focus}
        onKeyDown={undefined}
        role="presentation"
      >
        <EditorContent editor={editor} />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('draft.editor.counts', { words: counts.words, pages: counts.pages })}
      </p>
    </div>
  )
}
