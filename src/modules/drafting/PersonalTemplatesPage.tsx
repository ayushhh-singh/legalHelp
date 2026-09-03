import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Star, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  deletePersonal,
  listFavourites,
  listPersonal,
  personalId,
  savePersonal,
  toggleFavourite,
} from './personalStore'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { exportTemplates, importTemplates } from '@/lib/drafting/personal'

/**
 * The officer's own templates.
 *
 * Every one carries a "yours" badge and says which official form it borrows its
 * format and checklist from. It never claims a CSMOP reference of its own —
 * `personalTemplateSchema` has no field for one, which is the version of that
 * rule that cannot be forgotten (ADR-041, `src/lib/drafting/personal.ts`).
 */
export default function PersonalTemplatesPage() {
  const { t } = useT()
  const templates = useLiveQuery(() => listPersonal(), []) ?? []
  const favourites = useLiveQuery(() => listFavourites(), []) ?? []
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const download = () => {
    const payload = exportTemplates(templates, new Date().toISOString())
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'sahayak-templates.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const upload = async (file: File) => {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setNotice(t('draft.personal.importFailed'))
      return
    }
    const result = importTemplates(raw, templates, (index) => `${personalId()}-${index}`)
    if ('error' in result) {
      setNotice(
        result.error === 'wrong-version'
          ? t('draft.personal.importTooNew')
          : t('draft.personal.importFailed'),
      )
      return
    }
    for (const entry of result.imported) await savePersonal(entry)
    setNotice(
      [
        t('draft.personal.imported', { count: result.imported.length }),
        result.renamed.length ? t('draft.personal.renamed', { count: result.renamed.length }) : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('draft.personal.heading')} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={download} disabled={templates.length === 0}>
          <Download aria-hidden="true" className="mr-1 size-4" />
          {t('draft.personal.export')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" className="mr-1 size-4" />
          {t('draft.personal.import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label={t('draft.personal.import')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
            event.target.value = ''
          }}
        />
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('draft.personal.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{template.name}</span>
                  <Badge tone="warning">{t('draft.editor.yours')}</Badge>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t('draft.editor.yoursHint', { name: template.baseTemplateId })}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('draft.personal.favourite')}
                  aria-pressed={favourites.includes(template.id)}
                  onClick={() => void toggleFavourite(template.id)}
                >
                  <Star aria-hidden="true" className="size-4" />
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/draft/new/${template.baseTemplateId}?personal=${template.id}`}>
                    {t('draft.editor.newDocument')}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('draft.personal.delete')}
                  onClick={() => void deletePersonal(template.id)}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
