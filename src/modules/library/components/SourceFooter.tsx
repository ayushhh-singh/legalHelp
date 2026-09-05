import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { DataVersion } from '@/components/common/DataVersion'
import { Disclaimer } from '@/components/common/Disclaimer'
import { SourceChip } from '@/components/common/SourceChip'
import { Badge } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * Where the provision came from, and what it is not.
 *
 * ### One line, not five
 *
 * The reader used to end every unit with a citation, a source chip, up to two
 * badges, a dataset version and a full-width disclaimer banner — five bands of
 * chrome under every rule, none of which changes between one unit and the next
 * of the same work. It is one line and a disclosure now. Nothing is removed:
 * the citation stays visible because it is the thing an officer copies, and
 * everything else is one press away and STILL PRINTS, because the `<details>`
 * is opened by the print stylesheet.
 *
 * ### The disclaimer is a banner once and a note thereafter
 *
 * The master context requires the sentence on every data surface and this
 * renders it on every unit — the question is only how loudly. A reader working
 * through a chapter meets it thirty times in a sitting, and a banner repeated
 * thirty times is a banner nobody reads by the third. So the FIRST unit of a
 * session gets the full `Disclaimer` and the rest get the same sentence as a
 * muted note, which is a decision about emphasis and not about presence.
 *
 * `firstOfSession` is decided by the caller from a module variable in
 * `ReaderPage`, the way `src/modules/law/url.ts` holds the offence date: per
 * tab, never stored, gone on reload.
 */
export function SourceFooter({
  citation,
  sourceName,
  sourceUrl,
  personal,
  verify,
  versionKey,
  firstOfSession,
}: {
  citation: string
  sourceName: string | null
  sourceUrl: string | null
  /** A document the reader added themselves — no source, no dataset version. */
  personal: boolean
  verify: boolean
  /** The `data/_meta/versions.json` key, or null for a personal document. */
  versionKey: string | null
  firstOfSession: boolean
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)

  return (
    <footer className="flex flex-col gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">{citation}</p>
        {personal ? <Badge tone="warning">{t('library.add.yourDocument')}</Badge> : null}
        {verify ? <Badge tone="warning">{t('common.verifyWithDdo')}</Badge> : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="reader-source"
          onClick={() => setOpen(!open)}
          data-print-hide
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {t('library.reader.sourceAndVersion')}
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>

      {/*
        `hidden` on screen, and forced open on paper by `library-print-root`'s
        own rule in `index.css`: a printed provision has to carry its source and
        its dataset version whatever the reader had collapsed.
      */}
      <div id="reader-source" hidden={!open} className="flex flex-col gap-2 print:!block">
        {sourceName && sourceUrl ? <SourceChip name={sourceName} url={sourceUrl} /> : null}
        {versionKey ? <DataVersion dataset={versionKey} /> : null}
      </div>

      {firstOfSession ? <Disclaimer className="mt-1" /> : <p className="mt-1">{t('common.disclaimer')}</p>}
    </footer>
  )
}
