import { useMemo } from 'react'

import type { Glossary, GlossaryTerm } from './schema'

/** One English term found in the text, at the exact offsets it was found. */
export interface GlossaryMatch {
  start: number
  end: number
  /** The text as it actually appears — the term's own casing may differ. */
  matchedText: string
  term: GlossaryTerm
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g
const escapeRegExp = (value: string) => value.replace(ESCAPE, '\\$&')

/**
 * One alternation over every glossary term's `en`, longest first so "Under
 * Secretary" wins over "Secretary" where both would otherwise match at the
 * same position — the alternation operator tries each branch in order and
 * stops at the first that matches.
 *
 * `(?<![A-Za-z0-9_])`/`(?![A-Za-z0-9_])` rather than `\b` on both sides: `\b`
 * alone would let "e-Office" match inside a longer hyphenated word, and a
 * plain word boundary either side of a multi-word term like "Copy to"
 * already does the right thing at the space, so the lookaround only has to
 * guard the ends. It excludes digits and `_` as well as letters — not just
 * `[A-Za-z]` — because a term glued to a number is a reference, not the
 * word: "Panel2" must not offer "Panel" as a replacement, since accepting it
 * would splice Hindi into what is actually a panel number.
 *
 * A second, separate lookaround guards the hyphen-then-digit shape a plain
 * `[A-Za-z0-9_]` exclusion misses: "Audit-2024" has a hyphen — not a letter,
 * digit or underscore — immediately after "Audit", so the first lookaround
 * alone lets it through and the term matches inside what is actually a file
 * reference. `(?!-\d)`/`(?<!\d-)` reject a term immediately followed by, or
 * preceded by, a hyphen that is itself next to a digit.
 */
function buildMatcher(glossary: Glossary): { regex: RegExp; byLower: Map<string, GlossaryTerm> } | null {
  if (glossary.terms.length === 0) return null
  const byLower = new Map<string, GlossaryTerm>()
  for (const term of glossary.terms) {
    const key = term.en.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, term)
  }
  const sorted = [...byLower.keys()].sort((a, b) => b.length - a.length)
  const pattern = sorted.map(escapeRegExp).join('|')
  const regex = new RegExp(`(?<![A-Za-z0-9_])(?<!\\d-)(?:${pattern})(?![A-Za-z0-9_])(?!-\\d)`, 'gi')
  return { regex, byLower }
}

/**
 * Every English term in `text` that has a known Hindi equivalent, in order of
 * appearance and never overlapping.
 *
 * Pure and cheap enough to run on every keystroke: the matcher is built once
 * per glossary (`useMemo`, keyed on the object reference `useGlossary` already
 * settles once and keeps) and `String.matchAll` is one pass over the text.
 * What the caller does with a match — underline it, offer a one-click
 * replacement — is a UI decision; this hook only finds them.
 */
export function useGlossarySuggest(text: string, glossary: Glossary | null): GlossaryMatch[] {
  const matcher = useMemo(() => (glossary ? buildMatcher(glossary) : null), [glossary])

  return useMemo(() => {
    if (!matcher || !text) return []
    const matches: GlossaryMatch[] = []
    for (const found of text.matchAll(matcher.regex)) {
      const matchedText = found[0]
      const term = matcher.byLower.get(matchedText.toLowerCase())
      if (!term || found.index === undefined) continue
      matches.push({ start: found.index, end: found.index + matchedText.length, matchedText, term })
    }
    return matches
  }, [matcher, text])
}
