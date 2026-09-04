import { Bookmark, BookmarkCheck, Check, Columns2, Copy, Printer, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { citationFor, shareText } from '../citation'
import { addFavourite, isFavourite, removeFavourite } from '../saved'
import type { LawCode, LawDataset, LawSection } from '../types'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { toCompareHref } from '@/modules/library/url'

/**
 * Copy · Share · Save · Print, for one section.
 *
 * Every one of them is local. `navigator.share` hands the text to the operating
 * system's own share sheet — the app never sees where it goes and never sends
 * it anywhere itself — and the clipboard fallback is what runs on a desktop
 * browser that has no share sheet. Neither path makes a request, which is what
 * keeps `tests/e2e/zero-third-party-requests.spec.ts` green with these buttons
 * on screen.
 *
 * Each action reports its outcome in a live region rather than a toast: the
 * result of "Copy citation" is invisible otherwise, and a reader using a screen
 * reader would have no way to know it worked.
 */
export function SectionActions({
  code,
  record,
  dataset,
  onPrint,
}: {
  code: LawCode
  record: LawSection
  dataset: LawDataset
  onPrint: () => void
}) {
  const { t, language } = useT()
  const [saved, setSaved] = useState<boolean | null>(null)
  /**
   * Tagged with the section it belongs to, and read back by comparison. A
   * confirmation is DERIVED stale by navigating to another section rather than
   * cleared by an effect — the same shape the More sheet uses, and what
   * `react-hooks/set-state-in-effect` exists to push you towards.
   */
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const sectionId = `${code}:${record.section}`
  const message = notice?.id === sectionId ? notice.text : ''
  const setMessage = (text: string) => setNotice({ id: sectionId, text })

  useEffect(() => {
    let cancelled = false
    void isFavourite(code, record.section)
      .then((value) => {
        if (!cancelled) setSaved(value)
      })
      .catch(() => {
        // Blocked IndexedDB. The button still works as a no-op rather than
        // disappearing; `store.ts` takes the same line for preferences.
        if (!cancelled) setSaved(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, record.section])

  const citation = citationFor(record, dataset.newAct.name, language)

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMessage(ok)
    } catch {
      setMessage(t('law.actions.copyFailed'))
    }
  }

  const share = async () => {
    const text = shareText(record, dataset.newAct.name, dataset.disclaimer, language)
    // navigator.share rejects when the reader dismisses the sheet, which is not
    // a failure and must not fall through to the clipboard.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: citation, text })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copy(text, t('law.actions.shared'))
  }

  const toggleSaved = async () => {
    try {
      if (saved) {
        await removeFavourite(code, record.section)
        setSaved(false)
        setMessage(t('law.actions.unfavourited'))
      } else {
        await addFavourite(code, record)
        setSaved(true)
        setMessage(t('law.actions.favourited'))
      }
    } catch {
      setMessage(t('law.actions.copyFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-2" data-print-hide>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(citation, t('law.actions.copied'))}
        >
          {message === t('law.actions.copied') ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t('law.actions.copy')}
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={() => void share()}>
          <Share2 aria-hidden="true" />
          {t('law.actions.share')}
        </Button>

        <Button
          type="button"
          variant={saved ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={saved ?? false}
          onClick={() => void toggleSaved()}
        >
          {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          {saved ? t('law.actions.unfavourite') : t('law.actions.favourite')}
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={onPrint}>
          <Printer aria-hidden="true" />
          {t('law.actions.print')}
        </Button>

        {/*
          Into the Library, with THIS section already on the left.
          `/study/notes/compare` is where a provision is set beside another one word
          by word — which is the question an officer holding an old section
          number is actually asking. The Library holds the three Sanhitas, so
          the link is a real one; the repealed Act's own text is not in this
          repository, which is why the right-hand side is a picker rather than
          a pre-filled counterpart.
        */}
        <Button asChild type="button" variant="outline" size="sm">
          <Link to={toCompareHref({ workId: code, unitId: record.section })}>
            <Columns2 aria-hidden="true" />
            {t('library.compare.fromLaw')}
          </Link>
        </Button>
      </div>

      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
