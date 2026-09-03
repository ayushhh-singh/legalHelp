import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { listAddressees, readProfile, saveProfile } from './profileStore'

import { LetterheadCard } from './components/LetterheadCard'

import { PageHeader } from '@/components/common/PageHeader'
import { SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { emptyProfile, type DraftingProfile } from '@/lib/drafting/profile'
import { URGENCIES } from '@/lib/drafting/model'

/**
 * The drafting profile.
 *
 * The lead paragraph states the rule the whole feature turns on, because it is
 * the thing an officer would otherwise assume the opposite of: **changing this
 * never rewrites a document already written.** A document takes a copy of the
 * letterhead and the signature block when it is created (ADR-041 §5).
 */

const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

function Pair({
  label,
  value,
  onChange,
}: {
  label: string
  value: { en: string; hi: string }
  onChange: (next: { en: string; hi: string }) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <input
          className={field}
          value={value.en}
          onChange={(event) => onChange({ ...value, en: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label} (हिंदी)</span>
        <input
          lang="hi"
          className={field}
          value={value.hi}
          onChange={(event) => onChange({ ...value, hi: event.target.value })}
        />
      </label>
    </div>
  )
}

export default function ProfilePage() {
  const { t } = useT()
  const stored = useLiveQuery(() => readProfile(), [])
  const book = useLiveQuery(() => listAddressees(), []) ?? []
  /**
   * The officer's unsaved edits, or nothing.
   *
   * Derived rather than resynchronised: an effect copying `stored` into state
   * would overwrite what is being typed every time the live query re-ran, and
   * `react-hooks/set-state-in-effect` is right to reject it. The rule this
   * codebase already follows — derive, don't resynchronise (ADR-036).
   */
  const [profile, setProfile] = useState<DraftingProfile | null>(null)
  const [notice, setNotice] = useState('')

  const value = profile ?? stored ?? emptyProfile('1970-01-01T00:00:00.000Z')
  const set = (patch: Partial<DraftingProfile>) => setProfile({ ...value, ...patch })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('draft.profile.heading')} subtitle={t('draft.profile.lead')} />

      <SectionCard className="flex flex-col gap-4 p-4">
        <Pair label={t('draft.profile.name')} value={value.name} onChange={(name) => set({ name })} />
        <Pair
          label={t('draft.profile.designation')}
          value={value.designation}
          onChange={(designation) => set({ designation })}
        />
        <Pair label={t('draft.profile.office')} value={value.office} onChange={(office) => set({ office })} />
        <Pair
          label={t('draft.profile.ministry')}
          value={value.ministry}
          onChange={(ministry) => set({ ministry })}
        />
        <Pair
          label={t('draft.profile.department')}
          value={value.department}
          onChange={(department) => set({ department })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('draft.profile.section')}</span>
              <input
                className={field}
                aria-describedby="profile-section-hint"
                value={value.section.en}
                onChange={(event) => set({ section: { ...value.section, en: event.target.value } })}
              />
            </label>
            <span id="profile-section-hint" className="text-xs text-muted-foreground">
              {t('draft.profile.sectionHint')}
            </span>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.place')}</span>
            <input
              className={field}
              value={value.place}
              onChange={(event) => set({ place: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.phone')}</span>
            <input
              className={field}
              value={value.phone}
              onChange={(event) => set({ phone: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.email')}</span>
            <input
              type="email"
              className={field}
              value={value.email}
              onChange={(event) => set({ email: event.target.value })}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('draft.profile.address')}</span>
          <textarea
            rows={3}
            className={field}
            value={value.addressLines.join('\n')}
            onChange={(event) => set({ addressLines: event.target.value.split('\n') })}
          />
        </label>

        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t('draft.profile.letterhead')}</legend>
          <p className="mb-2 text-xs text-muted-foreground">{t('draft.profile.letterheadHint')}</p>
          {[0, 1, 2, 3].map((index) => {
            const line = value.letterhead[index] ?? { en: '', hi: '' }
            return (
              <div key={index} className="mb-2 grid gap-2 sm:grid-cols-2">
                <input
                  aria-label={`${t('draft.profile.letterhead')} ${index + 1}`}
                  className={field}
                  value={line.en}
                  onChange={(event) => {
                    const next = [...value.letterhead]
                    next[index] = { ...line, en: event.target.value }
                    set({ letterhead: next.slice(0, 4) })
                  }}
                />
                <input
                  lang="hi"
                  aria-label={`${t('draft.profile.letterhead')} ${index + 1} (हिंदी)`}
                  className={field}
                  value={line.hi}
                  onChange={(event) => {
                    const next = [...value.letterhead]
                    next[index] = { ...line, hi: event.target.value }
                    set({ letterhead: next.slice(0, 4) })
                  }}
                />
              </div>
            )
          })}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.defaultUrgency')}</span>
            <select
              className={field}
              value={value.defaultUrgency}
              onChange={(event) =>
                set({ defaultUrgency: event.target.value as DraftingProfile['defaultUrgency'] })
              }
            >
              {URGENCIES.map((urgency) => (
                <option key={urgency} value={urgency}>
                  {urgency === 'none' ? '—' : urgency}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.signatureLayout')}</span>
            <select
              className={field}
              value={value.signatureLayout}
              onChange={(event) =>
                set({ signatureLayout: event.target.value as DraftingProfile['signatureLayout'] })
              }
            >
              <option value="right">right</option>
              <option value="left">left</option>
              <option value="centre">centre</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.profile.defaultLanguage')}</span>
            <select
              className={field}
              value={value.defaultLanguage}
              onChange={(event) =>
                set({ defaultLanguage: event.target.value as DraftingProfile['defaultLanguage'] })
              }
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="bilingual">Both</option>
            </select>
          </label>
        </div>

        {/*
          The default copy-to list.

          `createDocument` has always read this and copied the named entries
          into every new document — and there was no way to set it, so it was
          always empty and that code could never run. It is a multi-select over
          the address book because a copy-to list IS a list of people this
          officer already writes to; anyone not in the book is added on the
          document itself.
        */}
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t('draft.profile.defaultCopyTo')}</legend>
          {book.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('draft.addressBook.none')}{' '}
              {/*
                Underlined ALWAYS, not on hover.

                Every other `text-primary` link in this app is the whole content
                of its own element, where colour alone is enough for axe. This
                one sits INSIDE a sentence, which is the case
                `link-in-text-block` is about: a reader who cannot tell the two
                colours apart has nothing to go on. Caught by the a11y sweep
                after the route was added to it — the design rule this project
                already states for navigation ("active state is never colour
                alone") applies to a link in a paragraph too.
              */}
              <Link to="/draft/address-book" className="text-primary underline underline-offset-4">
                {t('draft.addressBook.add')}
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {book.map((entry) => (
                <li key={entry.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={value.defaultCopyTo.includes(entry.id)}
                      onChange={(event) =>
                        set({
                          defaultCopyTo: event.target.checked
                            ? [...value.defaultCopyTo, entry.id]
                            : value.defaultCopyTo.filter((id) => id !== entry.id),
                        })
                      }
                    />
                    {entry.name.en || entry.name.hi}
                    {entry.designation.en ? ` — ${entry.designation.en}` : ''}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={value.signatureShowSd}
            onChange={(event) => set({ signatureShowSd: event.target.checked })}
          />
          {t('draft.profile.signatureSd')}
        </label>

        <div className="flex items-center gap-3">
          <Button
            onClick={() =>
              void saveProfile(value).then(() => {
                setNotice(t('draft.profile.saved'))
              })
            }
          >
            {t('draft.profile.save')}
          </Button>
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {notice}
          </span>
        </div>
      </SectionCard>

      <LetterheadCard />
    </div>
  )
}
