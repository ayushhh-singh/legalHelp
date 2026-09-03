import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { BodyDoc } from '@/lib/drafting/model'
import { projectBody, linesOfNodes } from '@/lib/drafting/renderDoc'
import { commentIsAnchored, type DocComment } from '@/lib/drafting/versions'
import type { Lang } from '@/lib/drafting/types'
import { cn } from '@/lib/utils'

/**
 * Notes to self, anchored to a paragraph.
 *
 * They are **excluded from every export** — the `.docx` writer, the print
 * stylesheet and the clipboard copy all read the rendered document, and a
 * comment is not part of it. That is not a rule this component enforces; it is
 * a consequence of comments living in their own table and never entering the
 * body, which is the version of the rule that cannot be forgotten.
 *
 * A comment whose paragraph has changed says so rather than pointing at the
 * wrong words. `commentIsAnchored` compares the stored text against the
 * paragraph at that index — the same "keep the quote" rule `resolveAnchor`
 * follows for a Library highlight (ADR-039 §1).
 */
export function CommentsPanel({
  body,
  lang,
  comments,
  onAdd,
  onResolve,
  onDelete,
}: {
  body: BodyDoc
  lang: Lang
  comments: readonly DocComment[]
  onAdd: (blockIndex: number, blockText: string, text: string) => void
  onResolve: (id: string, resolved: boolean) => void
  onDelete: (id: string) => void
}) {
  const { t } = useT()
  const [blockIndex, setBlockIndex] = useState(0)
  const [text, setText] = useState('')
  const lines = linesOfNodes(projectBody(body, lang))

  const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('draft.comments.hint')}</p>

      <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.comments.onParagraph', { number: blockIndex + 1 })}</span>
          <select
            className={field}
            value={blockIndex}
            onChange={(event) => setBlockIndex(Number(event.target.value))}
          >
            {lines.map((line, index) => (
              <option key={index} value={index}>
                {index + 1}. {line.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only">{t('draft.comments.add')}</span>
          <textarea
            rows={2}
            className={field}
            placeholder={t('draft.comments.placeholder')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div>
          <Button
            size="sm"
            disabled={!text.trim() || lines.length === 0}
            onClick={() => {
              onAdd(blockIndex, lines[blockIndex] ?? '', text.trim())
              setText('')
            }}
          >
            {t('draft.comments.add')}
          </Button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('draft.comments.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => {
            const anchored = commentIsAnchored(comment, body, lang)
            return (
              <li
                key={comment.id}
                className={cn(
                  'rounded-lg border border-border bg-card p-2 text-sm',
                  comment.resolved && 'opacity-60',
                )}
              >
                <p className="text-xs text-muted-foreground">
                  {t('draft.comments.onParagraph', { number: comment.blockIndex + 1 })}
                  {anchored ? '' : ` — ${t('draft.comments.moved')}`}
                </p>
                <p className="my-1 whitespace-pre-wrap">{comment.text}</p>
                {anchored ? null : (
                  <p className="mb-1 rounded bg-muted/60 p-1 text-xs italic">{comment.blockText}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onResolve(comment.id, !comment.resolved)}
                  >
                    {comment.resolved ? t('draft.comments.reopen') : t('draft.comments.resolve')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(comment.id)}>
                    {t('draft.comments.delete')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
