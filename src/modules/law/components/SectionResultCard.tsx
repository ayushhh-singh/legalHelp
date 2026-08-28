import { ArrowRight, FileWarning, X } from 'lucide-react'

import { summariseChanges, STATUS_TONE } from '../changes'
import { ClassificationTable } from './ClassificationTable'
import { DiffView } from './DiffView'
import { NoteBanner } from './NoteBanner'
import { SectionActions } from './SectionActions'
import { lookupOldSection } from '../resolve'
import type { LawCode, LawCorpus, LawSection } from '../types'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, Chip, SectionCard, SectionNumber } from '@/components/ui-x'
import type { Language } from '@/i18n'
import { useT } from '@/i18n/useT'

/**
 * One section, in full — the screen this module exists to draw.
 *
 * The two-column head is the shape of the whole answer: what the provision was
 * called under the repealed Act on the left, what it is now on the right. It
 * stacks on a phone, and the ARROW BETWEEN THEM IS DECORATIVE — the column
 * headings say "Repealed Act" and "In force from 1 July 2024" in words, because
 * a direction conveyed only by an icon is a direction half the readers of this
 * app will not get.
 *
 * Everything below the head is conditional on the dataset actually having it.
 * A card with no classification says the First Schedule lists none, rather than
 * rendering an empty table; a section with no Hindi text says so, rather than
 * showing a blank column. `docs/DATA-GAPS.md` #16 and #19 are why.
 */

interface SectionResultCardProps {
  code: LawCode
  record: LawSection
  corpus: LawCorpus
  /** Opens another section from a related-sections chip. */
  onOpenSection: (code: LawCode, section: string) => void
  /** Closes the section. Absent when there is nothing to go back to. */
  onClose?: () => void
}

export function SectionResultCard({ code, record, corpus, onOpenSection, onClose }: SectionResultCardProps) {
  const { t, language } = useT()
  const dataset = corpus.datasets[code]
  const change = summariseChanges(record, corpus.index)
  const heading = record.heading[language] || record.heading.en
  const text = record.text[language] || record.text.en

  const related = relatedSections(corpus, code, record, language)
  const subClauses = {
    new: change.newClauses.filter((clause) => clause !== record.section),
    changed: change.changedClauses.filter((clause) => clause !== record.section),
  }
  const sources = dataset.sources.filter((source) => record.sources.includes(source.id))

  return (
    <SectionCard active className="p-5" data-print-root>
      {/* Head ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <SectionNumber className="text-base">
          {record.act} {record.section}
        </SectionNumber>
        <Badge tone={STATUS_TONE[record.status]}>{t(`law.status.${record.status}`)}</Badge>
        {record.chapter.number ? (
          <span className="text-xs text-muted-foreground">
            {t('law.card.chapter', { number: record.chapter.number })}
          </span>
        ) : null}

        {/* Beside the list, this card is a pane — and a pane a reader cannot
            shut is a pane that has taken over the screen. */}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('law.card.close')}
            data-print-hide
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <h2 className="mt-3 text-lg leading-snug font-semibold">{heading}</h2>

      {/* Old | New ------------------------------------------------------- */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <section className="rounded-md border border-border bg-muted/60 p-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('law.card.old')}
          </h3>
          {change.absorbed.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('law.card.noCounterpart')}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {change.absorbed.map((old) => (
                <li key={`${old.act}-${old.section}`} className="text-sm">
                  <span className="font-semibold tabular-nums">
                    {old.act} {old.section}
                  </span>
                  {old.heading.en ? (
                    <span className="block text-muted-foreground">
                      {old.heading[language] || old.heading.en}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <ArrowRight
          aria-hidden="true"
          className="mx-auto hidden h-5 w-5 self-center text-muted-foreground sm:block"
        />

        <section className="rounded-md border border-border bg-card p-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('law.card.new')}
          </h3>
          <p className="mt-2 text-sm">
            <span className="font-semibold tabular-nums">
              {record.act} {record.section}
            </span>
            <span className="block text-muted-foreground">{heading}</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{dataset.newAct.name[language]}</p>
        </section>
      </div>

      {/*
        Curated-Hindi warning -------------------------------------------

        Only in Hindi, and that is the point of it. `verify: true` means the
        HINDI on this record is hand-authored (docs/DATA-GAPS.md #18); the
        English is the official text either way, so in English this card shows
        nothing curated and the banner would be a false alarm — which is how
        readers learn to stop reading banners.
      */}
      {record.verify && language === 'hi' ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border-l-[3px] border-marigold bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground">
          <FileWarning aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <Badge tone="warning" className="mr-1.5 align-middle">
              {t('law.card.verify')}
            </Badge>
            {t('law.card.curatedHindi')}
          </span>
        </p>
      ) : null}

      {/* Curated warnings ------------------------------------------------ */}
      {change.notes.length > 0 ? (
        <div className="mt-4 space-y-2">
          {change.notes.map((note) => (
            <NoteBanner key={note.title.en} note={note} />
          ))}
        </div>
      ) : null}

      {/* What changed ---------------------------------------------------- */}
      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t('law.card.whatChanged')}</h3>

        {change.numberOnly ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('law.card.numberOnly')}</p>
        ) : null}

        {/*
          A clause equal to the section number IS the section, not a
          sub-section of it — the dataset uses the section number as the clause
          when a section has only one. Listing it under "New sub-sections" read
          as "BNS 103 has a new sub-section called 103", and the status pill
          above already says the section changed.
        */}
        {subClauses.new.length > 0 ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">{t('law.card.newClauses')}: </span>
            <span className="tabular-nums">{subClauses.new.join(', ')}</span>
          </p>
        ) : null}

        {subClauses.changed.length > 0 ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">{t('law.card.changedClauses')}: </span>
            <span className="tabular-nums">{subClauses.changed.join(', ')}</span>
          </p>
        ) : null}

        {change.headingPair ? (
          <div className="mt-3 space-y-2">
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('law.card.diffTitle')}
            </h4>
            <p className="text-xs text-muted-foreground">{t('law.card.diffBody')}</p>
            <DiffView parts={change.headingDiff} />
          </div>
        ) : null}
      </section>

      {/* Section text ---------------------------------------------------- */}
      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t('law.card.text')}</h3>
        {text ? (
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{text}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t('law.card.noText')}</p>
        )}
      </section>

      {/* Classification -------------------------------------------------- */}
      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t('law.card.classification')}</h3>
        {record.classification.length > 0 ? (
          <div className="mt-2">
            <ClassificationTable rows={record.classification} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {code === 'bns' ? t('law.card.classificationNone') : t('law.card.classificationProcedural')}
          </p>
        )}

        {record.punishment.en || record.punishment.hi ? (
          <p className="mt-3 text-sm">
            <span className="font-medium">{t('law.card.punishment')}: </span>
            {record.punishment[language] || record.punishment.en}
          </p>
        ) : null}
      </section>

      {/* Related --------------------------------------------------------- */}
      {related.length > 0 ? (
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t('law.card.related')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map((sibling) => (
              <li key={`${sibling.code}:${sibling.section}`}>
                <button
                  type="button"
                  onClick={() => onOpenSection(sibling.code, sibling.section)}
                  aria-label={t('law.actions.openLabel', { act: sibling.act, section: sibling.section })}
                  className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                >
                  <Chip tone="neutral" className="min-h-11 hover:bg-accent hover:text-accent-foreground">
                    <span className="font-semibold tabular-nums">
                      {sibling.act} {sibling.section}
                    </span>
                    <span className="max-w-[16rem] truncate">{sibling.heading}</span>
                  </Chip>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Actions --------------------------------------------------------- */}
      <div className="mt-5 border-t border-border pt-4">
        <SectionActions code={code} record={record} dataset={dataset} onPrint={() => window.print()} />
      </div>

      {/* Footer ---------------------------------------------------------- */}
      <footer className="mt-5 space-y-3 border-t border-border pt-4">
        <ul className="flex flex-wrap gap-2">
          {sources.map((source) => (
            <li key={source.id}>
              <SourceChip name={source.name[language] || source.name.en} url={source.url} />
            </li>
          ))}
        </ul>
        <DataVersion dataset={`law-${code}`} />
        <Disclaimer />
      </footer>
    </SectionCard>
  )
}

/**
 * Sections of the same Act that absorbed one of the SAME repealed provisions.
 *
 * IPC 376 became BNS 64 and BNS 65, so each is the other's sibling. This is the
 * only "related" relation the datasets actually state — pulling section numbers
 * out of the body text would look richer and be wrong, because a BNSS section
 * citing "section 64" is citing the BNS, not itself.
 */
function relatedSections(
  corpus: LawCorpus,
  code: LawCode,
  record: LawSection,
  language: Language,
): Array<{ code: LawCode; act: string; section: string; heading: string }> {
  const dataset = corpus.datasets[code]

  const siblings = new Set<string>()
  for (const mapping of record.mappings) {
    for (const old of mapping.old) {
      const entry = lookupOldSection(corpus.index, old.act, old.section)
      for (const ref of entry?.newSections ?? []) {
        const base = /^(\d{1,4}[A-Za-z]{0,2})/.exec(ref)?.[1] ?? ref
        if (base !== record.section) siblings.add(base)
      }
    }
  }

  return [...siblings]
    .map((section) => dataset.sections[section])
    .filter((sibling): sibling is LawSection => Boolean(sibling))
    .slice(0, 8)
    .map((sibling) => ({
      code,
      act: sibling.act,
      section: sibling.section,
      heading: sibling.heading[language] || sibling.heading.en,
    }))
}
