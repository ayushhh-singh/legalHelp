import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { changesOf } from '../suggestion'
import {
  decidableBlocks,
  type BlockProposal,
  type Decisions,
  type DocProposal,
} from '@/lib/drafting/proposal'
import type { DiffPart } from '@/lib/diff'
import { cn } from '@/lib/utils'

/**
 * A whole-document suggestion, as decisions.
 *
 * `SuggestionDiff` (Session 8) shows one FIELD's rewrite word by word. This is
 * the same idea one level up, for a document: block-level first — a paragraph
 * added, deleted or rewritten — and then word by word inside a rewritten one.
 * The two share `changesOf`/`applyChanges` and the rule that makes them safe,
 * which is that rejecting a deletion keeps the original words.
 *
 * It is a separate component rather than a generalisation of the other, and the
 * reason is what a decision IS in each. There, one accept produces a string the
 * caller writes into a form field. Here, one accept produces a node in a
 * document, and the caller has to be able to accept the third paragraph and
 * refuse the first — so the state is a map keyed by block id, and the result is
 * computed by `applyProposal`, in the pure layer, where it is tested.
 *
 * ### Nothing here applies anything
 *
 * The component owns the DECISIONS and hands them up. `applyProposal` is called
 * by the panel, which then snapshots a version and writes the document. That
 * split is what lets "apply" be a single, undoable act rather than a sequence
 * of writes an officer could be interrupted halfway through.
 */

export interface DocSuggestionProps {
  proposal: DocProposal
  /** Called with the officer's decisions when they press Apply. */
  onApply: (decisions: Decisions) => void
  onDiscard: () => void
  /** Checklist items this change fixes and breaks, already resolved to labels. */
  fixed?: readonly string[]
  broken?: readonly string[]
}

export function DocSuggestion({ proposal, onApply, onDiscard, fixed = [], broken = [] }: DocSuggestionProps) {
  const { t } = useT()
  const blocks = useMemo(() => decidableBlocks(proposal), [proposal])

  /*
    Every change starts REFUSED, which is the opposite of `SuggestionDiff`.

    There, the reader pressed "improve this field" and a suggestion they asked
    for is one they probably want. Here the instruction was "make paragraph 3
    firmer" and the model may have returned changes to five paragraphs — an
    officer who presses Apply without reading would otherwise take four changes
    they never asked for. Accept-all is one press away for the case where they
    did read.
  */
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [words, setWords] = useState<Record<string, boolean[]>>({})
  const [fields, setFields] = useState<Record<string, boolean>>({})

  const takenBlocks = blocks.filter((block) => accepted[block.id]).length
  const takenFields = proposal.fields.filter((field) => fields[field.path]).length
  const taken = takenBlocks + takenFields

  const setAll = (value: boolean) => {
    setAccepted(Object.fromEntries(blocks.map((block) => [block.id, value])))
    setFields(Object.fromEntries(proposal.fields.map((field) => [field.path, value])))
    setWords({})
  }

  if (blocks.length === 0 && proposal.fields.length === 0) {
    return (
      <SectionCard className="p-4">
        <p className="text-sm text-muted-foreground">{t('draft.modify.noChanges')}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onDiscard}>
          {t('draft.modify.discard')}
        </Button>
      </SectionCard>
    )
  }

  return (
    <section
      aria-label={t('draft.modify.heading')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="neutral">
          {t('draft.modify.changes', { count: blocks.length + proposal.fields.length })}
        </Badge>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
            {t('draft.modify.acceptAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
            {t('draft.modify.rejectAll')}
          </Button>
        </div>
      </div>

      {fixed.length > 0 ? (
        <p className="text-xs text-tulsi-foreground">
          {t('draft.modify.checklistFixed', { items: fixed.join(', ') })}
        </p>
      ) : null}
      {broken.length > 0 ? (
        <p className="rounded-md border border-coral/40 bg-coral/15 p-2 text-xs text-coral-foreground">
          {t('draft.modify.checklistBroken', { items: broken.join(', ') })}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {blocks.map((block) => (
          <li key={block.id}>
            <BlockRow
              block={block}
              accepted={accepted[block.id] ?? false}
              words={words[block.id]}
              onAccepted={(value) => setAccepted((current) => ({ ...current, [block.id]: value }))}
              onWords={(next) => setWords((current) => ({ ...current, [block.id]: next }))}
            />
          </li>
        ))}
        {proposal.fields.map((field) => (
          <li key={field.path}>
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{t('draft.modify.fieldChange', { field: field.path })}</p>
                <p className="mt-1 break-words">
                  <del className="text-muted-foreground line-through">{field.before || '—'}</del>{' '}
                  <ins className="bg-tulsi/15 text-tulsi-foreground no-underline">{field.after || '—'}</ins>
                </p>
              </div>
              <Decide
                accepted={fields[field.path] ?? false}
                onChange={(value) => setFields((current) => ({ ...current, [field.path]: value }))}
              />
            </div>
          </li>
        ))}
      </ul>

      {proposal.outOfScope.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {proposal.outOfScope.map((entry) => (
            <li key={entry.what}>
              <Badge tone="neutral">{t('draft.modify.outOfScope')}</Badge> {entry.describe}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={taken === 0}
          onClick={() => onApply({ blocks: accepted, words, fields })}
        >
          {t('draft.modify.apply', { count: taken })}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
          {t('draft.modify.discard')}
        </Button>
      </div>
    </section>
  )
}

function BlockRow({
  block,
  accepted,
  words,
  onAccepted,
  onWords,
}: {
  block: BlockProposal
  accepted: boolean
  words: boolean[] | undefined
  onAccepted: (value: boolean) => void
  onWords: (next: boolean[]) => void
}) {
  const { t } = useT()
  const kindLabel =
    block.kind === 'added'
      ? t('draft.modify.added')
      : block.kind === 'removed'
        ? t('draft.modify.removed')
        : t('draft.modify.changedBlock')

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border p-3',
        accepted ? 'border-tulsi/50 bg-tulsi/10' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="neutral">{kindLabel}</Badge>
        <Decide accepted={accepted} onChange={onAccepted} />
      </div>

      {block.kind === 'changed' && block.words ? (
        <WordDiff
          parts={block.words}
          decisions={words}
          onChange={(next) => {
            onWords(next)
            // Touching a word decision is an acceptance of the block: the
            // alternative is a reader ticking three words and finding nothing
            // applied because the block itself was still refused.
            if (!accepted) onAccepted(true)
          }}
        />
      ) : (
        <p className="text-sm break-words">
          {block.kind === 'removed' ? (
            <del className="text-muted-foreground line-through">{block.text}</del>
          ) : block.kind === 'added' ? (
            <ins className="bg-tulsi/15 text-tulsi-foreground no-underline">{block.text}</ins>
          ) : block.kind === 'changed' ? (
            // A `changed` block whose two sides were too long to diff. Both are
            // shown plainly rather than a wrong diff — `SuggestionDiff`'s rule.
            <>
              <del className="block text-muted-foreground line-through">{block.before}</del>
              <ins className="block bg-tulsi/15 text-tulsi-foreground no-underline">{block.after}</ins>
            </>
          ) : (
            // `unchanged` never reaches here: `decidableBlocks` filters it out
            // before this list is built. The branch exists so the union is
            // exhaustive rather than narrowed by a cast.
            <span>{block.text}</span>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * The word-level diff inside one rewritten paragraph.
 *
 * `<ins>` and `<del>` carry the meaning, not the colour — the underline and the
 * strike-through survive a monochrome print and a reader who cannot tell the
 * two tints apart. The same rule `SuggestionDiff` and the Law Converter's
 * `DiffView` follow.
 */
function WordDiff({
  parts,
  decisions,
  onChange,
}: {
  parts: readonly DiffPart[]
  decisions: boolean[] | undefined
  onChange: (next: boolean[]) => void
}) {
  const { t } = useT()
  const changes = useMemo(() => changesOf(parts), [parts])
  const taken = decisions ?? changes.map(() => true)

  const changeAt = (partIndex: number): number =>
    changes.findIndex((change) => partIndex >= change.start && partIndex < change.end)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed break-words">
        {parts.map((part, index) => {
          if (part.op === 'equal') return <span key={index}>{part.tokens.join(' ')} </span>
          const at = changeAt(index)
          const on = taken[at] ?? true
          const Tag = part.op === 'insert' ? 'ins' : 'del'
          return (
            <Tag
              key={index}
              className={cn(
                part.op === 'insert'
                  ? 'bg-tulsi/15 text-tulsi-foreground no-underline'
                  : 'text-muted-foreground line-through',
                !on && 'opacity-50',
              )}
            >
              {part.tokens.join(' ')}{' '}
            </Tag>
          )
        })}
      </p>

      <ul className="flex flex-wrap gap-2">
        {changes.map((_change, index) => (
          <li key={index}>
            <button
              type="button"
              aria-pressed={taken[index] ?? true}
              onClick={() =>
                onChange(changes.map((__, at) => (at === index ? !(taken[at] ?? true) : (taken[at] ?? true))))
              }
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs"
            >
              {(taken[index] ?? true) ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                <X aria-hidden="true" className="size-3" />
              )}
              {t((taken[index] ?? true) ? 'draft.modify.accepted' : 'draft.modify.rejected')} {index + 1}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Decide({ accepted, onChange }: { accepted: boolean; onChange: (value: boolean) => void }) {
  const { t } = useT()
  return (
    <span className="flex shrink-0 gap-1">
      <Button
        type="button"
        size="sm"
        variant={accepted ? 'default' : 'outline'}
        aria-pressed={accepted}
        onClick={() => onChange(true)}
      >
        <Check aria-hidden="true" className="mr-1 size-3" />
        {t('draft.modify.accept')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={accepted ? 'outline' : 'default'}
        aria-pressed={!accepted}
        onClick={() => onChange(false)}
      >
        <X aria-hidden="true" className="mr-1 size-3" />
        {t('draft.modify.reject')}
      </Button>
    </span>
  )
}
