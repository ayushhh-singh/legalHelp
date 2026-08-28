import { Download, Loader2, Mic, MicOff, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useVoiceSearch } from '@/components/common/useVoiceSearch'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  /** ArrowDown from the field moves into the result list. */
  onArrowDown: () => void
  /** Enter opens the first result when nothing in the list has focus yet. */
  onSubmit: () => void
  /**
   * Id of the list this field controls. UNDEFINED when there is no list —
   * `aria-controls` pointing at an element that is not in the document is an
   * axe `aria-valid-attr-value` violation, and it is the state this field is in
   * most of the time.
   */
  resultsId: string | undefined
  resultCount: number
  busy: boolean
}

/**
 * The one field this module is used through.
 *
 * `/` focuses it from anywhere on the page, which is the shortcut every
 * reference tool has and the one an officer checking a number reaches for. The
 * handler is deliberately narrow: it ignores the keypress while the reader is
 * typing in any field, so `/` inside the search box is a slash and not a
 * refocus, and it never fires with a modifier held.
 */
export function SearchBar({
  value,
  onChange,
  onArrowDown,
  onSubmit,
  resultsId,
  resultCount,
  busy,
}: SearchBarProps) {
  const { t } = useT()
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Dictation. Recognised on the device or refused — see
   * `src/lib/voiceSettings.ts`. `supported` is false in a browser that cannot
   * do it locally, and then none of this renders.
   */
  const voice = useVoiceSearch((transcript, isFinal) => {
    onChange(transcript)
    if (isFinal) inputRef.current?.focus()
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative">
      <label htmlFor="law-search" className="mb-1.5 block text-sm font-medium">
        {t('law.search.label')}
      </label>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            id="law-search"
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                onArrowDown()
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                onSubmit()
              }
            }}
            placeholder={t('law.search.placeholder')}
            aria-describedby="law-search-hint"
            aria-controls={resultsId}
            // The reader is told how many results there are without having to
            // move focus into the list; `aria-live` on the count below carries it.
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-11 w-full rounded-lg border border-input bg-card pr-10 pl-9 text-base',
              'placeholder:text-muted-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
              // Safari draws its own clear button on type=search, beside ours.
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange('')
                inputRef.current?.focus()
              }}
              aria-label={t('law.search.clear')}
              className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {voice.supported ? (
          <Button
            type="button"
            variant={voice.listening ? 'secondary' : 'outline'}
            size="icon"
            onClick={voice.press}
            aria-pressed={voice.listening}
            aria-label={voice.label}
            className="shrink-0"
          >
            {voice.busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : voice.listening ? (
              <Mic aria-hidden="true" />
            ) : (
              <MicOff aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>

      <p id="law-search-hint" className="mt-1.5 text-xs text-muted-foreground">
        {t('law.search.hint')}
      </p>

      {/* The microphone is open. Say so in text, not only with an icon. */}
      <p role="status" aria-live="assertive" className="sr-only">
        {voice.listening ? t('voice.listening') : ''}
      </p>

      {voice.error ? (
        <p role="alert" className="mt-1.5 text-xs text-coral-foreground">
          {t(`voice.errors.${voice.error}`)}
        </p>
      ) : null}

      {/*
        The model is a one-time browser download, offered rather than started:
        it is large, and a reader who only wanted to type should not pay for it.
      */}
      {!voice.error && (voice.status === 'downloadable' || voice.status === 'downloading') ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="max-w-prose">{t('voice.download.needed')}</span>
          <Button type="button" variant="outline" size="sm" disabled={voice.busy} onClick={voice.download}>
            <Download aria-hidden="true" />
            {t('voice.download.action')}
          </Button>
        </div>
      ) : null}

      {!voice.error && voice.status === 'unavailable' ? (
        <p role="status" className="mt-1.5 max-w-prose text-xs text-muted-foreground">
          {t('voice.errors.no-model')}
        </p>
      ) : null}

      {/*
        The result count is announced, not just drawn. A reader typing a section
        number with a screen reader needs to know that something matched before
        deciding whether to move into the list.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {busy ? t('law.results.loading') : t('law.results.count', { count: resultCount })}
      </p>
    </div>
  )
}
