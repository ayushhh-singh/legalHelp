import { useLiveQuery } from 'dexie-react-hooks'
import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { DraftHome } from './components/DraftHome'
import { RecentDrafts } from './components/RecentDrafts'
import { migrateAllDrafts, pendingMigrationCount } from './migrateDrafts'
import { profileIsSet, readProfile } from './profileStore'

import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/**
 * `/draft/documents` — the Drafting Studio's own library.
 *
 * ADR-046 made this the section's default tab and gave it everything that was
 * scattered across the picker: `DraftHome` (continue editing, what is waiting
 * on a reply, search across every document's body, the type/status/thread
 * filters, bulk export and an undoable delete), the older Session 8 drafts, the
 * profile nudge, and importing — which is a page UNDER this one now rather than
 * a sibling of it, because importing a document is one way of getting a
 * document into this list and not a place in the navigation.
 *
 * The migration banner is deliberately not automatic. Bringing sixty drafts
 * across writes sixty rows, and a write an officer did not ask for is a write
 * that happens while their storage is nearly full. It is offered, it says
 * exactly what it will do, and it never deletes the originals.
 */
export default function DocumentsPage() {
  const { t } = useT()
  const pending = useLiveQuery(() => pendingMigrationCount(), []) ?? 0
  const [notice, setNotice] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <ProfileNudge />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to="/draft/new">{t('draft.editor.newDocument')}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/draft/documents/import">
            <FileUp aria-hidden="true" className="mr-1 size-4" />
            {t('draft.import.title')}
          </Link>
        </Button>
      </div>

      {pending > 0 ? (
        <SectionCard className="p-4">
          <h2 className="text-sm font-semibold">{t('draft.migration.heading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('draft.migration.pending', { count: pending })}
          </p>
          <div className="mt-3">
            <Button
              size="sm"
              onClick={() =>
                void migrateAllDrafts().then((report) =>
                  setNotice(
                    [
                      t('draft.migration.done', { count: report.migrated }),
                      report.skipped ? t('draft.migration.skipped', { count: report.skipped }) : '',
                      report.failed.length
                        ? t('draft.migration.failed', { count: report.failed.length })
                        : '',
                      report.keptAsVars.length
                        ? t('draft.migration.keptFields', { fields: report.keptAsVars.join(', ') })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                  ),
                )
              }
            >
              {t('draft.migration.run')}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      <DraftHome />
      <RecentDrafts />
    </div>
  )
}

/**
 * "Set up your drafting profile" — shown until there is one.
 *
 * Without a profile, every new document starts with an empty letterhead and an
 * unsigned signature block, and the officer has to discover why. It moved here
 * from the template picker with ADR-046: the picker is a grid of forty-three
 * cards and this is a sentence about the officer's own set-up, which belongs
 * beside their documents.
 */
function ProfileNudge() {
  const { t } = useT()
  const profile = useLiveQuery(() => readProfile(), [])
  if (!profile || profileIsSet(profile)) return null
  return (
    <SectionCard className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 text-sm text-muted-foreground">{t('draft.profile.notSet')}</p>
      <Button asChild size="sm">
        <Link to="/settings/profile">{t('draft.profile.open')}</Link>
      </Button>
    </SectionCard>
  )
}
