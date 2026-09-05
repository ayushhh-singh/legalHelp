import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { bodyForLanguage } from '@/lib/drafting/docLang'
import { personalFromDocument, uniqueName, type PersonalTemplate } from '@/lib/drafting/personal'
import type { OfficialDoc } from '@/lib/drafting/model'
import type { DocTemplate } from '../schema'

/**
 * "Save as my template" — the brief's item 6, and a feature whose whole pure
 * layer shipped with no way to reach it.
 *
 * `personalFromDocument` existed, was tested sixteen ways, and had nine i18n
 * strings authored for a dialog nobody had written. An edge-case pass found the
 * gap by sweeping for i18n keys nothing referenced — the same mechanical check
 * that found the Ctrl+/ sheet and the terminology lint.
 *
 * The choice the officer makes here is the one thing only they can make: which
 * of this document's values are the TEMPLATE (frozen, the same every time) and
 * which are the DOCUMENT (asked again). Everything defaults to frozen, because
 * a template that asks about everything is the official form.
 */
export function SaveAsTemplate({
  doc,
  template,
  existingNames,
  onSave,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  doc: OfficialDoc
  template: DocTemplate
  existingNames: readonly string[]
  onSave: (personal: PersonalTemplate) => void
  /**
   * Optional control, for a caller that opens this from somewhere else.
   *
   * Session 35 moved "Save as my template" into the focus bar's ⋯ menu, which
   * is a `<button>` in a list rather than a place a `Dialog.Trigger` can sit —
   * so the dialog has to be openable without its own button. `hideTrigger`
   * removes that button; passing neither leaves the component exactly as it
   * was.
   */
  open?: boolean
  onOpenChange?: (next: boolean) => void
  hideTrigger?: boolean
}) {
  const { t, language } = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [name, setName] = useState('')
  const [keep, setKeep] = useState<string[]>([])

  const variables = template.variables ?? []
  const field = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          // Reset on OPEN rather than on close: a dialog that keeps the last
          // answer is one an officer has to re-read every time.
          setName(doc.title || template.name[language])
          setKeep([])
        }
      }}
    >
      {hideTrigger ? null : (
        <Dialog.Trigger asChild>
          <Button variant="outline" size="sm">
            {t('draft.personal.saveAs')}
          </Button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">{t('draft.personal.saveAs')}</Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-sm text-muted-foreground">
            {t('draft.personal.saveAsHint')}
          </Dialog.Description>

          <label className="mb-4 flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.personal.name')}</span>
            <input className={field} value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          {variables.length > 0 ? (
            <fieldset className="mb-4 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{t('draft.personal.keepAsking')}</legend>
              <ul className="flex flex-col gap-1">
                {variables.map((variable) => (
                  <li key={variable.key} className="flex items-start gap-2 text-sm">
                    {/*
                      The checkbox is labelled by `aria-labelledby` and described
                      by the line under it, rather than by wrapping both in a
                      `<label>`: the description changes as the box is ticked
                      ("ask me again" / "keep as it is"), and folding it into the
                      NAME would make the control announce its own state twice.
                    */}
                    <input
                      id={`keep-${variable.key}`}
                      type="checkbox"
                      className="mt-0.5 size-4"
                      aria-labelledby={`keep-${variable.key}-label`}
                      aria-describedby={`keep-${variable.key}-state`}
                      checked={keep.includes(variable.key)}
                      onChange={(event) =>
                        setKeep((current) =>
                          event.target.checked
                            ? [...current, variable.key]
                            : current.filter((key) => key !== variable.key),
                        )
                      }
                    />
                    <span>
                      <label
                        id={`keep-${variable.key}-label`}
                        htmlFor={`keep-${variable.key}`}
                        className="font-medium"
                      >
                        {variable.label[language]}
                      </label>
                      <span id={`keep-${variable.key}-state`} className="block text-xs text-muted-foreground">
                        {keep.includes(variable.key)
                          ? t('draft.personal.keepAsking')
                          : t('draft.personal.freeze')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          <div className="flex gap-2">
            <Button
              disabled={!name.trim()}
              onClick={() => {
                onSave(
                  personalFromDocument({
                    // The id is minted by the caller's store, which owns
                    // `crypto`; this component is handed the result.
                    id: '',
                    name: uniqueName(name.trim(), existingNames),
                    baseTemplateId: doc.templateId,
                    vars: doc.vars,
                    body: bodyForLanguage(doc, 'en'),
                    ...(doc.bodyHi ? { bodyHi: doc.bodyHi } : {}),
                    keepAsVariable: keep,
                    base: template,
                    at: '',
                  }),
                )
                setOpen(false)
              }}
            >
              {t('draft.personal.save')}
            </Button>
            <Dialog.Close asChild>
              <Button variant="outline">{t('draft.addressBook.cancel')}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
