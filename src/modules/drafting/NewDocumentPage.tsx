import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'

import { createDocument } from './newDocument'
import { getPersonal, recordRecent } from './personalStore'
import { readProfile } from './profileStore'
import { useTemplate } from './useDraftingData'

import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'

/**
 * `/draft/new/:type` — create a document and go straight to it.
 *
 * A route rather than an `onClick` on the picker card, so the action survives a
 * reload and a shared link, and so the picker stays a list of forms rather than
 * a list of forms that also knows how to write to IndexedDB.
 *
 * The guard is a ref rather than state, and it is the point of the file:
 * `src/main.tsx` renders under `<StrictMode>`, which invokes every effect
 * twice in development, and an unguarded create would leave an empty document
 * behind on every use. CLAUDE.md records two of these in `useDraft.ts` already;
 * this is the same hazard in a new file, and `newDocument.test.tsx` renders it
 * inside `<StrictMode>` on purpose.
 */
export default function NewDocumentPage() {
  const { t } = useT()
  const { type = '' } = useParams()
  const [params] = useSearchParams()
  const template = useTemplate(type)
  const [created, setCreated] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  const personalId = params.get('personal')

  useEffect(() => {
    if (template.status !== 'ready' || started.current) return
    started.current = true
    void (async () => {
      try {
        const [profile, personal] = await Promise.all([
          readProfile(),
          personalId ? getPersonal(personalId) : Promise.resolve(null),
        ])
        const doc = await createDocument({ template: template.data, profile, personal })
        await recordRecent(personalId ?? template.data.id)
        setCreated(doc.id)
      } catch {
        // The guard stays armed: a second attempt would produce a second empty
        // document, and the officer can press the picker again.
        setFailed(true)
      }
    })()
  }, [template, personalId])

  if (created) return <Navigate to={`/draft/d/${created}`} replace />
  if (template.status === 'error' || failed) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={t('draft.editor.unknownType')} subtitle={t('draft.editor.unknownTypeBody')} />
        <QueryErrorState body={t('draft.editor.loadFailed')} onRetry={template.retry} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-2/3 max-w-md" />
      <Skeleton className="h-64 w-full" />
      <p className="sr-only" aria-live="polite">
        {t('common.loading')}
      </p>
    </div>
  )
}
