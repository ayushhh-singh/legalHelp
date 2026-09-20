import {
  BookText,
  Bold,
  Italic,
  Languages,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Redo2,
  Search,
  Table as TableIcon,
  Underline,
  Undo2,
  Users,
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
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-sm transition-colors',
        'disabled:opacity-40',
        active
          ? 'bg-action font-semibold text-action-foreground shadow-sm'
          : 'text-foreground hover:bg-card hover:shadow-sm',
      )}
    >
      {children}
    </button>
  )
}

/**
 * One named band of the toolbar, drawn as its own small pill.
 *
 * `role="group"` with a label, so a screen-reader user hears "Insert, table"
 * rather than twenty-two unrelated buttons in one strip. The label is not drawn
 * — a toolbar that spent a line on four captions would be taller than the
 * document on a phone — and the pill's own boundary is what shows it now,
 * replacing a run of thin `<Sep>` rules with something that actually reads as
 * "these buttons belong together" at a glance, the way a real toolbar's
 * button clusters do. `ToolButton` is borderless for exactly this reason: the
 * pill is the boundary, so a button no longer needs its own box around it.
 */
const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div
    role="group"
    aria-label={label}
    className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border/60 bg-muted/70 p-1"
  >
    {children}
  </div>
)

/** How many characters the conversion actually changed. */
function countConverted(before: BodyDoc, after: BodyDoc): number {
  const text = (body: BodyDoc) => JSON.stringify(body)
  const a = text(before)
  const b = text(after)
  let changed = 0
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) changed += 1
  }
  return changed
}

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
  onNotice,
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
  /** Announced in the page's live region — a whole-document edit says so. */
  onNotice: (message: string) => void
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
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2"
      >
        <Group label={t('draft.toolbar.groupParagraph')}>
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
        </Group>
        <Group label={t('draft.toolbar.groupText')}>
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
        </Group>
        <Group label={t('draft.toolbar.groupInsert')}>
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
          <ToolButton
            label={t('draft.toolbar.placeholder')}
            disabled={disabled}
            active={placeholderOpen}
            onClick={() => setPlaceholderOpen((open) => !open)}
          >
            {'{{ }}'}
          </ToolButton>
          {/*
            A small separator INSIDE the group, not a second `role="group"`:
            these four are still "Insert" as far as a screen reader is
            concerned. It is here only so the icon-only mark-up trio above
            (table / page break / placeholder) reads as visually distinct
            from the icon-plus-label content trio below — the mix of bare
            icons and bare text was what made this row read as clutter
            rather than four purposeful actions.
          */}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border/70" />
          <ToolButton label={t('draft.toolbar.enclosure')} onClick={onAddEnclosure}>
            <Paperclip aria-hidden="true" className="size-4" />
            {t('draft.toolbar.enclosure')}
          </ToolButton>
          <ToolButton label={t('draft.toolbar.copyTo')} onClick={onAddCopyTo}>
            <Users aria-hidden="true" className="size-4" />
            {t('draft.toolbar.copyTo')}
          </ToolButton>
          <ToolButton label={t('draft.toolbar.phrase')} onClick={onInsertPhrase}>
            <BookText aria-hidden="true" className="size-4" />
            {t('draft.toolbar.phrase')}
          </ToolButton>
          <ToolButton label={t('draft.toolbar.glossary')} onClick={onInsertGlossary}>
            <Languages aria-hidden="true" className="size-4" />
            {t('draft.toolbar.glossary')}
          </ToolButton>
        </Group>
        <Group label={t('draft.toolbar.groupLanguage')}>
          {/*
          Converting numerals rewrites the WHOLE document, so it says how many
          it changed. It used to do it silently, which for an edit an officer
          cannot see the extent of is the difference between a tool and a
          surprise — and `draft.toolbar.digitsDone` was authored for exactly
          this and referenced by nothing.
        */}
          <ToolButton
            label={t('draft.toolbar.toDevanagari')}
            disabled={disabled}
            onClick={() => {
              const next = convertDigits(body, 'devanagari')
              onChange(next)
              onNotice(t('draft.toolbar.digitsDone', { count: countConverted(body, next) }))
            }}
          >
            ०-९
          </ToolButton>
          <ToolButton
            label={t('draft.toolbar.toAscii')}
            disabled={disabled}
            onClick={() => {
              const next = convertDigits(body, 'ascii')
              onChange(next)
              onNotice(t('draft.toolbar.digitsDone', { count: countConverted(body, next) }))
            }}
          >
            0-9
          </ToolButton>
        </Group>
        {/*
          Find, undo and redo carry no `role="group"`/`aria-label` — they are
          about the editing session rather than the document, and inventing a
          fifth CAPTION for three controls that already say what they do
          would be a label added for symmetry. They still sit in the same
          visual pill as every other band, purely so the row reads as one
          family of clusters rather than three styled bands and three bare
          icons floating with nothing around them.

          `ms-auto` was tried here to push them to the row's far end and
          reverted: on `flex-wrap` that pushes to the end of whichever LINE
          this group lands on after wrapping, not the end of the toolbar —
          with the language group alone on the last line that left a wide,
          lopsided gap between "0-9" and Find/Undo/Redo. Plain inline flow,
          like every other band, wraps predictably.
        */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border/60 bg-muted/70 p-1">
          <ToolButton label={t('draft.toolbar.findReplace')} onClick={onFindReplace}>
            <Search aria-hidden="true" className="size-4" />
          </ToolButton>
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
