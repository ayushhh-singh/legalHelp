import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Search,
  Table as TableIcon,
  Underline,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'

import {
  convertDigits,
  insertPageBreak,
  insertPlaceholder,
  insertTable,
  toggleNumberedPara,
} from './commands'

import { useT } from '@/i18n/useT'
import type { BodyDoc } from '@/lib/drafting/model'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/core'

/**
 * The editor's toolbar.
 *
 * Every control is a real `<button>` with a real accessible name, and the
 * active ones carry `aria-pressed` rather than colour alone — the design
 * skill's nav rule ("active is never colour alone") applies to a toolbar for
 * the same reason it applies to the sidebar. Nothing here is icon-only without
 * a `title` and an `aria-label`.
 */

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(active === undefined ? {} : { 'aria-pressed': active })}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-[10px] border px-2 text-sm',
        'disabled:opacity-50',
        active
          ? 'border-action bg-action font-semibold text-action-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

const Sep = () => <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />

export function EditorToolbar({
  editor,
  placeholders,
  body,
  onChange,
  onFindReplace,
  onInsertPhrase,
  onInsertGlossary,
  onAddEnclosure,
  onAddCopyTo,
}: {
  editor: Editor | null
  placeholders: readonly string[]
  body: BodyDoc
  onChange: (next: BodyDoc) => void
  onFindReplace: () => void
  onInsertPhrase: () => void
  onInsertGlossary: () => void
  onAddEnclosure: () => void
  onAddCopyTo: () => void
}) {
  const { t } = useT()
  const [placeholderOpen, setPlaceholderOpen] = useState(false)
  const disabled = !editor

  return (
    <div className="flex flex-col gap-2">
      <div
        role="toolbar"
        aria-label={t('draft.toolbar.heading')}
        aria-orientation="horizontal"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-2"
      >
        <ToolButton
          label={t('draft.toolbar.paragraph')}
          active={editor?.isActive('paragraph') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setNode('paragraph').run()}
        >
          ¶
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.numberedPara')}
          active={editor?.isActive('numberedPara') ?? false}
          disabled={disabled}
          onClick={() => editor && toggleNumberedPara(editor)}
        >
          1.
        </ToolButton>
        {[1, 2, 3].map((level) => (
          <ToolButton
            key={level}
            label={t('draft.toolbar.headingLevel', { level })}
            active={editor?.isActive('heading', { level }) ?? false}
            disabled={disabled}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .toggleHeading({ level: level as 1 | 2 | 3 })
                .run()
            }
          >
            H{level}
          </ToolButton>
        ))}
        <Sep />
        <ToolButton
          label={t('draft.toolbar.bold')}
          active={editor?.isActive('bold') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.italic')}
          active={editor?.isActive('italic') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.underline')}
          active={editor?.isActive('underline') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <Underline aria-hidden="true" className="size-4" />
        </ToolButton>
        <Sep />
        <ToolButton
          label={t('draft.toolbar.bulletList')}
          active={editor?.isActive('bulletList') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.orderedList')}
          active={editor?.isActive('orderedList') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.quote')}
          active={editor?.isActive('blockquote') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.table')}
          disabled={disabled}
          onClick={() => editor && insertTable(editor)}
        >
          <TableIcon aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.pageBreak')}
          disabled={disabled}
          onClick={() => editor && insertPageBreak(editor)}
        >
          ⤶
        </ToolButton>
        <Sep />
        <ToolButton
          label={t('draft.toolbar.placeholder')}
          disabled={disabled}
          active={placeholderOpen}
          onClick={() => setPlaceholderOpen((open) => !open)}
        >
          {'{{ }}'}
        </ToolButton>
        <ToolButton label={t('draft.toolbar.enclosure')} onClick={onAddEnclosure}>
          {t('draft.toolbar.enclosure')}
        </ToolButton>
        <ToolButton label={t('draft.toolbar.copyTo')} onClick={onAddCopyTo}>
          {t('draft.toolbar.copyTo')}
        </ToolButton>
        <ToolButton label={t('draft.toolbar.phrase')} onClick={onInsertPhrase}>
          {t('draft.toolbar.phrase')}
        </ToolButton>
        <ToolButton label={t('draft.toolbar.glossary')} onClick={onInsertGlossary}>
          {t('draft.toolbar.glossary')}
        </ToolButton>
        <Sep />
        <ToolButton label={t('draft.toolbar.findReplace')} onClick={onFindReplace}>
          <Search aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.toDevanagari')}
          disabled={disabled}
          onClick={() => onChange(convertDigits(body, 'devanagari'))}
        >
          ०-९
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.toAscii')}
          disabled={disabled}
          onClick={() => onChange(convertDigits(body, 'ascii'))}
        >
          0-9
        </ToolButton>
        <Sep />
        <ToolButton
          label={t('draft.toolbar.undo')}
          disabled={disabled || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton
          label={t('draft.toolbar.redo')}
          disabled={disabled || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 aria-hidden="true" className="size-4" />
        </ToolButton>
      </div>

      {placeholderOpen ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t('draft.toolbar.placeholderPrompt')}</p>
          <div className="flex flex-wrap gap-2">
            {placeholders.map((field) => (
              <button
                key={field}
                type="button"
                className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted"
                onClick={() => {
                  if (editor) insertPlaceholder(editor, field)
                  setPlaceholderOpen(false)
                }}
              >
                {`{{${field}}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
