import { Check, Copy, ExternalLink, Phone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { loadPortals } from './data'
import { PORTAL_CATEGORIES } from './schema'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { PageHeader } from '@/components/common/PageHeader'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge, QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'

import type { Portal, PortalCategory } from './schema'

/** `/utils/portals` — the portals & helplines directory. */
export default function PortalsPage() {
  const { t, language } = useT()
  const state = useAsync(loadPortals, 'portals', true)
  const [searchParams] = useSearchParams()
  // A command palette result (`?q=<name>`) prefills the search box — the lazy
  // initialiser handles the first render (the value is available
  // synchronously from the URL and needs no dataset), and the effect below
  // handles every navigation AFTER that: this route never remounts when only
  // its search params change (same `/utils/portals` element throughout), so
  // picking a SECOND portal result from the palette while already on this
  // page updates the URL but not, without this, the search box — `lastQ`
  // guards against the effect fighting the reader's own typing, which never
  // changes `searchParams` itself.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const lastQ = useRef(searchParams.get('q') ?? '')
  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    if (q !== lastQ.current) {
      lastQ.current = q
      setQuery(q)
    }
  }, [searchParams])
  const [category, setCategory] = useState<PortalCategory | 'all'>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /*
    What the copy button did, announced rather than only drawn.

    The button's only feedback was swapping its Copy icon for a Check, and both
    are `aria-hidden` — so to a screen reader nothing happened at all. Every
    other copy affordance in this app already says so out loud
    (`SectionActions.tsx`, `TermRow.tsx`); this one was the odd one out.
  */
  const [message, setMessage] = useState('')

  const filtered = useMemo(() => {
    const portals = state.status === 'ready' ? state.data.portals : []
    const q = query.trim().toLowerCase()
    return portals.filter((p) => {
      if (category !== 'all' && p.category !== category) return false
      if (!q) return true
      return (
        p.name.en.toLowerCase().includes(q) ||
        p.name.hi.includes(q) ||
        p.shortName.en.toLowerCase().includes(q) ||
        p.purpose.en.toLowerCase().includes(q)
      )
    })
  }, [state, query, category])

  const copyUrl = async (portal: Portal) => {
    try {
      await navigator.clipboard.writeText(portal.url)
      setCopiedId(portal.id)
      setMessage(t('utils.portals.copied'))
    } catch {
      setCopiedId(null)
      setMessage(t('utils.portals.copyFailed'))
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('utils.portals.title')} subtitle={t('utils.portals.subtitle')} />

      <SectionCard active className="p-4">
        <label className="sr-only" htmlFor="portals-search">
          {t('utils.portals.searchLabel')}
        </label>
        <input
          id="portals-search"
          data-module-search
          type="search"
          value={query}
          placeholder={t('utils.portals.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />

        <fieldset className="mt-3 min-w-0">
          <legend className="sr-only">{t('utils.portals.categoryAll')}</legend>
          <div
            role="radiogroup"
            aria-label={t('utils.portals.categoryAll')}
            className="flex flex-wrap gap-1.5"
          >
            <CategoryChip checked={category === 'all'} onSelect={() => setCategory('all')}>
              {t('utils.portals.categoryAll')}
            </CategoryChip>
            {PORTAL_CATEGORIES.map((cat) => (
              <CategoryChip key={cat} checked={category === cat} onSelect={() => setCategory(cat)}>
                {t(`utils.portals.category.${cat}`)}
              </CategoryChip>
            ))}
          </div>
        </fieldset>
      </SectionCard>

      {state.status === 'error' ? <QueryErrorState body={t('errors.body')} onRetry={state.retry} /> : null}

      {state.status === 'loading' ? (
        <div className="space-y-3" aria-live="polite" aria-label={t('common.loading')}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t('utils.portals.resultCount', { count: filtered.length })}
          </p>
          <ul className="space-y-2">
            {filtered.map((portal) => (
              <li
                key={portal.id}
                className="rounded-lg border border-border p-3 transition-colors hover:border-input"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div>
                    <p className="text-sm font-semibold">{portal.name[language]}</p>
                    <p className="text-xs text-muted-foreground">{portal.purpose[language]}</p>
                  </div>
                  <a
                    href={portal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium hover:bg-muted"
                  >
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('utils.portals.open')}
                  </a>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyUrl(portal)}>
                    {copiedId === portal.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {t('utils.portals.copyUrl')}
                  </Button>
                  {portal.helpline ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone aria-hidden="true" className="h-3 w-3" />
                      {portal.helpline.phone ?? portal.helpline.email}
                    </span>
                  ) : null}
                  {portal.verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
                  {portal.source ? <SourceChip name={portal.source.name} url={portal.source.url} /> : null}
                </div>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('utils.portals.empty')}</p>
          ) : null}
        </>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>

      <Disclaimer />
      <DataVersion dataset="portals" />
    </div>
  )
}

function CategoryChip({
  checked,
  onSelect,
  children,
}: {
  checked: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium transition-colors',
        checked
          ? 'border-action bg-action font-semibold text-action-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
      )}
    >
      <input
        type="radio"
        name="portals-category"
        checked={checked}
        onChange={onSelect}
        onClick={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  )
}
