import type { ReaderPrefs } from '../useLibrary'

import type { Language } from '@/i18n'
import type { LibraryUnit } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * One unit's text, in one language.
 *
 * The four size steps and the two spacings are classes rather than inline
 * styles, so the whole of `src/styles`'s `:lang(hi)` line-height floor still
 * applies on top of them — an inline `line-height` would beat that rule at
 * specificity and quietly undo the ≥ 1.75 Devanagari requirement the master
 * context states twice.
 *
 * A PROVISO is set apart. `paragraphs()` in `src/lib/library/corpus.ts` breaks
 * before "Provided", "Explanation" and "Illustration" (and their Devanagari
 * equivalents) as well as before a numbered sub-clause, and this indents those
 * so a reader can see where the rule stops and its exception starts — which on
 * a 4,000-character single line of CCS (Conduct) Rule 11 is otherwise invisible.
 *
 * `unit.parts` IS NOT RENDERED HERE, deliberately. It looks like extra content
 * and is not: all 219 rules that have sub-rules have them as verbatim slices of
 * the same `text` the body is built from (`library.test.ts` asserts it). The
 * first version of this component rendered both and printed every such rule
 * twice — visible only in a real browser, because both halves were individually
 * correct.
 */

const SIZE_CLASS: Readonly<Record<number, string>> = {
  1: 'text-sm',
  2: 'text-base',
  3: 'text-lg',
  4: 'text-xl',
}

const PROVISO = /^(Provided|PROVIDED|Explanation|Illustration|परन्तु|परंतु|स्पष्टीकरण|दृष्टांत)/

interface UnitBodyProps {
  unit: LibraryUnit
  lang: Language
  prefs: ReaderPrefs
  className?: string
}

export function UnitBody({ unit, lang, prefs, className }: UnitBodyProps) {
  const paragraphs = unit.body[lang]

  const typography = cn(
    SIZE_CLASS[prefs.size] ?? SIZE_CLASS[2],
    prefs.family === 'serif' ? 'font-reading' : 'font-sans',
    prefs.lineHeight === 'relaxed' && 'leading-[1.9]',
  )

  // The caller decides what to do about a language with no text — it is the
  // one that knows whether the reader asked for one language or both, and it
  // owns the notice. This renders nothing rather than an empty page.
  if (paragraphs.length === 0) return null

  return (
    <div lang={lang} className={cn(typography, className)}>
      {paragraphs.map((paragraph, index) => (
        <p
          // Index is the identity here: these are positions in one immutable
          // string, not records, and two identical provisos in one rule are a
          // real thing (CCS (Leave) Rule 39 has three).
          key={index}
          className={cn('mb-4 last:mb-0', PROVISO.test(paragraph) && 'ml-4 border-l-2 border-border pl-4')}
        >
          {paragraph}
        </p>
      ))}
    </div>
  )
}
