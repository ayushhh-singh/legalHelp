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

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <EditorToolbar
        editor={editor}
        placeholders={placeholders}
        onFindReplace={onFindReplace}
        onInsertPhrase={onInsertPhrase}
        onInsertGlossary={onInsertGlossary}
        onAddEnclosure={onAddEnclosure}
        onAddCopyTo={onAddCopyTo}
        onChange={onChange}
        body={body}
      />
      <div
        className={cn(
          'rounded-xl border border-border bg-card p-4 text-[15px] leading-relaxed',
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
