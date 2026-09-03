import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { AllowanceList } from './components/AllowanceList'
import { ComparePanel } from './components/ComparePanel'
import { InfoPopover } from './components/InfoPopover'
import { Payslip } from './components/Payslip'
import { CityPicker, JobPicker } from './components/Pickers'

import { CONSENT_VERSION, DEFAULT_AI_SETTINGS } from '@/ai/flags'
import i18n from '@/i18n'
import { computePay } from '@/lib/pay/engine'
import {
  defaultScenario,
  scenarioForJob,
  toPayInput,
  withAllowance,
  type PayScenario,
} from '@/lib/pay/scenario'
import { loadPayTables } from '@/test/payTables'

import type { UseAi } from '@/ai/useAi'

/**
 * The Pay module's chrome, in jsdom.
 *
 * Everything here is a claim that would be expensive to find out about in
 * production: that the picker's acronym search reaches the keyboard as well as
 * the mouse, that switching language moves the labels and leaves the FIGURES
 * alone, and that an allowance whose rate the reader has not chosen shows a
 * choice rather than a confident zero.
 */

const tables = loadPayTables()
const DA = 60

const acio = scenarioForJob('ib-acio-ii-executive', tables, { daRate: DA, cityId: 'delhi' })
const slip = (scenario: PayScenario) => computePay(toPayInput(scenario), tables)

function Slip({ scenario }: { scenario: PayScenario }) {
  return (
    <Payslip
      result={slip(scenario)}
      scenario={scenario}
      tables={tables}
      onShare={() => undefined}
      shareMessage=""
    />
  )
}

describe('JobPicker', () => {
  function Harness({ onPick }: { onPick: (id: string) => void }) {
    const [selected, setSelected] = useState<string | null>(null)
    return (
      <JobPicker
        tables={tables}
        selectedId={selected}
        onSelect={(option) => {
          setSelected(option.job.id)
          onPick(option.job.id)
        }}
        onClear={() => setSelected(null)}
      />
    )
  }

  it('finds a post by acronym and reports how many matched', async () => {
    const user = userEvent.setup()
    render(<Harness onPick={() => undefined} />)

    await user.type(screen.getByRole('combobox', { name: /post/i }), 'ACIO')

    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    // The clear row plus the two Intelligence Bureau posts.
    expect(options).toHaveLength(3)
    expect(within(listbox).getByText(/Assistant Central Intelligence Officer, Grade-II/)).toBeVisible()
    expect(screen.getByText('2 posts')).toBeVisible()
  })

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    render(<Harness onPick={(id) => picked.push(id)} />)

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    // Row 0 is "Custom / no post"; one press down reaches the first real post.
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', 'pay-job-picker-option-1')
    await user.keyboard('{Enter}')

    expect(picked).toEqual(['ib-acio-i-executive'])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape without choosing anything', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    render(<Harness onPick={(id) => picked.push(id)} />)

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    expect(screen.getByRole('listbox')).toBeVisible()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(picked).toEqual([])
  })

  it('groups the options by the body that recruits to the post', async () => {
    const user = userEvent.setup()
    render(<Harness onPick={() => undefined} />)
    await user.type(screen.getByRole('combobox', { name: /post/i }), 'constable')
    expect(screen.getByText(/Central Armed Police Forces/i)).toBeVisible()
  })

  it('shows the selected post label, not the live query, once a post is picked', async () => {
    const user = userEvent.setup()
    render(<Harness onPick={() => undefined} />)

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')
  })

  it('keeps showing the selected label after the field loses focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness onPick={() => undefined} />
        <button type="button">elsewhere</button>
      </>,
    )

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')
  })

  it('lets the reader type over a selection to search for something else', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness onPick={() => undefined} />
        <button type="button">elsewhere</button>
      </>,
    )

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')

    // Focus has to move away and back for a real `focus` event to fire — a
    // click on an already-focused field (as it is right after `{Enter}`)
    // never does, which is exactly the case the `.select()`-on-focus behaviour
    // exists for: refocusing a field holding a selection.
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    await user.click(input)
    await user.keyboard('constable')

    expect(input).toHaveValue('constable')
    expect(screen.getByText(/Central Armed Police Forces/i)).toBeVisible()
  })

  it('restores the selected label if Escape is pressed mid-search', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness onPick={() => undefined} />
        <button type="button">elsewhere</button>
      </>,
    )

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    await user.click(input)
    await user.keyboard('constable')
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')
  })

  it('clears the selection and shows the placeholder when the clear control is pressed', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness onPick={() => undefined} />)

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')

    // Decorative and `aria-hidden` on purpose (mouse-only; the accessible way
    // to clear is the "Custom" row in the listbox), so it is reached by a DOM
    // query rather than a role.
    const clearButton = container.querySelector('button[aria-hidden="true"]')
    if (!clearButton) throw new Error('no clear control found')
    await user.click(clearButton)

    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder')
  })
})

describe('CityPicker', () => {
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null)
    return (
      <CityPicker
        tables={tables}
        selectedId={selected}
        onSelect={(city) => setSelected(city.id)}
        onClear={() => setSelected(null)}
      />
    )
  }

  it('shows the selected city label after picking it, in the active language', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByRole('combobox', { name: /place of posting/i })
    await user.type(input, 'Delhi')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(input).toHaveValue('Delhi')
  })
})

describe('Pickers language switch', () => {
  it('re-renders the selected label in the other language without losing the selection', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null)
      return (
        <JobPicker
          tables={tables}
          selectedId={selected}
          onSelect={(o) => setSelected(o.job.id)}
          onClear={() => setSelected(null)}
        />
      )
    }
    render(<Harness />)

    const input = screen.getByRole('combobox', { name: /post/i })
    await user.type(input, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')

    await i18n.changeLanguage('hi')
    expect(input).toHaveValue('सहायक केंद्रीय आसूचना अधिकारी, ग्रेड-I/कार्यपालक')

    await i18n.changeLanguage('en')
  })
})

const aiState = (over: Partial<UseAi> = {}): UseAi => ({
  enabled: false,
  ready: true,
  tier: 'byok',
  settings: { ...DEFAULT_AI_SETTINGS, tier: 'byok', consentVersion: CONSENT_VERSION, hasKey: true },
  provider: null,
  budget: null,
  error: null,
  refreshBudget: () => Promise.resolve(),
  ...over,
})

describe('ComparePanel', () => {
  function Harness() {
    const [a, setA] = useState<PayScenario>(defaultScenario(tables))
    const [b, setB] = useState<PayScenario>(defaultScenario(tables))
    return (
      <ComparePanel
        tables={tables}
        ai={aiState()}
        a={a}
        b={b}
        onChangeA={(patch) => setA((current) => ({ ...current, ...patch }))}
        onChangeB={(patch) => setB((current) => ({ ...current, ...patch }))}
        onPickA={(jobId) =>
          setA((current) => (jobId ? scenarioForJob(jobId, tables, current) : { ...current, jobId: null }))
        }
        onPickB={(jobId) =>
          setB((current) => (jobId ? scenarioForJob(jobId, tables, current) : { ...current, jobId: null }))
        }
      />
    )
  }

  it('shows each side its own selected post, independently of the other', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const inputA = screen.getByRole('combobox', { name: 'First post' })
    const inputB = screen.getByRole('combobox', { name: 'Second post' })

    await user.type(inputA, 'ACIO')
    await user.keyboard('{ArrowDown}{Enter}')

    await user.type(inputB, 'constable')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(inputA).toHaveValue('Assistant Central Intelligence Officer, Grade-I/Executive')
    expect(inputB).not.toHaveValue('')
    expect((inputB as HTMLInputElement).value).not.toBe((inputA as HTMLInputElement).value)
  })
})

describe('Payslip', () => {
  it('shows the Special Security Allowance the post carries, with its source', () => {
    render(<Slip scenario={acio} />)

    const row = screen.getByRole('row', { name: /Special Security Allowance/i })
    expect(within(row).getByText('₹8,980')).toBeVisible()

    const source = screen.getAllByRole('link', {
      name: /Special Security Allowance|Ministry|7th Central Pay/i,
    })
    expect(source.length).toBeGreaterThan(0)
  })

  it('shows every standing line at the figure the orders give', () => {
    render(<Slip scenario={acio} />)
    for (const figure of ['₹44,900', '₹26,940', '₹13,470', '₹3,600', '₹2,160', '₹1,00,050', '₹92,156']) {
      expect(screen.getAllByText(figure).length).toBeGreaterThan(0)
    }
  })

  it('moves the labels to Hindi and leaves the figures alone', async () => {
    const { rerender } = render(<Slip scenario={acio} />)
    expect(screen.getByText('Basic pay')).toBeVisible()

    await i18n.changeLanguage('hi')
    rerender(<Slip scenario={acio} />)

    // The Hindi label is now the primary one, and the figures have not moved.
    expect(screen.getAllByText('मूल वेतन').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹44,900').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹92,156').length).toBeGreaterThan(0)

    await i18n.changeLanguage('en')
  })

  it('carries both languages on every line, whichever one is selected', () => {
    render(<Slip scenario={acio} />)
    // A pay slip does. The reader's language decides which is the larger of the
    // two, not which one exists.
    expect(screen.getByText('Basic pay')).toBeVisible()
    expect(screen.getByText('मूल वेतन')).toBeVisible()
  })

  it('says the figures need checking, because the post dataset is unconfirmed', () => {
    render(<Slip scenario={acio} />)
    expect(screen.getByText(/have not been confirmed/i)).toBeVisible()
  })

  it('warns in terms when the Dearness Allowance rate is a projection', () => {
    render(<Slip scenario={{ ...acio, daRate: 63, daProjected: true }} />)
    expect(screen.getByText(/PROJECTED rate of Dearness Allowance/i)).toBeVisible()
  })
})

describe('AllowanceList', () => {
  function Harness({ initial }: { initial: PayScenario }) {
    const [scenario, setScenario] = useState(initial)
    return (
      <AllowanceList
        tables={tables}
        scenario={scenario}
        result={slip(scenario)}
        onToggle={(id, enabled) => setScenario((current) => withAllowance(current, id, { enabled }))}
        onRate={(id, rateKey) =>
          setScenario((current) => withAllowance(current, id, { enabled: true, rateKey }))
        }
      />
    )
  }

  it('asks for a rate rather than showing a confident zero', async () => {
    const user = userEvent.setup()
    const capf = scenarioForJob('capf-constable-gd', tables, { daRate: DA })
    render(<Harness initial={capf} />)

    await user.click(screen.getByRole('switch', { name: /Risk and Hardship Allowance/i }))

    // Two allowances on this post need a rate chosen — the Dress Allowance as
    // well — so the query names the one under test.
    const select = await screen.findByLabelText('Which rate applies', {
      selector: '#risk-and-hardship-allowance-rate',
    })
    expect(screen.getAllByText('Choose a rate').length).toBeGreaterThan(0)

    await user.selectOptions(select, 'r1h3')
    // ₹4,100 for Level 8 and below, raised once because DA crossed 50 per cent.
    expect(await screen.findByText('₹5,125')).toBeVisible()
  })

  it('says an allowance has no published rate rather than pricing it at nil', () => {
    const capf = scenarioForJob('capf-constable-gd', tables, { daRate: DA })
    render(<Harness initial={capf} />)
    // Ration Money is notified per day by the Ministry of Home Affairs, and
    // Leave Travel Concession is not a money allowance at all.
    expect(screen.getAllByText('No published rate').length).toBe(2)
  })

  it('marks a tax-exempt allowance with the section it is exempt under', async () => {
    const user = userEvent.setup()
    const capf = scenarioForJob('capf-constable-gd', tables, { daRate: DA })
    render(<Harness initial={capf} />)
    await user.click(screen.getByRole('switch', { name: /Tough Location Allowance/i }))
    expect(screen.getAllByText(/Exempt — 10\(14\)/).length).toBeGreaterThan(0)
  })
})

describe('InfoPopover', () => {
  it('shows the formula, its inputs and the order behind a line', async () => {
    const user = userEvent.setup()
    const line = slip(acio).lines.find((entry) => entry.id === 'house-rent-allowance')
    if (!line) throw new Error('the pay slip has no House Rent Allowance line')

    const { container } = render(<InfoPopover line={line} formulaLabel="How this figure is worked out" />)
    // A native <details>. jsdom keeps its content in the DOM either way, so the
    // click is here to prove the summary carries an accessible name and is
    // reachable — not to reveal the text.
    const summary = container.querySelector('summary')
    expect(summary).toHaveAttribute('aria-label', expect.stringContaining('Explain'))
    await user.click(summary!)

    expect(screen.getByText(/max\(\(basic \+ payElement\) × rate%, floor\)/)).toBeVisible()
    expect(screen.getByText('cityClass')).toBeVisible()
    expect(screen.getByText('X')).toBeVisible()
    expect(screen.getByText(/Government accommodation/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /House Rent Allowance/i })).toHaveAttribute(
      'href',
      expect.stringContaining('doe.gov.in'),
    )
  })
})
