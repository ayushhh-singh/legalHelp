import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import HomePage from './HomePage'
import { useEffectiveCatalogue, useRulesIndex } from '../useCatalogue'
import { useTrainerSettings } from '../useTrainerSettings'

import i18n from '@/i18n'
import {
  allStreaks,
  getDueQueue,
  statsForDay,
  weakAreasFor,
  type DayStats,
  type TrainerSettings,
} from '@/lib/srs'

import type { Card, RulesIndex } from '../schema'

/**
 * `/study/practise` Home, in isolation from Dexie and `data/rules`: every hook that
 * would otherwise touch IndexedDB or fetch a `?raw` chunk is mocked, so what
 * is under test is HomePage's own logic — what it renders while first-run,
 * and when the mock test has nothing to draw from — not the scheduler or the
 * dataset underneath it (both have their own suites).
 *
 * Regression coverage for two defects: the first-run `EmptyState` used to
 * REPLACE the whole dashboard, hiding every link off the page until the
 * reader had already started a review; and the mock-test button offered no
 * way to tell, before pressing it, that the reader's chosen rule books have
 * no approved mock-test questions at all.
 */

vi.mock('../useCatalogue', () => ({
  useRulesIndex: vi.fn(),
  useEffectiveCatalogue: vi.fn(),
}))
vi.mock('../useTrainerSettings', () => ({
  useTrainerSettings: vi.fn(),
}))
vi.mock('@/ai/useAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/useAi')>()
  const { DEFAULT_AI_SETTINGS } = await import('@/ai/flags')
  return {
    ...actual,
    useAi: () => ({
      enabled: false,
      ready: false,
      tier: 'off',
      settings: DEFAULT_AI_SETTINGS,
      provider: null,
      budget: null,
      error: null,
      refreshBudget: () => Promise.resolve(),
    }),
  }
})
vi.mock('@/lib/srs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/srs')>()
  return {
    ...actual,
    allStreaks: vi.fn(),
    getDueQueue: vi.fn(),
    statsForDay: vi.fn(),
    weakAreasFor: vi.fn(),
  }
})

const RULES_INDEX: RulesIndex = {
  version: '1.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  disclaimer: { en: 'Reference only.', hi: 'केवल संदर्भ हेतु।' },
  totals: { rules: 1, cards: 1, served: 1, byKind: { rule: 1 } },
  acts: [
    {
      id: 'ccs-conduct',
      name: { en: 'CCS (Conduct) Rules, 1964', hi: 'सीसीएस (आचरण) नियम, 1964' },
      short: { en: 'Conduct', hi: 'आचरण' },
      unit: { en: 'Rule', hi: 'नियम' },
      publisher: 'DoPT',
      text: 'text/ccs-conduct.json',
      cards: 'cards/ccs-conduct.json',
      counts: { rules: 1, cards: 1, served: 1, byKind: { rule: 1 } },
      source: { name: 'DoPT', url: 'https://dopt.gov.in' },
    },
  ],
}

const RULE_CARD: Card = {
  id: 'ccs-conduct-rule-1',
  act: 'ccs-conduct',
  rule: '1',
  kind: 'rule',
  front: { en: 'Short title, commencement and application', hi: '' },
  back: { en: 'These rules may be called the CCS (Conduct) Rules, 1964.', hi: '' },
  ruleRef: { textId: 'ccs-conduct-1', citation: { en: 'CCS (Conduct) Rules, R. 1', hi: '' } },
  difficulty: 'easy',
  reviewed: true,
  reviewState: 'approved',
  version: '1.0.0',
  source: { name: 'DoPT', url: 'https://dopt.gov.in' },
}

const MCQ_CARD: Card = {
  ...RULE_CARD,
  id: 'ccs-conduct-mcq-1',
  kind: 'mcq',
  options: [
    { en: 'A', hi: 'क' },
    { en: 'B', hi: 'ख' },
    { en: 'C', hi: 'ग' },
    { en: 'D', hi: 'घ' },
  ],
  answerIndex: 0,
}

const SETTINGS: TrainerSettings = {
  dailyNew: 10,
  dailyReviewCap: 100,
  desiredRetention: 0.9,
  actsEnabled: [],
}

const STATS: DayStats = {
  day: '2026-09-03',
  due: 0,
  reviewed: 0,
  newIntroduced: 0,
  lapses: 0,
  accuracy: 0,
  retentionEstimate: null,
  predictedRetention: null,
  durationMs: 0,
}

function mockReady(catalogue: Card[], settings: TrainerSettings, streaks: unknown[]) {
  vi.mocked(useRulesIndex).mockReturnValue({
    status: 'ready',
    data: RULES_INDEX,
    error: null,
    retry: () => undefined,
  })
  vi.mocked(useEffectiveCatalogue).mockReturnValue(catalogue)
  vi.mocked(useTrainerSettings).mockReturnValue(settings)
  vi.mocked(allStreaks).mockResolvedValue(streaks as never)
  vi.mocked(getDueQueue).mockResolvedValue([])
  vi.mocked(statsForDay).mockResolvedValue(STATS)
  vi.mocked(weakAreasFor).mockResolvedValue([])
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage, first run (an empty Dexie)', () => {
  it('shows the first-run banner AND every navigation link, not one instead of the other', async () => {
    // An approved MCQ card too, so the mock-test control is a live link here —
    // its disabled state (and the extra "browse the rule bank" link it adds)
    // is its own scenario, in the next describe block.
    mockReady([RULE_CARD, MCQ_CARD], SETTINGS, [])
    renderHome()

    await waitFor(() => expect(screen.getByText('No cards yet')).toBeInTheDocument())

    expect(screen.getByRole('link', { name: /^browse$/i })).toHaveAttribute('href', '/study/practise/browse')
    expect(screen.getByRole('link', { name: /bookmarks/i })).toHaveAttribute(
      'href',
      '/study/practise/bookmarks',
    )
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/study/practise/reports')
    expect(screen.getByRole('link', { name: /local review queue/i })).toHaveAttribute(
      'href',
      '/study/practise/review-queue',
    )
    expect(screen.getByRole('link', { name: /start review/i })).toHaveAttribute(
      'href',
      '/study/practise/review',
    )
    expect(screen.getByRole('link', { name: /mock test/i })).toHaveAttribute('href', '/study/practise/mock')
  })

  it('does not show the banner once a card has been graded', async () => {
    mockReady([RULE_CARD, MCQ_CARD], SETTINGS, [{ date: '2026-09-02', goalMet: true }])
    renderHome()

    await waitFor(() => expect(screen.getByRole('link', { name: /^browse$/i })).toBeInTheDocument())
    expect(screen.queryByText('No cards yet')).not.toBeInTheDocument()
  })
})

describe('HomePage, the mock test button', () => {
  it('is disabled and states why, in both languages, when the enabled acts have no approved mock questions', async () => {
    // Only a `rule`-kind card is approved for the one enabled act — none of
    // `mcq`/`trueFalse`/`scenario` — so the mock bank for this reader's
    // choice of rule books is genuinely empty.
    mockReady([RULE_CARD], { ...SETTINGS, actsEnabled: ['ccs-conduct'] }, [])
    renderHome()

    /*
      ADR-046 turned the five secondary destinations into rows that are ALWAYS
      there — the mock used to be a large disabled button beside "Start review",
      which put a dead control in the most prominent place on the screen. The
      reason it cannot run yet is now a sentence under the row rather than an
      `aria-describedby` on something nobody can press.
    */
    const mockRow = await screen.findByRole('link', { name: /mock test/i })
    expect(mockRow).toHaveAttribute('href', '/study/practise/mock')
    expect(mockRow).toHaveTextContent(/no mock-test questions are approved yet/i)

    // The deck is the next row down, so the note no longer needs a link of its
    // own inside it — `trainer.home.mockUnavailableLink` was removed with it,
    // because an i18n key with no reader is a feature with no reader.
    expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/study/practise/browse')

    await i18n.changeLanguage('hi')
    expect(
      screen.getByText(/आपकी चुनी गई नियमावलियों के लिए अभी कोई मॉक-टेस्ट प्रश्न अनुमोदित नहीं है।/),
    ).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })

  it('is a live link, and offers no reason, when an approved mock question exists', async () => {
    mockReady([MCQ_CARD], { ...SETTINGS, actsEnabled: ['ccs-conduct'] }, [])
    renderHome()

    const mockLink = await screen.findByRole('link', { name: /mock test/i })
    expect(mockLink).toHaveAttribute('href', '/study/practise/mock')
    expect(screen.queryByText(/no mock-test questions are approved yet/i)).not.toBeInTheDocument()
  })
})
