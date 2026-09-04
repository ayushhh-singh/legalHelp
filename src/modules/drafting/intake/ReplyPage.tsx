import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, FileUp, Sparkles, Trash2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { deleteIntake, getIntake, linkReply, listIntakes, restoreIntake, saveIntake } from './intakeStore'
import { provisionSnippets, resolveIntakeProvisions } from './resolveProvisions'
import { createDocumentFromIntake } from './newReply'
import { recordIntake } from '../register/registerStore'
import { useDraftingIndex } from '../useDraftingData'

import { PageHeader } from '@/components/common/PageHeader'
import { Badge, Chip, SectionCard } from '@/components/ui-x'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'
import { useAi } from '@/ai/useAi'
import { draftingAiAvailable } from '../ai-seam'
import { analyseIntake, type IntakeAnalysis, type ResolvedProvision } from '@/lib/drafting/intake'
import { useAsync } from '@/lib/useAsync'
import type { RetrievedSnippet } from '@/lib/retrieval'

/**
 * "Reply to a letter" — paste what arrived, see what it says, draft the answer.
 *
 * ### The deterministic pass is the feature; the AI pass is an addition
 *
 * Everything above the AI panel runs on every device with AI off, which is
 * every device's default: the reference number, the letter date, the receipt
 * date, the subject, the urgency, the enclosure count, the provisions cited and
 * the sentences that ask for something, all as chips the officer can correct.
 * "Draft the reply" works from those chips alone. `docs/AI.md` §13's ordering —
 * precomputed first, retrieval always, a model last — put the analysis panel at
 * the BOTTOM of this screen for exactly the reason `src/modules/library/
 * ai-seam.ts` states: turning the model off must cost the screen one affordance
 * out of six, not make it useless.
 *
 * ### Nothing is stored until the officer says so
 *
 * The letter lives in this component's state. It reaches `intakes` only when
 * "Keep this letter with the draft" is pressed. That is asserted in
 * `tests/e2e/draft-reply.spec.ts` rather than only stated here, because a
 * privacy claim nobody tests is a privacy claim.
 */

const IntakeAiPanel = lazy(() =>
  import('./IntakeAiPanel').then((module) => ({ default: module.IntakeAiPanel })),
)

export default function ReplyPage() {
  const { t, language } = useT()
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const ai = useAi()
  const index = useDraftingIndex()

  const stored = useLiveQuery(async () => (params.id ? await getIntake(params.id) : null), [params.id])
  const kept = useLiveQuery(() => listIntakes(12), []) ?? []

  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<IntakeAnalysis | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof deleteIntake>>>(null)
  const [intakeId, setIntakeId] = useState<string | null>(params.id ?? null)
  const [chosenType, setChosenType] = useState('')

  /*
    A stored letter opens with its own analysis. The read is keyed on the route
    parameter and applied through `useState`'s initialiser pattern rather than
    an effect: `react-hooks/set-state-in-effect` is right to reject the effect,
    and the derive-don't-resynchronise shape is what `ReviewPage`'s
    `wrongAnswer` already uses in the Trainer.
  */
  const active = analysis ?? stored?.analysis ?? null
  const activeText = text || stored?.text || ''

  /*
    The key is the citations themselves rather than the analysis object, so
    re-reading the same letter does not re-resolve — and so that `useAsync`'s
    own cancellation has something stable to compare. `loadCorpus` is memoised,
    but building the reverse index over 1,059 sections is not free.
  */
  const provisionKeyList = (active?.provisions ?? [])
    .map((provision) => `${provision.unit}:${provision.number}:${provision.act}`)
    .join('|')
  const provisions = useAsync<ResolvedProvision[]>(
    async () => (active && active.provisions.length > 0 ? resolveIntakeProvisions(active.provisions) : []),
    provisionKeyList,
    provisionKeyList.length > 0,
  )
  const snippets: RetrievedSnippet[] = useMemo(
    () => (provisions.status === 'ready' ? provisionSnippets(provisions.data) : []),
    [provisions],
  )

  const read = () => {
    const trimmed = text.trim()
    if (trimmed.length < 40) {
      setNotice(t('draft.intake.tooShort'))
      return
    }
    setAnalysis(analyseIntake(text))
    setNotice('')
  }

  const keep = async () => {
    if (!active) return
    const at = new Date().toISOString()
    const saved = await saveIntake({
      text: activeText,
      analysis: active,
      at,
      ...(intakeId ? { id: intakeId } : {}),
    })
    setIntakeId(saved.id)
    await recordIntake({
      intakeId: saved.id,
      number: saved.number,
      date: saved.date,
      receivedOn: saved.receivedOn,
      subject: saved.subject,
      at,
    })
    setNotice(t('draft.intake.kept'))
  }

  const draftReply = async () => {
    if (!active) return
    const at = new Date().toISOString()
    const templateId =
      chosenType || (index.status === 'ready' ? (index.data.templates[0]?.id ?? 'letter') : 'letter')
    const doc = await createDocumentFromIntake({
      templateId,
      analysis: active,
      intakeId,
      at,
      language,
    })
    if (intakeId) await linkReply(intakeId, doc.id, at)
    void navigate(`/draft/d/${doc.id}`)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title={t('draft.intake.heading')} subtitle={t('draft.intake.lead')} />

      <SectionCard className="p-4">
        <h2 className="text-sm font-semibold">{t('draft.intake.privacyTitle')}</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('draft.intake.privacyBody')}</p>
        {!acknowledged ? (
          <Button size="sm" className="mt-3" onClick={() => setAcknowledged(true)}>
            {t('draft.intake.privacyAccept')}
          </Button>
        ) : null}
      </SectionCard>

      {acknowledged || stored ? (
        <SectionCard className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('draft.intake.pasteLabel')}</span>
            <textarea
              value={activeText}
              onChange={(event) => {
                setText(event.target.value)
                setAnalysis(null)
              }}
              rows={10}
              className="w-full rounded-[10px] border border-input bg-card p-3 font-sans text-sm"
              placeholder={t('draft.intake.paste')}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={read} disabled={activeText.trim().length === 0}>
              {active ? t('draft.intake.readAgain') : t('draft.intake.read')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText('')
                setAnalysis(null)
                setNotice('')
              }}
            >
              {t('draft.intake.clear')}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/draft/import">
                <FileUp aria-hidden="true" className="mr-1 size-4" />
                {t('draft.intake.import')}
              </Link>
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {active ? (
        <Chips analysis={active} provisions={provisions.status === 'ready' ? provisions.data : []} />
      ) : (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('draft.intake.empty')}
        </p>
      )}

      {active ? (
        <SectionCard className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="reply-form">
              {t('draft.intake.chooseForm')}
            </label>
            <select
              id="reply-form"
              className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
              value={chosenType}
              onChange={(event) => setChosenType(event.target.value)}
            >
              <option value="">{t('draft.intake.suggestedForm')}</option>
              {index.status === 'ready'
                ? index.data.templates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name[language]}
                    </option>
                  ))
                : null}
            </select>
          </div>

          <p className="text-xs text-muted-foreground">{t('draft.intake.keepHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void keep()}>
              {t('draft.intake.keep')}
            </Button>
            <Button size="sm" onClick={() => void draftReply()}>
              {t('draft.intake.draftReply')}
              <ArrowRight aria-hidden="true" className="ml-1 size-4" />
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {/*
        The AI panel is LAST, is lazy, and renders nothing at all when AI is off.
        Everything above it works without it — that is the ordering `docs/AI.md`
        §13 asks for, and `src/modules/library/ai-seam.ts` states the test that
        keeps it honest.
      */}
      {active && draftingAiAvailable(ai.enabled) ? (
        <Suspense fallback={null}>
          <IntakeAiPanel
            text={activeText}
            extracted={active}
            provisions={provisions.status === 'ready' ? provisions.data : []}
            snippets={snippets}
            ai={ai}
            templateIds={index.status === 'ready' ? index.data.templates.map((entry) => entry.id) : []}
            onSuggestType={(id) => setChosenType(id)}
          />
        </Suspense>
      ) : null}

      {undo ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{t('draft.intake.deleted')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void restoreIntake(undo).then(() => {
                setUndo(null)
              })
            }
          >
            {t('draft.intake.undo')}
          </Button>
        </div>
      ) : null}

      {kept.length > 0 ? (
        <section aria-labelledby="kept-letters" className="flex flex-col gap-2">
          <h2 id="kept-letters" className="text-sm font-semibold">
            {t('draft.intake.keptLetters')}
          </h2>
          <ul className="flex flex-col gap-2">
            {kept.map((letter) => (
              <li
                key={letter.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm"
              >
                <Link to={`/draft/reply/${letter.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate font-medium">
                    {letter.subject || t('draft.editor.untitled')}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[letter.number, letter.date].filter(Boolean).join(' · ')}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('draft.intake.delete')}: ${letter.subject || letter.id}`}
                  onClick={() =>
                    void deleteIntake(letter.id).then((deleted) => {
                      setUndo(deleted)
                      setNotice(t('draft.intake.deleted'))
                    })
                  }
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * What the deterministic pass read, as editable chips.
 *
 * Every value is shown with what the extractor thought of it: a field it could
 * not find is empty and says so, and a field it read off an unlabelled line
 * carries a "check this" badge. That badge is not decoration — it is the
 * difference between a file number an officer glances at and one they read.
 */
function Chips({
  analysis,
  provisions,
}: {
  analysis: IntakeAnalysis
  provisions: readonly ResolvedProvision[]
}) {
  const { t, language } = useT()

  const rows: { label: string; value: string; low: boolean }[] = [
    {
      label: t('draft.intake.number'),
      value: analysis.meta.number,
      low: analysis.meta.confidence.number === 'low',
    },
    {
      label: t('draft.intake.letterDate'),
      value: analysis.letterDate,
      low: analysis.meta.confidence.date === 'low',
    },
    { label: t('draft.intake.receiptDate'), value: analysis.receiptDate, low: false },
    { label: t('draft.intake.diaryNumber'), value: analysis.diaryNumber, low: false },
    {
      label: t('draft.intake.subject'),
      value: analysis.meta.subject,
      low: analysis.meta.confidence.subject === 'low',
    },
    { label: t('draft.intake.urgency'), value: analysis.urgency, low: false },
    {
      label: t('draft.intake.enclosures'),
      value: String(analysis.enclosures.count),
      low: analysis.enclosures.confidence === 'low',
    },
  ]

  /*
    A NAMED region, and not only for the test that scopes to it.

    The letter is still in the textarea above, so every value on this card also
    exists on the page verbatim — the file number, the subject, every request
    sentence. A screen reader hearing "A-11011/4/2026-Estt.(Allowances)" twice
    with nothing between them cannot tell which is what the app read and which
    is the paper. The region gives the second one a name.

    It is also what makes `tests/e2e/draft-reply.spec.ts` able to assert
    anything at all here: the first version of that spec matched the textarea
    and the chip with one locator and failed six ways on strict mode.
  */
  return (
    // `SectionCard` IS a `<section>` and forwards its props, so naming it costs
    // nothing and needs no wrapper.
    <SectionCard aria-labelledby="intake-read" className="flex flex-col gap-4 p-4">
      <h2 id="intake-read" className="text-sm font-semibold">
        {t('draft.intake.whatWasRead')}
      </h2>

      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm break-words">
              {row.value ? (
                <span className="font-medium">{row.value}</span>
              ) : (
                <span className="text-muted-foreground italic">{t('draft.intake.notFound')}</span>
              )}
              {row.low && row.value ? (
                <Badge tone="warning" title={t('draft.intake.confidenceLowHint')}>
                  {t('draft.intake.confidenceLow')}
                </Badge>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('draft.intake.asks')}
        </h3>
        {analysis.asks.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('draft.intake.asksNone')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {analysis.asks.map((ask) => (
              <li key={ask.index} className="rounded-md border border-border p-2 text-sm">
                {ask.text}
                {ask.deadline ? (
                  <Chip tone="marigold" className="ms-2">
                    {ask.deadline}
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('draft.intake.provisions')}
        </h3>
        {analysis.provisions.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('draft.intake.provisionsNone')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {analysis.provisions.map((provision) => {
              const resolved = provisions.find(
                (each) => each.number === provision.number && each.unit === provision.unit,
              )
              return (
                <li key={`${provision.unit}-${provision.number}-${provision.act}`} className="text-sm">
                  <span className="font-medium">{provision.text}</span>
                  {resolved?.resolution ? (
                    <a
                      href={resolved.resolution.replacedBy?.href ?? resolved.resolution.href}
                      className="ms-2 text-primary underline"
                    >
                      {resolved.resolution.replacedBy
                        ? t('draft.intake.replacedBy', {
                            citation: resolved.resolution.replacedBy.citation,
                          })
                        : t('draft.intake.openProvision')}
                    </a>
                  ) : null}
                  {/*
                    The date rule is stated by the APP, in both languages, and is
                    never asked of a model — `dateRuleCaveat()` makes the same
                    decision for the law agent (ADR-035). An inbound letter
                    almost never gives an offence date, so the note usually says
                    it does not know, which is the honest answer.
                  */}
                  {resolved?.note ? (
                    <p className="mt-1 rounded-md border border-marigold/40 bg-marigold/15 p-2 text-xs text-marigold-foreground">
                      {resolved.note[language]}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-3" />
        {t('draft.intake.receiptDateHint')}
      </p>
    </SectionCard>
  )
}
