import { useMemo, useState } from 'react'

import { Combobox, type ComboboxOption } from './Combobox'
import { buildCityIndex, buildJobIndex, searchCities, searchJobs, type JobOption } from '../pick'
import type { HraCity } from '../schema'

import { useT } from '@/i18n/useT'
import type { PayTables } from '@/lib/pay/tables'

/**
 * The two pickers, over the same combobox.
 *
 * Both index once per set of tables and re-rank on every keystroke. 67 posts
 * and 102 cities make that a few microseconds, so there is no debounce and no
 * deferred value here — the law module needs both because it ranks 1,059
 * records of statute, and copying that machinery to rank a hundred rows would
 * add a frame of latency to buy nothing.
 */

export function JobPicker({
  tables,
  selectedId,
  onSelect,
  onClear,
  id = 'pay-job-picker',
  label,
}: {
  tables: PayTables
  selectedId: string | null
  onSelect: (job: JobOption) => void
  onClear: () => void
  /**
   * Distinct per instance. The comparison renders TWO of these at once, and
   * with one hard-coded id both labels pointed at the first input — clicking
   * the second post's label focused the first post's box. axe did not report
   * it; a duplicate-id sweep in `tests/e2e/pay.spec.ts` does.
   */
  id?: string
  /** Overridden by the comparison, so the two boxes are not both "Post". */
  label?: string
}) {
  const { t, language } = useT()
  const [query, setQuery] = useState('')
  const index = useMemo(() => buildJobIndex(tables.jobs), [tables.jobs])
  const hits = useMemo(() => searchJobs(index, query, 60), [index, query])
  // Resolved from the FULL table, not `hits` — `hits` is filtered to `query`
  // and stops containing the selected job the instant the query no longer
  // matches it, which is what let the box's own selection vanish.
  const selectedLabel = tables.jobs.jobs.find((job) => job.id === selectedId)?.title[language]

  const options: Array<ComboboxOption<JobOption>> = hits.map((hit) => ({
    id: hit.job.id,
    value: hit,
    label: hit.job.title[language],
    hint: [
      hit.job.cadre?.[language],
      t('pay.picker.levelAndGrade', {
        level: hit.job.entryLevel,
        gradePay: hit.job.gradePay ?? '—',
        group: hit.job.group,
      }),
      hit.exam?.name[language],
    ]
      .filter(Boolean)
      .join(' · '),
    // Grouped by the body that recruits to the post, which is how an officer
    // looks for one — "the IB posts", not "the Level 7 posts".
    group: hit.organisation[language],
  }))

  return (
    <Combobox
      id={id}
      label={label ?? t('pay.picker.jobLabel')}
      placeholder={t('pay.picker.jobPlaceholder')}
      options={options}
      selectedId={selectedId}
      selectedLabel={selectedLabel}
      query={query}
      onQueryChange={setQuery}
      onSelect={(option) => onSelect(option.value)}
      clearOption={{ id: '__custom__', label: t('pay.picker.custom'), hint: t('pay.picker.customHint') }}
      onClear={onClear}
      emptyText={t('pay.picker.noJobs')}
      countText={query ? t('pay.picker.jobCount', { count: hits.length }) : undefined}
    />
  )
}

export function CityPicker({
  tables,
  selectedId,
  onSelect,
  onClear,
  id = 'pay-city-picker',
  label,
}: {
  tables: PayTables
  selectedId: string | null
  onSelect: (city: HraCity) => void
  onClear: () => void
  id?: string
  label?: string
}) {
  const { t, language } = useT()
  const [query, setQuery] = useState('')
  const index = useMemo(() => buildCityIndex(tables.cities), [tables.cities])
  const hits = useMemo(() => searchCities(index, query, 60), [index, query])
  // Same reasoning as `JobPicker.selectedLabel`: resolved from the full table.
  const selectedLabel = tables.cities.cities.find((city) => city.id === selectedId)?.name[language]

  const options: Array<ComboboxOption<HraCity>> = hits.map((city) => ({
    id: city.id,
    value: city,
    label: city.name[language],
    hint: [
      city.state[language],
      t('pay.picker.cityClass', { class: city.delhiRateProtected ? 'X' : city.class }),
      city.delhiRateProtected ? t('pay.picker.delhiRate') : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }))

  return (
    <Combobox
      id={id}
      label={label ?? t('pay.picker.cityLabel')}
      placeholder={t('pay.picker.cityPlaceholder')}
      options={options}
      selectedId={selectedId}
      selectedLabel={selectedLabel}
      query={query}
      onQueryChange={setQuery}
      onSelect={(option) => onSelect(option.value)}
      // Z is not a list — the annexure names X and Y and says the rest is Z —
      // so "anywhere else" is a real choice here, not an absence of one.
      clearOption={{ id: '__z__', label: t('pay.picker.zClass'), hint: t('pay.picker.zClassHint') }}
      onClear={onClear}
      emptyText={t('pay.picker.noCities')}
      countText={query ? t('pay.picker.cityCount', { count: hits.length }) : undefined}
    />
  )
}
