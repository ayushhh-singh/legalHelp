import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from './DocumentEditor'
import { FindReplace } from './FindReplace'
import { buildPattern, convertDigits, countDocument, findMatches, replaceAll } from './commands'

import type { BodyDoc } from '@/lib/drafting/model'

const body = (...paras: string[]): BodyDoc => ({
  type: 'doc',
  content: paras.map((text) => ({
    type: 'numberedPara',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  })),
})

const noop = () => undefined

function Harness({ initial = body('One paragraph.') }: { initial?: BodyDoc }) {
  const [value, setValue] = useState(initial)
  return (
    <DocumentEditor
      body={value}
      lang="en"
      label="Document body"
      placeholders={['fileNumber', 'subject']}
      onChange={setValue}
      onFindReplace={noop}
      onInsertPhrase={noop}
      onInsertGlossary={noop}
      onAddEnclosure={noop}
      onAddCopyTo={noop}
    />
  )
}

/** A parent that hands the editor a body it never emitted. */
function ExternalChange() {
  const [value, setValue] = useState(body('Before the restore.'))
  return (
    <>
      <button type="button" onClick={() => setValue(body('After the restore.'))}>
        restore
      </button>
      <DocumentEditor
        body={value}
        lang="en"
        label="Document body"
        placeholders={[]}
        onChange={setValue}
        onFindReplace={noop}
        onInsertPhrase={noop}
        onInsertGlossary={noop}
        onAddEnclosure={noop}
        onAddCopyTo={noop}
      />
    </>
  )
}

describe('the editor, in the DOM', () => {
  it('mounts and renders the document it was given', async () => {
    render(<Harness />)
    expect(await screen.findByText('One paragraph.')).toBeInTheDocument()
  })

  it('exposes the body as a labelled multiline textbox', async () => {
    render(<Harness />)
    const surface = await screen.findByRole('textbox', { name: 'Document body' })
    expect(surface).toHaveAttribute('aria-multiline', 'true')
    expect(surface).toHaveAttribute('contenteditable', 'true')
  })

  it('gives the toolbar a role, a name and pressed states', async () => {
    render(<Harness />)
    const toolbar = await screen.findByRole('toolbar', { name: /formatting/i })
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal')

    // Every control is a real button with a real accessible name, and the ones
    // that toggle report `aria-pressed` rather than relying on colour.
    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers a chip for every field the form defines', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('button', { name: /insert a blank/i }))
    expect(screen.getByRole('button', { name: '{{fileNumber}}' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '{{subject}}' })).toBeInTheDocument()
  })

  it('reports the word and page count in a live region', async () => {
    render(<Harness initial={body('one two three four five')} />)
    const counts = await screen.findByText(/5 words/)
    expect(counts).toHaveAttribute('aria-live', 'polite')
  })

  it("survives StrictMode's double mount", async () => {
    // `src/main.tsx` renders under StrictMode and Playwright runs a production
    // build where it is inert, so this is the only place the double invocation
    // is exercised. CLAUDE.md records two StrictMode defects shipped in
    // `useDraft.ts` for exactly that reason.
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
    expect(await screen.findByText('One paragraph.')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: 'Document body' })).toHaveLength(1)
  })

  it('applies a body it did not emit — a restore, a replace-all, a language switch', async () => {
    render(<ExternalChange />)
    expect(await screen.findByText('Before the restore.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'restore' }))
    expect(await screen.findByText('After the restore.')).toBeInTheDocument()
  })

  /*
    There is deliberately NO jsdom test that the editor does not re-seed itself
    on every keystroke.
   
    The obvious one — assert the paragraph's DOM node is the same object after a
    re-render carrying an equal body — was written, and it PASSES against a
    version with the `lastEmitted` guard deleted: ProseMirror diffs the document
    it is given and reuses the nodes, so a re-seed of identical content is
    invisible in the DOM. The only thing the guard actually protects is the
    SELECTION, and jsdom implements no layout at all (`Range.getClientRects` is
    absent, and stubbing it makes ProseMirror place typed characters worse than
    the absence does).
   
    So the claim lives in `tests/e2e/draft-editor.spec.ts`, where a real browser
    types two separate runs of text and the second lands where the caret was.
    A test that cannot fail is not evidence (CLAUDE.md, the `network.sentinel`
    story), and one that looks like evidence is worse than none.
  */
})

describe('FindReplace', () => {
  it('reports the match count and replaces', async () => {
    const onReplace = vi.fn()
    render(<FindReplace body={body('alpha beta alpha')} onReplace={onReplace} onClose={noop} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), 'alpha')
    expect(await screen.findByText('2 match(es)')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: 'Replace with' }), 'gamma')
    await userEvent.click(screen.getByRole('button', { name: /replace all/i }))
    expect(onReplace).toHaveBeenCalledOnce()
    expect(JSON.stringify(onReplace.mock.calls[0]?.[0])).toContain('gamma')
  })

  it('says a regular expression is invalid instead of throwing', async () => {
    render(<FindReplace body={body('anything')} onReplace={noop} onClose={noop} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /regular expression/i }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), '(unclosed')
    expect(await screen.findByText(/not a valid regular expression/i)).toBeInTheDocument()
  })

  it('announces that "whole word" does nothing on a Devanagari query', async () => {
    render(<FindReplace body={body('नियम')} onReplace={noop} onClose={noop} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /whole word/i }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), 'नियम')
    expect(await screen.findByText(/no effect on a Devanagari search/i)).toBeInTheDocument()
  })
})

describe('find and replace, over the body', () => {
  it('escapes a literal query, so a file number is searchable', () => {
    const matches = findMatches(body('See A-11011/5(i)/2026-Estt. above.'), 'A-11011/5(i)/2026-Estt.')
    expect(matches).toHaveLength(1)
  })

  it('honours case sensitivity', () => {
    expect(findMatches(body('Rule and rule'), 'rule')).toHaveLength(2)
    expect(findMatches(body('Rule and rule'), 'rule', { caseSensitive: true })).toHaveLength(1)
  })

  it('applies whole-word only where a word boundary means something', () => {
    expect(findMatches(body('rules and rule'), 'rule', { wholeWord: true })).toHaveLength(1)
    // `\b` is defined over [A-Za-z0-9_], so anchoring a Devanagari query would
    // match NOTHING, ever — the ADR-035/ADR-038 trap. The option is dropped for
    // such a query rather than producing a pattern that silently finds nothing.
    expect(findMatches(body('नियम और उप-नियम'), 'नियम', { wholeWord: true })).toHaveLength(2)
  })

  it('reports a bad regular expression rather than throwing', () => {
    expect(findMatches(body('x'), '(', { regex: true })).toBe('bad-regex')
    expect(buildPattern('(', { regex: true })).toBe('bad-regex')
    expect(replaceAll(body('x'), '(', 'y', { regex: true })).toBe('bad-regex')
  })

  it('terminates on a zero-length match', () => {
    const matches = findMatches(body('abc'), 'x*', { regex: true })
    expect(Array.isArray(matches)).toBe(true)
  })

  it('expands capture groups in regex mode and not in literal mode', () => {
    const withGroups = replaceAll(body('Rule 12'), 'Rule (\\d+)', 'Rule $1A', { regex: true })
    if (withGroups === 'bad-regex') throw new Error('unexpected')
    expect(JSON.stringify(withGroups.body)).toContain('Rule 12A')

    const literal = replaceAll(body('cost $1'), '$1', '$2')
    if (literal === 'bad-regex') throw new Error('unexpected')
    expect(JSON.stringify(literal.body)).toContain('cost $2')
  })

  it('counts what it replaced', () => {
    const result = replaceAll(body('a a a'), 'a', 'b')
    if (result === 'bad-regex') throw new Error('unexpected')
    expect(result.count).toBe(3)
  })
})

describe('numerals and counts', () => {
  it('converts every numeral in the document, both ways', () => {
    const devanagari = convertDigits(body('Rule 12 of 2026'), 'devanagari')
    expect(JSON.stringify(devanagari)).toContain('१२')
    expect(JSON.stringify(convertDigits(devanagari, 'ascii'))).toContain('12')
  })

  it('counts words, characters, paragraphs and pages', () => {
    const counts = countDocument(body('one two three', 'four'))
    expect(counts.words).toBe(4)
    expect(counts.paragraphs).toBe(2)
    expect(counts.pages).toBe(1)
  })

  it('counts a long document as more than one page', () => {
    const long = Array.from({ length: 800 }, (_, index) => `w${index}`).join(' ')
    expect(countDocument(body(long)).pages).toBeGreaterThan(1)
  })
})
