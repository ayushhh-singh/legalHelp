import type { Page } from '@playwright/test'

import { expect, onPhone } from './fixtures'

/**
 * Driving the document editor, at both widths (Session 35, ADR-047).
 *
 * The editor stopped being eight tabs in one strip. It is three columns on a
 * desktop — outline, document, panel — and on a phone a Write / Preview / Check
 * strip where "Check" swaps the panel in for the document. So "click the
 * Versions tab" is one press at one width and two at the other, and every spec
 * that drives this screen needs the same two lines. They live here rather than
 * in `fixtures.ts` because that file is the network gate and the harness test
 * polices what it exports; these are ordinary helpers over one module's UI.
 */

/**
 * The panel tabs, matched on the START of the accessible name.
 *
 * A plain string `name` is a case-insensitive SUBSTRING match, so `'Review'`
 * also matches "Preview" — CLAUDE.md records the same trap costing half an hour
 * on `{ name: 'Post' }` matching "Place of posting". `exact: true` fails too,
 * because the Review tab's name legitimately carries more than its label: when
 * something must be fixed it gains an `aria-hidden` dot and an `sr-only`
 * sentence saying what the dot means.
 */
export const tab = (name: string) => ['tab' as const, { name: new RegExp(`^${name}`) }] as const

/** Open one of the ⋯ menu's entries — where the editor's own actions live. */
export async function editorMenu(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: /More actions|अन्य क्रियाएँ/ }).click()
  await page.locator('#focus-actions').getByText(name).click()
}

/**
 * Open one of the right-hand panel's four tabs: Review, Change, Versions or
 * Notes to self. On a phone the panel is behind the strip's "Check", so this is
 * two presses there and one on a desktop.
 */
export async function panelTab(page: Page, name: string): Promise<void> {
  if (onPhone(page)) {
    /*
      Anchored at the START only: when something must be fixed this tab's name
      gains an `sr-only` sentence saying so ("Check — 1 must be fixed"), exactly
      as the Review tab's does, so `$` would stop finding it on the documents
      most worth checking.
    */
    await page.getByRole('tab', { name: /^Check|^जाँच/ }).click()
  }
  await page.getByRole(...tab(name)).click()
}

/**
 * Show the bilingual preview. The ⋯ menu at every width — the phone's strip has
 * its own Preview, but one route through both projects is one thing to keep
 * right.
 */
export async function showPreview(page: Page): Promise<void> {
  await editorMenu(page, /^Preview$|^पूर्वावलोकन$/)
}

/** Back to the document, from the preview or the export. */
export async function showDocument(page: Page): Promise<void> {
  if (onPhone(page)) {
    await page.getByRole('tab', { name: /^Write$|^लिखें$/ }).click()
  } else {
    await editorMenu(page, /^Write$|^लिखें$/)
  }
  await expect(page.getByRole('textbox', { name: /Document body|दस्तावेज़ का मुख्य भाग/ })).toBeVisible()
}

/** The document's details, which are a card at the head of the surface now. */
export async function openDetails(page: Page): Promise<void> {
  await page.getByText(/^Document details$|^दस्तावेज़ का विवरण$/).click()
  await expect(page.getByLabel(/^Subject$|^विषय$/)).toBeVisible()
}

/** The export panel, which used to be a tab and is now a ⋯ entry. */
export async function showExport(page: Page): Promise<void> {
  await editorMenu(page, /Export as \.docx|\.docx के रूप में निर्यात करें/)
}
