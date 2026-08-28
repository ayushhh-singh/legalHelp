import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataSourcesTable } from './DataSourcesTable'

import versions from '../../../../data/_meta/versions.json'

/**
 * "Data sources & versions" (Settings): the acceptance check is "lists every
 * dataset in /data". Session 9's `data/rules/` — twelve rule books — was
 * never added to `data/_meta/versions.json` at all until this session
 * (ADR-028 point 5), so this asserts against the file's own key count rather
 * than a literal number that would have silently been wrong before that fix.
 */
describe('DataSourcesTable', () => {
  it('renders one row per dataset in versions.json, rules included', () => {
    render(<DataSourcesTable />)

    const rows = screen.getAllByRole('row')
    // Header row + one per dataset.
    expect(rows).toHaveLength(Object.keys(versions.datasets).length + 1)

    for (const act of ['rules-ccs-conduct', 'rules-osa', 'rules-rti', 'rules-csmop']) {
      expect(versions.datasets).toHaveProperty(act)
    }
  })

  it('links a dataset that carries a source URL, and leaves one that does not as plain text', () => {
    render(<DataSourcesTable />)

    const lawRow = screen.getByRole('row', { name: /BNS ↔ IPC mapping/ })
    expect(within(lawRow).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^https?:\/\//))

    // "app" (data/_meta itself) carries no `source` — rendered as an em dash,
    // not a broken link.
    const appRow = screen.getByRole('row', { name: /Application shell/ })
    expect(within(appRow).queryByRole('link')).not.toBeInTheDocument()
  })
})
