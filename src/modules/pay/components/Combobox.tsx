import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A searchable single-select, built to the ARIA 1.2 combobox-with-listbox
 * pattern rather than pulled in from `cmdk`.
 *
 * `cmdk` is in the pinned stack and is still deferred: it is a command palette,
 * and what these two pickers need is a form control that a screen reader
 * announces as one. The pattern below is the whole of it — a text input that
 * owns a listbox, `aria-activedescendant` moving the reader's focus through the
 * options while the DOM focus stays in the input, and Escape closing without
 * changing the value. That is about eighty lines, it prints, and it does not
 * put a second interaction model on a page whose other controls are ordinary
 * form fields.
 *
 * Options are grouped when `group` is supplied. A group heading is a
 * `role="presentation"` row rather than `role="group"` with a label, because a
 * flat option list with visual headings is what a reader arrowing down actually
 * experiences, and announcing eleven nested groups on every keystroke is not.
 */

export interface ComboboxOption<T> {
  /** Stable, and used as the DOM id suffix — so it must be URL-ish. */
  id: string
  value: T
  label: string
  /** One line under the label: the organisation, the State, the Level. */
  hint?: string
  /** Heading this option sits under. Options are rendered in the order given. */
  group?: string
}

interface ComboboxProps<T> {
  label: string
  placeholder: string
  /** Already filtered and ordered by the caller. */
  options: ReadonlyArray<ComboboxOption<T>>
  selectedId: string | null
  query: string
  onQueryChange: (query: string) => void
  onSelect: (option: ComboboxOption<T>) => void
  /** Drawn as the first row, above every group. */
  clearOption?: { id: string; label: string; hint?: string }
  onClear?: () => void
  emptyText: string
  /** Announced beneath the field — how many options the query matched. */
  countText?: string
  id?: string
  className?: string
}

export function Combobox<T>({
  label,
  placeholder,
  options,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  clearOption,
  onClear,
  emptyText,
  countText,
  id,
  className,
}: ComboboxProps<T>) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const listId = `${fieldId}-listbox`
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /**
   * The clear option is row 0 when present, so ONE array drives the keyboard
   * index, the rendered list and `aria-activedescendant`. Keeping it outside
   * the array would mean three off-by-one corrections that have to agree.
   */
  const rows = useMemo(
    () => [
      ...(clearOption
        ? [{ ...clearOption, group: undefined, option: undefined as ComboboxOption<T> | undefined }]
        : []),
      ...options.map((option) => ({
        id: option.id,
        label: option.label,
        hint: option.hint,
        group: option.group,
        option,
      })),
    ],
    [clearOption, options],
  )

  const lastIndex = Math.max(rows.length - 1, 0)
  const currentIndex = Math.min(activeIndex, lastIndex)
  const optionId = (index: number) => `${fieldId}-option-${index}`

  const commit = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return
      if (row.option) onSelect(row.option)
      else onClear?.()
      setOpen(false)
    },
    [onClear, onSelect, rows],
  )

  const move = (delta: number) => {
    if (!open) {
      setOpen(true)
      return
    }
    const next = Math.min(Math.max(currentIndex + delta, 0), lastIndex)
    setActiveIndex(next)
    // Keep the highlighted row on screen. `block: 'nearest'` scrolls only when
    // it has to, so arrowing through a visible list does not jump the page.
    // Guarded because jsdom implements neither `scrollIntoView` nor layout, and
    // an unguarded call turns a keyboard test into an unhandled exception.
    const row = listRef.current?.querySelector(`#${CSS.escape(optionId(next))}`)
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' })
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        if (!open) return
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        if (!open) return
        event.preventDefault()
        setActiveIndex(lastIndex)
        break
      case 'Enter':
        if (!open) return
        event.preventDefault()
        commit(currentIndex)
        break
      case 'Escape':
        // Closes without changing the value, which is what Escape means here.
        if (!open) return
        event.preventDefault()
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div className={cn('relative', className)}>
      <label className="mb-1 block text-sm font-medium" htmlFor={fieldId}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows.length > 0 ? optionId(currentIndex) : undefined}
          aria-describedby={countText ? `${fieldId}-count` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          // A blur that lands inside the list is a click on an option, and the
          // option's own onMouseDown has already handled it.
          onBlur={(event) => {
            if (!event.relatedTarget || !listRef.current?.contains(event.relatedTarget)) setOpen(false)
          }}
          className="h-11 w-full rounded-lg border border-input bg-card pr-10 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(event) => {
            event.preventDefault()
            setOpen((value) => !value)
            inputRef.current?.focus()
          }}
          className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {query ? <X className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {countText ? (
        <p id={`${fieldId}-count`} className="mt-1 text-xs text-muted-foreground" aria-live="polite">
          {countText}
        </p>
      ) : null}

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              {emptyText}
            </li>
          ) : null}
          {rows.map((row, index) => {
            const previous = index > 0 ? rows[index - 1] : undefined
            const heading = row.group && row.group !== previous?.group ? row.group : null
            const isActive = index === currentIndex
            const isSelected = row.option ? row.id === selectedId : selectedId === null
            return (
              <li key={row.id} role="presentation">
                {heading ? (
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {heading}
                  </p>
                ) : null}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={Boolean(isSelected)}
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commit(index)
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm',
                    isActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
                  )}
                >
                  <span className="min-w-0">
                    <span className={cn('block truncate', isSelected && 'font-semibold')}>{row.label}</span>
                    {row.hint ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.hint}</span>
                    ) : null}
                  </span>
                  {isSelected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
