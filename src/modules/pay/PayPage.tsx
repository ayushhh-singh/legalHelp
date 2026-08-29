import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AllowanceList } from './components/AllowanceList'
import { ComparePanel } from './components/ComparePanel'
import { ChipGroup } from './components/Fields'
import { InputsPanel } from './components/InputsPanel'
import { PayExplainPanel } from './components/PayExplainPanel'
import { Payslip } from './components/Payslip'
import { PrivatePanel } from './components/PrivatePanel'
import { ScenarioBar } from './components/ScenarioBar'
import { Simulations } from './components/Simulations'
import { readLastScenario, writeLastScenario } from './scenarios'
import { paramsFromView, parsePayParams, scenarioFromParams, type PayTab } from './url'
import { usePayTables } from './usePayTables'

import { useAi } from '@/ai/useAi'
import { PageHeader } from '@/components/common/PageHeader'
import { QueryErrorState, SectionCard, Skeleton } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { DEFAULT_PRIVATE_INPUT, type PrivateInput } from '@/lib/pay/compare'
import { computePay } from '@/lib/pay/engine'
import {
  defaultScenario,
  normaliseScenario,
  scenarioForJob,
  toPayInput,
  withAllowance,
  type PayScenario,
} from '@/lib/pay/scenario'
import type { PayTables } from '@/lib/pay/tables'

/**
 * The Pay & Allowances Calculator.
 *
 * **The URL is the state**, as it is in the Law Converter (ADR-013/015). Post,
 * Level, cell, city, Dearness Allowance rate, every allowance the reader
 * departed from the post's defaults on, the comparison's second post and the
 * private package all live in `useSearchParams`, and every control writes
 * straight to it. `/pay?job=ib-acio-ii-executive&city=delhi&da=60` restores
 * exactly this screen, which is what makes "Share" worth pressing.
 *
 * The one thing NOT in the URL is the last scenario, which is in IndexedDB so
 * that reopening `/pay` with no query puts the form back as it was left. It is
 * read once, and only when the URL says nothing — a shared link always wins
 * over what this device happens to remember.
 */
export default function PayPage() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const tables = usePayTables()

  const parsed = useMemo(() => parsePayParams(params), [params])

  if (tables.status === 'error') {
    return (
      <div className="space-y-6">
        <PageHeader title={t('pages.pay.title')} subtitle={t('pages.pay.subtitle')} />
        <QueryErrorState body={t('pay.loadFailed')} onRetry={tables.retry} />
      </div>
    )
  }

  if (tables.status === 'loading') {
    return (
      <div className="space-y-6">
        <PageHeader title={t('pages.pay.title')} subtitle={t('pages.pay.subtitle')} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <SectionCard className="space-y-3 p-5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
          </SectionCard>
          <SectionCard className="space-y-3 p-5">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </SectionCard>
        </div>
        <p className="sr-only" aria-live="polite">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return (
    <Calculator
      tables={tables.tables}
      params={params}
      parsed={parsed}
      setParams={setParams}
      hasQuery={[...params.keys()].length > 0}
    />
  )
}

/**
 * Split from the route component so that everything below here can take
 * `tables` as a non-null value. A component that has to re-check "have the
 * datasets arrived?" on every line is a component in which one line eventually
 * forgets to.
 */
function Calculator({
  tables,
  parsed,
  setParams,
  hasQuery,
}: {
  tables: PayTables
  params: URLSearchParams
  parsed: ReturnType<typeof parsePayParams>
  setParams: (next: URLSearchParams, options?: { replace?: boolean }) => void
  hasQuery: boolean
}) {
  const { t } = useT()
  const ai = useAi()

  const scenario = useMemo(() => scenarioFromParams(parsed, tables), [parsed, tables])
  const compare = useMemo(
    () =>
      parsed.compare
        ? scenarioFromParams(parsed.compare, tables)
        : scenarioForJob('aso-css', tables, { daRate: scenario.daRate }),
    [parsed.compare, scenario.daRate, tables],
  )
  const privateInput: PrivateInput = parsed.private ?? DEFAULT_PRIVATE_INPUT

  const view = {
    scenario,
    tab: parsed.tab,
    compare: parsed.compare ? compare : null,
    private: parsed.private,
  }

  const write = (next: {
    scenario?: PayScenario
    tab?: PayTab
    compare?: PayScenario | null
    private?: PrivateInput | null
  }) => {
    // replace, not push: dragging a stepper must not fill the back button with
    // a history entry per rupee.
    setParams(paramsFromView({ ...view, ...next }, tables), { replace: true })
  }

  const patch = (delta: Partial<PayScenario>) =>
    write({ scenario: normaliseScenario({ ...scenario, ...delta }, tables) })

  /**
   * Reopening `/pay` with nothing in the URL puts back the last scenario. A
   * link always wins: `hasQuery` is checked before the read, and the read only
   * ever runs on the first render of a bare route.
   */
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || hasQuery) return
    // Set before the await, not after: React's strict mode runs an effect
    // twice, and two reads racing to write the URL would restore the scenario
    // on top of itself.
    restored.current = true

    /*
      `alive` is what stops a read that lands after the reader has gone.

      `setSearchParams` navigates to ITS OWN route's path with the new search,
      not to wherever the reader now is — so a write from an unmounted
      `/pay` does not append a query to `/law`, it pulls the reader back onto
      `/pay?level=8&cell=3`. Demonstrated under both MemoryRouter and
      BrowserRouter with the unmount asserted; the window is one Dexie read,
      which is tens of milliseconds on a cold IndexedDB open.

      `completed` is the other half, and it is not optional. `restored` is a
      latch, and a latch armed by an attempt whose result is discarded is not a
      guard: under StrictMode the first mount arms it, the cleanup cancels the
      read, and the second mount returns early — so the scenario would never be
      restored in `pnpm dev`. That is the defect 089ce8e fixed in the Drafting
      Studio, and resetting the latch only for an attempt that never finished is
      what keeps it from reappearing here.
    */
    let alive = true
    let completed = false

    void readLastScenario()
      .then((last) => {
        completed = true
        if (!alive || !last) return
        // A bare URL means the rest of the view IS the default, so nothing from
        // the current render has to be carried in — which is what keeps this
        // effect's dependencies honest.
        setParams(
          paramsFromView(
            { scenario: normaliseScenario(last, tables), tab: 'calculator', compare: null, private: null },
            tables,
          ),
          { replace: true },
        )
      })
      .catch(() => {
        // Blocked storage. The form opens at its defaults, which is correct.
        completed = true
      })

    return () => {
      alive = false
      if (!completed) restored.current = false
    }
  }, [hasQuery, setParams, tables])

  /** Remembered as the reader works, so the next visit opens where they left. */
  const fingerprint = JSON.stringify(scenario)
  useEffect(() => {
    void writeLastScenario(JSON.parse(fingerprint) as PayScenario).catch(() => {
      // Blocked storage. The calculator does not depend on the write.
    })
  }, [fingerprint])

  const result = useMemo(() => computePay(toPayInput(scenario), tables), [scenario, tables])

  const [shareMessage, setShareMessage] = useState('')
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${paramsFromView(view, tables).toString()}`
    const text = t('pay.slip.shareText', {
      net: String(result.netMonthly),
      gross: String(result.gross),
      level: result.level,
      url,
    })
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('pages.pay.title'), text })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareMessage(t('pay.slip.shared'))
    } catch {
      setShareMessage(t('pay.slip.shareFailed'))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.pay.title')} subtitle={t('pages.pay.subtitle')} />

      <ChipGroup<PayTab>
        label={t('pay.tabs.label')}
        value={parsed.tab}
        options={[
          { value: 'calculator', label: t('pay.tabs.calculator') },
          { value: 'simulate', label: t('pay.tabs.simulate') },
          { value: 'compare', label: t('pay.tabs.compare') },
          { value: 'private', label: t('pay.tabs.private') },
        ]}
        onChange={(tab) => write({ tab })}
      />

      {parsed.tab === 'calculator' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-4" data-print-hide>
            <InputsPanel
              tables={tables}
              scenario={scenario}
              onChange={patch}
              onPickJob={(jobId) =>
                write({
                  scenario: jobId
                    ? scenarioForJob(jobId, tables, {
                        daRate: scenario.daRate,
                        daProjected: scenario.daProjected,
                        cityId: scenario.cityId,
                        children: scenario.children,
                        hostellers: scenario.hostellers,
                        pensionScheme: scenario.pensionScheme,
                        regime: scenario.regime,
                        oldRegime: scenario.oldRegime,
                      })
                    : { ...defaultScenario(tables), ...scenario, jobId: null },
                })
              }
            />
            <ScenarioBar
              scenario={scenario}
              onLoad={(loaded) => write({ scenario: normaliseScenario(loaded, tables) })}
            />
          </div>

          <div className="space-y-4">
            <Payslip
              result={result}
              scenario={scenario}
              tables={tables}
              onShare={() => void share()}
              shareMessage={shareMessage}
            />
            <AllowanceList
              tables={tables}
              scenario={scenario}
              result={result}
              onToggle={(id, enabled) => write({ scenario: withAllowance(scenario, id, { enabled }) })}
              onRate={(id, rateKey) =>
                write({ scenario: withAllowance(scenario, id, { enabled: true, rateKey }) })
              }
            />
            {ai.enabled ? <PayExplainPanel key={scenario.jobId ?? 'none'} ai={ai} scenario={scenario} /> : null}
          </div>
        </div>
      ) : null}

      {parsed.tab === 'simulate' ? <Simulations tables={tables} scenario={scenario} /> : null}

      {parsed.tab === 'compare' ? (
        <ComparePanel
          tables={tables}
          ai={ai}
          a={scenario}
          b={compare}
          onChangeA={patch}
          onChangeB={(delta) => write({ compare: normaliseScenario({ ...compare, ...delta }, tables) })}
          onPickA={(jobId) =>
            write({
              scenario: jobId
                ? scenarioForJob(jobId, tables, { daRate: scenario.daRate, cityId: scenario.cityId })
                : { ...scenario, jobId: null },
            })
          }
          onPickB={(jobId) =>
            write({
              compare: jobId
                ? scenarioForJob(jobId, tables, { daRate: scenario.daRate, cityId: compare.cityId })
                : { ...compare, jobId: null },
            })
          }
        />
      ) : null}

      {parsed.tab === 'private' ? (
        <PrivatePanel
          tables={tables}
          scenario={scenario}
          input={privateInput}
          onChange={(delta) => write({ private: { ...privateInput, ...delta } })}
        />
      ) : null}
    </div>
  )
}
