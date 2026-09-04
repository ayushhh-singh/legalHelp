import { NavLink } from 'react-router-dom'
import { useRef } from 'react'

import type { SubTab } from '@/lib/nav'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

/**
 * The sub-tab strip inside a section: underline variant, one row, scrollable
 * on a phone.
 *
 * These are ROUTES, not panels — pressing one navigates, and the browser's
 * back button has to undo it — so this is a labelled `<nav>` of links carrying
 * `aria-current="page"` rather than a `role="tablist"` of `role="tab"`s. The
 * ARIA tab pattern promises a tabpanel that is swapped in place and a widget
 * that owns its own focus; neither is true of a router, and claiming both is
 * how `aria-required-children` and "where did my back button go" arrive
 * together. The keyboard behaviour a reader actually wants from a strip like
 * this — Left/Right/Home/End between the labels — is implemented below, on
 * links, where it costs nothing and lies about nothing.
 *
 * The active mark is the file tab, as everywhere else in this app: a 3px
 * `--marigold` rule on the strip's own edge plus a bolder label, never colour
 * alone.
 */
export function SegmentedTabs({
  subTabs,
  badges,
  className,
}: {
  subTabs: readonly SubTab[]
  /** Sub-tab id → count. Only a sub-tab declaring a `badge` is given one. */
  badges?: Readonly<Record<string, number | undefined>>
  className?: string
}) {
  const { t, language } = useT()
  const listRef = useRef<HTMLUListElement>(null)

  // A section of one renders no strip. A single tab is not a choice, and a
  // control with one option is noise in the tab order and on the screen.
  if (subTabs.length < 2) return null

  const onKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]
    if (links.length === 0) return
    const at = links.findIndex((link) => link === document.activeElement)
    if (at < 0) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? links.length - 1
          : // Wraps, which is what every tab strip does and what makes End
            // reachable from the first label with one press if you want it.
            (at + (event.key === 'ArrowRight' ? 1 : links.length - 1)) % links.length
    links[next]?.focus()
  }

  return (
    <nav aria-label={t('a11y.sectionTabs')} className={cn('-mt-2', className)}>
      {/*
        The arrow-key handler is on each LINK, not on the list. A `<ul>` is not
        interactive; hanging a keyboard listener on one is both a lint error
        (`jsx-a11y/no-noninteractive-element-interactions`) and a description of
        the wrong thing — it only ever fires because the event bubbled up from a
        link, so it belongs where the focus actually is.
      */}
      <ul ref={listRef} className="flex gap-1 overflow-x-auto border-b border-border">
        {subTabs.map((subTab) => {
          const count = subTab.badge ? badges?.[subTab.id] : undefined
          return (
            <li key={subTab.id} className="shrink-0">
              <NavLink
                to={subTab.path}
                onKeyDown={onKeyDown}
                end={subTab.path.split('/').length <= 2}
                className={({ isActive }) =>
                  cn(
                    'relative flex min-h-11 items-center gap-2 rounded-t-md px-3 text-sm transition-colors',
                    isActive
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-1 bottom-0 h-[3px] rounded-t-sm bg-marigold"
                      />
                    ) : null}
                    {subTab.icon ? <subTab.icon aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                    <span className="whitespace-nowrap">{subTab.label[language]}</span>
                    {/*
                      The badge slot. It is inside the link's accessible name on
                      purpose: "Register, 3 waiting" is what a screen-reader
                      user needs to hear, and a number rendered `aria-hidden`
                      beside a label is a number only sighted readers get.
                    */}
                    {count !== undefined && count > 0 ? (
                      <span className="font-display rounded-full bg-marigold/20 px-1.5 text-[0.6875rem] text-marigold-foreground tabular-nums">
                        {count}
                        <span className="sr-only"> {t('a11y.waiting')}</span>
                      </span>
                    ) : null}
                    {isActive ? <span className="sr-only"> ({t('a11y.currentPage')})</span> : null}
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
