import { diffWords, type DiffPart } from '@/lib/diff'
import { bodySchema, type BodyDoc, type BodyNode, type OfficialDoc } from './model'
import type { Lang } from './types'

/**
 * A proposed change to a document, as a set of decisions an officer takes one
 * at a time.
 *
 * This is what "modify by instruction" produces. A model is given the document
 * and a sentence ("make para 3 firmer", "shorten to one page", "translate to
 * Hindi and keep the citations in English") and returns a WHOLE new document.
 * Nothing about that document is applied. It is diffed against the one on
 * screen, block by block and then word by word inside a block that changed, and
 * every change is a control with accept and reject on it. An accepted set
 * produces a new `OfficialDoc` and a version; a rejected set produces nothing
 * at all.
 *
 * ### Why the block, and not the rendered line
 *
 * `versions.ts#diffDocuments` diffs the RENDERED lines of two documents, which
 * is exactly right for showing an officer what changed between two saved
 * versions — it strips the automatic paragraph numbers so an insertion does not
 * read as a change to the whole rest of the page. It is the wrong unit here,
 * because a rendered line cannot be turned back into a body node: accepting one
 * would leave nothing to store. So a change here is a top-level node of
 * `body.content`, which is the unit the editor edits, the unit `projectBody`
 * projects and the unit that can be put back.
 *
 * The two share the matching ALGORITHM (walk both lists once; an identical
 * block at the same position is unchanged; a block whose counterpart appears
 * later in the other list is an insertion or a removal; anything else is a
 * change) and the reason for it, which `diffDocuments` states.
 *
 * ### Scope is enforced here, never trusted from the model
 *
 * "Rewrite this paragraph" hands the model one block and asks for one block
 * back. A model that also tidied the paragraph above it has done something the
 * officer did not ask for, and a suggestion list that quietly includes it is a
 * suggestion list nobody reads to the end. {@link restrictToBlocks} drops every
 * change outside the allowed set and REPORTS what it dropped, so the panel can
 * say "two changes outside the paragraph you selected were discarded" rather
 * than silently narrowing the result.
 *
 * ### Marks, and the one thing partial acceptance costs
 *
 * Accepting a changed block whole takes the model's node unchanged, marks and
 * all. Accepting only some of the words inside it cannot: the accepted text is
 * assembled from tokens taken from two different nodes, and there is no honest
 * way to decide which of the two sets of bold runs the result carries. A
 * partially accepted block is therefore rebuilt as one unmarked run, and
 * {@link applyProposal} reports it in `flattened` so the panel can say so. The
 * alternative — keeping the before-node's marks over after-text — would apply
 * emphasis to words the officer never saw emphasised.
 */

/* ------------------------------------------------------------------ *
 * The proposal
 * ------------------------------------------------------------------ */

export type BlockProposal =
  | { kind: 'unchanged'; id: string; beforeIndex: number; text: string }
  | { kind: 'added'; id: string; afterIndex: number; text: string; node: BodyNode }
  | { kind: 'removed'; id: string; beforeIndex: number; text: string }
  | {
      kind: 'changed'
      id: string
      beforeIndex: number
      afterIndex: number
      before: string
      after: string
      node: BodyNode
      /** `null` when either side is past `src/lib/diff.ts`'s token ceiling. */
      words: DiffPart[] | null
    }

/** A change to something outside the body — the subject, the date, a variable. */
export interface FieldProposal {
  /** `meta.subject.en`, `meta.number`, `vars.sanctionAmount`, `status`. */
  path: string
  before: string
  after: string
}

export interface DocProposal {
  blocks: BlockProposal[]
  fields: FieldProposal[]
  /** True when anything at all differs. */
  changed: boolean
  /**
   * Changes the model returned that were outside the scope it was given, and
   * which have been discarded. Empty when no scope was set.
   */
  outOfScope: OutOfScope[]
}

export interface OutOfScope {
  /** `block` or the field path. */
  what: string
  /** English, for the panel's log — the same posture `problems[]` takes. */
  describe: string
}

/** Every proposal an officer can act on. `unchanged` blocks are not decisions. */
export const decidableBlocks = (proposal: DocProposal): BlockProposal[] =>
  proposal.blocks.filter((block) => block.kind !== 'unchanged')

/* ------------------------------------------------------------------ *
 * Reading a block as text
 * ------------------------------------------------------------------ */

/** Every string of text inside a node, joined. The unit the block match runs on. */
export function textOf(node: BodyNode): string {
  const parts: string[] = []
  const walk = (current: BodyNode) => {
    if (typeof current.text === 'string') parts.push(current.text)
    if (current.type === 'hardBreak') parts.push('\n')
    for (const child of current.content ?? []) walk(child)
  }
  walk(node)
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const bodyFor = (doc: OfficialDoc, lang: Lang): BodyDoc =>
  lang === 'hi' && doc.bodyHi ? doc.bodyHi : doc.body

/**
 * A block's stable identity across a proposal.
 *
 * Position, not content: an officer accepting the third change then the first
 * must not have the ids renumber underneath them. It is derived from the
 * proposal's own order, which is fixed the moment the proposal is built.
 */
const blockId = (position: number): string => `b${position}`

/* ------------------------------------------------------------------ *
 * Building it
 * ------------------------------------------------------------------ */

const bilingualPaths = (doc: OfficialDoc): { path: string; value: string }[] => [
  { path: 'meta.number', value: doc.meta.number },
  { path: 'meta.date', value: doc.meta.date },
  { path: 'meta.subject.en', value: doc.meta.subject.en },
  { path: 'meta.subject.hi', value: doc.meta.subject.hi },
  { path: 'meta.urgency', value: doc.meta.urgency },
  { path: 'meta.place', value: doc.meta.place },
  { path: 'meta.enclosures', value: doc.meta.enclosures.join('\n') },
]

const varPaths = (doc: OfficialDoc): { path: string; value: string }[] =>
  Object.entries(doc.vars)
    .map(([key, value]) => ({
      path: `vars.${key}`,
      value:
        typeof value === 'string'
          ? value
          : Array.isArray(value)
            ? value.join('\n')
            : [value.en, value.hi].filter(Boolean).join(' / '),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

/**
 * What the model proposed, as a list of decisions.
 *
 * `lang` picks which body is compared — a modify run on the Hindi issue of a
 * bilingual document compares `bodyHi` against `bodyHi`, or every paragraph
 * reads as replaced.
 */
export function proposeChanges(before: OfficialDoc, after: OfficialDoc, lang: Lang = 'en'): DocProposal {
  const left = (bodyFor(before, lang).content ?? []).filter((node) => textOf(node).length > 0)
  const right = (bodyFor(after, lang).content ?? []).filter((node) => textOf(node).length > 0)
  const leftText = left.map(textOf)
  const rightText = right.map(textOf)

  const blocks: BlockProposal[] = []
  let i = 0
  let j = 0
  const id = () => blockId(blocks.length)

  while (i < left.length || j < right.length) {
    const a = leftText[i]
    const b = rightText[j]
    if (a === undefined) {
      blocks.push({ kind: 'added', id: id(), afterIndex: j, text: b ?? '', node: right[j] as BodyNode })
      j += 1
      continue
    }
    if (b === undefined) {
      blocks.push({ kind: 'removed', id: id(), beforeIndex: i, text: a })
      i += 1
      continue
    }
    if (a === b) {
      blocks.push({ kind: 'unchanged', id: id(), beforeIndex: i, text: a })
      i += 1
      j += 1
      continue
    }
    const laterOnRight = rightText.indexOf(a, j + 1)
    const laterOnLeft = leftText.indexOf(b, i + 1)
    if (laterOnRight !== -1 && (laterOnLeft === -1 || laterOnRight - j <= laterOnLeft - i)) {
      blocks.push({ kind: 'added', id: id(), afterIndex: j, text: b, node: right[j] as BodyNode })
      j += 1
      continue
    }
    if (laterOnLeft !== -1) {
      blocks.push({ kind: 'removed', id: id(), beforeIndex: i, text: a })
      i += 1
      continue
    }
    blocks.push({
      kind: 'changed',
      id: id(),
      beforeIndex: i,
      afterIndex: j,
      before: a,
      after: b,
      node: right[j] as BodyNode,
      /*
        `exact: true`, for the reason `SuggestionDiff` passes it and
        `diffDocuments` repeats: the default folds case and punctuation, and an
        `equal` run re-attaches the BEFORE token — so a rewrite whose only
        change was a capital or a missing full stop would render as no change
        and applying it would produce neither text (ADR-032).
      */
      words: diffWords(a, b, { exact: true }),
    })
    i += 1
    j += 1
  }

  const beforeFields = [...bilingualPaths(before), ...varPaths(before)]
  const afterFields = new Map(
    [...bilingualPaths(after), ...varPaths(after)].map((entry) => [entry.path, entry.value]),
  )
  const seen = new Set(beforeFields.map((entry) => entry.path))
  const fields: FieldProposal[] = []
  for (const entry of beforeFields) {
    const next = afterFields.get(entry.path) ?? ''
    if (next !== entry.value) fields.push({ path: entry.path, before: entry.value, after: next })
  }
  // A variable the model ADDED. Reported as a change from nothing rather than
  // dropped: a template variable appearing out of nowhere is exactly the kind
  // of thing an officer should get to refuse.
  for (const [path, value] of afterFields) {
    if (!seen.has(path) && value) fields.push({ path, before: '', after: value })
  }

  return {
    blocks,
    fields,
    changed: fields.length > 0 || blocks.some((block) => block.kind !== 'unchanged'),
    outOfScope: [],
  }
}

/* ------------------------------------------------------------------ *
 * Scope
 * ------------------------------------------------------------------ */

/**
 * Keep only the changes that touch the blocks the officer selected.
 *
 * `allowed` is a set of BEFORE indices — the positions in the document as it
 * stands, which is what a selection in the editor knows. A change to a block
 * outside them is dropped and listed in `outOfScope`; an ADDED block is allowed
 * only where it sits immediately after an allowed block, because splitting a
 * selected paragraph in two is a legitimate way to answer "shorten this" while
 * appending a new paragraph at the end of the document is not.
 *
 * Field changes are dropped wholesale under a block scope. Asking for one
 * paragraph to be rewritten is not asking for the subject line to change.
 */
export function restrictToBlocks(proposal: DocProposal, allowed: ReadonlySet<number>): DocProposal {
  if (allowed.size === 0) return proposal

  const outOfScope: OutOfScope[] = [...proposal.outOfScope]
  const kept: BlockProposal[] = []
  let previousAllowed = false

  for (const block of proposal.blocks) {
    if (block.kind === 'unchanged') {
      kept.push(block)
      previousAllowed = allowed.has(block.beforeIndex)
      continue
    }
    if (block.kind === 'added') {
      if (previousAllowed) kept.push(block)
      else {
        outOfScope.push({
          what: block.id,
          describe: `A new paragraph was proposed outside the selection and was discarded: "${preview(block.text)}"`,
        })
      }
      continue
    }
    const inScope = allowed.has(block.beforeIndex)
    previousAllowed = inScope
    if (inScope) {
      kept.push(block)
      continue
    }
    // Out of scope: keep the block as it was, so the officer's document is
    // rebuilt whole, and record what was thrown away.
    kept.push({
      kind: 'unchanged',
      id: block.id,
      beforeIndex: block.beforeIndex,
      text: block.kind === 'changed' ? block.before : block.text,
    })
    outOfScope.push({
      what: block.id,
      describe:
        block.kind === 'changed'
          ? `A paragraph outside the selection was rewritten and the rewrite was discarded: "${preview(block.before)}"`
          : `A paragraph outside the selection was deleted and the deletion was discarded: "${preview(block.text)}"`,
    })
  }

  for (const field of proposal.fields) {
    outOfScope.push({
      what: field.path,
      describe: `${field.path} was changed outside the selection and the change was discarded.`,
    })
  }

  return {
    blocks: kept,
    fields: [],
    changed: kept.some((block) => block.kind !== 'unchanged'),
    outOfScope,
  }
}

const preview = (text: string): string => (text.length > 60 ? `${text.slice(0, 60)}…` : text)

/* ------------------------------------------------------------------ *
 * Applying it
 * ------------------------------------------------------------------ */

/**
 * What the officer decided.
 *
 * `blocks` is keyed by `BlockProposal.id`. `words` is the per-change decision
 * inside one changed block, keyed by the same id, and it is optional: a block
 * accepted with no word decisions is accepted whole, which is what the
 * accept-all control does.
 */
export interface Decisions {
  blocks: Readonly<Record<string, boolean>>
  words?: Readonly<Record<string, readonly boolean[]>>
  fields?: Readonly<Record<string, boolean>>
}

export interface AppliedProposal {
  doc: OfficialDoc
  /** How many block decisions were taken. */
  acceptedBlocks: number
  acceptedFields: number
  /** Ids of blocks whose marks were dropped because acceptance was partial. */
  flattened: string[]
}

/** A paragraph-shaped node carrying exactly this text and nothing else. */
const plainNode = (template: BodyNode, text: string): BodyNode => ({
  type: template.type,
  ...(template.attrs ? { attrs: template.attrs } : {}),
  content: text ? [{ type: 'text', text }] : [],
})

/**
 * Rebuild the document from the decisions.
 *
 * The result is assembled from the BEFORE document — every unchanged block is
 * the officer's own node, untouched, marks intact — with accepted changes
 * substituted in. That direction matters: assembling from the AFTER document
 * and putting rejections back would make a rejected change a round trip through
 * the model's rendering of the officer's own words.
 */
export function applyProposal(
  before: OfficialDoc,
  proposal: DocProposal,
  decisions: Decisions,
  lang: Lang = 'en',
  at?: string,
): AppliedProposal {
  const source = bodyFor(before, lang).content ?? []
  const content: BodyNode[] = []
  const flattened: string[] = []
  let acceptedBlocks = 0

  // Blocks with no text at all are not part of the proposal — they were
  // filtered out when it was built — so they are carried across in place by
  // walking the ORIGINAL content and consuming proposals as their indices come
  // up. Without this an empty paragraph an officer left as a spacer vanishes on
  // the first accepted change.
  const proposalsByBeforeIndex = new Map<number, BlockProposal>()
  const additionsAfter = new Map<number, BlockProposal[]>()
  let lastBeforeIndex = -1
  for (const block of proposal.blocks) {
    if (block.kind === 'added') {
      const list = additionsAfter.get(lastBeforeIndex) ?? []
      list.push(block)
      additionsAfter.set(lastBeforeIndex, list)
      continue
    }
    proposalsByBeforeIndex.set(block.beforeIndex, block)
    lastBeforeIndex = block.beforeIndex
  }

  const textIndexOf = new Map<number, number>()
  {
    let position = 0
    source.forEach((node, index) => {
      if (textOf(node).length === 0) return
      textIndexOf.set(index, position)
      position += 1
    })
  }

  const emitAdditions = (afterTextIndex: number) => {
    for (const addition of additionsAfter.get(afterTextIndex) ?? []) {
      if (decisions.blocks[addition.id] !== true) continue
      if (addition.kind !== 'added') continue
      content.push(addition.node)
      acceptedBlocks += 1
    }
  }

  emitAdditions(-1)

  source.forEach((node, index) => {
    const textIndex = textIndexOf.get(index)
    if (textIndex === undefined) {
      content.push(node)
      return
    }
    const block = proposalsByBeforeIndex.get(textIndex)
    if (!block || block.kind === 'unchanged') {
      content.push(node)
      emitAdditions(textIndex)
      return
    }
    const accepted = decisions.blocks[block.id] === true
    if (!accepted) {
      content.push(node)
      emitAdditions(textIndex)
      return
    }
    acceptedBlocks += 1
    if (block.kind !== 'changed') {
      // `removed`, accepted: the block simply does not come across. (`added`
      // never reaches here — additions are keyed by the block they follow, in
      // `additionsAfter`, and are emitted by `emitAdditions`.)
      emitAdditions(textIndex)
      return
    }
    // Accepted. Word decisions narrow it; their absence takes it whole.
    const wordDecisions = decisions.words?.[block.id]
    if (!wordDecisions || !block.words) {
      content.push(block.node)
      emitAdditions(textIndex)
      return
    }
    const text = applyWordDecisions(block.words, wordDecisions)
    if (text === block.after) {
      content.push(block.node)
    } else {
      flattened.push(block.id)
      content.push(plainNode(node, text))
    }
    emitAdditions(textIndex)
  })

  let doc: OfficialDoc = { ...before }
  const body = bodySchema.parse({ type: 'doc', content })
  if (lang === 'hi' && before.bodyHi) doc = { ...doc, bodyHi: body }
  else doc = { ...doc, body }

  let acceptedFields = 0
  for (const field of proposal.fields) {
    if (decisions.fields?.[field.path] !== true) continue
    const next = setFieldPath(doc, field.path, field.after)
    if (next) {
      doc = next
      acceptedFields += 1
    }
  }

  if (at && (acceptedBlocks > 0 || acceptedFields > 0)) doc = { ...doc, updatedAt: at }

  return { doc, acceptedBlocks, acceptedFields, flattened }
}

/**
 * Which fields a proposal is allowed to write, and how.
 *
 * An allowlist rather than a path walker, and deliberately: a path walker over
 * an `OfficialDoc` would let a model's `path` reach `id`, `docModelVersion` or
 * `createdAt`, and a proposal that can renumber the model version is a proposal
 * that can make a document unreadable. Anything not named here is refused, and
 * `proposeChanges` only ever produces paths that are.
 */
function setFieldPath(doc: OfficialDoc, path: string, value: string): OfficialDoc | null {
  switch (path) {
    case 'meta.number':
      return { ...doc, meta: { ...doc.meta, number: value } }
    case 'meta.date':
      return { ...doc, meta: { ...doc.meta, date: value } }
    case 'meta.place':
      return { ...doc, meta: { ...doc.meta, place: value } }
    case 'meta.subject.en':
      return { ...doc, meta: { ...doc.meta, subject: { ...doc.meta.subject, en: value } } }
    case 'meta.subject.hi':
      return { ...doc, meta: { ...doc.meta, subject: { ...doc.meta.subject, hi: value } } }
    case 'meta.urgency':
      return value === 'none' || value === 'immediate' || value === 'priority' || value === 'topPriority'
        ? { ...doc, meta: { ...doc.meta, urgency: value } }
        : null
    case 'meta.enclosures':
      return {
        ...doc,
        meta: { ...doc.meta, enclosures: value ? value.split('\n').filter((line) => line.trim()) : [] },
      }
    default:
      break
  }
  if (path.startsWith('vars.')) {
    const key = path.slice('vars.'.length)
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return null
    return { ...doc, vars: { ...doc.vars, [key]: value } }
  }
  return null
}

/**
 * The text that results from taking exactly the accepted word changes.
 *
 * The same three rules `applyChanges` in `src/modules/drafting/suggestion.ts`
 * states, and the same inversion on `delete` — rejecting a deletion means
 * keeping the original words. It is duplicated rather than imported because
 * that module sits under `src/modules` and this library may not import one
 * (`purity.test.ts`); the shared half is `changesOf`'s grouping, which is
 * re-derived here from the parts.
 */
export function applyWordDecisions(parts: readonly DiffPart[], accepted: readonly boolean[]): string {
  const changes: { start: number; end: number }[] = []
  let index = 0
  while (index < parts.length) {
    if (parts[index]?.op === 'equal') {
      index += 1
      continue
    }
    const start = index
    while (index < parts.length && parts[index]?.op !== 'equal') index += 1
    changes.push({ start, end: index })
  }

  const takenAt = (partIndex: number): boolean => {
    const at = changes.findIndex((change) => partIndex >= change.start && partIndex < change.end)
    return at === -1 ? false : (accepted[at] ?? false)
  }

  const out: string[] = []
  parts.forEach((part, partIndex) => {
    if (part.op === 'equal') {
      out.push(...part.tokens)
      return
    }
    const take = takenAt(partIndex)
    if ((part.op === 'insert' && take) || (part.op === 'delete' && !take)) out.push(...part.tokens)
  })

  return out
    .reduce<string>((text, token) => {
      if (token === '\n') return `${text}\n`
      return text === '' || text.endsWith('\n') ? `${text}${token}` : `${text} ${token}`
    }, '')
    .trim()
}

/** Every change accepted. What the "accept all" control passes. */
export function acceptAll(proposal: DocProposal): Decisions {
  const blocks: Record<string, boolean> = {}
  for (const block of decidableBlocks(proposal)) blocks[block.id] = true
  const fields: Record<string, boolean> = {}
  for (const field of proposal.fields) fields[field.path] = true
  return { blocks, fields }
}

/** Nothing accepted. What "reject all" passes, and what a fresh panel starts at. */
export function rejectAll(proposal: DocProposal): Decisions {
  const blocks: Record<string, boolean> = {}
  for (const block of decidableBlocks(proposal)) blocks[block.id] = false
  const fields: Record<string, boolean> = {}
  for (const field of proposal.fields) fields[field.path] = false
  return { blocks, fields }
}
