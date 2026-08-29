import { Sparkles } from 'lucide-react'

import { useT } from '@/i18n/useT'

/**
 * The "Improve wording" control that sits beside a field's label when AI is on.
 *
 * It lives in its own file rather than in `AiDraftPanel.tsx` for the reason the
 * whole AI layer is arranged the way it is: `FormFields.tsx` and
 * `BodyEditor.tsx` import it STATICALLY, and importing it from the panel would
 * drag the panel — and with it the agent's types and `SuggestionDiff` — into
 * the editor's own chunk for every reader, including the ones who never turn AI
 * on. This file is a button, an icon and two translation keys.
 *
 * It does not run anything. Pressing it hands the field up to `EditorPage`,
 * which opens the panel and runs the rewrite there, so the diff and the
 * acknowledgement gate stay in one place.
 */
export function ImproveButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useT()
  return (
    <button
      type="button"
      /*
        The accessible name says WHICH field. Fifteen buttons all called
        "Improve wording" leave a screen-reader user counting rows to know which
        one is in focus — the same rule the split-language button follows.
      */
      aria-label={`${t('draft.ai.improve.button')} — ${label}`}
      title={t('draft.ai.improve.button')}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
      {t('draft.ai.improve.button')}
    </button>
  )
}
