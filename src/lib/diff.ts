/**
 * Word-level diff, so a reader can see what the new wording actually changed.
 *
 * This is Myers' O(ND) algorithm (E. Myers, 1986), not a line diff and not a
 * character diff. Character diffs of legal prose produce confetti; line diffs
 * of a single paragraph produce "the whole thing changed". The unit that
 * carries meaning here is the word — "shall" becoming "may", "seven years"
 * becoming "ten years" — and that is what this reports.
 *
 * No dependency: a word diff is thirty lines, and a diff library would be
 * another package in a bundle this app keeps deliberately small.
 */

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffPart {
  op: DiffOp
  /** Consecutive tokens sharing one operation, so the UI renders one span. */
  tokens: string[]
}

/**
 * Words and hard line breaks. Line breaks are kept as their own tokens because
 * `data/law/*.json` uses them to separate sub-sections, and losing them turns
 * "(1) … (2) …" into one run-on paragraph.
 */
export function tokenise(text: string): string[] {
  return text.match(/\n|[^\s]+/g) ?? []
}

/**
 * Punctuation and case are not what a reader means by "what changed".
 *
 * The danda `।` and double danda `॥` are in the list because they are the
 * Devanagari full stop: the ingest's Hindi headings end in one and the English
 * ones do not, so leaving them out reported "हत्या।" and "हत्या" as a deletion
 * plus an insertion — a spurious change on every Hindi heading pair.
 */
const normalise = (token: string) => token.toLowerCase().replace(/[.,;:"'()‘’“”।॥]/g, '')

/**
 * Above this many tokens on either side the algorithm's worst case (O(N·D))
 * stops being worth the wait on a phone. No section in the three Sanhitas comes
 * near it; the guard exists so a future dataset with a long schedule in it
 * degrades to "shown side by side" rather than to a frozen tab.
 */
const MAX_TOKENS = 2500

/**
 * The edit script turning `before` into `after`.
 *
 * Returns `null` when either side is too long to diff — a distinct answer from
 * "no differences", and the caller must show both texts plainly instead.
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = tokenise(before)
  const b = tokenise(after)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null

  const script = myers(a.map(normalise), b.map(normalise))
  if (!script) return null

  // Re-attach the ORIGINAL tokens: the comparison runs on the normalised forms
  // so punctuation does not register as a change, but what is shown must be
  // the text as it is written.
  const parts: DiffPart[] = []
  let ai = 0
  let bi = 0
  for (const op of script) {
    let token: string
    if (op === 'insert') {
      token = b[bi] ?? ''
      bi += 1
    } else if (op === 'delete') {
      token = a[ai] ?? ''
      ai += 1
    } else {
      token = a[ai] ?? ''
      ai += 1
      bi += 1
    }

    const last = parts[parts.length - 1]
    if (last && last.op === op) last.tokens.push(token)
    else parts.push({ op, tokens: [token] })
  }

  return parts
}

/**
 * Myers' greedy algorithm with a recorded trace.
 *
 * `v[k]` is the furthest x reached on diagonal k after d edits. One snapshot of
 * `v` is kept per d so the path can be walked backwards once the end is
 * reached — the alternative (the linear-space refinement) is a good deal more
 * code for inputs this size.
 */
function myers(a: readonly string[], b: readonly string[]): DiffOp[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      // Move down (an insertion) when that is the further-reaching option.
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k

      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x

      if (x >= n && y >= m) return backtrack(trace, n, m, offset, d)
    }
  }

  return null
}

/** Walk the recorded traces backwards, emitting one operation per step. */
function backtrack(
  trace: readonly Int32Array[],
  n: number,
  m: number,
  offset: number,
  finalD: number,
): DiffOp[] {
  const ops: DiffOp[] = []
  let x = n
  let y = m

  for (let d = finalD; d > 0; d -= 1) {
    const v = trace[d] ?? new Int32Array(0)
    const k = x - y
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK] ?? 0
    const prevY = prevX - prevK

    // The diagonal run first: everything between here and (prevX, prevY) matched.
    while (x > prevX && y > prevY) {
      ops.push('equal')
      x -= 1
      y -= 1
    }
    ops.push(down ? 'insert' : 'delete')
    x = prevX
    y = prevY
  }

  while (x > 0 && y > 0) {
    ops.push('equal')
    x -= 1
    y -= 1
  }

  return ops.reverse()
}

/** True when the two texts differ by at least one word. */
export function hasChanges(parts: readonly DiffPart[] | null): boolean {
  return Boolean(parts?.some((part) => part.op !== 'equal'))
}

/** How many words were added and removed — the summary line above a diff. */
export function diffCounts(parts: readonly DiffPart[] | null): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of parts ?? []) {
    if (part.op === 'insert') added += part.tokens.filter((token) => token !== '\n').length
    if (part.op === 'delete') removed += part.tokens.filter((token) => token !== '\n').length
  }
  return { added, removed }
}
