import { Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { deleteScenario, listScenarios, MAX_SCENARIOS, saveScenario } from '../scenarios'

import { Badge, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import type { PayScenarioRow } from '@/db'
import { useT } from '@/i18n/useT'
import type { PayScenario } from '@/lib/pay/scenario'

/**
 * Named scenarios, on the device.
 *
 * Saving an eleventh is REFUSED rather than made room for. Ten is the brief's
 * limit and it is a comparison set rather than an archive, but a calculator
 * that quietly deleted the scenario a reader named six weeks ago to fit a new
 * one would be doing something no amount of convenience justifies. The message
 * says which one to delete instead.
 *
 * The whole list is IndexedDB, on this device, with no account behind it — so
 * it also disappears if the reader clears site data, which the hint says.
 */
export function ScenarioBar({
  scenario,
  onLoad,
}: {
  scenario: PayScenario
  onLoad: (scenario: PayScenario) => void
}) {
  const { t } = useT()
  const nameId = useId()
  const [name, setName] = useState('')
  const [rows, setRows] = useState<PayScenarioRow[] | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void listScenarios()
      .then((found) => {
        if (!cancelled) setRows(found)
      })
      .catch(() => {
        // Blocked IndexedDB (private window, storage denied). The calculator
        // still works; only saving does not — the same line src/app/store.ts
        // takes for preferences.
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = async () => {
    setRows(await listScenarios())
  }

  const save = async () => {
    const result = await saveScenario(name, scenario)
    if (!result.ok) {
      setMessage(
        result.reason === 'full'
          ? t('pay.scenarios.full', { max: MAX_SCENARIOS })
          : t('pay.scenarios.needName'),
      )
      return
    }
    setName('')
    setMessage(t('pay.scenarios.saved', { name: result.row.name }))
    await refresh()
  }

  const remove = async (row: PayScenarioRow) => {
    await deleteScenario(row.id)
    setMessage(t('pay.scenarios.deleted', { name: row.name }))
    await refresh()
  }

  return (
    <SectionCard className="p-5" data-print-hide>
      <h2 className="text-base font-semibold">{t('pay.scenarios.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('pay.scenarios.intro')}</p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-sm font-medium" htmlFor={nameId}>
            {t('pay.scenarios.name')}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('pay.scenarios.namePlaceholder')}
            className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        <Button type="button" onClick={() => void save()}>
          <Save aria-hidden="true" />
          {t('pay.scenarios.save')}
        </Button>
      </div>

      <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {message}
      </p>

      {rows && rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <button
                type="button"
                onClick={() => {
                  onLoad(row.scenario as PayScenario)
                  setMessage(t('pay.scenarios.loaded', { name: row.name }))
                }}
                className="min-h-11 min-w-0 flex-1 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('pay.scenarios.rowHint', { level: row.level, date: row.updatedAt.slice(0, 10) })}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('pay.scenarios.delete', { name: row.name })}
                onClick={() => void remove(row)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {rows ? (
        <p className="mt-3 text-xs text-muted-foreground">
          <Badge tone="neutral">{t('pay.scenarios.used', { used: rows.length, max: MAX_SCENARIOS })}</Badge>
        </p>
      ) : null}
    </SectionCard>
  )
}
