import { ArrowRight, Star } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { RecentDrafts } from './components/RecentDrafts'
import { listFavourites, listPersonal, listRecents, toggleFavourite } from './personalStore'
import { useDraftingIndex } from './useDraftingData'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, Chip, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import type { DraftingIndex } from './schema'

/**
 * The form picker: forty-three cards, grouped the way an officer thinks about
 * them rather than the way CSMOP lists them, with a search box, favourites,
 * recently used forms and the officer's own templates above them.
 *
 * This screen loads `index.json` and nothing else — 17 KB for forty-three names,
 * the one-line `useWhen` each, and the CSMOP paragraphs behind each format. A
 * template is 24 KB and is fetched only once a form has been chosen. That is
 * the same laziness `useLawEngine(enabled)` keeps, and it is why the "use when"
 * line lives in the index rather than being read off `whenToUse` inside the
 * templates: showing it any other way would mean downloading all forty-three
 * templates to draw a grid.
 *
 * No card carries the file tab. The signature means *this is the one you are
 * in*, and on a screen whose whole job is choosing, none of them is yet.
 */

/** CSMOP's own order of business: outward, inward, personal, statutory. */
const GROUPS = ['communication', 'internal', 'personal', 'statutory'] as const
type Group = (typeof GROUPS)[number]

export default function PickerPage() {
  const { t } = useT()
  const index = useDraftingIndex()

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={t('pages.draft.title')} subtitle={t('pages.draft.subtitle')} />

      <RecentDrafts />

      <nav aria-label={t('draft.editor.documents')} className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/documents">{t('draft.editor.documents')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/my-templates">{t('draft.personal.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/profile">{t('draft.profile.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/address-book">{t('draft.addressBook.heading')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/numbering">{t('draft.numbering.heading')}</Link>
        </Button>
      </nav>

      <PersonalTemplates />

      <section aria-labelledby="draft-forms" className="flex flex-col gap-4">
        <div className="space-y-1">
          <h2 id="draft-forms" className="text-lg font-semibold">
            {t('draft.picker.heading')}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t('draft.picker.lead')}</p>
        </div>

        {index.status === 'error' ? (
          <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={index.retry} />
        ) : null}

        {index.status === 'loading' ? <PickerSkeleton /> : null}

        {index.status === 'ready' ? <Groups index={index.data} /> : null}
      </section>

      <Disclaimer />
      <DataVersion dataset="drafting-templates" />
    </div>
  )
}

function PersonalTemplates() {
  const { t } = useT()
  const templates = useLiveQuery(() => listPersonal(), []) ?? []
  if (templates.length === 0) return null
  return (
    <section aria-labelledby="draft-mine" className="flex flex-col gap-3">
      <h2 id="draft-mine" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('draft.personal.heading')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.slice(0, 6).map((template) => (
          <li key={template.id} className="contents">
            <SectionCard className="transition-colors hover:border-input">
              <Link
                to={`/draft/new/${template.baseTemplateId}?personal=${template.id}`}
                className="flex h-full min-h-11 flex-col gap-2 rounded-lg p-4"
              >
                <span className="flex items-center gap-2">
                  <span className="text-base font-semibold">{template.name}</span>
                  <Badge tone="warning">{t('draft.editor.yours')}</Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('draft.editor.yoursHint', { name: template.baseTemplateId })}
                </span>
              </Link>
            </SectionCard>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Groups({ index }: { index: DraftingIndex }) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const favourites = useLiveQuery(() => listFavourites(), []) ?? []
  const recents = useLiveQuery(() => listRecents(), []) ?? []

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return null
    return index.templates.filter((entry) =>
      [
        entry.name.en,
        entry.name.hi,
        entry.shortName.en,
        entry.shortName.hi,
        entry.useWhen.en,
        entry.useWhen.hi,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [index, query])

  const byId = useMemo(() => new Map(index.templates.map((entry) => [entry.id, entry])), [index])

  const byGroup = useMemo(() => {
    const map = new Map<Group, DraftingIndex['templates']>()
    for (const group of GROUPS) {
      map.set(
        group,
        index.templates.filter((entry) => entry.group === group),
      )
    }
    return map
  }, [index])

  const pinned = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((entry): entry is DraftingIndex['templates'][number] => Boolean(entry))

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('draft.picker.heading')}</span>
        <input
          data-module-search
          className="w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('draft.picker.heading')}
        />
      </label>

      {matches !== null ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map((entry) => (
            <FormCard key={entry.id} entry={entry} favourite={favourites.includes(entry.id)} />
          ))}
        </ul>
      ) : null}

      {matches === null && favourites.length > 0 ? (
        <section aria-labelledby="draft-favourites" className="flex flex-col gap-3">
          <h3
            id="draft-favourites"
            className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t('draft.personal.favourites')}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pinned(favourites).map((entry) => (
              <FormCard key={entry.id} entry={entry} favourite />
            ))}
          </ul>
        </section>
      ) : null}

      {matches === null && recents.length > 0 ? (
        <section aria-labelledby="draft-recent-forms" className="flex flex-col gap-3">
          <h3
            id="draft-recent-forms"
            className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t('draft.personal.recent')}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pinned(recents).map((entry) => (
              <FormCard key={entry.id} entry={entry} favourite={favourites.includes(entry.id)} />
            ))}
          </ul>
        </section>
      ) : null}

      {matches !== null
        ? null
        : GROUPS.map((group) => {
            const entries = byGroup.get(group) ?? []
            if (entries.length === 0) return null
            return (
              <section key={group} aria-labelledby={`draft-group-${group}`} className="flex flex-col gap-3">
                <h3
                  id={`draft-group-${group}`}
                  className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {t(`draft.groups.${group}`)}
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {entries.map((entry) => (
                    <FormCard key={entry.id} entry={entry} favourite={favourites.includes(entry.id)} />
                  ))}
                </ul>
              </section>
            )
          })}
    </>
  )
}

function FormCard({ entry, favourite }: { entry: DraftingIndex['templates'][number]; favourite: boolean }) {
  const { t, language } = useT()

  return (
    <li className="contents">
      <SectionCard className="relative transition-colors focus-within:border-input hover:border-input">
        <button
          type="button"
          aria-label={t('draft.personal.favourite')}
          aria-pressed={favourite}
          onClick={() => void toggleFavourite(entry.id)}
          className="absolute end-2 top-2 z-10 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <Star aria-hidden="true" className={favourite ? 'size-4 fill-current text-marigold' : 'size-4'} />
        </button>
        <Link
          to={`/draft/new/${entry.id}`}
          aria-label={t('draft.picker.open', { name: entry.name[language] })}
          className="flex h-full min-h-11 flex-col gap-2 rounded-lg p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="text-base font-semibold text-foreground">{entry.name[language]}</span>
            <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          </span>

          <span className="text-sm text-muted-foreground">{entry.useWhen[language]}</span>

          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <Chip tone="neutral">{t(`draft.picker.person.${entry.person}`)}</Chip>
            <Chip tone="neutral" className="tabular-nums">
              {t('draft.picker.csmop', { paras: entry.csmopParas.join(', ') })}
            </Chip>
            {/*
              `verify` on a template means CSMOP prescribes NO format for this
              document — seven of the fourteen. It is not a caveat about a
              detail; it is the difference between "the manual says this" and
              "this is how it is done", and an officer must never have to guess
              which they are looking at (ADR-020).
            */}
            {entry.verify ? <Badge tone="warning">{t('draft.picker.notInManual')}</Badge> : null}
          </span>
        </Link>
      </SectionCard>
    </li>
  )
}

function PickerSkeleton() {
  const { t } = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <SectionCard key={index} className="space-y-2 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </SectionCard>
      ))}
      <p className="sr-only" aria-live="polite">
        {t('common.loading')}
      </p>
    </div>
  )
}
