import { ArrowLeft, Merge, Scissors, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { extractFile, MAX_FILE_BYTES, type ExtractFailure } from '../personal/extract'
import { toWorkHref } from '../url'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard, SectionNumber } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import {
  mergeWithPrevious,
  personalWorkId,
  savePersonalWork,
  splitDocument,
  splitUnitAt,
  type SplitResult,
  type SplitUnit,
} from '@/lib/library'
import { cn } from '@/lib/utils'
import type { LibraryPersonalWorkRow } from '@/db'

/**
 * `/library/add` — paste or upload a document, check how it was split, save it.
 *
 * NOTHING IS SAVED UNTIL THE READER CONFIRMS, and that is the whole shape of
 * this screen. No heuristic over an arbitrary PDF is right every time, so the
 * raw text sits beside the proposed parts and every one of them can be merged,
 * divided, retitled, renumbered or deleted first. `splitDocument` reports its
 * own confidence per part and this shows it, because a splitter that is
 * confidently wrong is worse than one that admits what it guessed.
 *
 * Everything stays on the device. The file is read in the browser
 * (`../personal/extract.ts`), the row goes to IndexedDB, and nothing is
 * uploaded — which is also why a scanned PDF is refused with a sentence rather
 * than sent somewhere that could read it.
 */

const LANGUAGES = ['en', 'hi'] as const
const UNIT_WORDS = ['section', 'rule', 'paragraph', 'item'] as const

export default function AddWorkPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [raw, setRaw] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [language, setLanguage] = useState<'en' | 'hi'>('en')
  const [unitWord, setUnitWord] = useState<(typeof UNIT_WORDS)[number]>('item')
  const [units, setUnits] = useState<SplitUnit[] | null>(null)
  const [split, setSplit] = useState<SplitResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ExtractFailure | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * Where the caret is in each part's textarea.
   *
   * "Split at the cursor" said so and split at the MIDPOINT — a label that lies
   * about the one operation on this screen where the reader has a precise
   * intention. A textarea reports its own caret; nothing else can.
   */
  const [caret, setCaret] = useState<Record<number, number>>({})

  const propose = (text: string) => {
    const result = splitDocument(text)
    setSplit(result)
    setUnits(result.units)
  }

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    const result = await extractFile(file)
    setBusy(false)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setRaw(result.text)
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
    propose(result.text)
  }

  const save = async () => {
    if (!units || units.length === 0 || !title.trim()) return
    setSaving(true)
    const id = personalWorkId(title)
    const row: LibraryPersonalWorkRow = {
      id,
      title: title.trim(),
      language,
      note: note.trim(),
      unitWord,
      units: units.map((unit, index) => ({
        id: `${id}-${index + 1}`,
        number: unit.number || String(index + 1),
        heading: unit.heading,
        text: unit.text,
        division: unit.division,
      })),
      divisions: split?.divisions ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    try {
      await savePersonalWork(row)
      void navigate(toWorkHref(id))
    } catch {
      setSaving(false)
      setError('failed')
    }
  }

  const patch = (index: number, change: Partial<SplitUnit>) => {
    setUnits((current) =>
      current ? current.map((unit, at) => (at === index ? { ...unit, ...change } : unit)) : current,
    )
  }

  const confidenceTone = useMemo(() => ({ high: 'success', medium: 'info', low: 'warning' }) as const, [])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={t('library.add.title')}
        subtitle={t('library.add.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/library">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
            </Link>
          </Button>
        }
      />

      <SectionCard>
        <div className="flex flex-col gap-4 p-4">
          <div>
            <label htmlFor="library-add-paste" className="mb-1 block text-sm font-medium">
              {t('library.add.paste')}
            </label>
            <textarea
              id="library-add-paste"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              onBlur={() => raw.trim() && propose(raw)}
              rows={6}
              placeholder={t('library.add.pastePlaceholder')}
              className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              `hidden`, not `sr-only`. An `sr-only` input is still in the
              accessibility tree and still focusable, so it needs a label of its
              own — axe said so — and the reader then meets two controls that do
              one thing: an unlabelled file field and the button beside it.
              `display: none` takes it out of the tree entirely and a
              programmatic `.click()` still opens the picker, which is what the
              button is for.
            */}
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onFile(file)
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload aria-hidden="true" />
              {t('library.add.upload')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('library.add.accept')}</span>
            {busy ? (
              <span role="status" className="text-xs text-muted-foreground">
                {t('library.add.extracting')}
              </span>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border-l-[3px] border-destructive bg-destructive/10 px-3 py-2 text-sm"
            >
              {error === 'too-big'
                ? t('library.add.tooBig', { mb: Math.round(MAX_FILE_BYTES / 1024 / 1024) })
                : error === 'no-text-layer'
                  ? t('library.add.noTextLayer')
                  : error === 'unsupported'
                    ? t('library.add.unsupported')
                    : t('library.add.failed')}
            </p>
          ) : null}
        </div>
      </SectionCard>

      {units ? (
        <>
          <SectionCard>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <label htmlFor="library-add-title" className="mb-1 block text-sm font-medium">
                  {t('library.add.titleLabel')}
                </label>
                <input
                  id="library-add-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('library.add.titlePlaceholder')}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              </div>
              <div>
                <label htmlFor="library-add-note" className="mb-1 block text-sm font-medium">
                  {t('library.add.noteLabel')}
                </label>
                <input
                  id="library-add-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('library.add.notePlaceholder')}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              </div>
              <div>
                <label htmlFor="library-add-language" className="mb-1 block text-sm font-medium">
                  {t('library.add.languageLabel')}
                </label>
                <select
                  id="library-add-language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as 'en' | 'hi')}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {LANGUAGES.map((option) => (
                    <option key={option} value={option}>
                      {t(`library.lang.${option}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="library-add-unit" className="mb-1 block text-sm font-medium">
                  {t('library.add.unitWordLabel')}
                </label>
                <select
                  id="library-add-unit"
                  value={unitWord}
                  onChange={(event) => setUnitWord(event.target.value as (typeof UNIT_WORDS)[number])}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {UNIT_WORDS.map((option) => (
                    <option key={option} value={option}>
                      {t(`library.add.unitWord.${option}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          <section aria-labelledby="library-review-heading" className="flex flex-col gap-3">
            <h2 id="library-review-heading" className="text-lg font-semibold">
              {t('library.add.review')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('library.add.reviewSubtitle')}</p>

            {(split?.notes ?? []).map((noteKey) => (
              <p
                key={noteKey}
                role="note"
                className="rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground"
              >
                {t(`library.add.notes.${noteKey as 'preamble'}`)}
              </p>
            ))}

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard>
                <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">
                  {t('library.add.raw')}
                </h3>
                <pre className="max-h-96 overflow-auto p-3 text-xs whitespace-pre-wrap">{raw}</pre>
              </SectionCard>

              <SectionCard>
                <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">
                  {t('library.add.proposed')} · {t('library.add.unitsFound', { count: units.length })}
                </h3>
                <ul className="flex max-h-96 flex-col gap-2 overflow-auto p-3">
                  {units.map((unit, index) => (
                    <li key={index} className="flex flex-col gap-2 rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SectionNumber className="text-xs">{unit.number || '—'}</SectionNumber>
                        <Badge tone={confidenceTone[unit.confidence]}>
                          {t(`library.add.confidence.${unit.confidence}`)}
                        </Badge>
                        {unit.division ? (
                          <span className="text-xs text-muted-foreground">{unit.division}</span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                          {t('library.add.renumber')}
                          <input
                            value={unit.number}
                            onChange={(event) => patch(index, { number: event.target.value })}
                            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                          />
                        </label>
                        <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                          {t('library.add.retitle')}
                          <input
                            value={unit.heading}
                            onChange={(event) => patch(index, { heading: event.target.value })}
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          />
                        </label>
                      </div>

                      <textarea
                        aria-label={`${t('library.add.proposed')} ${unit.number}`}
                        value={unit.text}
                        onChange={(event) => patch(index, { text: event.target.value })}
                        onSelect={(event) =>
                          setCaret((current) => ({
                            ...current,
                            [index]: event.currentTarget.selectionStart,
                          }))
                        }
                        rows={3}
                        className="w-full resize-y rounded-md border border-input bg-background p-2 text-xs"
                      />

                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            setUnits((current) => (current ? mergeWithPrevious(current, index) : current))
                          }
                          className={cn(
                            'inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            index === 0 && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <Merge aria-hidden="true" className="h-3.5 w-3.5" />
                          {t('library.add.mergeUp')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setUnits((current) => {
                              if (!current) return current
                              // The caret if the reader has put one in this
                              // part; the midpoint only as a fallback for a
                              // part they have not touched.
                              const at = caret[index] ?? Math.floor(unit.text.length / 2)
                              return splitUnitAt(current, index, at)
                            })
                          }
                          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <Scissors aria-hidden="true" className="h-3.5 w-3.5" />
                          {t('library.add.splitHere')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setUnits((current) => current?.filter((_, at) => at !== index) ?? current)
                          }
                          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          {t('library.add.deleteUnit')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void save()} disabled={saving || !title.trim() || units.length === 0}>
                {t('library.add.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setUnits(null)
                  setSplit(null)
                  setRaw('')
                }}
              >
                {t('library.add.cancel')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('library.add.notOfficial')}</p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
