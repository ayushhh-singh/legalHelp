import { useLiveQuery } from 'dexie-react-hooks'
import { ImageUp, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { deleteLetterhead, getLetterhead, letterheadSizeMm, putLetterheadFile } from '../letterheadStore'
import { useObjectUrl } from '../useObjectUrl'

import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { LETTERHEAD_MAX_BYTES, type LetterheadRejection } from '@/lib/drafting/letterhead'

/**
 * The letterhead image, in the drafting profile.
 *
 * **This app supplies no emblem, crest or seal**, and the card says so before
 * it offers the control. Reproducing the State Emblem is governed by the State
 * Emblem of India (Prohibition of Improper Use) Act 2005, and an app that
 * shipped one would be handing every reader a ready-made letterhead for an
 * office they may not hold. What an officer supplies from their own office is
 * theirs to supply.
 *
 * The image is a SECOND thing, not a replacement for the letterhead lines above
 * it: those already print at the head of the document (`applyStationery` in
 * `renderDoc.ts`), while the image goes in the running header, where it repeats
 * on every sheet.
 */
export function LetterheadCard() {
  const { t } = useT()
  const row = useLiveQuery(() => getLetterhead(), [])
  const [error, setError] = useState<LetterheadRejection | 'undecodable' | null>(null)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const preview = useObjectUrl(row?.data)

  const size = row ? letterheadSizeMm(row) : null

  return (
    <SectionCard className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">{t('draft.letterhead.heading')}</h2>
      <p className="text-sm text-muted-foreground">{t('draft.letterhead.lead')}</p>
      <p className="rounded-lg border-l-[3px] border-marigold bg-marigold/15 p-3 text-sm text-marigold-foreground">
        {t('draft.letterhead.noEmblem')}
      </p>

      {row && preview ? (
        <div className="flex flex-wrap items-center gap-3">
          <img
            src={preview}
            alt={t('draft.letterhead.current')}
            className="max-h-24 max-w-full rounded border border-border bg-white p-2"
          />
          <span className="text-xs text-muted-foreground">
            {size ? t('draft.letterhead.size', { width: size.widthMm, height: size.heightMm }) : ''}
          </span>
        </div>
      ) : null}

      {row?.type === 'image/svg+xml' ? (
        <p className="text-xs text-muted-foreground">{t('draft.letterhead.svgNote')}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <ImageUp aria-hidden="true" className="mr-1 size-4" />
          {row ? t('draft.letterhead.replace') : t('draft.letterhead.choose')}
        </Button>
        {row ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void deleteLetterhead().then(() => {
                setNotice(t('draft.letterhead.removed'))
                setError(null)
              })
            }
          >
            <Trash2 aria-hidden="true" className="mr-1 size-4" />
            {t('draft.letterhead.remove')}
          </Button>
        ) : null}
      </div>

      {/*
        A real file input, hidden but present, rather than a synthetic one
        created on click: this one is announced as a file picker, opens from the
        keyboard through its own button, and keeps its `accept` list where a
        reviewer can see it.
      */}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
        className="sr-only"
        aria-label={t('draft.letterhead.choose')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so choosing the same file again after a failure fires
          // `change` a second time.
          event.target.value = ''
          if (!file) return
          void putLetterheadFile(file, new Date().toISOString()).then((result) => {
            if (result.ok) {
              setError(null)
              setNotice(t('draft.letterhead.saved'))
              return
            }
            setError(result.reason)
            setNotice('')
          })
        }}
      />

      <p className="text-xs text-muted-foreground">{t('draft.letterhead.hint')}</p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(ERROR_KEY[error])}
        </p>
      ) : null}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>
    </SectionCard>
  )
}

/**
 * A rejection to the sentence that explains it.
 *
 * A literal map, so a reason added to `LetterheadRejection` without a sentence
 * to go with it is a compile error rather than a missing-key placeholder on
 * somebody's screen.
 */
const ERROR_KEY = {
  'too-big': 'draft.letterhead.errors.tooBig',
  unsupported: 'draft.letterhead.errors.unsupported',
  empty: 'draft.letterhead.errors.empty',
  'unsafe-svg': 'draft.letterhead.errors.unsafe-svg',
  undecodable: 'draft.letterhead.errors.undecodable',
} as const satisfies Record<LetterheadRejection | 'undecodable', string>

export { LETTERHEAD_MAX_BYTES }
