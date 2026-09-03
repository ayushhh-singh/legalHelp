import { ArrowLeft, ArrowLeftRight } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { parseCompareRef, toCompareHref, toUnitHref } from '../url'
import { useReaderCorpus, useReaderWork } from '../useAnnotations'
import { useLibraryIndex } from '../useLibrary'
import { usePersonalWorks } from '../useAnnotations'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, SectionCard, SectionNumber, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { Language } from '@/i18n'
import { anchorText, diffOf, unitLabel, type LibraryCorpus } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * `/library/compare?a=work:unit&b=work:unit` — two units side by side.
 *
 * The diff is the Law Converter's own word diff (`src/lib/diff.ts`), used in
 * its DEFAULT mode: case and punctuation folded. That is right here for the
 * same reason it is right there — the question is "what does this provision say
 * differently", and a danda or a capital is noise. It is NOT the `exact` mode
 * the drafting suggestions use, because nothing here is accepted into a
 * document.
 *
 * Both sides are read from the URL, so a comparison is a link somebody can
 * send. The language toggle applies to both panes at once: comparing the
 * English of one against the Hindi of the other is not a comparison of
 * anything.
 */

function Pane({
  corpus,
  unitId,
  language,
  parts,
  side,
}: {
  corpus: LibraryCorpus | null
  unitId: string | null
  language: Language
  parts: { text: string; changed: boolean }[] | null
  side: 'a' | 'b'
}) {
  const { t } = useT()
  const unit = corpus && unitId ? corpus.units.get(unitId) : null
  if (!unit) return <p className="text-sm text-muted-foreground">{t('library.compare.empty')}</p>

  const shown = unitLabel(unit.heading, unit.excerpt, language)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2">
        <SectionNumber className="mt-0.5 shrink-0 text-xs">{unit.number}</SectionNumber>
        <h2 lang={shown.lang} className={cn('text-sm font-semibold', shown.isExcerpt && 'italic')}>
          {shown.text}
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">{unit.citation[language]}</p>
      <div className="text-sm leading-relaxed">
        {parts
          ? parts.map((part, index) => (
              <span
                key={index}
                className={cn(
                  part.changed &&
                    (side === 'a'
                      ? 'bg-coral/15 text-coral-foreground'
                      : 'bg-tulsi/15 text-tulsi-foreground'),
                )}
              >
                {part.text}
              </span>
            ))
          : // Too long to diff: both are shown in full rather than nothing.
            anchorText(unit.body.en.length > 0 ? unit.body.en : unit.body.hi)}
      </div>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to={toUnitHref(corpus!.workId, unit.id)}>{t('library.compare.open')}</Link>
      </Button>
    </div>
  )
}

export default function ComparePage() {
  const { t, language } = useT()
  const [params, setParams] = useSearchParams()
  const index = useLibraryIndex()
  const personal = usePersonalWorks()

  // `unitId` may be empty: a work is chosen first and its units are listed
  // from its own corpus. `Pane` renders the "pick one" message for that state.
  const a = parseCompareRef(params.get('a'))
  const b = parseCompareRef(params.get('b'))

  const workA = useReaderWork(a?.workId)
  const workB = useReaderWork(b?.workId)
  const corpusA = useReaderCorpus(workA.work)
  const corpusB = useReaderCorpus(workB.work)

  const textA = useMemo(() => {
    const unit = a?.unitId && corpusA.data ? corpusA.data.units.get(a.unitId) : null
    return unit ? anchorText(unit.body.en.length > 0 ? unit.body.en : unit.body.hi) : ''
  }, [a, corpusA.data])

  const textB = useMemo(() => {
    const unit = b?.unitId && corpusB.data ? corpusB.data.units.get(b.unitId) : null
    return unit ? anchorText(unit.body.en.length > 0 ? unit.body.en : unit.body.hi) : ''
  }, [b, corpusB.data])

  const diff = useMemo(() => (textA && textB ? diffOf(textA, textB) : null), [textA, textB])

  const options = useMemo(() => {
    const rows: { id: string; name: string }[] = []
    for (const work of index.data?.works ?? []) rows.push({ id: work.id, name: work.shortTitle[language] })
    for (const work of personal ?? []) rows.push({ id: work.id, name: work.title })
    return rows
  }, [index.data, personal, language])

  const picker = (
    side: 'a' | 'b',
    ref: { workId: string; unitId: string } | null,
    corpus: LibraryCorpus | null,
  ) => (
    <div className="flex flex-wrap gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('library.compare.work')}
        <select
          value={ref?.workId ?? ''}
          onChange={(event) => {
            const next = new URLSearchParams(params)
            if (event.target.value) next.set(side, `${event.target.value}:`)
            else next.delete(side)
            setParams(next, { replace: true })
          }}
          aria-label={`${t(`library.compare.pick${side.toUpperCase()}` as 'library.compare.pickA')} — ${t('library.compare.work')}`}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t('library.compare.pick')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
        {t('library.compare.unit')}
        <select
          value={ref?.unitId ?? ''}
          disabled={!corpus}
          onChange={(event) => {
            const next = new URLSearchParams(params)
            next.set(side, `${ref?.workId ?? ''}:${event.target.value}`)
            setParams(next, { replace: true })
          }}
          aria-label={`${t(`library.compare.pick${side.toUpperCase()}` as 'library.compare.pickA')} — ${t('library.compare.unit')}`}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
        >
          <option value="">{t('library.compare.pick')}</option>
          {[...(corpus?.order ?? [])].map((id) => {
            const unit = corpus?.units.get(id)
            return unit ? (
              <option key={id} value={id}>
                {unit.number}
              </option>
            ) : null
          })}
        </select>
      </label>
    </div>
  )

  const loading = corpusA.status === 'loading' || corpusB.status === 'loading'

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={t('library.compare.title')}
        subtitle={t('library.compare.subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/library">
              <ArrowLeft aria-hidden="true" />
              {t('library.back')}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">{t('library.compare.pickA')}</legend>
          {picker('a', a, corpusA.data)}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">{t('library.compare.pickB')}</legend>
          {picker('b', b, corpusB.data)}
        </fieldset>
      </div>

      <div>
        <Button variant="outline" size="sm" asChild>
          <Link to={toCompareHref(b, a)}>
            <ArrowLeftRight aria-hidden="true" />
            {t('library.compare.swap')}
          </Link>
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <SectionCard>
          <div className="flex flex-col gap-4 p-4">
            {a?.unitId && b?.unitId && diff?.identical ? (
              <p role="status" className="text-sm text-tulsi-foreground">
                {t('library.compare.identical')}
              </p>
            ) : null}
            {a?.unitId && b?.unitId && diff === null && textA && textB ? (
              <p role="note" className="text-sm text-muted-foreground">
                {t('library.compare.tooLong')}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 text-xs">
              <Badge tone="danger">{t('library.compare.removed')}</Badge>
              <Badge tone="success">{t('library.compare.added')}</Badge>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Pane
                corpus={corpusA.data}
                unitId={a?.unitId ?? null}
                language={language}
                parts={diff?.left ?? null}
                side="a"
              />
              <Pane
                corpus={corpusB.data}
                unitId={b?.unitId ?? null}
                language={language}
                parts={diff?.right ?? null}
                side="b"
              />
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
