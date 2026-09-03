import { tocLeaves } from './corpus'
import type { LibraryCorpus, LibraryUnit } from './types'

import type { LibraryWork, TocNode } from '@/schemas/library'

/** One unit, or `null` — a URL can name a unit that this work does not have. */
export function getUnit(corpus: LibraryCorpus, unitId: string): LibraryUnit | null {
  return corpus.units.get(unitId) ?? null
}

export interface Adjacent {
  previous: LibraryUnit | null
  next: LibraryUnit | null
  /** 1-based, for "12 of 358". 0 when the unit is not in this work. */
  position: number
  total: number
}

/**
 * What is either side of a unit, in the work's own reading order.
 *
 * Deliberately takes the corpus rather than the work: `readingOrder` names
 * every unit the work claims, and `buildCorpus` skips any the corpus turns out
 * not to have. Walking the order alone would offer a "next" that resolves to
 * nothing — a Next button that lands on an error page.
 */
export function adjacent(corpus: LibraryCorpus, unitId: string): Adjacent {
  const present = corpus.order.filter((id) => corpus.units.has(id))
  const index = present.indexOf(unitId)
  if (index < 0) return { previous: null, next: null, position: 0, total: present.length }

  const at = (offset: number): LibraryUnit | null => {
    const id = present[index + offset]
    return id ? (corpus.units.get(id) ?? null) : null
  }
  return { previous: at(-1), next: at(1), position: index + 1, total: present.length }
}

/**
 * The narrow shapes these three read.
 *
 * Structural rather than `LibraryWork` for the reason `CorpusWork` in
 * `corpus.ts` gives: a document the reader added has no publisher, no official
 * URL and no source, and it must still be navigable.
 */
export type OrderedWork = Pick<LibraryWork, 'readingOrder'>
export type TocWork = Pick<LibraryWork, 'toc'>

/** The first unit of a work — what "Start reading" opens. */
export function firstUnitId(work: OrderedWork): string | null {
  return work.readingOrder[0] ?? null
}

/**
 * The chain of table-of-contents nodes from the root down to the unit, for the
 * reader's breadcrumb and for opening the right branch of the TOC. Empty when
 * the unit is not in this table of contents.
 */
export function tocPath(work: TocWork, unitId: string): TocNode[] {
  const walk = (nodes: readonly TocNode[], trail: TocNode[]): TocNode[] | null => {
    for (const node of nodes) {
      if (!node.unitIds.includes(unitId)) continue
      const children = node.children ?? []
      if (children.length === 0) return [...trail, node]
      return walk(children, [...trail, node]) ?? [...trail, node]
    }
    return null
  }
  return walk(work.toc, []) ?? []
}

/** Every unit id the table of contents names, in order. */
export function tocUnitIds(work: TocWork): string[] {
  return tocLeaves(work.toc).flatMap((node) => node.unitIds)
}
