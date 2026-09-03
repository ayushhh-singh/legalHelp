# CLAUDE.md — Sahayak (सरकारी सहायक)

> Read this file and `docs/DECISIONS.md` at the start of every session.

---

## MASTER CONTEXT

<!-- prettier-ignore-start -->
<!-- The block below is the human's spec, kept byte-for-byte. Do not reflow it. -->

PROJECT: <APP_NAME> (Hindi tagline: सरकारी सहायक). Working title in code: "sahayak".
WHAT: Offline-first, bilingual (Hindi ⇄ English, EQUAL footing, toggle everywhere) PWA for Indian central
  government officers and people about to join government service. Personal productivity + reference tool.
MODULES:
  1. Law Converter — IPC↔BNS, CrPC↔BNSS, Evidence Act↔BSA, bidirectional, every section, offence-date aware.
  2. Rules Trainer — spaced repetition (FSRS via ts-fsrs) over CCS Conduct/CCA/Leave/Pension, FR-SR, GFR 2017,
     CSMOP 2022, RTI, OSA, PoSH 2013, Rajbhasha rules. Bilingual questions with rule citations.
  3. Drafting Studio — every CSMOP 2022 document type (OM, DO, UO, noting, notification, circular, endorsement,
     letter, leave application, representation, RTI reply, show-cause reply, tour programme, TA bill covering
     letter) with live A4 preview, Hindi admin glossary helper, phrase library, .docx + print-PDF export.
  4. Pay & Allowances Calculator — 7th CPC matrix (all levels/cells) with grade pay shown, job-title picker that
     auto-adds post-specific allowances (IB SSA 20%, CBI incentive, CAPF risk/hardship, railway running
     allowance, etc.) with editable toggles and source links, DA/HRA/TA/CEA, NPS/UPS/GPF, CGHS, CGEGIS,
     income tax old vs new incl. 80CCD(2), increment/MACP/8th-CPC simulations (8th CPC = projection only),
     compare two posts, private-vs-govt comparison.
  5. Utilities — holiday calendar (gazetted/restricted), leave calculator, pension/GPF/NPS/gratuity/commutation,
     Hindi admin glossary, portals & helplines directory.
AI LAYER (built fully, dormant by default; see Sessions 3A, 21-24):
  Three activation tiers, identical app code: Tier 0 on-device WebLLM (free), Tier 1 BYOK (user's own
  Anthropic key stored only in IndexedDB, browser calls api.anthropic.com directly), Tier 2 hosted proxy
  (Cloudflare Worker with the owner's key, VITE_AI_PROXY_URL). Provider abstraction src/ai/provider.ts;
  MockProvider for all tests. Agents run client-side over local JSON via a typed tool registry. Default OFF;
  opt-in modal; classified-content banner on every AI surface; kill switch; with AI off, zero outbound
  requests. Agents must ground every claim in a tool result; ungrounded output fails tests.
HARD RULES (never violate, never "improve" around):
  - PUBLIC, NON-DEPARTMENTAL DATA ONLY. No feature that collects, profiles, monitors, investigates, or
    surveils anyone. No OSINT. No departmental data. If a request would cross this line, refuse and say why.
  - All user state lives in IndexedDB (Dexie). No accounts. No backend for user data. No analytics by default.
    Zero network requests carrying user-entered data (enforced by a Playwright test).
  - Free for users. No ads. No Razorpay in v1; leave a dormant, commented "billing seam" only.
  - Every data card shows its source URL and dataset version. Disclaimer: "Reference only; verify with the
    official gazette/order or your DDO."
  - Equal bilingual content: every data record stores { en, hi } objects, not flat strings. Missing hi is a
    CI failure, not a fallback.
STACK (pinned to CURRENT latest as of Aug 2026, verified on the npm registry; do not downgrade without an
  ADR): Node 24, pnpm 9.15, React 19.2 + react-dom 19.2, Vite 8.2, @vitejs/plugin-react 6.1,
  TypeScript 7.0 (native compiler), Tailwind CSS 4.3 via @tailwindcss/vite (CSS-first @theme — NO
  tailwind.config.ts), shadcn/ui (Radix) + tw-animate-css 1.4, react-router-dom 7.18, i18next 26 +
  react-i18next, Dexie 4.4 + dexie-react-hooks, zustand 5, zod 4.4, date-fns 4.4, lucide-react 1.34,
  fuse.js 7.5, ts-fsrs 5.4, docx 9.7, cmdk 1.1, recharts 3.10, vite-plugin-pwa 1.3 + workbox-window 7.4,
  @fontsource-variable/inter 5.3, @fontsource/poppins 5.3, @fontsource/noto-sans-devanagari 5.3.
  Tests: Vitest 4.1, @testing-library/react 16, Playwright 1.62, axe-core 4.13, fake-indexeddb.
  Lint/format: ESLint 10 (flat) + typescript-eslint 8.68, prettier 3.9 + prettier-plugin-tailwindcss.
  AI (later sessions): @mlc-ai/web-llm 0.2.84 (Tier 0), fetch to api.anthropic.com (Tier 1), Cloudflare
  Worker + wrangler 4 (Tier 2). Data pipeline: Python 3.12 (requests, bs4, pdfplumber, PyMuPDF, jsonschema)
  in GitHub Actions/scripts only, never in the browser. Hosting: Cloudflare Pages.
  Breaking changes that matter: Tailwind 4 has no JS config (theme lives in CSS `@theme inline`, dark via
  `@custom-variant dark (&:is(.dark *))`, `@import "tailwindcss"` replaces the @tailwind directives);
  zod 4 changes error-customisation APIs; i18next 26 typed resources via CustomTypeOptions; React Router 7
  is ESM-only with the v6 data-router API; TypeScript 7 is the native compiler — fix errors, do not
  silently downgrade.
DESIGN (ported from Neev — apps/web/src/index.css + .claude/skills/frontend-design/SKILL.md; light is the
  default, dark only on explicit toggle, never from OS preference):
  Light: --background #F7F9FC, --foreground #0B1D3B (navy ink), --card #FFFFFF, --primary #1E4FD9 (links,
  active states, focus ring — NOT the primary button), --action #0B1D3B on white (the ONE theme-inverting
  token; primary buttons, active chips, progress fill, underline-tab bar), --marigold #F7C873 (single accent,
  same value in both themes; text on solid gold is ALWAYS --brand-navy), --tulsi #10B981 success,
  --coral #F43F5E low band, --destructive #DA3125, --muted #F2F5FA / --muted-foreground #667085,
  --border #DFE5EF, --secondary #E4EAF4, --accent #DBE4F8 / #123086.
  Dark: --background #061225, --card #102542, --foreground #E8EDF5, --primary #6E9BFF, --action #F7C873 on
  navy, --muted-foreground #A9B7CC, --tulsi #34D399, --coral #FB7185, --destructive #F2685C.
  Every marigold/tulsi/coral has a paired -foreground token for text on its /15 tint — never the raw token
  as text/icon colour. Fonts (self-hosted via @fontsource): Inter (body, --font-sans), Poppins LATIN ONLY for
  headings (Hindi headings fall through to Noto glyph-by-glyph), Noto Sans Devanagari with line-height
  ≥ 1.75 always; scoreboard numerals = Inter 800 tabular-nums. Radius 12px cards/inputs, 10px buttons, pill
  chips. Strict 4px grid. ONE nav config array drives sidebar + bottom tab bar (<768px: 4 tabs + "More").
  Active nav = gold rule on the chrome edge + bolder label, never colour alone. Tap targets ≥ 44px.
  Contrast verification via <canvas> colour resolution, not string parsing. NEVER: cream + serif +
  terracotta; near-black + acid green; newspaper hairlines; stock shadcn grays.
  Signature element (decide in Session 1B): the "file tab" — a slim gold index-tab on the active module card
  and the section-number chip set in tabular Inter. No gauge (that is Neev's).
DATA SOURCES (public): NCRB Sankalan static tables
  https://www.ncrb.gov.in/uploads/SankalanPortal/SectionTableBNS.html (+ BNSS, BSA; PDFs under DownloadPDF/),
  India Code https://indiacode.gov.in (robots.txt disallows bots → fetch manually/one-off, cite, never cron),
  DoE/DoPT/DoPPW/PFRDA orders (PDF), DoPT annual holiday O.M., ISTM e-LMS reading material,
  Dept of Official Language Prashasanik Shabdavali, data.gov.in (GODL-India licence, attribution required).
KEY FACTS (verify at ingest; store in data, never hardcode in UI): DA 60% from 1 Jan 2026 (DoE OM
  1/1(i)/2026-E.II(B)); HRA 30/20/10 X/Y/Z with floors 5400/3600/1800; TA slabs L9+: 7200/3600, L3-8:
  3600/1800, L1-2: 1350/900 (X&Y / Z), DA on TA; NPS emp 10% govt 14%; UPS govt 18.5%; CGHS L1-5 ₹250, L6 ₹450,
  L7-11 ₹650, L12+ ₹1000; grade-pay↔level: 1800=L1,1900=L2,2000=L3,2400=L4,2800=L5,4200=L6,4600=L7,
  4800=L8,5400(PB2)=L9,5400(PB3)=L10,6600=L11,7600=L12,8700=L13,8900=L13A,10000=L14; IB ACIO-II = L7 GP4600
  + SSA 20% of basic; 8th CPC constituted 3 Nov 2025, report ~mid-2027, no fitment factor notified.
REPO LAYOUT: /data (versioned JSON, bundled at build) /schemas /scripts (python + node) /src/modules/{law,
  trainer,drafting,pay,utils} /src/{app,components,i18n,db,lib,styles} /tests/e2e /docs .github/workflows
WORKING AGREEMENTS FOR CLAUDE CODE:
  - ZERO PAID SERVICES. Never add a dependency on a paid API or service. Content authoring (quiz questions,
    Hindi text) is done by YOU, Claude Code, inside the session, in batches — not via the Anthropic API.
  - Read CLAUDE.md and docs/DECISIONS.md at the start of every session.
  - Do all research, fetching, seeding, verification, testing and committing yourself. Ask the human only
    for secrets, logins, or product decisions. If a source is unreachable, record it in docs/DATA-GAPS.md
    with what you tried and continue with the best public alternative — do not stop.
  - Every fact that lands in /data must carry { source: { name, url }, fetchedAt } and be schema-validated.
  - When unsure whether a number is official, keep it but set verify: true so the UI shows "verify with DDO".
  - Write tests for every calculation and every search. Run pnpm check (lint+types+unit+data-validate) before
    every commit. Conventional commits.
SESSION CLOSE-OUT (mandatory at the end of every session):
  1) Run every acceptance check listed in the session yourself; fix until green.
  2) Update CLAUDE.md (current status, how to run), docs/DECISIONS.md (any decision), docs/DATA-GAPS.md.
  3) Print a short summary: what was built, what was verified, anything the human must look at on a device.
  4) Commit with the given message. End with the literal line: ALL ACCEPTANCE CHECKS PASSED
     (or: BLOCKED: <reason> if truly blocked).

<!-- prettier-ignore-end -->

> **Where the built app deviates from the block above, and why.** Five colour values differ from the DESIGN
> section because each failed a contrast floor this project enforces, and one signature question it defers is
> now answered. Nothing here overrides the master context — it records what measurement forced:
>
> - `--destructive` is `#C92A1E` in light (spec `#DA3125` measures 4.48:1 as text on `--background`) and
>   `#FB8378` in dark (spec `#F2685C` measures 4.40:1 on `--muted`).
> - `--sidebar` is `#F1F5FB` in light (spec `#EFF3FA` measures 4.47:1 with `--muted-foreground`, which every
>   inactive nav label uses).
> - `--input` is split from `--border` — `#7B8BA8` light, `#6B80A4` dark — because WCAG 1.4.11 wants 3:1 for a
>   control boundary and `--border` measures 1.20:1 (ADR-007, first made for the previous palette).
> - Dark `--border` / `--input` are solid hex rather than `oklch(1 0 0 / 12%)`: a token whose contrast depends
>   on what it is composited over is a token nobody re-checks.
> - Contrast is verified by resolving the token values numerically in `src/styles/tokens.test.ts` — following
>   `var()` chains and compositing `/15` tints — rather than through `<canvas>`. Both avoid string parsing,
>   which is the point of that instruction; the token-value route additionally runs under jsdom in `pnpm check`
>   and states which pairs it checks. `tests/e2e/a11y.spec.ts` is the in-browser confirmation.
> - The pay slip's numerals are **Inter with `tabular-nums`**, not IBM Plex Mono. The DESIGN block above
>   settles the numeral question in its own words — "scoreboard numerals = Inter 800 tabular-nums" — and
>   Session 6's brief asked for a mono face for the pay slip. A fourth self-hosted family would put
>   ~25 KB of woff2 into every offline install and add a face to `tests/e2e/typography.spec.ts` to buy an
>   alignment Inter's tabular figures already give. ADR-018.
> - The Session 1B signature question is decided: the file tab is a 3px `--marigold` index tab on the active
>   module card, the same rule on the sidebar's left edge and the tab bar's top edge, plus the `SectionNumber`
>   chip. One tab per screen. Full reference: `.claude/skills/frontend-design/SKILL.md`.
>
> Every one of these is measured and recorded in ADR-010 (and ADR-007). `src/styles/tokens.test.ts` is what
> caught them and is what stops them regressing.

---

## CURRENT STATUS

> **This session builds the Library: a reading module over the corpus this app already ships.** No
> statutory text was fetched — `data/library/` is 824 KB of STRUCTURE over the 5.5 MB of statute
> already in `data/rules/text` and `data/law`. Read **ADR-038**, and `scripts/ingest/README.md`'s
> "The Library's reading structure" before touching the seed. Six things to know:
>
> 1. **A work is a POINTER, never a copy.** `data/library/works/*.json` carries a table of contents,
>    a reading order, an estimate and a citation, plus `corpus: { kind, file }` naming
>    `data/rules/text/<act>.json` or `data/law/<code>.json`. It carries no provision text at all, and
>    `test_library_seed.py` asserts the absence of a `text` key, because the alternative is a second
>    copy of a statute a dataset refresh cannot correct. The promise that buys is checked in both
>    directions by `tests/library-data.test.ts`: every unit id resolves into the pointed-at corpus,
>    AND every record in that corpus is reachable from the work.
> 2. **Three loaders, three costs.** The shelf is 11 KB and draws fifteen cards; a work is 8–220 KB
>    and draws a 531-row contents list for the BNSS **without touching its 1.9 MB corpus**; only the
>    reader pays for the corpus, and on the work page only once a search worth running has been
>    typed. `practiseCounts` is in the dataset for the same reason — answering "is there anything to
>    practise on this rule" at read time would mean downloading 1.1 MB of GFR cards.
> 3. **`tocSource` says where the structure came from, and admits `flat`.** The three Sanhitas get
>    NCRB's own chapters; CSMOP is grouped on the `4.7` numbering the manual itself prints (titles
>    unavailable, so nodes are labelled by number alone); the other eleven rule books publish no
>    division this repo holds and get one node per rule. The work page states which, in both
>    languages. `docs/DATA-GAPS.md` #70 — and closing it is a change to `extract_rules.py`, not here.
> 4. **The Hindi gap runs in BOTH directions and this surface is what made that visible.** The known
>    half: no source publishes a readable Hindi text layer, so `mode: 'hi'` renders the English under
>    a bilingual notice saying so — announced, never silent, never machine-translated. The half
>    nobody had seen: **221 units have no ENGLISH heading and do have an authored Hindi one**, because
>    four rule books print no heading `extract_rules.py` could read and Session 20 authored Hindi for
>    all of them. Nothing was invented — `library_seed.py` quotes the unit's opening ~96 characters as
>    an `excerpt`, only where a heading is missing, and `unitLabel()` (`src/lib/library/label.ts`) is
>    the one place that decides what to show and reports which language it actually returned.
>    `docs/DATA-GAPS.md` #71.
> 5. **`unit.parts` is a re-segmentation of the body, not extra content, and rendering both prints
>    the rule twice.** All 219 rules with sub-rules store them as verbatim slices of the same `text`
>    (asserted in `library.test.ts`). The first reader rendered both. The same clause also made the
>    missing-Hindi notice unreachable for exactly those 219 rules, so Hindi silently showed English
>    with no notice at all. Both were found in a real browser; neither was visible to jsdom.
> 6. **`paragraphs()` breaks a 4,000-character rule for reading, and joining the pieces back is
>    asserted over every unit of every work.** That is the only thing that makes presentational
>    splitting safe to do to a statute. Writing its Devanagari case found that `/परन्तु\b/` matches
>    nothing, ever — the ADR-035 word-boundary trap, hit again in an unrelated file.

> **This session lights up the two dormant tiers: Tier 0 runs a model on the reader's own device, and
> Tier 2 gets the Cloudflare Worker it has been waiting for since Session 3A.** Read **ADR-037** and
> **§12 of `docs/AI.md`**, and `worker/README.md` before deploying anything. Nothing above the provider
> seam changed — the four agents, `runAgent`, the tool registry and every surface are untouched, which
> is the claim the seam existed to make. Six things to know before touching any of it:
>
> 1. **Tier 0's tool calls are emulated in the PROMPT, and the parser is strict about exactly one
>    thing.** A quantised 1.5B model has no tool-calling wire format, so `src/ai/local/protocol.ts`
>    teaches one — `{"tool": …, "input": …}` or `{"answer": …}`, one object per turn — and reads it
>    back into the same `ContentPart[]` `wire.ts` builds from Anthropic's SSE. A turn is a tool call
>    **if and only if it names a tool**; whether that tool exists and whether the arguments fit its
>    zod schema are `runAgent`'s to decide, and it already has a one-round recovery path for both.
>    Two validators disagreeing means the one further from the model wins silently.
>    `LOCAL_MAX_TOOL_STEPS` is **2**, counted from the transcript rather than from a field on the
>    provider — the provider outlives a run.
> 2. **`fitFor()` in `src/ai/local/webgpu.ts` says what it does not know.** WebGPU exposes no
>    video-memory figure by design, so the guard is a floor, not a prediction. `navigator.deviceMemory`
>    is quantised AND **capped at 8** in every browser that reports it, so a value at the cap is
>    treated as absent — the first version compared against it unconditionally and warned about both
>    3B models for the majority of readers who can run them fine. Its own test caught that.
>    `loadFailureMessage()` is what turns the real failure ("Device lost") into a sentence naming a
>    smaller model.
> 3. **`CONSENT_VERSION` is 2.** Nothing the reader TYPES leaves the device on Tier 0, but the model
>    itself arrives once from `huggingface.co`, and version 1's notice described a tier that did not
>    exist. Two consequences worth knowing: `estimateCost()` returns 0 for any id in
>    `src/ai/local/catalogue.ts` (otherwise `resolveModel()` prices it at Sonnet's rate and shows a
>    dollar figure for tokens nobody was billed for), and `runAgent` skips the monthly ceiling when
>    `tier === 'local'` — that ceiling is a SPENDING cap, and there is a test on the negative side so
>    "skipped for local" and "never enforced" cannot be the same passing test.
> 4. **Tier 2's row is HIDDEN in a build with no `VITE_AI_PROXY_URL`; Tier 0's refusals stay visible.**
>    ADR-030's "disabled with a reason, never hidden" rule is narrowed rather than dropped, and the
>    line is *who can act*: Tier 0 tells the reader about their own graphics card, "not configured in
>    this build" is about somebody they have never met. `tierPickable()` is that question,
>    `tierAvailable()` is the other, and the consent modal filters on the first one too.
> 5. **`worker/` is a separate package on purpose** — its own tsconfig, its own lockfile, its own CI
>    job (`ci.yml`, job `worker`), and NOT part of the app's install. `pnpm check` does not cover it.
>    Its four guards (origin, per-IP rate limit, model allowlist, daily token budget) are pure
>    functions in `policy.ts` tested by calling them; `test/worker.test.ts` runs the same Worker in
>    **miniflare** and proves the wiring — that the outbound request carries the operator's key and
>    NONE of the caller's headers, and that SSE streams through rather than buffering. 42 tests, no
>    network.
> 6. **`@mlc-ai/web-llm` is 2.1 MB gzip and three mechanisms keep it off everyone else's device**, all
>    of which need to NAME the file — hence the fixed `manualChunks` name `web-llm`: `globIgnores`
>    keeps it out of the service worker's precache, `scripts/size-budget.json#chunkExemptions` records
>    why it is past the per-chunk budget, and `tests/no-external-urls.test.ts` confines its three hosts
>    to that one chunk. The CSP moved with it (`'wasm-unsafe-eval'`, the model hosts, the Tier 1
>    endpoint), which closes `docs/DATA-GAPS.md` #57 and #61; #68 and #69 are what is left open.

> **This session builds the law research agent — the second agent this app runs, and the first that
> answers in prose.** `src/ai/agents/law.ts`, `src/ai/prompts/law.md` (bilingual, in the cached
> prefix, so `PROMPT_VERSIONS['law-explain']` is bumped 1 → 2 in the same commit), and the "Ask"
> surface in the Law Converter (`src/modules/law/components/AskPanel.tsx`, mounted behind
> `React.lazy` AND `lawAiAvailable(useAi().enabled)`). Read **ADR-035** and **§7A of `docs/AI.md`**.
> Four things to know before touching any of it:
>
> 1. **It is TWO model passes and that is forced, not chosen.** `validateCitations()` rejects a
>    provision number that appears in no CITED CONTEXT SNIPPET, and tool results are not context
>    snippets. So a single pass that calls `get_section` and then writes "Section 103 of the BNS"
>    fails its own citation check every time. Stage 3 turns the tool results INTO numbered,
>    type-labelled snippets and the answer pass writes from those alone. **Any future agent that
>    answers in prose hits the same wall — start from this shape rather than rediscovering it.**
> 2. **The answer pass is the one place in this app where `groundedRequired` is off**, and
>    `docs/AI.md` §11 requires an ADR for that. ADR-035 §1 is it: that pass has no tools, so the
>    rule is unsatisfiable by construction. Four checks replace the one, all in code —
>    `validateCitations` called by the agent itself with `requireCitation: true` over the answer
>    text; every number named in `answer` must be in `citations[]`; every citation re-derived from
>    the tool result that actually contains it (a wrong handle is corrected and reported, an
>    unsupported one dropped); and `format_citation` must find the section at all.
> 3. **A First Schedule row is labelled `(classification, BNSS First Schedule: BNS 318)`, never
>    `(section …)`.** BNS 103's heading is "Punishment for murder", which reads like an answer about
>    punishment and cannot settle bail. Two new `SnippetType` members, `classification` and
>    `mapping`, exist for exactly that. Stage 3 also writes a provision inside a snippet as
>    `Section 318(4) of the BNS` rather than `BNS 318(4)`, because `validateCitations` only
>    extracts the full sub-section after the word "section" and its bare-numeral fallback splits
>    `318(4)` into `318` and `4`.
> 4. **The offence-date rule and the disclaimer are stated by the APP, in both languages, always.**
>    `dateRuleCaveat()` is pure and is the first caveat; `LAW_DISCLAIMER` is the last;
>    `prompts/law.md` tells the model to write neither. The converter already holds the date, so
>    this is a fact the app knows rather than an instruction the model was given.
>
> The screen here is deliberately NARROWER than the drafting agent's: `screenLawQuestion()` refuses
> a departmental RECORD (an FIR, case, diary, charge-sheet or crime number, each pattern requiring a
> digit) and does NOT refuse the words "secret" or "classified", because "which BNS section covers
> communicating secret information" is a question about published statute. Advice about a person's
> case is a **steer, not a refusal** — `caseAdviceSteer()`. There is no per-question acknowledgement
> gate, and ADR-035 §5 says why. With AI off — every device's default — nothing renders.
> `docs/DATA-GAPS.md` #66 and #67 are what is left open.

> **This session (concurrent with the one above, same working tree) builds the third and fourth
> agents — the Rules Trainer's coach and the Pay calculator's explainer.** `src/ai/agents/tutor.ts`
> ("Explain" after a wrong answer, "Give me a scenario on this rule", the weekly focus plan) and
> `src/ai/agents/pay.ts` ("Explain my payslip", "Compare these two posts for me"). Read **ADR-036**
> and **§7B of `docs/AI.md`**. The one thing to know before touching either: every entry point but
> one is a SINGLE `runAgent` pass with `tools: []` — this file calls `get_rule_text`/
> `get_card_history`/`get_user_weak_areas`/`compute_pay_for_job`/`explain_pay_line`/
> `get_allowance_source`/`compare_jobs` itself, in code, before the model runs, and hands the real
> result back as numbered context. That sidesteps the exact wall ADR-035 hit from the other
> direction (`validateCitations` rejects a number that appears in no CITED CONTEXT snippet, and a
> tool result is not one) without needing a second model pass, because none of these reads needs a
> round of research to know what to fetch. `proposeScenario` is the one WRITE and the one real tool
> loop, since only the model can author a scenario's wording — and its confirmation is read back
> from `propose_card`'s own result, never claimed by the model (ADR-032's lesson, applied again).
> `ungroundedFigures()` and `containsRecommendation()` are the two checks a persona alone cannot
> enforce: a rupee figure or percentage the answer states must appear in what was actually computed,
> and a comparison may never favour one post over the other. Both fail the run closed rather than
> silently letting a plausible-sounding sentence through. `CardView.tsx` gained one prop,
> `onAnswered`, so "Explain" appears only after a genuinely wrong answer, in the reader's own
> language, never re-derived. With AI off — every device's default — none of the four new surfaces
> renders, and `tests/e2e/ai-tutor.spec.ts`/`ai-pay.spec.ts` assert it.

> **Session 21 turns the AI layer on, in exactly one place.** The layer has been
> built and dormant since Session 3A; this session writes the first agent
> (`src/ai/agents/drafting.ts`), the first system prompt file
> (`src/ai/prompts/drafting.md`, bilingual, in the cached prefix), one new tool
> (`lookup_glossary_term`, scope `utils`), and the first AI surface — "Draft with AI" in the
> Drafting Studio's editor. Read **ADR-032** and the rewritten §7 of `docs/AI.md`. The three
> things to know before touching any of it: the agent produces FIELD VALUES and lets the engine
> lay them out, so three of its five stages are code rather than the model; the checklist it
> reports is one it evaluated itself over the values it is returning, never one the model claimed;
> and a brief naming classified or departmental material is refused by `screenBrief()` **before
> the provider is constructed**, which the tests prove by counting `MockProvider.calls`. With AI
> off — every device's default — nothing renders and no chunk is fetched, asserted in
> `tests/e2e/draft.spec.ts`. ADR-021's "Tier 0 first" condition is superseded, deliberately and
> in writing. `docs/DATA-GAPS.md` #61 is the one thing a reader will hit on the deployed site.

> **Session 20 (concurrent with the session above) is the rules-bank expansion `docs/AUTHORING.md`
> named "where Session 20 continues," plus the law module's Hindi-heading gap.** It authored Hindi
> headings for the four rule books that had none (`ccs-pension`, `gfr`, `fr-sr`, `csmop`, 582
> headings), hand-reviewed the 529 generated cloze cards that unlocked, ran ~275 new questions
> through the four-stage pipeline for six more acts plus a ten-question scenario batch each for
> `ccs-conduct`/`ccs-cca`/`ccs-leave`, and extended `data/law/overlays/` from 94 curated BNS
> sections to full Hindi-heading coverage of all 1,059 BNS/BNSS/BSA sections plus Hindi punishment
> text for every classified BNS section. Read **ADR-033**. Rule cards served: 571 → 1,595; reviewed
> cloze: 340 → 869; reviewed authored questions: 141 → 351. Two things worth knowing before
> touching either surface again: fixing `make_cards.py`'s `_unanswerable()` check (it had a heading-
> only blind spot that could never fire for a book printing no headings at all, which is exactly
> what let eight identical "Deleted — which rule?" FR/SR cards ship) surfaced MORE genuinely
> ambiguous rules than it used to catch — `docs/DATA-GAPS.md` #62 has which acts that leaves short
> of literal 100% rule-card coverage and why closing the rest is real work, not a quick pass; and a
> Hindi-quality review of `src/i18n/hi.json` was dispatched and cut off by a session rate limit
> before it reported anything — `docs/DATA-GAPS.md` #63/#64 are what is still open there. BNS
> classification coverage needed no new data: every one of the 70 unclassified BNS sections has no
> punishment field at all (definitional/general provisions the First Schedule correctly does not
> classify), so all 288 sections that carry a punishment already carry a classification.

> **Session 15 is a test-hardening pass, not a feature.** It ran concurrently with two
> other sessions in the same working tree — one finishing the command palette's edge cases, one
> doing performance, CSP and deployment — and coordinated with both directly, the same arrangement
> Sessions 12/13 and 14 used. What it changed: coverage over `src/lib/**` is now a 90% gate that
> measures 99.73%; property-based tests (`fast-check`) cover pay rounding invariants and FSRS grade
> monotonicity; the end-to-end suite runs on two Playwright projects (desktop and a Pixel 7) with
> the brief's eight journeys in BOTH languages; the zero-network privacy rule is an automatic
> fixture that no spec can forget, enforced in turn by a unit test; axe sweeps 21 routes × 2
> languages × 2 themes with keyboard-only and reduced-motion runs beside it; CI is four jobs with
> cached browsers and traces on failure; and `docs/TESTING.md` is the reference for all of it. It
> also split the i18n catalogues so one language loads at boot rather than two, which is what
> actually closed `docs/DATA-GAPS.md` #55. Read **ADR-031**. Three real defects were found by the
> layers added to find them and are listed there.

**Sessions 1, 3A, 2, 4, 5, 6, 7, 8 and 9 complete — application shell, a fully built and fully
dormant AI layer, the complete law dataset with the Law Converter built over it, the complete pay
dataset with the Pay & Allowances Calculator built over it, the CSMOP 2022 templates, Rajbhasha terms
and drafting engine with the Drafting Studio built over them, and the Rules Trainer's whole content
pipeline — twelve rule books extracted into 818 rules, 2,607 cards, 571 of them served. Session 11
adds the Trainer's scheduler: `src/lib/srs`, FSRS over `ts-fsrs` 5.4 with the schedule in Dexie v7.
Session 12 builds the Trainer's UI over it — Home, a review session over all five card kinds, a
timed mock test with a `recharts` results chart, Browse, Bookmarks, Reports, Settings and the Local
Review Queue (`/learn/*`) — plus four AI tools (`src/ai/tools/rules.ts`) and a local, best-effort
daily reminder; `ts-fsrs` is finally in a chunk. Session 10 built Utilities' first tool: the
Hindi administrative glossary, `data/glossary.json` (1,891 compiled terms) with search, category
filter, favourites and recents at `/utils/glossary`, plus a second "Full glossary" tab in the Drafting
Studio's own glossary sheet and a `useGlossarySuggest` hook in its body editor. Session 13 finishes
Utilities: the DoPT holiday calendar with restricted-holiday picks and an `.ics` export at
`/utils/holidays`, the CCS (Leave) Rules 1972 leave calculator at `/utils/leave`, retirement & pension
(superannuation date, NPS/UPS, gratuity, commutation, GPF) at `/utils/pension`, and the portals &
helplines directory at `/utils/portals` — every "coming later" card on the Utilities hub now links
somewhere real. Sessions 12 and 13 ran concurrently in the same working tree; read ADR-026 and
ADR-027 for how that was coordinated and what each left for the other to fix. Session 14 adds
first-run onboarding (`/onboarding` — language, an optional post + city that prefills Pay and can
narrow the Trainer's rule books, a three-promise privacy step) and finishes Settings: a global
Devanagari-digits toggle (now actually wired into the Drafting Studio, which had carried the engine
support with no control since Session 8), a daily-reminder shortcut to Trainer settings, "Check for
data updates" (a second, narrowly-scoped `fetch` exemption — ADR-028), export/import/erase and an
About card with a data-sources table. It ran concurrently with a second session building a global
command palette (Ctrl/⌘-K — Law sections, Job posts, Glossary, Document types, Trainer topics, Portals
and Settings actions, each reusing its own module's existing search rather than a second one), global
keyboard shortcuts (`g` + a letter to jump modules, `?` for help, `/` to focus a page's own search) and
"Copy link"/"Share" on glossary entries and Trainer topics, in the same working tree; each coordinated
directly with the other rather than guessing from file diffs, the same arrangement Sessions 12/13 used
— read ADR-029 for that session's own decisions and the three real bugs a real browser caught that no
unit test could (an ambiguous law section number, a global-shortcut listener race, an intermittent
axe failure).**

| Area            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain       | pnpm 9.15.9 via corepack, Node 24 (ADR-002), TypeScript 7.0 native compiler, strict + `noUncheckedIndexedAccess` (ADR-009)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Design system   | Neev tokens in `src/styles/tokens.css` — Tailwind 4 CSS-first (`@theme inline`, `@custom-variant dark`). Light is `:root`, dark only on `.dark` from the toggle (ADR-010). 85 contrast assertions in `tokens.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Fonts           | `@fontsource` Inter / Poppins (Latin only) / Noto Sans Devanagari, bundled by Vite. `public/OFL.txt` generated by `pnpm fonts:licenses`. No runtime third-party request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| i18n            | 1,237 keys × {en, hi} at last count (up from 1,120 — Session 26's `library.*` block is 117 keys and the newest; before it, the law session's `law.ask.*` block (37 keys) and this session's `pay.ai.*`/`trainer.ai.*` blocks are the newest; the figure moves with whichever concurrent session's work landed most recently — check `pnpm i18n:check`'s own output for the live number), typed via module augmentation, `fallbackLng: false`. Nav labels live in `src/lib/nav.ts` as `{ en, hi }`. The `pay.*` block is still the largest single one (186 keys); a new top-level `trainer.*` block (160 keys — Session 12, the whole Trainer UI), Session 13's `utils.holidays.*`/`utils.leave.*`/`utils.pension.*`/`utils.portals.*`, Session 14's new `onboarding.*` block plus `pages.settings.digits`/`.reminder`/`.updates`/`.backup`/`.erase`/`.about`/`.dataSources`, and the concurrent command-palette session's `palette.*`/`shortcuts.*` blocks plus `a11y.openCommandPalette`/`utils.glossary.share`/`.linkCopied`/`trainer.browse.copyLink`/`.linkCopied`/`.linkCopyFailed`, are the newest. **Since ADR-031 the two catalogues are no longer static imports**: `src/i18n/index.ts` loads them through an i18next `backend` plugin that dynamic-imports one language, so `en` and `hi` are their own chunks (17.3 / 22.2 KB gzip) and only the ACTIVE one reaches the browser at boot. Adding a key therefore no longer grows the initial route at all — which was the mechanism behind `docs/DATA-GAPS.md` #55, now resolved. `src/main.tsx` awaits the exported `i18nReady` before `createRoot` (with `useSuspense: false` nothing holds the tree back, so without it the shell paints one frame of raw keys) and `store.ts`'s `applyLanguage` returns i18next's promise so `setLanguage` resolves only once the language is applied; `<html lang>` is still set synchronously. Both chunks stay precached, so an offline language toggle is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Persistence     | Dexie **v11** (up from v6 — v7 is the Trainer scheduler, ADR-025; v8 is the Trainer UI's bookmarks/reports/review-queue tables, ADR-027; v9 adds `holidayPicks`, keyed `"<year>:<holidayId>"`, indexed on `year` — Session 13's restricted-holiday picks; v10 adds `commandRecents`, keyed on the item's own id, capped at 8, populated only for results that navigate — never a settings action like "toggle theme" — Session 14's command palette, ADR-029; v11 adds the Library's four reading tables — `libraryProgress` and `libraryBookmarks`, both keyed `"<workId>:<unitId>"` because a law unit id is a bare section number unique only within its own code, and `libraryHighlights`/`libraryNotes`, declared and written by nothing until Session 27 the way v2 declared the AI tables, ADR-038). `settings`, `secrets` / `aiAnswers` / `aiUsage` (AI, empty until turned on), `lawFavourites` / `lawRecents`, `payScenarios` (up to 10 named, and an eleventh is refused rather than evicting one), `drafts` (uncapped — a draft is work, not a comparison set — with an undoable delete), `draftDefaults` (one saved letterhead per form) and `glossaryFavourites` / `glossaryRecents` (Session 10, the same `{id, createdAt}` / `{id, viewedAt}` shape the law tables use). Settings rows: language, theme, `ai`, `pay` (the last scenario), `learnReminder`, (Session 14) `onboarded` / `devanagariDigits` — plain booleans, no new table needed — and (Session 26) `library`, the reader's own type and language controls. Store hydrates from it and tolerates blocked storage. Dexie v7's four trainer tables — `srsCards` (keyed `qId`, indexed on `due`), append-only `reviewLog`, `streaks` (keyed on an **IST** date) and a one-row `trainerSettings` — have their row shapes declared in `src/lib/srs/types.ts` and imported here as types (ADR-025). Dexie v8 adds `trainerBookmarks` and `cardOverrides` (both keyed on `qId` alone — a decision about one card, not a log) and the append-only `trainerReports` / `proposedCards` (ADR-027)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Shell           | 7 lazy routes from the one `src/lib/nav.ts` config (the Library is the seventh — deliberately NOT flagship, so it enters the "More" sheet below 768px and nothing was pushed out; `shell.edge.test.tsx` asserts the four flagship ids BY NAME, because a swap keeps the count at four): sidebar ≥1024px, bottom bar below (4 tabs + a "More" sheet under 768px), skip link, landmarks. Active state = 3px gold rule on the chrome edge + semibold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Components      | `src/components/ui-x/`: Chip, Badge, ProgressBar, InfoCard, SectionCard (the file tab), SectionNumber, StatCard, Skeleton, QueryErrorState, Breadcrumbs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Law Converter   | **"Ask" (this session; an edge-case pass after the commit found eight defects — ADR-035's addendum, `src/ai/agents/law.edge.test.ts` and `src/modules/law/askPanel.edge.test.tsx`): an input under the search when AI is on, a live-region progress list and a streaming answer, `[n]` marks and a source row that are both buttons opening the cited section's card below, "copy answer with citations" (the marks, a numbered source list and the disclaimer travel together), and a "why can't it answer" note naming the grounding rule when a run is discarded. `useLawAsk.ts` dynamic-imports the agent on the press, not on the render.** `/law` search (section numbers incl. Devanagari digits, English, Hindi, roman-Hindi, Act names in both scripts) and **browse** — a code chip with an empty box reads that Act end to end, "All" reads all three. Sticky list beside the open section from 1024px, stacked below it. Old-vs-new card with a word-level heading diff, the First Schedule table, trap banners, bilingual citations, share / save / print / close. Offence-date rule on the 1 July 2024 boundary. The whole view lives in the URL (ADR-013, ADR-015)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pay calculator  | `/pay`, four tabs, the whole view in the URL. A `cmdk`-shaped combobox over 67 posts (acronyms included — "ACIO" finds a post whose title never says it) and 102 cities with aliases; Level select showing grade pay, cell stepper showing basic; DA select prefilled from the latest **notified** rate with the projection offered and labelled; payslip card with a "why" disclosure on every line that prints open on A4; simulations (increment, FR 22 fixation, 8th CPC behind a non-dismissible projection banner, DA what-if); two-post diff and private-vs-government. Pure engine in `src/lib/pay` (ADR-018). This session adds two AI actions, off with everything else by default: `PayExplainPanel` ("Explain my payslip", beside the slip, hidden without a post picked) and `PayCompareAiPanel` ("Compare these two posts for me", on the compare tab) — `src/ai/agents/pay.ts`, ADR-036 |
| Modules         | **Law Converter, Pay & Allowances, the Drafting Studio and Utilities are all built** (rows above and below) — Utilities' fifth and last tool, portals, landed this session alongside holidays/leave/pension, so `UtilsHubPage` no longer has a "coming later" card. **Trainer is built too** — its data, its scheduler (ADR-025) and now its UI (ADR-027): Home, review, mock tests, Browse, Bookmarks, Reports, Settings and the Local Review Queue at `/learn/*`. **The Library is the sixth module** (`/library`, ADR-038) — the rows below |
| AI layer        | **All three activation tiers now work (ADR-037): Tier 0 on-device via `@mlc-ai/web-llm` 0.2.84 (`src/ai/providers/local.ts` + `src/ai/local/{catalogue,webgpu,protocol,engine}.ts`, five curated models 0.9-2.5 GB, emulated tool protocol capped at two steps, WebGPU probe and memory guard, resumable Cache-API download with progress/cancel/unload/delete in Settings), Tier 1 BYOK, and Tier 2 behind `worker/` — a standalone Cloudflare Worker package with its own tests and CI job. `CONSENT_VERSION` is 2. `AiSettings` gains `localModel`/`localModelInstalled`. The web-llm chunk is 2.1 MB gzip, named `web-llm` by `manualChunks`, kept out of the precache and confined to itself by `tests/no-external-urls.test.ts`.** `src/ai` — still **off by default** (ADR-011, `docs/AI.md`), and **four surfaces use it**: the Drafting Studio (Session 21, ADR-032), the Law Converter's "Ask" (this session, ADR-035), and the Rules Trainer's coach plus the Pay calculator's explainer (concurrent session, ADR-036 — `src/ai/agents/tutor.ts` and `pay.ts`; no new tool or `prompts/*.md` file, both personas just grew a sentence, so `PROMPT_VERSIONS['trainer-coach']`/`['pay-explain']` each bump 1 → 2). Second agent: `src/ai/agents/law.ts`; second prompt file: `src/ai/prompts/law.md`, also in the CACHED prefix, so editing it means bumping `PROMPT_VERSIONS['law-explain']` (now 2) in the same commit. `src/ai/context.ts`'s `SnippetType` gained `classification` and `mapping` for it — a BNSS First Schedule row must not be labelled the way a section heading is. Twenty-THREE tools now: the twenty-two below plus `lookup_glossary_term` (scope `utils`, over `data/glossary.json`'s 1,891 terms — deliberately disjoint from `lookup_admin_term`'s 78 CSMOP structural terms, which is why a drafting agent needs both; "Under Secretary" is a structural term and is NOT in the glossary). First agent: `src/ai/agents/drafting.ts`. First prompt file: `src/ai/prompts/drafting.md`, passed through `buildSystem({ instructions })` into the CACHED prefix — so nothing in it may vary per reader or per language, and editing it means bumping `PROMPT_VERSIONS['draft-assist']` (now 2) in the same commit. Original description follows. Consent gate _is_ the feature flag; four tiers (`byok` works, `local` / `proxy` shown disabled with a reason); AES-GCM key vault; agent loop with step cap, zod validation, per-tool timeouts, a hard monthly token budget and grounding that fails closed; tool registry with an MCP-shaped JSON export; numbered type-labelled context + citation validation; bilingual heuristics; local answer cache. Twenty-two tools registered: five over the statute, five over pay, **six over drafting** (`src/ai/tools/drafting.ts` — templates and CSMOP rules only; nothing registered can reach the reader's `drafts` rows, and a test asserts it), **four over the Trainer** (`src/ai/tools/rules.ts` — `get_rule_text`, `get_user_weak_areas`, `get_card_history`, and `propose_card`, the one tool in the app that WRITES, to `proposedCards`, never directly to the schedule, ADR-027), two common. Lazy-loaded: **+5.9 KB gzip** on the initial route, essentially all of it consent copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PWA / offline   | `vite-plugin-pwa` (`generateSW`, `registerType: 'prompt'`); manual `workbox-window` registration + bilingual update/offline-ready toasts (`src/app/pwa.tsx`); real service-worker-era `OfflineBadge`; installable (Lighthouse PWA category 1.0 via a one-off `lighthouse@9` run — ADR-008)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Test harness    | `tests/e2e/fixtures.ts` is the whole end-to-end harness and the enforcement of the master context's zero-network rule. Import `test`/`expect` from THERE, never from `@playwright/test`: an `{ auto: true }` `network` fixture arms for every test and fails it at teardown if any request crossed the origin, or if any request URL, query string or **body** contained a value the test typed. Typed values come from `network.sentinel('label')` → `SNTNL-<label>-<n>`, not realistic input — `"302"` and `"Delhi"` occur in chunk filenames by coincidence, and a privacy assertion with false positives gets weakened until it has false negatives. The listener is on the browser CONTEXT, not the page, so a service-worker request escapes nothing. One declared exception: `ai-byok.spec.ts` calls `network.allowCrossOrigin(/api\.anthropic\.com/)`, because Tier 1 IS that request. `tests/e2e-harness.test.ts` (a unit test, so it runs on every commit) fails any spec that bypasses the fixture; its `UNGATED` map holds the one exemption, `csp.spec.ts`, with the reason. The file also exports `t(language, key)` (reads `src/i18n/*.json`, so a renamed key fails rather than silently asserting a stale string), `setLanguage` (idempotent, waits for the IndexedDB row not the DOM), `showPreviewPane`/`showFormPane` (the Drafting Studio is two TABS below 1024px), `onPhone`, `audit`/`settle` and `dismissPwaToasts` (ADR-031) |
| Tests           | 1,346 unit across 58 files + 82 Playwright e2e, the law ones run at four viewports. The law suites read the committed `data/law/*.json` off disk — dataset coverage, ranking against a 50-query bilingual acceptance set (`tests/fixtures/law-search.ts`), every "What's new" bullet resolved and its claim checked. `tests/pay-data.test.ts` reads `data/pay/*.json` off disk the same way — 95 assertions, every one confirmed to fail against a deliberately corrupted copy (ADR-016 addendum). `src/lib/pay/*.test.ts` holds 73 golden pay slips whose figures were worked out from the orders before the code ran. e2e adds an offline section lookup AND an offline pay calculation, both with no network at all, a real-input privacy run, the keyboard path, and axe over every route × 2 languages × 2 themes plus the three non-default pay tabs. `tests/drafting-data.test.ts` renders all fourteen committed templates in both languages and in Devanagari digits and runs each one's own checklist over the result; `tests/drafting-render.test.ts` snapshots the Office Memorandum and a note on a file as `.txt` files, because the thing under test is the shape of a page. Session 8 adds `src/lib/drafting/docx.test.ts` (the packed archive unzipped with Node's own zlib and read: A4, 1-inch margins, both font slots, Devanagari intact, well-formed XML against a hostile subject line, all fourteen templates in both languages), `src/modules/drafting/drafting.test.ts` (46 over the bilingual value model, the URL, the drafts table and the suggestion diff) and `src/ai/tools/drafting.test.ts` (29, through the registry so the zod schemas run). e2e adds `tests/e2e/draft.spec.ts`: one run that writes an O.M., clears the checklist, exports a real `.docx` and reads the file off disk, switches the preview to Hindi, reloads into the restored draft — with a request counter armed across the whole flow — plus an offline editor run, and axe now covers `/draft/office-memorandum`. Session 10 adds `tests/glossary-data.test.ts` (reads `data/glossary.json` off disk the same way the other dataset suites do — count floor, no duplicate ids/English terms, no overlap with `structure-terms.json`, every `hi` real Devanagari, fails against a corrupted copy), `src/modules/utils/glossary/{search,useGlossarySuggest,favourites}.test.ts` (34 tests, including the roman-Hindi "avar sachiv" search case) and `tests/e2e/glossary.spec.ts` (search, category filter, favourites/recents surviving a reload, the render cap, the Drafting Studio's Full glossary tab and the body editor's replace-suggestion chip), plus one offline lookup and one clipboard/IndexedDB privacy run added to the existing offline and zero-third-party-requests specs. **1,744 unit tests as of Session 13** (the 1,346 figure above predates both this session and Session 12's Trainer UI, ADR-027). Session 12 adds `src/modules/trainer/{reviewQueue,store,reminder,intervalLabel}.test.ts` (over the local-override merge, the bookmarks/reports/review-queue Dexie helpers, the best-effort reminder's pure decision logic and the grade-button interval labels) and `src/ai/tools/rules.test.ts` (through the registry, against the real committed `data/rules`), plus `tests/e2e/learn.spec.ts` — one run asserting the brief's own acceptance flow by NAME (CCS (Conduct) Rule 1, then Rule 2 — the first two approved cards a fresh device with no history will ever show, not a fixture) with a language toggle mid-card and a request counter armed throughout, a completed mock test, and an offline review session — and extends `tests/e2e/a11y.spec.ts` / `tests/e2e/zero-third-party-requests.spec.ts` over the new routes. Session 13 adds `src/lib/holidays/engine.test.ts` (25, including the .ics export's CRLF framing, per-event UID uniqueness and text escaping), `src/lib/leave/engine.test.ts` (12, including EL/HPL credit landing exactly on the half-yearly figures and the 300-day cap holding once credit exceeds it either side of a leave-taken deduction) and `src/lib/pension/engine.test.ts` (21, including the DoB-on-the-1st superannuation edge case in both directions across a year boundary, the gratuity ceiling's DA-linked uplift, and the UPS Rs. 10,000 floor) — no `tests/e2e/*.spec.ts` was added this session, since none of Session 13's own acceptance checks named one and the generic offline/zero-network specs already sweep every route. Session 14's command-palette session adds `src/components/palette/{sections,recents}.test.ts` (the hand-rolled Document-type/Trainer-topic/Portal matchers and the recents table's trim-to-8, since Law/Pay/Glossary results already have coverage through the engines they reuse) and `tests/e2e/palette.spec.ts` — ten specs covering every acceptance-test query ("hatya", "ACIO", "avar sachiv", "OM"), every global shortcut, and that none of them fire while typing — plus two new `tests/e2e/a11y.spec.ts` runs (the palette empty and with results, the shortcuts-help sheet), a palette run in `tests/e2e/zero-third-party-requests.spec.ts`, and a share-link round trip added to `tests/e2e/glossary.spec.ts` and `tests/e2e/learn.spec.ts` each (ADR-029). **Session 15 is the test-hardening pass, and `docs/TESTING.md` is now the reference for all of it** — how to run each suite and what each one guarantees. 1,925 unit tests across 97 files; 285 Playwright across TWO projects (`desktop-chromium` and `mobile-chromium`, Pixel 7). Coverage is thresholded at 90% of lines/functions/statements over `src/lib/**` in `vite.config.ts` and measures **99.73%**; `docs/COVERAGE.md` is generated by `scripts/coverage-summary.mjs`, committed, and diffed by CI. New: `tests/e2e/fixtures.ts` (the automatic privacy gate — see the row below), `tests/e2e-harness.test.ts` (a UNIT test that fails if any spec bypasses it), `tests/e2e/journeys.spec.ts` (the brief's eight journeys × both languages × both projects, every label read from the i18n catalogue through `t()`), `tests/e2e/keyboard.spec.ts` (keyboard-ONLY runs — no `click()`, no `fill()` — plus `prefers-reduced-motion` asserted against computed style with a negative case, and every copy confirmation asserted to be inside a live region), property tests in `src/lib/pay/rounding.property.test.ts` and `src/lib/srs/fsrs.property.test.ts` (`fast-check`; FSRS grade monotonicity over arbitrary review histories), and `src/lib/{istDay,useAsync}.test.ts(x)` + `src/lib/pay/{format,rates}.test.ts`. `tests/e2e/offline.spec.ts` now reloads EVERY route with no network; `tests/e2e/a11y.spec.ts` sweeps 21 routes × 2 languages × 2 themes (ADR-031). **Session 21 adds** `src/ai/agents/drafting.test.ts` (28, against `MockProvider` and the REAL committed templates — the exact tool sequence including the two calls the agent makes itself, a passing checklist, a preserved `____` blank, the refusal path with `provider.calls` asserted empty, the revision kept, the revision refused for being worse, and `turnsTaken` proving it revises at most once), `src/ai/tools/glossary.test.ts` (8, including the assertion that "Under Secretary" is NOT in this dataset), `src/modules/drafting/components/AiDraftPanel.test.tsx` (8, the panel driven end to end against `MockProvider` through `ai.provider`, including a per-field diff applied and a fully-rejected one that must come back unchanged), two `src/lib/diff.test.ts` cases for the new `exact` option, `tests/e2e/ai-draft.spec.ts` (AI turned on through Settings, the panel axe-swept gated and open, and NO `allowCrossOrigin` declared so the automatic gate proves nothing is sent) and one AI-off spec in `tests/e2e/draft.spec.ts`. `src/ai/agents/drafting.live.test.ts` is the one suite that reaches the network and it is skipped unless `AI_LIVE=1` AND `ANTHROPIC_API_KEY` are both set. **An edge-case pass after the commit adds** `src/ai/agents/drafting.edge.test.ts` (7) and `src/modules/drafting/aiPanel.edge.test.tsx` (2) — seven defects, each confirmed to fail against the committed code first (ADR-032's addendum). **Session 26 (the Library) adds** `tests/library-data.test.ts` (203 — the schema over all sixteen committed files, and the POINTER in both directions: every unit id resolves into the pointed-at corpus and every record in that corpus is reachable from the work; plus a negative block that breaks a work four ways), `src/lib/library/library.test.ts` (90, against the real corpora off disk — including the join-back guarantee for `paragraphs()` over every unit of every work, and the sub-rule containment property that is the reason the reader does not render `parts`), `src/lib/library/data.test.ts` (12, through the real `?raw` specifiers, because a mistyped path in that map is a work that opens onto an error and nothing reading the files with `node:fs` would see it), `scripts/ingest/test_library_seed.py` (22 stdlib-unittest, over the seed's pure helpers and each way `self_check` refuses a broken work) and `tests/e2e/library.spec.ts` (5 × 2 projects — the brief's own flow: open a work OFFLINE, read three units, reload, and "continue reading" returns to the third; plus search, `j`/`k`/Home, the missing-Hindi notice and a Hindi run). Three new routes joined both sweeps. **2,634 unit tests across 132 files; 329 Playwright** |
| Law data        | `data/law/{bns,bnss,bsa}.json` + `index.json` — 1,059 sections covering every one of BNS 1-358, BNSS 1-531 and BSA 1-170, full English text, 288 BNS sections classified from the BNSS First Schedule, reverse index over IPC/CrPC/IEA with number-swap warnings. 3.9 MB, reaching the browser as `?raw` chunks and precached (ADR-012, ADR-013)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ingest          | `scripts/ingest/` (Python 3.12): `ncrb_sankalan.py` weekly, `indiacode_seed.py` by hand only, `pay_matrix.py` by hand (`--check` in CI), `drafting_seed.py` by hand (`--check` in CI), `validate_data.py` over all 32 datasets in CI — it fails on a dataset that is in neither its manifest nor its stated no-schema list, so a new file cannot go unvalidated. 67 stdlib-`unittest` tests. Inline-HTML parse with a `pdfplumber` fallback measured at 99.4% agreement, hand-curated overlays the cron cannot write to, an 86-term bilingual offence lexicon. Run by `ci.yml` and by the refresh workflow before it touches `data/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pay data        | `data/pay/` — 11 datasets, 1.2 MB, reaching the browser as `?raw` chunks and precached (ADR-018). The whole 7th CPC matrix (19 levels, 540 cells, generated from the gazette rule and checked against the scan); 22 Dearness Allowance rates from nil to 60% plus one flagged projection; 102 X/Y cities from the DoE annexure with aliases and the four Delhi-rate towns; 32 allowances with rates, tax position and DA-escalation; 67 posts, each resolving to a Level and a set of allowance ids; CGHS, CGEGIS, NPS, UPS; income tax for FY 2026-27 both regimes; and 8th CPC status facts with no matrix (ADR-016)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pay sourcing    | 10 of 32 allowances, the matrix and every city are read from a fetched order; the rest carry `verify: true` with `docs/DATA-GAPS.md` #23-#32 naming the order that would settle each. The 899-page 7th CPC report is the one pay source with a text layer; every DoE order is a scan, read by rendering and recognising and then checking by eye                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Drafting data   | `data/drafting/` — 17 files, 476 KB, written by `scripts/ingest/drafting_seed.py` and reaching the browser as `?raw` chunks. 14 `DocTemplate`s (letter, D.O., O.M., circular, I.D. note, noting, notification, endorsement, leave application, representation, RTI reply, show-cause reply, tour programme, T.A. bill cover), each with fields, a bilingual block layout, a machine-evaluable bilingual checklist and the CSMOP paragraph it comes from; 78 Rajbhasha structural terms; 49 bilingual phrases; an index the picker can load alone (ADR-020)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Drafting engine | `src/lib/drafting/` — pure, takes the template as an argument. `render(template, values, 'en' \| 'hi' \| 'bilingual')` → a structured model (header, refLine, subject, paras[], closing, signature, copyTo[], enclosures[]) plus a plain-text serialiser that wraps and aligns; required-field, date-format and unknown-option validation; auto paragraph numbering; auto `Encl.: as above (n)`. `checklist.ts` implements thirteen rule kinds and throws on an unimplemented one. Values are never filled in for the caller — `sampleValues(template)` is the worked example, asked for explicitly; every rendered block carries the `layoutIndex` the bilingual view pairs on; a multiline value is split into real lines; and a list is normalised to exactly what renders, so what the checklist reads and what the page shows cannot disagree (ADR-020 addendum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Drafting source | CSMOP 2022 (16th edition) English and Hindi, fetched from DARPG; `docs/CSMOP-FORMATS.md` is the reading of it, with paragraph references. The Hindi issue's text layer is scrambled by a legacy font, so every Hindi string was read off a rendered page — which is how `परम अग्रता` (not `सर्वोच्च अग्रता`) and `अर्ध-सरकारी पत्र` (not `अर्ध-शासकीय`) survived. Seven of the 14 forms are ones CSMOP prescribes no format for: each carries `verify: true` and names its chassis (DATA-GAPS #36-#39)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Drafting AI     | **`components/AiDraftPanel.tsx`** — "Draft with AI" in the editor's form column, mounted by `EditorPage` behind `React.lazy` AND `draftingAiAvailable(useAi().enabled)`, so a reader with AI off downloads none of it. A brief textarea; plain-language streaming progress per tool (`draft.ai.step.<tool>`, from a literal map so an unlabelled tool is a compile error); ≤3 bilingual clarifying questions; the result as a `SuggestionDiff` **per changed field** with accept/reject per change; "Improve wording" (a ✨ control on every text field, offering the four `SuggestionKind`s rather than guessing); "Explain" on every failing checklist item; token count and cost after every run; Cancel. A **per-draft acknowledgement** gates the brief box — the panel's `key` is the draft id, so switching drafts asks again, and the textarea does not exist in the DOM until it is pressed (ADR-032 §5, amending ADR-021 point 5). `useDraftingAi` dynamic-imports the agent, the registry and the tools when the BUTTON is pressed, not when the panel appears |
| Drafting Studio | `/draft` picker — 14 cards grouped by what an officer is doing, each with its one-line CSMOP "use when" from `index.json` alone (6 KB; a template is fetched only once a form is chosen), its paragraphs, and a badge on the seven forms the manual prescribes **no** format for. `/draft/:type` editor — guided bilingual form beside a live A4 preview with English / हिंदी / side-by-side tabs; a body editor with a numbering gutter and a phrase / glossary / urgency / enclosure / copy-to toolbar; a live checklist drawer; `.docx` + print + clipboard export behind a gate that **refuses** a failing required item and asks once for a recommended one; drafts that autosave to Dexie with duplicate, rename and undoable delete; "Save as my template" for the letterhead only. The whole view is in the URL — the draft's text never is (ADR-021)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Glossary data   | `data/glossary.json` — 1,891 terms across seven categories (designation, office, file, finance, establishment, legal, it), ~970 KB, reaching the browser as a single `?raw` chunk gated behind `useGlossary(enabled)`. Compiled from standard Rajbhasha administrative usage rather than read off one fetched page — the source PDF (`rajbhasha.gov.in/sites/default/files/saralshabdavali.pdf`, the same one `structure-terms.json` cites) exceeded `WebFetch`'s 10 MB ceiling — so every entry carries `verify: true` unconditionally (ADR-024, `docs/DATA-GAPS.md` #48). `scripts/ingest/glossary_seed.py` reads the raw category pairs from `scripts/ingest/glossary_sources/*.json`, cross-deduplicates by English term and drops the seven terms `data/drafting/structure-terms.json` already carries |
| Glossary module | `/utils/glossary` — instant search (English, Hindi, roman-Hindi via `romanKey()`, no new lexicon), a category filter, copy buttons, favourites and recents in Dexie. Render capped at 100 rows regardless of view (`MAX_RENDERED`) — an unfiltered 1,891-row list ran `axe.run()` past a 30s timeout in `pnpm exec playwright test`; the search itself is uncapped. The Drafting Studio's own `GlossarySheet.tsx` gained a second "Full glossary" tab reaching this dataset through the SAME `onInsert` callback its existing 78-term structural tab already used, and `BodyEditor.tsx`'s `useGlossarySuggest` hook underlines-by-chip any English term with a known Hindi equivalent when the officer is typing in Hindi mode, with a one-click replace (ADR-024) |
| Holidays data   | `data/holidays/holidays-2026.json` — 17 gazetted + 34 restricted holidays for Delhi/New Delhi, from DoPT O.M. F.No. 12/2/2023-JCA dated 03.07.2025. `dopt.gov.in` itself refused every fetch this session (403 / broken certificate), so the dated list is read from a secondary reproduction with every day-of-week independently recomputed and checked (`verify: true`, ADR-026, `docs/DATA-GAPS.md` #51). `scripts/ingest/holidays.py <year>` keeps this repeatable — `YEARS` is keyed by calendar year, so 2027 is a second entry |
| Leave engine    | `src/lib/leave/` — pure, no dataset: `rules.ts` holds the CCS (Leave) Rules 1972 constants (EL 2.5 days/month capped at 300, HPL 20/12 days/month, commuted leave at 2× debit) each with its rule citation, `engine.ts` accrues EL/HPL by completed month and pro-rates Casual Leave/Restricted Holidays (DoPT instructions, not the 1972 Rules — `verify: true`) in the year of joining. `cashEquivalent()` is the (basic+DA)/30×days formula shared by EL and LTC encashment |
| Pension data    | `data/pension/pension-facts.json` — superannuation (FR 56(a)), retirement/death gratuity (CCS Pension Rules 2021 Rule 45, including the DA-linked ceiling escalation — allowances.json's own pattern, reused: Rs. 20 lakh → Rs. 25 lakh), the CCS Commutation Rules 1981 age-factor table (62 rows, fetched PDF's table unparseable this session — cross-checked against a second source instead, `verify: true`, `docs/DATA-GAPS.md` #52) and the GPF rate history (7.1%, `dea.gov.in` certificate failure — `docs/DATA-GAPS.md` #49). NPS and UPS are NOT repeated here — `src/modules/utils/pension/data.ts` re-parses `data/pay/nps.json`/`ups.json` through the Pay module's own `schemeSchema` (ADR-026) |
| Pension engine  | `src/lib/pension/engine.ts` — pure: `superannuationDate()` (the "born on the 1st retires at the end of the PRECEDING month" rule, one formula, no branch), `retirementGratuity()`, `commuteePension()`, `projectNpsCorpus()`/`projectGpfBalance()` (simplified monthly-compounding projections, held in today's rupees), `upsAssuredPayout()`/`upsLumpSum()` |
| Portals data    | `data/portals.json` — 22 Government of India portals and helplines (e-HRMS, SPARROW, CGHS, DoPT, Bhavishya, CPENGRAMS, CPGRAMS, iGOT Karmayogi, EPFO, NPS/CRA, UPS, GeM, PFMS, CGEGIS, Kendriya Bhandar, CSSS, Kanthasth, Bharati, India Code, e-Gazette, NCRB Sankalan, DoE), bilingual purpose and category, a public helpline where one is published. Every record `verify: true` — several URLs (SPARROW, e-HRMS, CSSS) could not be independently confirmed this session (`docs/DATA-GAPS.md` #50) |
| Utilities' other tools | `/utils/holidays` (month-at-a-glance grid + full list, G/R tags, restricted-holiday picks capped at two in a new `holidayPicks` Dexie table, an upcoming strip, an RFC 5545 `.ics` export of the gazetted list only, a delegation note), `/utils/leave` (EL/HPL/CL/RH balances with `SourceChip` citations, EL and LTC encashment, LTC block years, EOL and leave-preparatory-to-retirement notes), `/utils/pension` (superannuation date, NPS-or-UPS projection, gratuity, commutation, GPF), `/utils/portals` (search + category filter + copy-URL). `UtilsHubPage`'s four "coming later" cards are now live links (ADR-026) |
| Rules data      | `data/rules/` — 25 files, ~4 MB. `text/<act>.json` for twelve rule books (CCS Conduct, CCA, Leave, Pension; GFR 2017; FR/SR; RTI, OSA, PoSH; OL Act and Rules; CSMOP 2022) — **818 rules**, no duplicate numbers, each with number, heading, text and sub-rules. `cards/<act>.json` — 2,807 cards, **1,595 served**: 693 rule, 563 cloze, 339 authored questions. `index.json` carries the counts so the picker loads nothing else (ADR-023). Session 20 authored the last four acts' Hindi headings — unlocking all twelve books' rule cards — and reviewed the 529 generated cloze cards that unlocked (ADR-033) |
| Rules authoring | `scripts/authoring/` (Python 3.12), hand-run and on no cron: `fetch_sources.py` (21 documents, cited in `SOURCES.md`), `extract_rules.py`, `make_cards.py`, `qa_pipeline.py` (stages C and D, and the acceptance report). 43 stdlib-`unittest` tests. **Hindi is authored, never extracted** — every Ministry Hindi issue is legacy-font byte soup (ADR-023). All twelve rule books now have authored Hindi headings (ADR-033) |
| Rules questions | 426 bilingual MCQ / true-false / scenario questions across all twelve rule books (the original 151 over CCS Conduct/CCA/Leave/RTI/PoSH, plus Session 20's ~275 over CCS Pension, GFR, CSMOP, OSA, OL Act, OL Rules and FR/SR, and a ten-question scenario batch each for CCS Conduct/CCA/Leave), each put through four separate passes — generate, critic, blind verify (genuinely blind for Session 20's batches: a fresh subagent with no access to the answer key), rapidfuzz dedup — of which **339 approved**. Rejects stay in the card file with their reason and are never served. `docs/authoring-reports/2026-08-28.md` is the Session 11 acceptance report; ADR-033 has Session 20's own numbers |
| Trainer engine  | `src/lib/srs` — FSRS over `ts-fsrs` 5.4, **fuzz off** so the same grade at the same instant always gives the same due date. Seven files: `types.ts` (the stored shape), `day.ts` (IST day boundaries and the streak), `engine.ts`, `queue.ts`, `stats.ts` and `transfer.ts` — all pure — and `store.ts`, the only one that opens Dexie. No React, no dataset import, no clock of its own; `purity.test.ts` asserts all three by reading the files (and that nothing sorts with `localeCompare`). 162 tests against a frozen clock — including `edge.test.ts`, seven defects an edge-case pass found, each confirmed to fail against the code before its fix — plus `tests/srs-corpus.test.ts` over the committed cards (ADR-025) |
| Trainer UI      | `src/modules/trainer/` — `/learn` Home (due count, streak, a `ProgressBar` "today's goal" indicator, weak-area chips that link into a filtered review, act toggles); `/learn/review` (one `CardView` per card, all five kinds, keyboard 1-4/space, bookmark/report); `/learn/mock` (timed, scoped to `mcq`/`trueFalse`/`scenario` — the kinds with one right answer — no reveal until the end, a `recharts` accuracy-by-rule-book bar chart on the results screen); `/learn/browse` (Act → rule → per-rule mastery bar, from `srsCards`, no `data/rules/text` load); `/learn/bookmarks`, `/learn/reports` (CSV export), `/learn/settings` (daily new, review cap, target retention, act toggles, the reminder); `/learn/review-queue` (j/k/a/e/r, generationMeta shown when present, bulk-approve on a matched critic+blind-verify). `useLiveQuery` throughout — no manual refetch anywhere, since Dexie's live query tracks every table `src/lib/srs/store.ts`'s functions actually read. A local decision never mutates a `Card`: `cardOverrides`/`proposedCards` are folded over the dataset at read time by `reviewQueue.ts#effectiveCatalogue`, which is the only thing `isServed` ever sees (ADR-027). This session adds three AI actions to `/learn`, off with everything else by default: `CardAiActions` ("Explain" once a card reveals wrong, via `CardView`'s new `onAnswered` prop; "Give me a scenario on this rule", always) below `CardView` in `ReviewPage`, and `FocusPlanCard` ("Get a focus plan") in Home's weak-areas card — `src/ai/agents/tutor.ts`, ADR-036 |
| Library data    | `data/library/` — 16 files, 824 KB, written by `scripts/ingest/library_seed.py` and reaching the browser as `?raw` chunks. Fifteen `LibraryWork`s (the twelve rule books plus BNS/BNSS/BSA), each a POINTER (`corpus.file`) into `data/rules/text` or `data/law` with a table of contents, a reading order, `estimatedMinutes` at 180 wpm English / 140 Devanagari, `examTags`, `practiseCounts` (unit id → approved Trainer cards citing it, counted at build time so a reader never downloads 1.1 MB of GFR cards to find out), a citation and `officialUrl`; plus `index.json`, the 11 KB shelf the hub loads alone. Every work carries `verify: true` — all its Hindi is authored or curated (ADR-038) |
| Library engine  | `src/lib/library/` — pure apart from `store.ts`, the split `src/lib/srs` draws. `corpus.ts` (`buildCorpus` normalises either corpus shape into `LibraryUnit`s; `paragraphs()` breaks a run-on rule at the four places a printed rule book breaks, and joining the pieces back is asserted over every unit of every work), `navigate.ts`, `search.ts` (fuse.js over BOTH languages always, plus an exact unit-number pass because fuse's `minMatchCharLength` refuses "11"), `label.ts` (the one place a missing heading is decided, reporting which language it returned), `readTime.ts`, `crossRefs.ts` (six full citations into the criminal codes across all twelve rule books — deliberately narrow, and it builds a QUERY naming the Act, ADR-029 point 4), `tags.ts`/`categories.ts`, `data.ts` (the `?raw` loaders) and `store.ts` (progress, bookmarks) |
| Library module  | `/library` shelf — fifteen cards grouped by category, each with a progress ring, unit count, estimated time and its tags; the file tab marks the work last opened and that card carries "Continue reading". `/library/:workId` — a collapsible table of contents with per-unit read ticks, a search-within box (which is what loads the corpus), a "Start reading" CTA, the source and the official text. `/library/:workId/:unitId` — the reader: a sticky header with work, position and progress; English / हिंदी / Both (side by side ≥1024px); four text sizes, sans or a system serif (`--font-reading`, no fourth webfont — ADR-018's line), normal or relaxed spacing with relaxed FORCED and explained whenever Devanagari is shown; prev/next, `j`/`k`, Home/End; a right rail (below the text on a phone) with nearby units, repealed-provision chips into the Law Converter, explicit code cross-references and "practise this rule book"; a footer with the citation, `SourceChip`, `DataVersion` and the disclaimer. Progress is written on arrival and every 30 seconds of dwell. Prints as a clean A4 page against a named `library-a4` page box, chrome dropped (ADR-038) |
| Onboarding      | `/onboarding` (Session 14) — three skippable steps, reached ONLY from a bare `/` on a device that has never completed or skipped it (`App.tsx`'s `path="/"` route branches on `hydrated` then `onboarded`; every other route, deep link included, is untouched — ADR-028). Step 1: language, the same `setLanguage` toggle Settings uses. Step 2: an optional post + city via the Pay module's own `JobPicker`/`CityPicker` — picking one writes a `PayScenario` to `settings.pay` (`writeLastScenario`, so a bare `/pay` opens prefilled) and, for a small set of intelligence/enforcement organisations only, narrows `TrainerSettings.actsEnabled` to `['ccs-conduct', 'osa']` (`src/modules/onboarding/actHints.ts#trainerActHintsForJob`) — every other post makes no change, since an empty `actsEnabled` already means "every rule book" and narrowing it for a fresh install would have made the Trainer look broken for the common case. Step 3: the three-promise privacy statement, "Understood" finishes. "Skip setup" is one tap on every step |
| Settings        | `/settings` — language, theme, a global Devanagari-digits toggle (`useAppStore().devanagariDigits`, wired into the Drafting Studio's `render`/`renderDocument` calls — the engine option existed since Session 8 with no control anywhere; Session 14 closes that), a daily-reminder status line linking to `/learn/settings` for the actual toggle (one setting, read by both screens, not duplicated), the AI section, "Check for data updates" (`src/lib/dataUpdates.ts` — fetches `data/_meta/versions.json` fresh, bypassing the browser cache and the service worker's `StaleWhileRevalidate` rule with a cache-busting query param, diffs it against the bundled copy), export/import/erase (`src/lib/backup.ts` — export/import cover every Dexie table except `secrets`/`aiAnswers`/`aiUsage` by name, so a table a later session adds is backed up by default; erase is gated by a typed `ERASE` confirmation), an About card (version, build sha via a `vite.config.ts` `define`, licence, a `mailto:` "Report a data error" link) and a data-sources table reading `data/_meta/versions.json` directly. `src/lib/dataUpdates.ts` is a second, narrowly-scoped `fetch` exemption in `eslint.config.js` alongside `src/ai/providers/wire.ts` — ADR-028 |
| Command palette | Ctrl/⌘-K, and a search button in `TopBar` — `src/components/palette/` (Session 14, ADR-029), mounted lazily from `App.tsx` only once opened. `Command.Dialog` (`cmdk`, wrapping `@radix-ui/react-dialog`) supplies the focus trap and the ARIA 1.2 combobox wiring; every section reuses its module's own search (`searchLaw`, `searchJobs`, `searchGlossary`) rather than a second index, plus a small `romanKey`-folded/acronym matcher for Document types and Trainer topics (fourteen and twelve items, no reusable search of their own). Sections: recents (`commandRecents`, Dexie v10), Go to a module, Law sections, Job posts, Glossary, Document types, Trainer topics, Portals, Settings actions — each dataset loads lazily, gated on the palette being open AND the query non-empty. Global shortcuts (`src/app/useGlobalShortcuts.ts`): `g`+`l`/`p`/`d`/`e`/`u` jumps a module, `?` opens the shortcuts-help sheet, `/` focuses the current page's own `[data-module-search]` field, falling back to the palette. None fires while typing in a field, CapsLock included (case-folded), or while a dialog other than the palette itself already has the reader's attention (ADR-029 addendum — a same-session edge-case pass, six defects, each confirmed against a real browser before its fix: a recents re-record bug, two share-link routes that only applied on first mount, the CapsLock case bug, Ctrl+Shift+K also toggling the palette, and shortcuts firing underneath an already-open dialog) |
| Share links     | `toGlossaryHref(termId)` (`/utils/glossary?term=<id>`) and `toTrainerTopicHref(actId)` (`/learn/review?act=<id>`, formalising a link `HomePage.tsx`'s weak-area chips already built ad hoc) back a "Copy link"/"Share" button on `TermRow.tsx` and `BrowsePage.tsx`'s Act rows, `navigator.share` first and the clipboard otherwise — the same pattern the Law Converter's `SectionActions.tsx` already used. The Law Converter's and Pay calculator's own share/URL-state (`toLawHref`, `toPayHref`) predate this session and are unchanged |
| Security headers | `public/_headers` — the one copy of the CSP (`default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` — WebAssembly compilation for Tier 0, still NO `unsafe-eval`; `style-src 'self' 'unsafe-inline'` with `style-src-attr 'none'`; `connect-src 'self' https://api.anthropic.com` + Tier 0's three model hosts, with `VITE_AI_PROXY_URL`'s origin appended at build time by `vite.config.ts` — ADR-037, closing DATA-GAPS #57/#61; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'none'`), HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP, plus cache policy. `tests/e2e/csp.spec.ts` PARSES that file and replays the `/*` block onto the document in a real browser on every route, failing on a `securitypolicyviolation` OR a console error. One violation is allowlisted: zod 4's caught `Function("")` capability probe (ADR-030) |
| Size budget     | `scripts/size-budget.json` is the one copy of the numbers; `scripts/size-check.mjs` (`pnpm size`) gates CI and prints a per-asset table, `tests/bundle-budget.test.ts` reads the same file and adds the AI-layer-absence assertions. Initial JS **145.0 KB gzip** against a 250 KB budget (the Library adds a nav label and one `versions.json` entry to it and nothing else — every byte of `data/library` is behind the route). Replaces ADR-011's fixed `BASELINE_GZIP + 30 KB`, which DATA-GAPS #55 had left unreachable — ADR-030, and ADR-031's per-language i18n chunks are what fixed the mechanism |
| SEO / social    | `robots.txt` and `sitemap.xml` are EMITTED at build time by `vite.config.ts`'s `seoFiles()` (they carry an absolute origin, so a committed copy goes stale); `socialTags()` injects the canonical link and the og:/twitter: tags, with the bilingual description read from the SAME i18n catalogues the app renders; `preloadFonts()` adds exactly two `rel=preload` font hints; `routePreloadHeaders()` appends per-route `Link:` preload blocks to `dist/_headers`. `public/og.png` is generated from the app icon by `pnpm icons:generate`. `tests/seo.test.ts` checks the sitemap against `src/lib/nav.ts` |
| Deploy          | **`.github/workflows/deploy-worker.yml` is new: `workflow_dispatch` ONLY, with a typed "deploy" confirmation, publishing `worker/`. It never touches `ANTHROPIC_API_KEY` — that is `wrangler secret put`, once, by hand.** `.github/workflows/deploy.yml` — `workflow_run` on a SUCCESSFUL CI run (a push trigger cannot wait for another workflow), gated additionally on the head repository being this one, then `cloudflare/wrangler-action` running `pages deploy`. `main` is production, every other branch a preview. Secrets: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_PROJECT_NAME`; optional `vars.SITE_URL`. `.github/dependabot.yml` covers npm + github-actions + pip, weekly and grouped |
| Lighthouse      | `docs/lighthouse/*.json`, measured against `pnpm serve:dist` (production headers, compression, SPA fallback) — not `vite preview`, which applies none of them. Mobile: Performance **85-93**, Accessibility **100**, Best Practices **96-100**, SEO **100**. Desktop: Performance 98-100. The Performance target of 95 is NOT met and needs prerendering rather than tuning — `docs/DATA-GAPS.md` #58 has the measurement and the two options |

## HOW TO RUN

```bash
corepack enable          # once — pins pnpm to the version in package.json
pnpm install             # fonts come with it, from @fontsource
pnpm dev                 # http://localhost:5173
```

### Scripts

> **`docs/TESTING.md` is the reference for everything below that runs a test** — how to run each
> suite, what each one actually guarantees, and the rules for adding one. Read it before writing a
> Playwright spec: importing `test` from `@playwright/test` instead of from `tests/e2e/fixtures.ts`
> now fails the unit suite (ADR-031).

| Command               | Does                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Vite dev server, with `src/app/axe-dev.ts` logging axe violations to the console                      |
| `pnpm build`          | Typecheck, then production build into `dist/`                                                         |
| `pnpm preview`        | Serve the built `dist/` on :4173                                                                      |
| `pnpm lint`           | ESLint 9 flat config, type-aware on `src/`                                                            |
| `pnpm typecheck`      | TypeScript 7 (`typescript-native`) over both the app and the Node config projects                     |
| `pnpm test`           | Vitest (jsdom)                                                                                        |
| `pnpm test:coverage`  | The same, with the 90% `src/lib/**` thresholds in `vite.config.ts` enforced (ADR-031)                  |
| `pnpm i18n:check`     | Fails if `en.json` and `hi.json` disagree on keys                                                     |
| `pnpm fonts:licenses` | Regenerate `public/OFL.txt` from the installed `@fontsource` licences (idempotent, offline)           |
| `pnpm icons:generate` | Re-rasterize `public/icons/*.png` from `src/assets/pwa-icon.svg` (idempotent, offline, needs `sharp`) |
| `pnpm test:e2e`       | Playwright, BOTH projects (desktop + Pixel 7); builds + serves `dist/` itself (`playwright.config.ts`) |
| `pnpm size`           | The initial-route size budget from `scripts/size-budget.json`; needs a build (ADR-030)                |
| `pnpm analyze`        | Build with `rollup-plugin-visualizer`; treemap at `dist/stats.html`. Never on a normal build          |
| `pnpm serve:dist`     | Serve `dist/` with the production `_headers` and the SPA fallback applied — what Lighthouse measures  |
| `pnpm lighthouse`     | Lighthouse over all seven routes into `docs/lighthouse/`; `--preset desktop` for the other profile    |
| `pnpm check`          | `lint && typecheck && i18n:check && test` — run before every commit                                   |

### The Tier 2 proxy

`worker/` is a **separate package** with its own dependency tree (miniflare pulls workerd, ~90 MB),
its own tsconfig and its own lockfile. `pnpm install` at the root does not touch it and `pnpm check`
does not cover it — CI does, in the `worker` job. Read `worker/README.md` before deploying; read
`docs/AI.md` §12 for the order to turn the tiers on.

```bash
cd worker && pnpm install --ignore-workspace
pnpm test          # 42: policy.test.ts by calling, worker.test.ts through real workerd
pnpm typecheck
pnpm dev           # wrangler dev
pnpm deploy        # or the workflow_dispatch-only .github/workflows/deploy-worker.yml
```                                   |

### The data pipeline

```bash
cd scripts/ingest && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py            # refresh data/law from NCRB
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py --offline  # reparse raw/, no network

scripts/ingest/.venv/bin/python scripts/ingest/pay_matrix.py --check       # re-derive the 540 cells, write nothing
scripts/ingest/.venv/bin/python scripts/ingest/drafting_seed.py            # write data/drafting/*
scripts/ingest/.venv/bin/python scripts/ingest/drafting_seed.py --check    # rebuild and compare, write nothing

scripts/ingest/.venv/bin/python scripts/ingest/holidays.py 2026            # write data/holidays/holidays-2026.json
scripts/ingest/.venv/bin/python scripts/ingest/holidays.py 2026 --check    # rebuild and compare, write nothing
scripts/ingest/.venv/bin/python scripts/ingest/utils_seed.py               # write data/portals.json + data/pension/pension-facts.json
scripts/ingest/.venv/bin/python scripts/ingest/utils_seed.py --check       # rebuild and compare, write nothing

scripts/ingest/.venv/bin/python scripts/ingest/library_seed.py             # write data/library/* (structure only; copies no text)
scripts/ingest/.venv/bin/python scripts/ingest/library_seed.py --check     # rebuild all 16 files and compare, write nothing

scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py            # every dataset vs its JSON Schema
```

### The rules-authoring pipeline

Read `docs/AUTHORING.md` before adding an act, a card kind, or a question. It is on no cron either,
for the same reason: a rule book changes when a Ministry amends it.

```bash
scripts/ingest/.venv/bin/python scripts/authoring/fetch_sources.py         # 21 documents -> sources/ (git-ignored) + SOURCES.md
scripts/ingest/.venv/bin/python scripts/authoring/extract_rules.py         # -> data/rules/text/*.json
scripts/ingest/.venv/bin/python scripts/authoring/extract_rules.py --audit-hindi   # measure each Hindi text layer
scripts/ingest/.venv/bin/python scripts/authoring/qa_pipeline.py dedup     # stage D, rapidfuzz
scripts/ingest/.venv/bin/python scripts/authoring/make_cards.py            # -> data/rules/cards/*.json + index.json
scripts/ingest/.venv/bin/python scripts/authoring/qa_pipeline.py report --date $(date +%F)

scripts/ingest/.venv/bin/python -m unittest discover -s scripts/authoring -t scripts/authoring
```

Read `scripts/ingest/README.md` before touching any of these. Three rules there are structural, not
stylistic: the weekly cron may never write to `data/law/overlays/` (a step in
`.github/workflows/ingest-law.yml` fails the run if it does); `indiacode_seed.py` may never be added
to that workflow — India Code is fetched by hand, cited, and never crawled (ADR-012); and
`pay_matrix.py` is not on any cron either, because the pay matrix changes when a Pay Commission is
implemented, not when a portal is re-published; and `drafting_seed.py` is not on one because the
Manual of Office Procedure is revised by a new **edition**, and a new edition is a reading job. It reaches no host at all: every input is in
`ANCHORS` at the top of the file, and `--check` re-derives all 540 cells and compares them against
the figures read off the gazette (ADR-016).

### The AI layer

Read `docs/AI.md` before adding a tool, adding an agent, or touching anything under `src/ai`. Four rules
are load-bearing, and each is enforced by a test rather than by convention:

1. `src/app/store.ts` may import **only** `src/ai/flags.ts`. Everything else in `src/ai` sits behind a
   dynamic import, because laziness here is a privacy property, not a performance one — a reader who
   never turns AI on never downloads the code that could reach the network
   (`tests/bundle-budget.test.ts`).
2. `src/ai/providers/wire.ts` is the **only** module allowed to call `fetch`, by a file-scoped exception
   in `eslint.config.js`. Do not reach the network as `globalThis.fetch` to get around the rule — the
   written exception is what keeps the audit question answerable from one file.
3. Every agent runs through `runAgent` with `groundedRequired`. An answer that cites no tool result, or
   that states a section or rule number no cited snippet contains, is discarded rather than shown.
4. A tool is a pure function over local data — bundled `/data` JSON or the reader's own IndexedDB rows.
   Never the network. Both `{ en, hi }` descriptions are required; a missing Hindi one throws at
   registration.

### Notes for the next session

- **A latest-ref in a mount-only listener is right for a handler with state ACROSS keypresses and
  wrong for one whose target depends on where the reader currently is.** `useGlobalShortcuts` needs
  it (a pending `g` chord and its timer would not survive a re-subscription) and the Library reader
  does not, and copying it anyway made `j` then `k` go forward one and back two: the ref lands in a
  passive effect, after paint, so a keypress in that window reads the previous unit's neighbours.
  Re-subscribing the listener per unit is the obvious repair and is wrong the same way one level
  down — the new listener is also attached in a passive effect, so the failure went from every time
  to one run in six, **which is worse**. `src/modules/library/url.ts#unitIdFromPath` is the fix:
  read the current unit from `window.location.pathname` at press time, because the navigation
  updates the URL synchronously and nothing else about the render has happened yet. And note the
  test layer this lives in — **the jsdom version passes against every broken variant**, since React
  flushes passive effects between two `userEvent` interactions, so `tests/e2e/library.spec.ts` is
  what actually holds it.

- **An edge-case pass over the Library found TWELVE defects and every one of them was in the code
  around the data, not in the data.** ADR-038's addendum has all eleven;
  `src/lib/library/library.edge.test.ts` and `src/modules/library/library.edge.test.tsx` are the
  regression files, and each test was confirmed to fail against the committed code first. This is the
  third session in a row to land on the same shape (ADR-032, ADR-035) and the first with no model in
  it, so the lesson generalises past agents: **whatever you obviously distrust gets guarded, and
  whatever you write yourself gets written as though it cannot fail.** The four most transferable
  (the fifth has its own note above):
  `isWorkId` used `key in objectLiteral`, which walks `Object.prototype`, so `constructor` and
  `toString` were accepted as work ids out of the address bar; three screens blocked their whole
  render on a `useLiveQuery` they only decorate themselves with, so a device whose storage is refused
  sat on a skeleton for ever with the library sitting in a precached chunk beside it; `recordProgress`
  rejected from an interval every thirty seconds on that same device; and `j`/`k` fired underneath an
  open dialog, which is ADR-029's addendum defect six arriving verbatim in a new file.

- **A test that reads the whole row passes against a heading that is not there.** The search-result
  label was `heading[language] || heading.en` rather than `unitLabel`, so every hit in FR/SR and
  CSMOP rendered a section number beside an empty string — and the first version of the test written
  to catch it asserted over `hit.textContent`, which also carries a snippet of the body, and went
  green against the broken code. It asserts on the row's own two elements now. Break the code and
  watch the new assertion go red before believing it; `network.sentinel()` has the same story
  (ADR-031).

- **`estimateReadTime` lost its `lang` parameter, deliberately, and the brief's signature with it.**
  The trailing `|| words.length / WPM[lang]` could not fire — `minutes` is zero only when there are
  no words, which the guard above has already returned for — and with the dead branch gone the
  parameter provably carried no information. The rate is picked per WORD by the script it is written
  in, which is what this corpus actually needs. A parameter that does nothing and a branch nothing
  can reach are the same lie told twice.

- **A reading module over a corpus you already ship is mostly a question about POINTERS, and the
  test that matters runs in both directions.** `data/library/works/*.json` names unit ids in
  `data/rules/text` and `data/law` and copies no text. `tests/library-data.test.ts` asserts that
  every id resolves AND that every record in the corpus is reachable from the work — the second half
  is the one that catches a rule nobody can navigate to, and it is the half that is easy to skip.
  Separately, `src/lib/library/data.test.ts` loads all fifteen works and all fifteen corpora through
  the real `?raw` specifiers, because a mistyped path in that map is invisible to anything that reads
  the same files with `node:fs`.

- **Splitting a statute for reading is only safe if joining it back is asserted.** The twelve rule
  books store a rule as one unbroken 4,000-character string, so `paragraphs()` breaks before a
  numbered sub-clause, a proviso, an explanation and an illustration. The guarantee is that
  `paragraphs(text).join(' ')` is `text` with its whitespace collapsed, asserted over every unit of
  every one of the fifteen works. Without it, a regex that ate a character would be invisible on
  screen and wrong in a way somebody would act on. If you add a break rule, that assertion is what
  makes it safe to add.

- **`/परन्तु\b/` matches nothing, ever — and this is the second file in this project to ship it.**
  JavaScript defines a word boundary over `[A-Za-z0-9_]`, so a Devanagari alternative anchored with
  `\b` silently covers one language while looking symmetric with its English half.
  `src/ai/agents/law.ts#SECTION_MENTION` records the same trap (ADR-035). Any pattern here with two
  language halves owes itself a test for the Devanagari one; the English one passing is not evidence.

- **`unit.parts` is a re-segmentation of the body, and the two mistakes that came out of that are
  both worth knowing.** All 219 rules in `data/rules/text` that have `subRules` store them as
  verbatim slices of the same `text` (`library.test.ts` asserts it). Rendering the body AND the parts
  list therefore prints the whole rule twice — each half individually correct, so jsdom shows nothing
  wrong, and it was found by reading a Playwright page snapshot for a different bug. The same clause
  had a second face: `hindiTextMissing` was `body.hi.length === 0 && parts.length === 0`, and `parts`
  counts records regardless of language, so for exactly those 219 rules the "Hindi is not available"
  notice never rendered and the English appeared silently under a Hindi setting. **A condition that
  looks like extra care is where a silent fallback hides.**

- **A two-digit query is the most obvious thing a reader types into a rule book, and `fuse.js`
  refuses it.** `minMatchCharLength` is 3, so "11" never reached the index at all. A unit number is
  matched exactly and first now (`numberHits`), and a single DIGIT is searchable where a single
  letter is not — `isSearchable()` is exported so the page, which uses the same rule to decide
  whether to load a 1.9 MB corpus, cannot drift from the index.

- **A count of destinations written down in a spec is a second copy of `src/lib/nav.ts`, and it goes
  stale the next time a module lands.** Two Playwright specs hard-coded "6 destinations" and failed
  on the Library for a reason that had nothing to do with what either was checking. `nav.spec.ts`
  derives the expected count from the widest viewport (where the sidebar shows everything) and reads
  the More sheet's tab order from the sheet itself. `shell.edge.test.tsx` goes the other way and
  asserts the four flagship ids BY NAME, because a swap keeps the count at four and the reader would
  find out from the phone in their hand.

- **Where the corpus has no structure, say so rather than inventing it — and put the admission in the
  DATA.** `tocSource` is `chapters`, `numbering` or `flat`, and the work page states which in both
  languages. Eleven of the fifteen works are `flat` because `extract_rules.py` walks past the chapter
  heading lines in those PDFs (`docs/DATA-GAPS.md` #70). Closing that gap is a change to the parser,
  not to the Library, and it would improve the Trainer's Browse screen at the same time.

- **The Hindi gap in this project runs in BOTH directions, and nobody had seen the second one.**
  221 units have no ENGLISH heading and do have an authored Hindi one — four rule books print no
  heading the extractor could read, and Session 20 authored Hindi for all of them. The reading
  surface is what made it visible. Nothing was invented: `library_seed.py` quotes the unit's opening
  ~96 characters as an `excerpt`, only where a heading is missing, and `unitLabel()`
  (`src/lib/library/label.ts`) is the one place that decides, reporting which language it actually
  returned so the markup can set `lang` and italicise a quotation. `docs/DATA-GAPS.md` #71 has all
  three sub-gaps; closing (a) would also fix 110 truncated FR/SR rule-card fronts in the Trainer.

- **`src/schemas/` is new, and the reason it is not `src/modules/library/schema.ts` is worth
  repeating.** The Library's shape is read by two places that are not the module: `src/lib/library`,
  which is pure and must not import a module, and the tests that read the committed bytes off disk.
  The four schemas before it (law, pay, drafting, rules) are each read only by their own module and
  its tests, which is why they live where they do.

- **Session 27 owes the Library its notes and highlights.** `libraryHighlights` and `libraryNotes`
  are declared in Dexie v11 and written by nothing — the arrangement v2 made for the AI tables.
  `LibraryUnit.parts` is kept for them: a sub-rule number is a real citation and an anchor finer than
  a whole rule. `libraryHighlights.lang` is part of the row rather than derived, because the English
  and Hindi renderings of a unit are different strings of different lengths and an offset means
  nothing without knowing which one it indexes into.

- **An edge-case pass over the Trainer-home/mock-button fix and the pay Combobox fix (the commit
  fixing the first-run `EmptyState` hiding navigation, and `Combobox`/`Pickers` showing the live
  query instead of the selected label) found one more real defect, in code neither of those two
  touches directly: `normaliseScenario()` in `src/lib/pay/scenario.ts` clamped a stale `level` and a
  stale `cityId` back to a valid value — the exact pattern its own two adjacent lines already show —
  but let a stale `jobId` through unchecked.** `payScenarios` (Dexie, up to ten named scenarios) and
  a shared `/pay` URL both persist a `jobId` across a `data/pay/jobs.json` update, and
  `normaliseScenario` is the one place that kind of untrusted, cross-session state is meant to be
  sanitised before anything reads it — `scenarioFromParams` and the "load a saved scenario" flow in
  `PayPage.tsx` both route through it. The Job picker's new `selectedLabel` (this session) is what
  actually surfaced it: a `jobId` naming a post no longer in the table resolves to no label, so the
  box renders exactly like "nothing picked" — indistinguishable, and with the trailing clear control
  hidden too, since `showClear` reads `selectedLabel`. `jobFor(tables.jobs, scenario.jobId) ?
  scenario.jobId : null` is the one-line fix, mirroring the `cityId` line right above it.
  `src/lib/pay/scenario.test.ts` did not exist before this — `normaliseScenario` had no direct test
  at all — and now has three, the first confirmed to fail against the code before the fix.
- **The City picker's "Anywhere else (Z)" is a real, deliberate selection with `cityId: null`, not
  an absence of one** — `defaultScenario` already starts every scenario there, and the list marks
  that row `aria-selected` when `selectedId === null`. The box showing the plain placeholder for
  that state (rather than "Anywhere else (Z)" as a resolved label) reads the same as "never touched"
  and was true before this session's Combobox fix too — `PayScenario` has no separate flag for
  "explicitly Z" versus "not yet chosen", so telling them apart in the box would need a data-model
  change, not a Combobox one. Considered and left alone; a future session reaching for
  `selectedLabel` should not treat this as a bug to re-discover.

- **`validateCitations` is not the only rule an agent has to satisfy on Tier 0 — the DEVICE is.**
  `LOCAL_MAX_TOOL_STEPS` is 2, and `src/ai/agents/law.ts#TIER_POLICIES.local` independently cuts the
  research pass to one tool-calling turn, one snippet and a two-sentence answer. Any agent that can
  run on Tier 0 owes itself a `local` policy row for the same reason: a step cap sized for a frontier
  model is a minute of waiting per step on a device generating twenty tokens a second. This is now
  the last item on `docs/AI.md` §11's checklist.

- **An edge-case pass over Tier 0 found five more defects, and four were the same mistake as the
  citation one: the PROVIDER deciding something on behalf of callers it cannot see.** Read ADR-037's
  second addendum. The two most transferable: `LocalProvider` suppressed `token` events on a
  structured turn, which no other provider does — `wire.ts` emits one per text delta — and the only
  consumer of those events is the law agent's answering pass, which passes a `jsonSchema` and has
  `partialAnswerText()` built to read half-arrived JSON, so the suppression silenced the one
  streaming surface on the slowest tier. **The original commit shipped a test asserting that
  suppression**, so the defect had a test defending it; when an edge-case pass contradicts an
  existing assertion, check which one is describing the app. And `ensureLocalEngine`'s comment said
  a caller wanting a different model "has to wait", which nothing enforced — an invariant described
  rather than implemented, and the kind of comment worth distrusting on sight.

- **`vi.mock` is NOT stable under concurrent dynamic import of the same specifier.** A second
  overlapping `import()` resolves to the real package — here `@mlc-ai/web-llm`, which fails with
  `caches is not defined` under jsdom and looks exactly like an application defect. The first
  concurrency probe this session ran was worthless for that reason and was thrown away rather than
  acted on; verify a mock is actually in force (`'MARKER' in module`) before believing a concurrency
  result. What made `src/ai/local/engine.ts` testable was hoisting the library behind ONE memoised
  `webllm()` promise — which is also just better, four call sites and several megabytes of parsing.
  If a future change reintroduces a second `import()` site there, `engine.edge.test.ts` starts lying
  before it starts failing.

- **A prompt fragment that names a citation format is making a claim about a validator it cannot
  see, and this session shipped one that contradicted four agents at once.** `toolProtocolInstruction`'s
  answer-only form told the model to cite `[T1]`, and it was used for every turn that could not call
  a tool — including `src/ai/agents/{pay,tutor}.ts`, which pass `tools: []` and whose model sees
  numbered PLATFORM CONTEXT cited as `[1]`, `[2]`. `context.ts#CITATION_PATTERN` is `/\[(\d{1,3})\]/`
  and does not match `[T1]`, so an obedient model cited nothing, every provision number landed in
  `unsupported` — and those problems are pushed **regardless of `requireCitation`**, which is what
  made it fatal. A tutor "Explain" saying "Rule 3 of the CCS (Conduct) Rules" would have died with
  `invalid_citation` on Tier 0 and nowhere else. The toolless form now describes only the JSON
  envelope and defers the citation rule to the persona. Note where this came from: the PROVIDER is
  the layer furthest from the agent that decides what a citation means, so it could break four
  agents without one of their tests noticing, because none of them runs on Tier 0. Found by reading
  `validateCitations` after a peer session asked to be told about concrete Tier 0 misbehaviour —
  not by any test that existed.

- **A test that fails with a message describing something other than what went wrong is worse than
  no test, and this session shipped one for an hour.** `tests/e2e/ai-local.spec.ts` waited for a
  `role="status"` element before reading the list of hosts contacted — and the progress region says
  "0% downloaded" the instant the button is pressed, before the runtime chunk has even loaded. It
  read an empty list and failed with "the download reached no host at all", which is exactly what a
  real defect would look like. `expect.poll` on the list itself is the fix. Poll the thing you are
  asserting about, not a proxy for it.

- **`navigator.deviceMemory` is capped at 8 in every browser that reports it, so `8` means "eight or
  more".** A 64 GB workstation reports what an 8 GB laptop reports. `fitFor()`'s first version
  compared against it unconditionally and warned about both 3B models for the large majority of
  readers who can run them comfortably; `src/ai/local/webgpu.test.ts` caught it. Any future guard
  built on that API needs the same treatment — at the cap the figure carries no information.

- **Substring matching on a security policy is how a policy gets wider without anyone noticing.**
  `tests/e2e/csp.spec.ts` used `toContain("script-src 'self'")`, which is satisfied by any wider
  value beginning that way. Worse, a `toContain("'unsafe-eval'")` check would match
  `'wasm-unsafe-eval'` as a substring and report the opposite of the truth. Both directives are
  compared as TOKEN LISTS now. The same trap is waiting in any assertion about a delimited header.

- **`estimateCost()` prices an unknown model id at the DEFAULT model's rate, and that is right
  everywhere except Tier 0.** It would have shown a dollar figure for tokens nobody was billed for,
  on the one tier whose whole promise is that nothing was sent. `isLocalModelId()` is the one-line
  guard. `runAgent` separately skips the monthly ceiling for `tier === 'local'` — that ceiling is a
  SPENDING cap — and there is a test asserting a PAID tier still stops at the same exhausted budget,
  because without it "skipped for local" and "never enforced" are the same passing test.

- **Three mechanisms keep the 2.1 MB web-llm chunk off devices that never asked for it, and all
  three have to be able to NAME the file.** That is why `vite.config.ts` gives it a fixed
  `manualChunks` name: the service worker's `globIgnores`, `scripts/size-budget.json#chunkExemptions`
  and the confinement assertion in `tests/no-external-urls.test.ts` all refer to `web-llm-*.js`. If
  that name changes, all three break together, which is the point. Any future vendor dependency of
  this size wants the same treatment — and note the `NetworkFirst` runtime rule still caches it once
  fetched, so excluding it from the precache costs a Tier 0 reader nothing offline.

- **`worker/` is deliberately outside the app's install, and that decision has a cost you should
  know about before touching it.** `pnpm check` does not run its tests; `ci.yml`'s `worker` job does.
  Its four guards are pure functions in `policy.ts` tested by calling them, because a limit that is
  off by one is invisible to an integration test that sends one request; `test/worker.test.ts` then
  runs the same code in miniflare for the two things only a runtime settles — that the outbound
  request carries the operator's key and NONE of the caller's headers, and that SSE streams through
  rather than buffering. Both suites reach no network.

- **KV counters are guardrails, not accounting, and the code says so rather than pretending
  otherwise.** One write per second per key, eventually consistent: a burst inside one second can
  undercount. The daily budget is checked before a request and written after it, so the ceiling is
  crossed by at most one request — and `worker/test/worker.test.ts` asserts exactly that, so it
  cannot drift into something looser without a failure. A Durable Object is the named upgrade path
  in `worker/README.md`.

- **The law agent, the pay explainer and the rules tutor were built CONCURRENTLY in one working
  tree, by three sessions coordinating with direct messages** — the arrangement Sessions 12/13, 14,
  15 and 21 established. Ownership was split by path: this one owned `src/ai/agents/law.ts`,
  `src/ai/prompts/law.md`, `src/modules/law/**` and the `law.ask.*` i18n block; the other owned
  `src/ai/agents/{pay,tutor}.ts`, `src/modules/{pay,trainer}/**` and the `pay.ai.*`/`trainer.ai.*`
  blocks. Four files were edited across the line and each was announced first: `src/ai/context.ts`
  (two additive `SnippetType` members), `src/ai/prompts.ts` (each session bumped only its own
  agents' `PROMPT_VERSIONS` entries), `src/ai/agent.test.ts` (it asserted `promptVersion: 1` as a
  LITERAL, which broke the moment either session bumped anything — it reads `PROMPT_VERSIONS[AGENT]`
  now, because the claim there is that a run stamps its version, not that the number is 1), and
  `docs/AI.md` (§7A and §7B were both inserted before `## 8`, deliberately, so no section already
  cited by another file moved). Because both sessions had edited CLAUDE.md, `docs/AI.md`,
  `docs/DECISIONS.md` and `src/i18n/*.json`, those shared files landed in whichever commit went
  first rather than being split by hunk. Read ADR-035 and ADR-036 together.

- **A `pnpm check` run while a Playwright run is in flight can fail for a reason that is not about
  the code.** ESLint walks `test-results/`, which Playwright deletes and recreates at the start of
  a run, and the scan dies with `ENOENT: scandir 'test-results'`. It is not a lint error and there
  is nothing to fix in the config; wait for the tree to go quiet, or `rm -rf test-results` first.

- **Two Playwright runs at once collide on port 4173, and the loser reports APP failures.** The
  same `reuseExistingServer: !CI` that causes the stale-`dist/` trap also means the second run
  attaches to the first run's server — and when the first finishes, it tears that server down under
  the second. What the victim reports is `net::ERR_CONNECTION_REFUSED` followed by a string of
  "element(s) not found", which is indistinguishable from a genuinely broken page unless you read
  far enough up to find the refused connection. One e2e run on this machine at a time — INCLUDING
  two of your own, which is how this was actually hit: a second run started while the first still
  had a dozen processes live. Check `ps aux | grep [p]laywright` before starting one, and note that
  a run whose reporter output has not flushed yet looks exactly like a run that has finished. Three distinct ways this shared working tree
  produced a MISLEADING test result in one session — a stale bundle passing an absence assertion, a
  lint crash with no lint error, and app failures that were really a dead server — and none of the
  three was a defect in any code under test.

- **An edge-case pass over the law agent found EIGHT defects, and every one of them was in the
  agent's own half of the run rather than the model's** — ADR-035's addendum has all eight, and
  `src/ai/agents/law.edge.test.ts` (16) plus `src/modules/law/askPanel.edge.test.tsx` (4) are the
  regression files. Each test was confirmed to fail against the committed code before its fix was
  written. The pattern is the one ADR-032 already named for the drafting agent and it repeated here
  exactly: the model is obviously untrusted, so everything it returns is validated, re-derived and
  dropped when unsupported — while the code AROUND it assumed a tool that succeeded had found
  something, a question had words in it, a cancelled run had stopped, and the clipboard works. If
  you write the next agent, audit your own half first; the model's half will already be guarded
  because guarding it is the obvious part.

- **A tool that SUCCEEDED and found nothing is not the same as a tool that was not called.**
  `get_section` for a section that does not exist returns `{ found: false }`; a search that matches
  nothing returns an empty list. Both are `ok: true`. Gating on "did any tool succeed" let a run
  that had read nothing pay for a second model pass over a context containing only the reader's own
  question — and the only numbers such a context can support are the ones the reader typed, which is
  the answer grounding exists to prevent. Gate on what was READ, not on what returned.

- **`124` and `124A` are different sections, and a digits-only key cannot tell them apart.**
  IPC 124A is sedition; IPC 124 is assaulting the President. Reducing a reference to digits made a
  citation of one look supported by a tool result about the other, and a repealed-Act citation never
  goes near the dataset, so nothing downstream caught it. `refKey()` in `src/ai/agents/law.ts` keeps
  the letter suffix; 65B/65 and 376AB/376 collide the same way. Note the app's own
  `validateCitations` still compares on digits alone — that is a different check, upstream, and
  widening it is not one agent's decision.

- **A four-digit "section" does not exist in any of these six Acts, and that is what makes the year
  guard safe.** The longest is the BNSS at 531 sections. Without the guard, "the BNS 2023 replaced
  the IPC 1860" named two provisions that were in no citation and a correct answer was discarded.
  Count DIGITS, not characters, or `124A` gets thrown out with `2023`.

- **Hand-authored Hindi has to say so on EVERY surface that repeats it, and the tools have to
  report it for that to be possible.** All 1,059 records carry `verify: true` because the source
  publishes no Hindi (`docs/DATA-GAPS.md` #18). `compare_old_new` and `get_classification` returned
  the Hindi heading and NOT `hindiIsCurated`, which is what let the Ask panel present it as
  statutory while the card two inches below showed a marigold banner. Both tools report it now. If
  you add a tool that returns a `heading`, return the flag beside it.

- **A mark that depends on the reader's language must not be frozen when the run ends.** The
  curated-Hindi note is carried on the RESULT (`curatedHindiNote`) and rendered by the panel when
  the reader is reading Hindi, not pushed into `caveats` by the agent. The language toggle is on
  every screen: ask in English, switch to Hindi to read the Hindi phrasing, and a baked-in caveat
  leaves that Hindi unmarked. It is carried as TEXT rather than a boolean for a second reason —
  the panel must not `import` the agent module for a string, or the dynamic import in `useLawAsk`
  that keeps the agent out of the panel's chunk is quietly undone.

- **Every copy affordance in this app wraps the clipboard in a try/catch, and the new one did not.**
  `SectionActions.tsx`, `TermRow.tsx`, `PortalsPage.tsx`, the pay slip and the drafting export all
  do. Without it, a browser that refuses the clipboard — an insecure origin, a denied permission, a
  locked-down managed device — gives an unhandled promise rejection and a button that silently does
  nothing, so the reader pastes whatever was there before. Copy the pattern, not just the button.

- **`useAi().ready` is synchronous and `useAi().provider` is not.** `ready` reads the settings row;
  `provider` is a dynamic import that lands a tick later. Any control that spends tokens has to be
  disabled on `!ai.provider` too, or there is a window on first paint where pressing it throws "The
  AI provider is not ready" into a red alert — an error for a condition that resolves on its own,
  which is how a working feature comes to look flaky.

- **`validateCitations()` makes a one-pass prose agent impossible, and that is the single most
  transferable thing this session learned.** The rule rejects a provision number that appears in no
  CITED CONTEXT SNIPPET. Tool results are not context snippets — they arrive as `tool_result` blocks
  with the handles `T1`, `T2`, which that function does not read. So a single `runAgent` pass that
  calls a tool and then writes "Section 103" or "Rule 18" or "Level 7 cell 3" in its final text fails
  its own citation check every time. The answer is not to weaken the rule: it is to turn the tool
  results INTO numbered snippets and ask again. `src/ai/agents/law.ts` is that shape. Two other
  agents landed the same week and each solved it independently — read one of them before writing a
  third.

- **The research pass's closing sentence is DISCARDED, so two of `runAgent`'s failures are not
  failures of the run.** `ungrounded` and `invalid_citation` there are judgments about a sentence
  nobody will read, and the second one can never be satisfied at that stage for the reason above.
  When either fires and at least one tool result exists, the run continues and says so in
  `problems[]`. Every other code — provider, budget, aborted, max_steps — really did stop it. The
  pass is asked to end with literally `Gathered [T1] [T2]` so the tolerated path stays the exception;
  there is a test on each branch, because a tolerance with no test on its negative side is an
  unconditional bypass.

- **A BNSS First Schedule row and a section heading read alike in a prompt, and only one of them can
  answer "is it bailable".** BNS 103's heading is "Punishment for murder". `SnippetType` gained
  `classification` and `mapping` so the label says which is which; `src/ai/prompts/law.md` names both
  labels verbatim. This generalises: whenever two tool results carry different AUTHORITY over the
  same question, the label is where that goes, not the prose.

- **Write a provision inside a snippet as `Section 318(4) of the BNS`, never `BNS 318(4)`.**
  `validateCitations` extracts the full sub-section only after the word "section"; its fallback scan
  for a bare numeral matches `318` and `4` separately. Written the other way, a correct answer saying
  "Section 318(4)" is rejected as unsupported. Found by a test, not by reading.

- **`\b` does not exist between a space and a Devanagari letter.** JavaScript defines a word boundary
  over `[A-Za-z0-9_]`, so `/\bधारा/` matches nothing, ever — a pattern that looks symmetric with its
  English half and silently covers one language. `src/ai/agents/law.ts#SECTION_MENTION` keeps the
  Devanagari alternative unanchored; `src/ai/context.ts`'s own pattern already made the same
  allowance without saying why.

- **The date rule is stated by the app, not asked of the model.** The converter holds the offence
  date, so `dateRuleCaveat()` names the era for a date that was given and says plainly that it does
  not know for one that was not. `prompts/law.md` tells the model to write neither it nor the
  disclaimer, so the reader never reads two versions of one rule. Same principle as the drafting
  checklist, one step out: anything the app already knows, the app says.

- **This surface's screen is NARROWER than the Drafting Studio's, deliberately.** `screenBrief()`
  refuses a brief mentioning "secret" or "classified" — right for a document, wrong for a question,
  because "which BNS section covers communicating secret information" is about published statute.
  `screenLawQuestion()` refuses a departmental RECORD instead, every pattern requiring a digit after
  the word so "an FIR was filed on 20 June 2024" stays answerable. Do not "harmonise" the two.

- **Advice about somebody's case is a steer, not a refusal, and `isPersonalQuery` is the wrong tool
  for it.** "Will my brother get bail under 420" has a real general core — whether the corresponding
  offence is bailable — and the officer deserves that answer without a prediction about their
  brother. `caseAdviceSteer()` has its own narrow patterns; `heuristics.ts#isPersonalQuery` matches
  "can I" and "should I", which open a large share of ordinary lookups here, and its bias (a false
  positive costs only a cache hit) is wrong for a control that changes the answer.

- **A citation chip that names a REPEALED provision must not build a doc id from the old number.**
  There is no document for "IPC 420" to open — the converter's answer to it IS BNS 318 — so
  `openCitation` sets the query and lets the search open its own best hit. `bns:420` is a real BNS
  section and a different offence entirely. The query it writes names the Act, for the reason
  ADR-029 point 4 records.

- **`pnpm exec playwright test` locally does NOT build, and a stale `dist/` turns an absence
  assertion into a green tick that means nothing.** `playwright.config.ts` has
  `reuseExistingServer: !CI`, so a `pnpm preview` left running by another session (or by you, an hour
  ago) is reused and the `pnpm build` in its `command` never runs. This session's "with AI off there
  is no Ask input" test passed against a bundle that contained no Ask panel at all. Check
  `ls -la dist/index.html` and `lsof -nP -iTCP:4173` before believing a local e2e run, and kill the
  server if the build predates your work. CLAUDE.md already warned about a stray `pnpm dev`; this is
  the same hazard one step downstream.

- **A one-pass agent can avoid the citation-validator wall the law session hit, if the read is simple
  enough not to need a second round of research.** `src/ai/agents/tutor.ts` and `pay.ts` (ADR-036)
  call their tools directly, in code, BEFORE the model runs — the lookup (an act and rule, a job id)
  is named by the caller, not discovered from a first tool result — build context from the real
  output, then run the model with `tools: []` and `groundedRequired: false`. There is nothing left for
  it to call, and every number it may state is already sitting in a citable snippet. This is cheaper
  than `law.ts`'s two-pass shape and only works because the lookup itself needs no model judgement;
  reach for the two-pass shape instead the moment an agent has to decide WHAT to fetch from something
  a first pass returned.

- **A persona instruction is not a check.** "Never state a figure you were not shown" and "stay
  neutral, never recommend" are both things a model can read and still not do over a longer answer.
  `src/ai/agents/pay.ts#ungroundedFigures()` extracts every `₹…`/`NN%` token from the final answer and
  every bare number from the JSON this file fetched, compares them DIGITS-ONLY (`₹21,600` in prose and
  the `21600` a JSON number serialises as must agree), and refuses the run if one does not match.
  `containsRecommendation()` is the same idea for "compare neutrally" — a short bilingual pattern list
  run over the answer, not trusted to the prompt. Both return `status: 'refused'`, the same vocabulary
  `screenBrief()` uses, kept apart from `status: 'error'` (`runAgent` itself failing).

- **`propose_card`'s confirmation is read back from the tool's own result, never the model's sentence
  saying so** — the same lesson as the drafting checklist, applied to a WRITE instead of a checklist.
  `proposeScenario` finds the model's `propose_card` call in `run.toolResults` and reports success only
  if THAT tool returned `stored: true` and an id; a shape `cardSchema` rejects comes back `stored:
  false` and that is what gets reported. No special case was needed to keep an unreviewed AI-proposed
  card out of `get_user_weak_areas`: that tool aggregates only `reviewLog`/`srsCards`, which a freshly
  proposed card has none of, so it falls out for free — `tutor.test.ts` seeds a real lapse alongside a
  proposed card and asserts the plan reflects only the former.

- **A `setState` that only needs to reset when a key changes belongs in the read, not in an effect.**
  `ReviewPage.tsx`'s `wrongAnswer` (which card "Explain" is for) is keyed by `qId` and filtered AT READ
  TIME (`wrongAnswer.qId === current.qId ? wrongAnswer : null`) rather than cleared by a
  `useEffect(() => setWrongAnswer(null), [current?.qId])` — `react-hooks/set-state-in-effect` is right
  to reject the latter, and the fix is the same shape `TrainerActHint`/`effectiveCatalogue` already use
  elsewhere in this codebase: derive, don't resynchronise.

- **`compare_jobs` applies its ONE `overrides` object to BOTH posts, and a per-side scenario cannot be
  forwarded through it without corrupting the comparison.** `PayCompareAiPanel` sends only `{ daRate }`
  — the one field `ComparePanel.tsx` itself already shares between sides — never a side's level/cell/
  city; forwarding post A's level would silently force post B onto it.
  `src/modules/pay/aiOverrides.ts#overridesFromScenario` (used only for the single-scenario "explain my
  payslip" case) is documented as NOT round-tripping a typed custom basic pay either, since
  `overrides` has no `basic` field — a gap in the tool's own schema, not fixed here, left for whoever
  next touches
  `src/ai/tools/pay.ts`.

- **The drafting agent evaluates its own checklist in CODE, and that is the whole design.**
  `src/ai/agents/drafting.ts` is five stages and the model owns two: it picks the form and returns
  field values, and it revises once when told what failed. Stages 3 and 5 — `render_draft` then
  `check_draft` over the values that actually came back — are called by that file, through the same
  registry the model uses, with the same zod schemas. The obvious alternative was to instruct the
  model to run them (it has the tools), and it is wrong: a model that reports its own checklist as
  passing is reporting an INTENTION. Anything a future agent asserts about its own output belongs
  in the same category — re-derive it, do not believe it. ADR-032 §1.

- **The edge-case pass found four defects that were all the same mistake: the model's half of the
  run was written defensively and the CODE's half was not.** The refusal screen read the brief but
  not the officer's own draft (which is sent, and is the likelier of the two to carry a marking);
  a tool that threw rejected the promise instead of returning the documented `error` member; a run
  cancelled between stages still returned a complete draft; and `improveWording` on an empty field
  cheerfully asked a model to invent one. That is the predictable failure mode of an agent whose
  design is "three of five stages are code" — a model is obviously untrusted, so those paths get
  guarded, and the local stages get written as though code cannot fail. `screenOutbound()` is the
  fix for the first and is what callers should reach for; `screenBrief()` is now just the primitive.

- **Counting provider calls cannot detect a double-started run.** `answer()` started the run from
  inside a `setState` updater, which React invokes twice under StrictMode — and `src/main.tsx`
  renders the app inside one. Two runs started; only `start()`'s abort-the-previous behaviour kept
  the second off the wire, which is an accident and holds only while nothing synchronous happens
  before `run`'s first `await`. The aborted run makes zero provider calls, so the obvious assertion
  passes against the bug. The test counts runs STARTED, via `onSpent`, which fires in the `finally`
  of every run including an aborted one. Third StrictMode defect in this project; second time the
  lesson was that `pnpm test:e2e` runs a production build where StrictMode is inert.

- **The AI panel's suggestion list is a SNAPSHOT (`baseValues`), not a view of the live form.**
  Computing it from the live `values` meant that applying a field made its `after` equal its
  `before`, dropped its row, and took the "Applied" confirmation with it — the officer's own action
  looked like the panel losing their place. It also re-diffed every other field on each apply.

- **`editorSessionKey(draftId, createdHere)` in `src/modules/drafting/url.ts` is not the same
  question as "what is `?d=`".** A draft row is created on the first CHANGE, not on arrival, so
  applying the first field of an AI suggestion is itself what creates the row and writes its id
  into the URL. Anything keyed on `draftId ?? 'new'` remounts at that moment — which is how the
  panel used to throw away the rest of a suggestion, and the acknowledgement, a debounce after the
  officer pressed Apply. Note `createdHere` is STATE and not a ref: it is read during render to
  compute a key, and `react-hooks/refs` is right that a ref read during render can tear.

- **A revision is kept only if `mustFailing` did not get worse, and the refusal is reported.**
  A model asked to fix three items and returning a draft that fails four has not improved anything,
  and taking it silently would hand the officer a worse document with no way to tell. The test for
  this asserts that the returned checklist still reports the FIRST draft's failure honestly —
  asserting only `revised === false` would pass against a version that quietly kept the worse one.

- **A blank in a drafted document is `____`, never `{{fieldName}}`, and the reason is CSMOP's own
  checklist.** `src/lib/drafting/checklist.ts`'s `noPlaceholders` rule matches `/\{\{[a-zA-Z]/` and
  is a `must` on ten of the fourteen forms, so a brace placeholder FAILS the document — and a model
  shown a failing checklist has one obvious way to make it pass, which is to invent a file number.
  Four underscores satisfy `allRequired`, survive `noPlaceholders`, and read on paper as what they
  are. `BLANK` is exported from the agent and `parseFieldValues` reports every field carrying one.
  Do not "tidy" this to a nicer placeholder syntax without re-reading that rule.

- **`screenBrief()` runs before the provider is constructed, and the test that matters counts
  `MockProvider.calls`.** "We told the model to refuse" and "nothing was sent" are different claims.
  Its bias is deliberately the opposite of `src/ai/heuristics.ts`'s: there a false positive costs a
  cache hit, here a false negative sends an officer's classified brief to a model endpoint, so a
  brief that merely MENTIONS a marking is refused and told which word to remove. `\bsecret\b` is
  word-bounded because "Secretary" and "Secretariat" are in almost every document this app drafts,
  and there is a test for that sentence. `improveWording` screens the field's text too.

- **`validateCitations` bites harder on this agent than on any other, and `docs/DATA-GAPS.md` #60
  is the write-up.** The rule rejects a rule/section/paragraph number appearing in no CITED snippet,
  and it runs over the WHOLE final answer — which here carries the officer's document text. A body
  paragraph legitimately saying "in continuation of para 3 above" can end the run with
  `invalid_citation`. It is mitigated (the brief is context snippet `[1]`, the template spec is
  `[2]`, the persona says not to state a number the brief did not give) and it fails closed, which
  is the safe direction — an invented citation in a signed document is the worst thing this feature
  could produce. Read #60 before "fixing" it: the principled repair is a per-agent policy for which
  PART of a structured answer the rule applies to, not widening what counts as supported.

- **`SuggestionDiff` diffs EXACTLY now, and the default `diffWords` behaviour is unchanged.**
  `diffWords` folds case and punctuation and re-attaches the BEFORE token on an `equal` run — right
  for the Law Converter, where a danda is not what a Sanhita changed. It is wrong for a diff the
  reader ACCEPTS: a rewrite whose only change to a word was a capital letter rendered as "No change
  is suggested", and applying one containing such a word produced neither text. `diffWords` takes
  `{ exact?: boolean }`; `SuggestionDiff` passes it unconditionally rather than exposing a prop,
  because "what you accept is what you get" is not an invariant a caller should be able to switch
  off. Found by a unit test asserting the APPLIED value — the diff on screen looked correct.

- **Nothing that costs the reader money is attached to a render.** The ✨ "Improve wording" control
  hands its field up to `EditorPage`, which opens the panel; the panel then OFFERS the four
  rewrites and waits to be told which. The first version ran the rewrite from a `useEffect`
  watching the prop, which `react-hooks/set-state-in-effect` rejected and which was the right call
  for a reason beyond lint. Likewise the per-draft acknowledgement is reset by the panel's `key`
  being the draft id, not by an effect that watches it — an effect would clear the state one render
  after one draft's suggestion had already painted over another draft's form.

- **`lookup_admin_term` and `lookup_glossary_term` are two tools over two disjoint datasets, and an
  agent needs both.** `glossary_seed.py` drops any term `data/drafting/structure-terms.json`
  already carries (ADR-024), so **"Under Secretary" is not in `data/glossary.json`** — a drafting
  run with only the glossary would find no Hindi for the designation that signs almost every
  document this app drafts. `src/ai/tools/glossary.test.ts` asserts that absence on purpose.
  The 970 KB dataset is loaded only when the tool is called, which for a drafting run means only
  when the draft has a Hindi issue.

- **`src/ai/prompts/drafting.md` is in the CACHED prompt prefix.** Nothing in it may vary per
  reader, per language or per question — the language directive stays in `prompts.ts`'s volatile
  block, or English and Hindi get separate cache prefixes and the toggle throws the cache away on
  every use. Editing that file means bumping `PROMPT_VERSIONS['draft-assist']` in the same commit,
  which is what stops the answer cache serving anything the old wording produced. It is bilingual
  because the officer reading the output is, and the Hindi half is not a translation — it carries
  CSMOP 2022's own vocabulary.

- **ADR-021's "Tier 0 first" is superseded, in writing, and `src/modules/drafting/ai-seam.ts`
  records where each of its five conditions now stands.** Tier 0 does not exist in this build
  (`LocalProvider` throws `not_installed`), so honouring it literally meant shipping no assistant.
  What replaces it is narrower rather than weaker: the deterministic refusal screen, the per-draft
  acknowledgement, and the standing rule that **no tool in this app can reach the `drafts` table** —
  the agent is handed the values it works on as an argument from what is on screen, and
  `improveWording` sends exactly one field's text. `DRAFTING_AI_ENABLED` is still a literal wired
  to no flag, and `EditorPage` asks `draftingAiAvailable(ai.enabled)`, so the lever is real.

- **`docs/DATA-GAPS.md` #61: the deployed site's CSP will refuse the drafting run.** `connect-src
  'self'` in `public/_headers` (ADR-030, gap #57) blocks `api.anthropic.com`, and it surfaces as an
  opaque provider error rather than a network one. Everything works in `pnpm dev` and in Playwright,
  where the dev server applies no policy — which is exactly why it needs writing down rather than
  discovering. One line in `public/_headers` plus the matching expectation in
  `tests/e2e/csp.spec.ts`; read #57 first, it has the WebLLM half too.

- **Session 21 ran concurrently with a Session-20-style content session (Hindi headings, cloze
  review and MCQ authoring over `data/rules/` and `data/law/overlays/`), coordinating by direct
  message** — the arrangement Sessions 12/13, 14 and 15 established. Ownership was split by path:
  that session owned `data/rules/**`, `data/law/**` and `scripts/authoring/**`; this one owned
  `src/ai/**`, `src/modules/drafting/**` and the `draft.ai.*` i18n block. Two things crossed the
  line and both were agreed first: `src/ai/tools/registry.test.ts`'s exact tool-name list gained
  `lookup_glossary_term`, and `pnpm exec prettier --write src/ai` reformatted
  `src/ai/tools/rules.ts` and `rules.test.ts`, which had been committed unformatted in Session 12
  — whitespace and quote style only.

- **A language chunk that fails to load must never become the language the app is in.** i18next does
  NOT reject on a backend read failure — it resolves, sets `language` to what it could not load, and
  with `fallbackLng: false` renders every key as its own name. `store.ts#applyLanguage` checks
  `hasResourceBundle` and refuses to switch, persist or move `<html lang>` in that case, and
  `src/i18n/index.ts` falls through to the other language if the BOOT chunk fails. Do not "simplify"
  either check away: without them a reader whose Hindi chunk was evicted gets a screen of
  `pages.law.title`, persisted, with the toggle's own label a raw key too — no control left to escape
  with. This is NOT the silent English fallback `fallbackLng: false` forbids; that rule is about a
  missing key inside a catalogue that DID load, which must stay a CI failure.
  `src/i18n/chunk-failure.test.ts` pins the library behaviour the whole design rests on
  (ADR-031 addendum).

- **`tests/route-coverage.test.ts` derives the app's routes from the routers and fails on any route
  that is in neither the axe sweep nor the offline sweep.** It exists because the convention it
  replaces had already lapsed: `/learn/review` — the Trainer's review card, the most-used screen in
  that module — was in neither, and `/onboarding`, `/learn/mock` and `/learn/review-queue` were
  missing from the offline one. Adding a route to `LearnPage.tsx` now fails this test until the route
  is swept, or listed in its `EXEMPT` map with a reason. Never satisfy it by adding an exemption
  without one. **All five routes passed the moment they were swept — the gap was in the coverage,
  not in the pages.** Worth saying, because the opposite assumption is the natural one: finding that
  a screen was never audited reads like finding that it is broken, and here it meant only that a
  hand-maintained list had drifted from a hand-maintained app.

- **When a live region is shared by a whole page rather than owned per row, an identical repeat
  message announces nothing.** `/utils/portals` has one region for every row (unlike `TermRow.tsx`,
  where each row owns its own), so copying portal A then portal B wrote the same sentence twice and
  the second was silent. The inner span is keyed on a counter so each announcement is a real DOM
  insertion. The regression test asserts NODE IDENTITY, not text — asserting the text passes against
  the broken version, the same trap the `elementFromPoint` hit-test in `tests/e2e/pay.spec.ts` was
  written to avoid.

- **Never `localeCompare` in anything CI byte-compares.** `scripts/coverage-summary.mjs` sorted its
  rows with it, and `docs/COVERAGE.md` is regenerated and diffed by the `unit` job — ICU collation
  depends on the locale and the ICU build, so two files on the same percentage could order one way
  on a laptop and the other on the runner and fail the gate on a file nobody edited. Same rule
  `src/lib/srs/types.ts#compareStrings` states for the export.

- **A test that cannot fail is not evidence, and the sentinel case is the worked example.** The test
  that supposedly proved `surfaces()` decodes percent-encoding passed whether or not it decoded,
  because every sentinel it used was already encoding-stable. `network.sentinel()` now folds its
  label to `[A-Za-z0-9-]` so a minted value survives any encoding, and the decode test uses a value
  that genuinely needs decoding. Before trusting a new assertion here, break the code and watch it go
  red.

- **Import `test` and `expect` from `tests/e2e/fixtures.ts`, never from `@playwright/test`, and
  `tests/e2e-harness.test.ts` fails the UNIT suite if you don't.** The fixture arms an automatic
  per-test network gate: no cross-origin request, and no value the test typed (minted by
  `network.sentinel('label')`) anywhere in a request URL, query string or body. That is the master
  context's "enforced by a Playwright test" clause, moved from two hand-rolled counters in two specs
  to something a spec author cannot forget. A deliberate exception is declared in the spec
  (`network.allowCrossOrigin(...)`, as `ai-byok.spec.ts` does for `api.anthropic.com`), never by
  quietly importing the ungated `test`. `docs/TESTING.md` is the full reference (ADR-031).

- **`src/i18n/index.ts` loads ONE language at boot, through an i18next `backend` plugin.** `en.json`
  and `hi.json` are dynamic imports now, not static ones, so they are their own chunks and a reader
  downloads only the language they are reading. Two consequences worth knowing before touching
  anything nearby: `src/main.tsx` MUST keep awaiting the exported `i18nReady` before `createRoot`
  (with `useSuspense: false` nothing holds the tree back, so without the await the shell paints one
  frame of raw translation keys), and `store.ts`'s `applyLanguage` returns i18next's promise so
  `setLanguage` resolves only once the language is actually applied — `src/app/store.edge.test.ts`
  asserts exactly that and was what caught the async change. `<html lang>` is still set
  synchronously, because assistive tech reads it and it needs no strings (ADR-031).

- **A phone is a Playwright PROJECT, and it earns its runtime.** `mobile-chromium` (Pixel 7) runs
  the whole suite a second time, and on its first execution it found that the Rules Trainer's mock
  test could not be completed on a phone at all — the service worker's "Ready to work offline."
  toast is a full-width bar at `bottom-[4.5rem]` that sat on "Next question" and intercepted every
  click (`docs/DATA-GAPS.md` #59; fixed in `src/app/pwa.tsx` by a concurrent session). Three specs
  are in its `testIgnore` — `csp`, `pwa-install`, `typography` — each device-independent and each
  waiting on the service worker with a 30s ceiling. When a spec fails only on that project, check
  first whether it is asserting a desktop-only affordance: the shell swaps its navigation below
  1024px (`Main navigation` → `Main tabs`), the Drafting Studio becomes two TABS rather than two
  columns (use `showPreviewPane`/`showFormPane` from the fixture), and the command-palette button in
  the header is `hidden sm:flex`.

- **An intermittent failure that passes in isolation is a budget, not a defect — name it, don't
  retry it.** `waitFor`'s 1s default and Vitest's 5s default are races against CPU contention;
  `asyncUtilTimeout` is 8s in `src/test/setup.ts` and `testTimeout`/`hookTimeout` are 30s in
  `vite.config.ts`. `tests/e2e/a11y.spec.ts`'s route sweep carries an explicit
  `test.setTimeout(240_000)`, because it is ONE test that navigates 21 routes and runs a full axe
  pass on each — ~21s quiet, already at the default ceiling before any contention. Splitting it per
  route would multiply `setChrome()`'s IndexedDB round trip by 21 to make one number smaller.

- **Coverage is thresholded on `src/lib/**` and nowhere else, at 90%, and it measures 99.73%.**
  That scope is a decision, not an accident: `src/lib` is the pure layer and the only place a number
  can be wrong without anyone noticing. A global line-coverage target would push effort towards
  rendering components in jsdom to raise a percentage rather than towards the browser runs that find
  real problems. `docs/COVERAGE.md` is GENERATED by `scripts/coverage-summary.mjs`, committed, in
  `.prettierignore`, and diffed by CI — regenerate it in the same commit as any change to
  `src/lib/**`, or the `unit` job fails on a stale file.

- **The two property-test files assert what must hold for every input, and the FSRS one is the
  load-bearing half.** `src/lib/srs/engine.ts` is a translation layer over `ts-fsrs`, and a swapped
  entry in `RATING`, a crossed field in `toRow`/`toFsrsCard` or a lost `learningSteps` would break
  `Again ≤ Hard ≤ Good ≤ Easy` without breaking any single golden interval. It found no defects,
  which is the honest result; its value is that it will fail the first time that layer is edited
  carelessly. Note that both files depend on fuzz being OFF (ADR-025) — turning it on makes every
  interval comparison in them nondeterministic by design.

- **A scroll container has to be focusable, and `jsx-a11y/no-noninteractive-tabindex` forbids
  exactly that.** `HolidaysPage.tsx`'s local `ScrollStrip` is where the one scoped disable lives,
  with the reason. Putting a `role` on the `<ul>` instead was tried and is worse: it takes the
  list's semantics away, orphans every `<li>`, and trades one serious axe violation for five. Note
  also that `// eslint-disable-next-line` covers the next LINE, so the attribute has to be on the
  same line as the element — which is why the class list is a module const.

- **Every copy affordance in this app announces itself, and `/utils/portals` was the one that did
  not.** The button swapped an `aria-hidden` icon and said nothing, so to a screen reader it did
  nothing at all. `tests/e2e/keyboard.spec.ts` now asserts, for each confirmation, that it is inside
  `[aria-live]` or `[role="status"]` — not merely that the text is on the page. Any new
  copy/share/export button owes the reader the same.

- **The app was never renamed, because no name was given.** The Session 15 brief opened "The final app name
  is `<APP_NAME>`" — the literal placeholder from the master context above — and made the rename
  conditional on a name being supplied ("if I gave a new name now"). None was. Sahayak / सरकारी सहायक
  stands. When a name does arrive it is a mechanical change in seven places and nowhere else:
  `package.json` (`name`, `description`), `index.html` (`<title>`, the meta description, and the static app
  shell's wordmark), `src/i18n/{en,hi}.json` (`app.name`, `app.tagline`), `vite.config.ts` (the manifest's
  `name`/`short_name` and `SITE_URL`), `scripts/generate-icons.mjs` (the og.png wordmark — re-run
  `pnpm icons:generate` after), `README.md` and this file. The icons carry no text, so they need no change.
  `tests/seo.test.ts` reads the name from the i18n catalogues rather than restating it, so it follows.

- **`public/_headers` is the one copy of the Content-Security-Policy, and `tests/e2e/csp.spec.ts` PARSES it
  rather than restating it.** There is deliberately no `<meta http-equiv="Content-Security-Policy">` to
  drift from the header. That spec replays the `/*` block onto the document through `page.route` and fails
  on two independent signals — the `securitypolicyviolation` event and console errors — because CSP is
  quiet by default and a broken policy looks like a broken app. Three things it settled by measurement, all
  in ADR-030: `style-src 'self'` alone breaks the command palette (Radix Dialog's scroll lock injects a
  `<style>` whose content embeds the scrollbar width, so no hash can cover it) and the policy splits the
  directive instead — inline style ELEMENTS allowed, inline style ATTRIBUTES refused; `script-src` has no
  `'unsafe-eval'` and zod 4's caught `Function("")` probe is narrowly allowlisted rather than accommodated;
  and `connect-src 'self'` WILL refuse Tier 1 BYOK the day the AI layer ships (`docs/DATA-GAPS.md` #57 —
  read it before debugging that, it is one line in `public/_headers` plus `'wasm-unsafe-eval'` if WebLLM
  lands too).

- **`form-action 'none'` is safe only because this app contains no `<form>` element at all — read this
  BEFORE adding one.** Every input in the app is a controlled component, so the policy costs nothing today.
  The moment a real `<form>` appears, any submission that reaches a navigation is refused, and the case
  that will catch someone is the one nobody writes on purpose: pressing Enter in a single-input form
  triggers IMPLICIT submission, which navigates, which the policy blocks — silently, because a blocked
  navigation looks like a control that did nothing. There is no test for this and there should not be: a
  test asserting about an element that does not exist asserts nothing. If a form is genuinely wanted, either
  call `preventDefault()` (CSP does not govern a submission that never navigates) or widen the directive to
  `form-action 'self'` in `public/_headers` and say why. The related check that IS worth knowing: all four
  blob downloads — the holidays `.ics`, the drafting `.docx`, the Settings backup and the Trainer's CSV —
  were confirmed working in a real browser under this policy, because `default-src 'self'` lists no `blob:`
  and reasoning about it was not good enough (ADR-030 addendum).

- **Running the app under its own production CSP found a real accessibility defect no test had.**
  `Command.Dialog`'s `label` prop only sets `aria-label` on the content element; Radix still requires a
  `Dialog.Title` INSIDE it and logs a `console.error` in every build without one — not just development.
  `src/components/palette/CommandPalette.tsx` now carries a `sr-only` `Dialog.Title`. The general lesson is
  the one the spec is built on: a console error in a production build is a defect, and nothing in this
  project was watching for one until that spec.

- **`vite preview` is not what Cloudflare serves, and measuring against it is how you chase a regression
  that does not exist.** It applies neither `public/_headers` nor `public/_redirects`. `pnpm serve:dist`
  (`scripts/serve-dist.mjs`) applies both AND compresses — the first run of that server without
  compression measured FCP 4.9s against `vite preview`'s 2.1s, which was ENTIRELY the missing
  `Content-Encoding`. Every report in `docs/lighthouse/` is measured against it. `scripts/lighthouse.mjs`
  serves a COPY of `dist/` (`--root`), because a full run is seven routes and several minutes and a
  concurrent session's `pnpm build` replaced `dist/` mid-run, which surfaced as `/law` scoring SEO 92
  because `index.html` did not exist for a moment.

- **`index.html` ships the app shell as real markup, and it is load-bearing, not decoration.** `#root` was
  empty, so nothing painted until the entry chunk had downloaded, parsed, executed and resolved the active
  language's i18n chunk: FCP measured 2.6s on Lighthouse mobile. The static header inside `#root` paints
  from the document and stylesheet alone — FCP 0.9-1.3s, CLS still 0. Two rules for anyone editing it:
  every class in it must be one `src/app/TopBar.tsx` already uses (Tailwind only generates classes it finds
  in scanned source, and the shell must match the real header's `h-14` height and background or CLS moves
  off 0), and the wordmark stays the bilingual literal from `<title>` — this markup is built once and
  cannot know the reader's language.

- **Preloading a route's full transitive import graph is worse than preloading nothing. Measured twice.**
  `vite.config.ts`'s `routePreloadHeaders()` emits per-route `Link: rel=preload` hints into `dist/_headers`,
  and it deliberately emits only the route's own PAGE chunks — not their static imports. The full graph
  (two dozen hints for `/law`) was measured before the app shell landed and again after, and lost both
  times (`/law` 90 -> 87, `/pay` 86 -> 83): small preloads compete with the stylesheet and the entry chunk
  for the same throttled bandwidth, buying ~0.1s of LCP for ~0.7s of FCP. The comment at that line says so;
  do not "improve" it back.

- **U+20B9 (₹) lives in Inter's `latin-ext` subset, which is 85 KB, and that used to be the largest font
  file `/pay` requested.** `src/styles/fonts.css` declares a one-glyph `'Rupee Devanagari'` `@font-face`
  (`unicode-range: U+20A8, U+20B9`) named ahead of Inter in `--font-sans`, pointing at the Devanagari file
  the bilingual chrome already fetches — font matching is per-character, and the first family whose
  `unicode-range` covers the character wins. `/pay` stopped requesting `inter-latin-ext` entirely. The same
  file now imports ONE variable Devanagari face instead of four static weights, which also makes
  `.font-display`'s weight 800 an actual 800 — **but that one is a TRADE, not a saving, and an edge-case
  pass after the fact is what established it.** Measured total font transfer per route: the static set
  costs 111 KB on an English `/draft` and 270 KB on a heading-rich Hindi page, because it charges by how
  many weights a page happens to use; the variable file costs 180 KB either way. It is kept because a font
  strategy that is cheapest for English readers and dearest for Hindi ones is the wrong shape for a project
  whose hard rule is equal bilingual footing, and because capping the worst case beats shaving the best
  one. ADR-030 point 8 has the table. Do not "optimise" it to two static weights: 400 + 600 measures better
  than both and renders Hindi bold at 600 while English bold stays at 700. Exactly two faces are preloaded and neither is Devanagari — this build cannot know the
  reader's language, and preloading nothing was measured too and was worse.

- **Lighthouse mobile Performance is 85-93 and the brief asked for 95; the gap is LCP and tuning cannot
  close it.** Accessibility 100, Best Practices 96-100, SEO 100 are all met. LCP is 3.2-4.1s and is **89%
  render delay**, not network: the LCP element is text that does not exist until the entry chunk, the
  module chunk, the view chunk and that view's data have each been fetched and executed in sequence. The app
  shell fixed FCP because a paint can come from HTML; it cannot fix LCP, because LCP updates to whatever
  larger element appears later. `docs/DATA-GAPS.md` #58 has the numbers and the two real options
  (prerender the six routes, or fold each module's default view into its module chunk). Re-measure with
  `pnpm build && pnpm lighthouse` before attempting either — the committed reports are the baseline.

- **An init script re-runs on every navigation, so anything it collects must survive one.**
  `tests/e2e/csp.spec.ts` set `window.__csp = []` at the top of its `addInitScript`, which meant a test
  that visited two routes before asserting had already discarded the first one's violations — not a
  failure, a silent coverage hole. It accumulates in `sessionStorage` now. The same trap applies to any
  future `addInitScript` that gathers evidence across a multi-page flow.

- **`og.png` must stay OUT of the service worker's precache**, and anything else that exists only for a
  crawler. It is 47 KB referenced from a `<meta>` tag and never rendered by the app, so precaching it
  charged every installed device for an image only a social-media scraper ever fetches. It is in
  `globIgnores` beside `stats.html`; the launcher icons stay precached, because those are the installed
  app's own artwork.

- **`robots.txt` and `sitemap.xml` are generated, not committed, and the sitemap is checked against
  `src/lib/nav.ts`.** Both carry an absolute origin (`VITE_SITE_URL`, defaulting to the Pages domain), so a
  committed copy would go stale the day the site moves. `vite.config.ts` cannot import `src/lib/nav.ts` — it
  pulls `lucide-react` and the config runs in Node — so the route list exists twice, and `tests/seo.test.ts`
  is what stops them drifting, in both directions. Adding a nav destination means `src/lib/nav.ts` AND
  `ROUTE_CRITICAL_MODULES` / `SITEMAP_ROUTES` in `vite.config.ts`; that test will tell you.

- **`pnpm icons:generate` also writes `public/og.png`, and it is hand-run for a reason.** The Devanagari line
  on the card is real text rendered by librsvg, so a CI box with no Devanagari font installed would silently
  regenerate the card full of tofu boxes. The output is committed, like the icons and `public/OFL.txt`, and
  the script is on no CI step.

- **Sessions 15 (this one, deploy/CSP/perf), the test-hardening session (ADR-031, per-language i18n chunks;
  it also restructured `.github/workflows/ci.yml` and `playwright.config.ts`) and a command-palette
  edge-case pass ran concurrently in the same working tree**, coordinating by direct message rather than by
  reading each other's diffs — the arrangement Sessions 12/13 and 14 established. Ownership was split
  explicitly: one session owned `ci.yml` and `playwright.config.ts`, this one owned `vite.config.ts`,
  `public/_headers` and the deploy workflow, and each carried the other's needed changes through rather than
  editing across the line.

- **Sessions 12 (Trainer UI) and 13 (Utilities) ran concurrently in the same working tree, with no
  branch isolation, and coordinated directly** (a cross-session message, not guesswork from file diffs).
  Session 13 found Session 12's uncommitted work mid-flight, left it completely untouched, and built its
  Dexie version 9 (`holidayPicks`) on top of Session 12's version 8 rather than around it. The two
  pre-existing gaps Session 13 found and correctly left alone are now fixed (ADR-027): `src/ai/tools/
  rules.ts`'s placeholder `example.gov.in` URL and the `MockPage` chunk's `redux.js.org`/`bit.ly` URLs are
  both reviewed `ALLOWED_INERT` entries in `tests/no-external-urls.test.ts` now. One further joint issue
  neither session could resolve alone: `tests/bundle-budget.test.ts` fails — both sessions' i18n additions
  landed in the same eagerly-loaded resource bundle, and Session 13's own content is already over budget
  before Session 12's is even counted. `docs/DATA-GAPS.md` #55 has the measurement and the two real fixes
  (re-baseline via an ADR, or per-route i18next namespaces); neither session should unilaterally silence
  it by editing `BASELINE_GZIP`/`BUDGET_GZIP` without one.

- **Session 14 (onboarding + Settings) ran concurrently with a session building a command palette,
  keyboard shortcuts and share links, in the same working tree, and coordinated the same way Sessions
  12/13 did.** Read ADR-028 for the onboarding-gate and fetch-exemption decisions. Two things worth
  knowing before touching either session's surface again: `data/_meta/versions.json` was missing all
  twelve `data/rules/` rule books until this session added them (`rules-<act>` keys, generated from
  `data/rules/index.json`'s own `short` label and `source`) — an unrelated, pre-existing gap this
  session's "Data sources" screen surfaced by needing the file to be complete, not something either
  concurrent session's brief asked for. And `SettingsPage.tsx`'s `EraseSection` first shipped with a
  `bg-destructive/5` tint behind its hint paragraph, which failed `color-contrast` in the light theme —
  `--muted-foreground` has no pairing with a destructive TINT the way the marigold/tulsi/coral trio's own
  `-foreground` tokens do (tokens.css); only a real-browser `pnpm exec playwright test tests/e2e/
a11y.spec.ts` run caught it, exactly the kind of defect `src/styles/tokens.test.ts` cannot see. Fixed by
  dropping the tint and keeping only the border.

- **A requested edge-case pass over `cf69afb` (after the commit) found two more real defects, both fixed
  — ADR-028's own addendum has the detail.** `BackupSection.tsx`'s "Import backup" restored a `settings`
  row (theme, language, `ai`, `onboarded`, `devanagariDigits`) straight into Dexie with no visible effect
  until a manual reload, because that ONE table is read into `useAppStore` once at `hydrate()` rather than
  through `useLiveQuery` the way every other restored table is — it now offers a "Reload" button exactly
  when the restored file actually touched `settings`. And `OnboardingPage`'s `finish()` had no error
  handling at all: a thrown `writeLastScenario`/`saveSettings` left the reader stuck on step 3 with a
  re-enabled button and no feedback — it now surfaces a role="alert" message naming "Skip setup" as the
  fallback. The same pass also surfaced, and deliberately left alone, that `cf69afb` checked out on its own
  fails typecheck (it already referenced the concurrent palette session's files before that session's own
  commit landed) — not fixable without rewriting shared history, and `main` from `d89abf4` on is a normal,
  bisectable line regardless.

- **A palette result that builds a `/law` href from a bare section number is wrong roughly as often as it
  is right.** `data/law`'s three Acts each restart their own numbering, and plenty of numbers ALSO exist as
  a real section of the repealed Act the same digits happen to share — `/law?q=101&code=bns` re-parses on
  a fresh visit as "old IPC 101" (the Law Converter's own default direction), not "BNS 101, Murder", the
  hit the reader actually clicked. `src/components/palette/sections.ts#lawItems` builds `"BNS 101"` —
  the Act name AND the number — for exactly this reason; see ADR-029 point 4 for how this was found (only
  by clicking a real hit end to end, no unit test catches it) and why naming the Act is what fixes it
  (`directionContradicted()` in `src/modules/law/search.ts`). Any future code that builds a `toLawHref`
  from a section number found some other way owes the reader the same prefix.

- **`useGlobalShortcuts` attaches its `keydown` listener exactly once, in a mount-only effect, and reads
  `navigate`/the palette actions through a ref rather than the effect's own dependency array.** The
  ordinary `[navigate, ...]` dependency shape re-created the listener — and the `pendingG`/timer state it
  closes over — mid-chord often enough to drop roughly one `g`+letter press in five in a real browser,
  always right after a route change. `src/app/useGlobalShortcuts.ts`'s own doc comment has the full
  mechanism; the general lesson is that a `keydown` handler with any cross-keypress state (a pending chord,
  a debounce) belongs in a mount-only effect with a "latest ref" for anything from outside, not one that
  re-subscribes on every value it happens to read — `openRef`'s own pattern one function up from
  `useGlobalShortcuts` was the first hint, before the chord state made the cost of getting this wrong
  visible.

- **A `role="progressbar"` (or anything else that is not `option`/`group`) has no business as a direct
  child of `cmdk`'s `Command.List` (`role="listbox"`).** `CommandPalette.tsx`'s "still searching" indicator
  first lived there and intermittently failed axe's `aria-required-children` — reproducible only through
  `pnpm exec playwright test`'s actual test runner, never through a hand-written script replaying the same
  steps, which is itself worth remembering: a race that will not reproduce outside the real test harness is
  not evidence the harness is wrong. `Command.Loading` now sits as a sibling of `Command.List`, not a child
  — `useCommandState` reads `cmdk`'s own context regardless of where in the tree a consumer sits, so this
  cost nothing else.

- **`TrainerActHint.acts: []` (`src/modules/onboarding/actHints.ts`) means "make no change to
  `actsEnabled`", not "enable nothing".** `actsEnabled` is a restrictive allowlist whose own empty-array
  default already means "every rule book" (`src/lib/srs/types.ts`), so onboarding step 2 only narrows it
  for the small set of organisations self-evidently about intelligence, investigation or classified
  material (`ib`, `nia`, `cbi`, `ncb`, `ed`, `capf`, `delhi-police`, `mod-civ`, `drdo` — to `['ccs-conduct',
  'osa']`) and leaves it alone for every other post. Do not widen this into a per-organisation legal
  classification (e.g. against the RTI Act's Second Schedule) without a human confirming each one — the
  RTI s.24 note is shown only for IB and NIA, named in that Schedule beyond any reasonable dispute, for
  exactly that reason.

- **A card the reader locally approves or rejects in `/learn/review-queue` never mutates a `Card`.**
  `src/modules/trainer/reviewQueue.ts#effectiveCatalogue(rawCards, overrides, proposed)` is the ONE
  function that folds a `cardOverrides` decision (and an approved `proposedCards` row) back over the
  static dataset, and `src/lib/srs#isServed` only ever sees the result — it has no idea an override
  exists. Every page that schedules or counts cards calls `useEffectiveCatalogue()`, never `useRawCards()`
  directly, or a locally-approved card silently never reaches the FSRS scheduler.

- **The mock test draws only from `mcq`/`trueFalse`/`scenario` cards** — the ones `answerIndex` actually
  grades. A rule-flip or cloze card is open recall with nothing for a timed test to silently mark right or
  wrong; widening the pool to "every approved card" would mean guessing at a rule-flip card's correctness.

- **Every reactive number in the Trainer is a `useLiveQuery` over an `src/lib/srs/store.ts` function, not
  a load-once effect.** Dexie's live query tracks every table a querier function reads, transitively
  through `await`, regardless of the calling component's own dependency array — grading a card (one
  transaction across `srsCards`/`reviewLog`/`streaks`) is what makes Home's counts update the instant the
  reader navigates back, with no manual refetch anywhere. Don't reach for `useEffect` + `setState` to
  "refresh after a mutation" inside this module; a plain `useLiveQuery(() => someStoreFn(...), deps)` is
  almost always already correct.

- **The daily reminder cannot fire while no tab of this app is open — that is the actual ceiling, not a
  bug to chase.** No push server, no VAPID keys (master context), and `src/app/pwa.tsx`'s service worker
  has no custom message handler to extend. `src/modules/trainer/reminder.ts#checkAndShowReminder` runs on
  a `useNow(60_000)` tick for as long as a `/learn/*` route stays mounted; `docs/DATA-GAPS.md` #53 names
  the two real options (a push server, or Chrome-only Periodic Background Sync) if this is ever not enough.

- **`src/lib/istDay.ts` is a second, deliberately separate copy of `src/lib/srs/day.ts`'s fixed +05:30
  IST-offset reasoning, not a shared import.** `src/lib/srs/purity.test.ts` enumerates every file in
  that directory by name and polices what each one may do — importing across that boundary from three
  unrelated Utilities tools would couple them to the Trainer through a test that exists to guard a
  different module. Read ADR-026 before deciding whether a future date-arithmetic need belongs in one
  file, the other, or a third, genuinely shared one.

- **The superannuation date is one formula, not a rule plus an edge-case branch.**
  `lastDayOfMonth(addDays(addYears(dob, 60), -1))` in `src/lib/pension/engine.ts` gives the ordinary
  answer AND the "born on the 1st retires at the end of the PRECEDING month" case from the same
  expression, because age in law is attained the day before the birth anniversary. Do not special-case
  the 1st — the formula already covers it, including the December/January boundary crossing a year.

- **The gratuity ceiling is DA-linked the same way a fixed pay allowance is, not a separate rule.**
  CCS (Pension) Rules 2021 Rule 45 prints Rs. 20 lakh; what is actually payable today is Rs. 25 lakh,
  because the ceiling is raised 25% each time DA crosses 50% (it did, 01.01.2024) — the identical pattern
  `data/pay/allowances.json`'s `daLinked` field already encodes. `data/pension/pension-facts.json`'s
  `gratuity.daLinked` reuses that shape; `gratuityCeiling()` reuses `1.25 ** timesApplied`.

- **NPS and UPS are not re-declared for the pension calculator.** `src/modules/utils/pension/data.ts`
  parses `data/pay/nps.json` and `data/pay/ups.json` again, through `src/modules/pay/schema.ts`'s own
  `schemeSchema` — imported, not copied. Adding a field to either scheme's shape means touching one zod
  schema, not two.

- **`dopt.gov.in` refused every fetch this session** (403, or a broken certificate chain) — the same
  class of failure `authoring_common.build_ca_bundle()` already works around for `documents.
doptcirculars.nic.in` and `istm.gov.in`, but that fix lives in the Python authoring pipeline, not in
  `WebFetch`. The 2026 holiday calendar was read from a secondary reproduction instead, with every
  day-of-week independently recomputed and checked against the calendar rather than trusted
  (`docs/DATA-GAPS.md` #51). `scripts/ingest/holidays.py`'s `YEARS` dict is keyed by year specifically so
  a 2027 circular is a second entry, never a rewrite of this one.

- **Five of the seven defects an edge-case pass found in `src/lib/srs` were two code paths reading the
  same row and disagreeing about it** (ADR-025 addendum). The pure layer tolerated a corrupt timestamp
  the store layer threw on; the import validated a shape loosely that a Dexie index depended on
  strictly; `remaining` scoped by `actsEnabled` and `pendingLater` did not, which made a day's goal
  unreachable. None was visible to a suite that tests one file at a time. `src/lib/srs/edge.test.ts`
  is the regression file, and every test in it was confirmed to fail against the code before its fix.

- **Never `localeCompare` in this library — `compareStrings` in `types.ts` is the one comparator.**
  ICU collation is a property of the runtime, not of the data: it depends on the locale and the ICU
  build, it sorts `A-1` after `a-1` where code-unit order does the opposite, and it gives a hyphen
  variable weight — which is the one punctuation mark every card id in `data/rules` is built from. The
  export's whole claim is that two devices holding the same history produce the same bytes.
  `purity.test.ts` fails on `.localeCompare(` anywhere in the directory.

- **`2026-02-31` parses in JavaScript, as the 3rd of March, and `2026-02-31T00:00:00.000Z` does too.**
  Validate a stored day with `day.ts#isIstDay` (a round trip) and a stored instant with `transfer.ts`'s
  `isoInstant` (also a round trip) — never with a pattern, and never with a bare `Date.parse` test.

- **`reviewLog.at` is an index that `store.ts` range-queries, and that only works while every stored
  timestamp is exactly what `toISOString()` produces.** IndexedDB orders strings by code unit, so
  lexicographic order is chronological order only for one shape. That is why the import schema refuses
  `2026-03-02T09:00:00Z` and `2026-03-02T14:30:00+05:30`, both of which are valid ISO-8601 and both of
  which would sort into the wrong place and fall out of the day they belong to.

- **`src/lib/srs` is pure and it is tested for it, not trusted for it.** `purity.test.ts` reads every
  source file in the directory and fails on a React import, on JSX, on a hook name, on a dataset
  specifier, on `fetch`, on `Date.now()`, and on any file except `store.ts` importing the database. The
  first thing anyone builds over this library is a hook, and a hook is easiest to put beside the thing
  it wraps — put it in `src/modules/trainer` instead. The file list in that test is exhaustive, so a
  new file in the directory fails until it is added deliberately.

- **Every function takes the catalogue as an argument, and that is not a style choice.** `data/rules`
  is ~4 MB and belongs behind the Trainer route's lazy import, the way the statute and the pay tables
  are (ADR-013, ADR-018). Importing it inside `src/lib/srs` would put it into whatever chunk imports
  the scheduler. The caller already has the cards — it just showed one to the reader.

- **`ts-fsrs` is in `package.json` and in no chunk.** Nothing under `src/app` or `src/modules` imports
  `src/lib/srs`, so this session's `dist/` contains none of it. When the Trainer UI lands, reach the
  scheduler and the cards the way `useLawEngine(enabled)` reaches the statute — lazily, and only once
  the reader has asked for something. Re-run `pnpm build && pnpm test` afterwards:
  `tests/bundle-budget.test.ts` and the `dist/` half of `tests/no-external-urls.test.ts` both skip
  without a build, and `pnpm check` never builds.

- **Fuzz is off, deliberately, and turning it on breaks the test suite by design** (ADR-025). Every
  assertion about an interval, and the whole export/import round trip, depends on the same grade at the
  same instant producing the same due date. It also depends on two devices holding the same history
  agreeing about the schedule, which is the only sync this app will ever have.

- **Three fields on the stored rows are not in the session brief and each one is load-bearing.**
  `SrsCardRow.learningSteps` — FSRS's default steps are `1m, 10m`, and a card that comes back from
  storage as step 0 never graduates. `ReviewLogRow.stateBefore` and `.retrievability` — retention
  cannot be measured from the card rows, because grading a card overwrites the state it was in when it
  was asked. Do not "tidy" any of the three away.

- **The IST day is a fixed +05:30 offset and that is exact, not an approximation.** India has observed
  no daylight saving since 1945. `Intl.DateTimeFormat` would buy nothing and would cost `day.ts` its
  purity. Every window is `[start, end)`, so no review lands in two days or in neither — the tests in
  `day.test.ts` pin both edges at 18:29:59.999Z and 18:30:00.000Z.

- **`goalMet` is "nothing due AND nothing falling due before IST midnight", plus the cap escape.**
  Without the second clause, `Again` on the last card of the day — which empties the queue and puts the
  card back in a minute — counts as a finished day. Without the cap escape, a reader who set
  `dailyReviewCap` low could never meet a goal while a learning step was pending. `store.ts#reviewCard`
  is where all three parts are, and `ReviewResult.pendingLater` is what a UI should show beside
  "0 due".

- **Import merges by the later *review*, never by the later *file*.** A device that exported yesterday
  can still hold the newer review of a particular card. The log id is `<qId>#<reps>#<at>`, which is the
  same string on both devices, so the union counts nothing twice. `transfer.ts` is pure and every rule
  in it has a test in `transfer.test.ts`; `store.ts` only wires it to Dexie.

- **Dexie is at version 7 and `src/db/db.test.ts` asserts both the version number and the full table
  list.** Adding a table means the `.version(n).stores({...})` block, the `Table` declaration on the
  class (or `clearAllData` silently misses it), and both of those assertions.

- **The glossary's Hindi is compiled, not extracted, and every entry says so.** Unlike
  `structure-terms.json`'s fifty CSMOP-sourced terms, nothing in `data/glossary.json` was read off a
  specific page of a specific fetched document — the source PDF exceeded `WebFetch`'s 10 MB ceiling, so
  the brief's own fallback ran: seven parallel passes compiled standard Rajbhasha vocabulary from
  general knowledge. Every one of the 1,891 entries carries `verify: true` unconditionally. **Do not
  flip one to `false` without actually checking it against the Department of Official Language's own
  term list or the Central Translation Bureau's chapter 6** (`docs/DATA-GAPS.md` #48) — a spot-check is
  not the same thing as a citation.
- **`GlossarySheet.tsx`'s "Full glossary" tab and `data/glossary.json` are a SEPARATE dataset from its
  original "Structural terms" tab and `structure-terms.json`.** They answer different questions — this
  glossary is general administrative vocabulary, `structure-terms.json` is the parts of a CSMOP document
  itself — and `scripts/ingest/glossary_seed.py` actively excludes any term the two would otherwise
  answer twice. Adding a term to one is never a reason to add it to the other.
- **A page that renders more than a few hundred rows needs its render capped, and axe-core in a real
  browser is what will tell you.** `GlossaryPage.tsx`'s unfiltered view is 1,891 rows; rendering all of
  them ran `tests/e2e/a11y.spec.ts` past its 30s timeout, which the unit suite and `pnpm check` cannot
  see at all (`pnpm check` never builds or runs Playwright). `MAX_RENDERED = 100` bounds the list, not
  the search — narrowing still reaches every term. Measure with a real `pnpm build && pnpm exec
  playwright test` before assuming a new list of a few hundred rows is fine because the six-node law list
  was (ADR-016).
- **`opacity-*` on a card dims its children's text along with everything else, and a Badge is often
  already at the tokens' own contrast floor.** `UtilsHubPage.tsx`'s "coming later" cards used
  `opacity-70` to read as inert; the Badge inside dropped below WCAG AA and only a real-browser axe run
  caught it (`src/styles/tokens.test.ts` never renders a Badge inside a faded ancestor). Reach for a
  dashed border or a muted background instead of fading text.
- **`z.toJSONSchema()` (used by `src/ai/tools/registry.ts`, nothing to do with this session) has dead
  branches for JSON Schema dialects the app never requests, and a bundler ships them wherever it decides
  to place zod's core.** That moved into `GlossaryPage`'s own chunk this build and tripped
  `tests/no-external-urls.test.ts`'s dist sweep on four string literals — two dialect identifiers, and
  zod's own IPv6-validation trick (wrapping an address in `new URL("http://[...]")` to parse-validate
  it) — that had never shipped together in one physical chunk before. Three `ALLOWED_INERT` entries
  record why; if the chunk that carries this code moves again, the strings are matched by pattern, not
  by which file they happen to be bundled into.

### Notes for the next session

- **Read `docs/AUTHORING.md` before touching anything under `scripts/authoring/` or `data/rules/`.**
  It has the act-by-act checklist, the knobs the parser exposes, and what Session 20 continues.

- **No Ministry Hindi PDF in this project has a usable text layer, and that is now measured rather
  than assumed** (ADR-023). `extract_rules.py --audit-hindi` prints the numbers for each. DoPT's
  Conduct rules extract `ूशासन` for `प्रशासन`; its RTI Act maps Devanagari onto Vedic and Ol Chiki
  codepoints (`ᳰकसी` for `किसी`); rajbhasha's OL Act renders `कायाषिय` for `कार्यालय`. CLAUDE.md
  already said this about CSMOP (DATA-GAPS #36); it generalises. **Do not "correct" an authored Hindi
  string against an extracted one**, and do not add a substitution table — the ambiguity is real.

- **`reviewState` is the only thing that decides what a reader sees.** `approved` is served;
  `needs-hindi` is a card whose English is right and whose Hindi is not written; `unreviewed` is
  generated and not yet hand-reviewed; `rejected` keeps a bad card visible to an auditor and never
  shows it. `isServed` in `src/modules/trainer/schema.ts` is the one predicate. A card is never
  deleted for being wrong — it is rejected with a reason, which is the audit trail.

- **A rule card names its act in the front, and that is load-bearing.** "Definitions — which rule?"
  has twelve right answers, because twelve of these rule books head a rule "Definitions". The
  duplicate-front check in `tests/rules-data.test.ts` found forty-two such collisions and is what
  stops it regressing.

- **Two classes of rule get a card that is deliberately not served**, both with the reason in
  `reviewNote`: a rule the book has emptied ("Deleted", "Omitted" — the Leave rules have six of
  them), and a heading the same act uses twice (the RTI Act heads both s.13 and s.16 "Term of office
  and conditions of service"). They keep their cards so rule coverage stays 100%.

- **A cloze card's id is `<act>-cloze-<rule>-<span kind>`, and the kind is what makes it stable.**
  Every one of the 340 hand-written review entries is keyed on the id, so a positional counter
  re-points them at the wrong cards the first time a span is filtered out. At most one card per
  (rule, kind) is emitted, which is what makes the kind unique.

- **A cloze is rejected if its stem repeats its own answer**, and that gate runs on the FINAL stem —
  after an `edit` from the review file has replaced it, because an edit introduces the leak as easily
  as the generator does. Twelve cards passed the hand review with the answer three clauses further
  down the sentence. Note the boundary rule: assert it only on the **alphanumeric ends** of the
  answer. A plain `\b…\b` reads correctly and never matches `(1)` or `₹250`, which silently exempts
  half of what the check is for.

- **An authored key that matches nothing fails the run.** A typo in `scripts/authoring/hindi/<act>.json`
  or `review/cloze-<act>.json` used to break nothing at all — the entry was never looked up and the
  run reported success. `check_authored_keys` raises, for the reason `validate_data.py` fails on an
  unlisted dataset.

- **"Repeal and Saving" is an operative rule, not an emptied one.** The emptied-rule test matches a
  heading that _is_ "Deleted" or "Omitted", or one that says "Rep. by" (this provision was itself
  repealed). Broadening it to `repeal` took the closing rule away from five of these books.

- **A rule number that opens with a letter carries its own unit word.** `citation()` printed
  "Rule F.R. 17(1)" on 179 cards before this was noticed.

- **The MCQ options are rotated by `sha256` of the card id, and that is not cosmetic.** Stage A put
  the correct answer at index 0 in **91%** of its questions — every key right, and a card set that
  teaches position instead of law. Rotation is deterministic because `data/rules/cards/*.json` is
  regenerated on every run and a shuffle would make every run a diff; it is a rotation rather than a
  shuffle because several questions end their option list with a deliberate catch-all.

- **The parser's sequence walk is scored by substantive members, not by chain length.** The Conduct
  rules end with twenty-five numbered amendment entries, which is a longer increasing sequence than
  the rules themselves — and the parse that "succeeded" was of that table. A member counts only if
  120 characters of text follow it. Four more refinements in `extract_rules.py`, each of which was a
  wrong parse first, are documented at the function that implements them; `scripts/authoring/
test_authoring.py` covers all five and names the document that broke each.

- **`scripts/authoring/sources/` is git-ignored and `SOURCES.md` is the citation.** 21 published
  documents, ~90 MB; committing them would put a copy of the rule book in the repository instead of a
  citation to it. `SOURCES.md` carries every URL, size and SHA-256 and is regenerated by
  `fetch_sources.py --report-only`.

- **Certificate verification is never disabled, and the CA bundle is why.** Several Government of
  India hosts serve an incomplete Let's Encrypt chain: `documents.doptcirculars.nic.in` omits its
  intermediate, and `www.istm.gov.in` chains to _ISRG Root YR_, which is newer than our pinned
  `certifi`. `authoring_common.build_ca_bundle()` supplies the missing links from `letsencrypt.org`,
  over a connection that verifies against the roots we already trust, with the new root taken
  **cross-signed by X1**. `test_authoring.py` parses every module with `ast` and fails on any call
  passing `verify=False` — a grep would fail on the docstring that promises it.

- **India Code is fetched by hand, one document at a time, rate-limited, and never on a cron**
  (ADR-012). `authoring_common.RATE_LIMITED_HOSTS` holds the three-second delay so the two hand-run
  scripts cannot differ in how politely they behave. Its new host `indiacode.gov.in` currently
  answers 502; the legacy `/bitstream/` path still works (DATA-GAPS #44).

- **`data/rules` is in `.prettierignore`**, with `data/law`, `data/pay` and `data/_meta`, for the
  reason recorded there: it is written by `ingest_common`-style `write_json`, and prettier and the
  generator would take turns rewriting 4 MB.

- **Adding a rules dataset means adding it to `scripts/ingest/validate_data.py`'s `MANIFEST`**, which
  now covers 58 datasets — a file in neither `MANIFEST` nor `NO_SCHEMA` fails the run. The zod half is
  `src/modules/trainer/schema.ts`, `strictObject` throughout, with `Question` exported as an alias of
  `Card`. Both must pass.

#### Earlier sessions

- **Read `.claude/skills/frontend-design/SKILL.md` before touching any component or colour.**

- **`pnpm test:e2e` CANNOT see a StrictMode bug, and one shipped because of it.** `src/main.tsx`
  renders under `<StrictMode>`, which double-invokes every effect — mount, clean up, mount again —
  **in development only**. Playwright runs against a production build, where StrictMode is inert. So
  an effect that is not idempotent across that sequence passes all 82 e2e specs and is broken the
  moment anyone opens `pnpm dev`. Session 8 shipped exactly that twice in one hook
  (`src/modules/drafting/useDraft.ts`): a load guard armed BEFORE its own `await`, so the second
  mount skipped the read the first mount had thrown away and the form sat on three skeletons forever
  with no field to type into; and an `alive` flag cleared by the cleanup that nothing re-armed, so
  the new draft's id never reached the URL. Both are covered now by
  `src/modules/drafting/useDraft.test.tsx`, which renders the hook inside `<StrictMode>` on purpose.
  **Any new effect that guards a ref, or that a cleanup disarms, wants a test in that file** — a
  browser will not find it for you.
- **A drafting field holds ONE shared value until the officer separates the two languages.**
  `src/modules/drafting/values.ts` writes a plain string until "Write Hindi separately" is pressed,
  and an `{ en, hi }` pair after — a shape the engine already reads. That is not a shortcut around
  equal bilingual footing; it is what stops a form demanding a telephone number twice. Two things
  follow: `collapseIdentical` must stay in the "Fill with the worked example" path (every `sample` is
  stored as a pair, so without it all fifteen fields open as two boxes), and a split field's DOM id
  is `draft-field-<id>-en` / `-hi` rather than `draft-field-<id>`.
- **`fromText` returns `[]` for an empty box, never `['']`, and that is load-bearing.** The engine's
  `asList` filters blanks before rendering, so the DOCUMENT is right either way — but
  `src/lib/drafting/checklist.ts` and the engine's required-field validation both read the RESOLVED
  value, where an array holding one empty string is an array with something in it. With `['']`,
  clearing the Copy-to box left "Copies are endorsed to everyone concerned" **passing** and emptying
  the body reported no required issue. Interior and trailing blanks are still kept, because
  `fromText` runs on every keystroke and dropping the line an officer just made with Enter would take
  the caret with it.
- **Key a rendered block on `layoutIndex`, never on `role`.** Roles repeat — a demi-official letter
  has two `header` blocks and two `closing` blocks — so the role is not an identity, and pairing the
  side-by-side view on it puts both headers at the first one's position.
- **`docx` is imported inside the export handler and must stay there.** It is ~340 KB (100 KB gzip)
  for something used once per document at most. `tests/no-external-urls.test.ts` confines its OOXML
  namespace strings to that one chunk and asserts the chunk is absent from `dist/index.html`; both
  assertions fail if it is ever imported statically.
- **The `.docx` names two fonts per run and embeds neither.** `ascii`/`hAnsi` is the Latin face and
  `cs` — the complex-script slot — is the Devanagari one, and Word picks per character. That is what
  makes a bilingual signature block come out right without scanning strings. Setting `bold` without
  `boldComplexScript` gives a bold English title and a regular Hindi one.
- **The A4 preview prints against a NAMED page.** `@page draft-a4 { margin: 25.4mm }` in
  `src/styles/index.css`, applied by `.a4-print-root`, so asking for CSMOP's one-inch margins here
  does not move the pay slip or the law card, which print at the global 15mm. `.a4-page` drops its
  own padding in print, or the margin would be applied twice.
- **No AI tool may read the `drafts` table, and a test asserts it.** The six tools in
  `src/ai/tools/drafting.ts` are about templates and CSMOP rules; `render_draft` takes values as an
  ARGUMENT. Adding a `list_my_drafts` would silently turn every agent in the app into one that reads
  an officer's unfinished work. The seam for doing it deliberately, once, is
  `src/modules/drafting/ai-seam.ts` — read ADR-021 before touching it. `DRAFTING_AI_ENABLED` is
  `false` and is not wired to any flag; turning it on is a code change that shows up in review.
- **`data/drafting/index.json` carries `useWhen` so the picker loads nothing else.** 6 KB for
  fourteen names and a line each; reading the long `whenToUse` off the templates would mean
  downloading all fourteen (~330 KB) to draw a grid. `drafting_seed.py`'s `self_check` rejects a
  `useWhen` over 130 characters or one that does not end in a full stop.
- **The word-level diff now lives at `src/lib/diff.ts`**, not under `src/modules/law/`. It moved on
  its second caller — the drafting suggestion review — which is the convention the Pay module's
  `Fields.tsx` states. The algorithm is unchanged and the law module still uses it.
- **Read `docs/CSMOP-FORMATS.md` before touching anything under `data/drafting/`.** It is the reading
  of CSMOP 2022 that the templates encode, with the paragraph reference for every claim.
- **A drafting layout is data and the engine knows only block roles** (ADR-020). There is no branch
  in `src/lib/drafting/engine.ts` for an Office Memorandum; the O.M. is a list of blocks in
  `data/drafting/templates/office-memorandum.json`, and a fifteenth form is a fifteenth JSON file.
  Anything that would need a branch — "the first paragraph of an O.M. is unnumbered but an I.D. note
  starts at 1" — is a field on the block instead (`numberFrom`).
- **The Hindi CSMOP's text layer is unusable and must not be trusted** (DATA-GAPS #36). It is
  typeset from a legacy font whose glyph map yields `अभधकायी` where the page renders `अधिकारी`, and
  the ambiguity is real, so no substitution table reverses it. Every Hindi string attributed to the
  manual was read off a 130-dpi rendering. Do not "correct" one of them against the extracted text.
- **The manual's own Hindi is not the Hindi anyone would guess.** CSMOP 2022 prints `परम अग्रता` for
  Top Priority, `अर्ध-सरकारी पत्र` for a demi-official letter and `अंतर-विभागीय टिप्पणी` for the
  U.O. note. The three expected forms are in `alsoHi` so a search finds them; none is what the app
  prints, and `tests/drafting-data.test.ts` asserts both halves.
- **A checklist rule kind that nothing implements throws.** `src/lib/drafting/checklist.ts` ends in
  an exhaustive `never` switch, deliberately: an item that silently passed because nobody wrote its
  rule would be worse than no checklist at all. Adding a kind means the schema, the zod schema and
  that switch.
- **Seven of the fourteen forms are not in CSMOP at all** — circular, leave application,
  representation, RTI reply, show-cause reply, tour programme, T.A. bill cover. Each carries
  `verify: true`, a `csmopRef.chassis` naming the form whose format it borrows, and a note saying so
  in both languages. The test suite fails a template that claims to be unverified without both. The
  picker badges those seven; anything else built over a `verify: true` template owes the reader the
  same marigold treatment the Law Converter gives curated Hindi.
- **The drafting datasets reach the browser as `?raw` dynamic imports, one template at a time.**
  `src/modules/drafting/data.ts` loads `index.json` for the picker and fetches a template only once a
  form has been chosen. The fourteen import specifiers are written out because a bundler can only
  chunk a specifier it can see — a computed one would put all fourteen into every chunk.
- **The engine fills nothing in for you.** `renderDocument` used to fall back to each field's
  `sample`, per field, so a form with one field edited produced a complete document signed by the
  specimen's "(A.B.C.), Under Secretary" with the specimen telephone number — and reported no issue
  at all. That is gone: an absent field renders as nothing and is reported when the template requires
  it. `sampleValues(template)` is the worked example, and a caller has to ask for it.
- **Pair bilingual blocks on `layoutIndex`, never on `role`.** Roles repeat — a demi-official letter
  has two `header` blocks and two `closing` blocks — and pairing by role put both headers at the
  position of the first, which moved `D.O. No.` below the letterhead in the side-by-side view. Every
  `RenderedBlock` and every `BlockPair` carries the index; it is also the right React key.
- **A defect that renders as nothing is invisible to a snapshot.** The urgency grading was missing
  from four templates' layouts for a whole commit: the field, the bilingual labels and the Rajbhasha
  terms were all there, and only the block was gone. Nothing caught it because the sample value is
  `none`, which renders as nothing, so every `.txt` snapshot was byte-identical. When a field's
  sample is the empty case, assert the non-empty one too — `tests/drafting-data.test.ts` now renders
  every template with the grading actually set.
- **`drafting_seed.py`'s `self_check` is where a template's cross-references are enforced**, because
  a JSON Schema cannot see them: a placeholder naming a field the template lacks, a `source` that is
  not a list, a rule naming a role the layout never places (which makes `regexAbsent` pass over
  nothing), a `select` sample outside its own options, `urgencyAllowed` disagreeing with the field,
  and any field that appears in no layout and no rule. That last one found a demi-official letter
  that required an e-mail address and printed it nowhere. A field that deliberately renders nowhere
  goes in `GUIDANCE_ONLY` with the reason.
- **`serialise()` wraps left-aligned lines and never wraps a right-aligned one**, because wrapping the
  signature block would break the column. The `.txt` snapshots in `tests/__snapshots__/` are the
  readable record of what a document looks like; update them with `pnpm test -u` only after reading
  the diff.

- **`SectionCard` clips its children only when `active`.** `overflow-hidden` is there for the 3px
  file tab; applied unconditionally it also clipped every popup rendered inside a card, which showed
  two of sixty posts in the Pay form's combobox. Note that neither
  `getBoundingClientRect` nor Playwright's `toBeVisible` sees ancestor clipping — the regression test
  in `tests/e2e/pay.spec.ts` hit-tests `elementFromPoint` below the card's edge, because the two
  obvious assertions both passed against the bug.
- **An absolutely positioned child with no `left` falls back to its STATIC position**, which inside a
  `<button>` is where centred text would start. The `ToggleRow` knob was translated from the middle
  of its track and rendered flush outside the right edge. Anchor with `left-*` first, then translate.
- **The pay engine is pure and takes its datasets as an argument** (`src/lib/pay/*`). Nothing under it
  imports a JSON file — the unit suite reads the committed bytes off disk, the UI hands it the lazily
  imported chunks, and `src/ai/tools/pay.ts` hands it the same ones. Do not add a dataset import
  there; it would put 1.2 MB into whatever imports the engine.
- **`computePay` uses THREE different bases and they are not interchangeable** (ADR-018). Dearness
  Allowance is on cell pay + running-staff pay element + Non-Practising Allowance; House Rent
  Allowance is on cell pay + pay element and NOT NPA; every other percentage allowance is on cell pay
  alone. Collapsing them mis-states a medical officer's slip in both directions at once, and the
  golden tests assert both halves.
- **An allowance whose rate cannot be resolved returns `needsChoice`, an amount of zero and the list
  of choices — never a guess.** Ten of the thirty-two allowances carry rates that turn on a fact this
  app has no way to know. Taking the first rate would hand a CAPF constable an Army officer's Dress
  Allowance without saying so.
- **A fixed allowance is usually a quarter more than the figure its order printed.** `daLinked:
quarter-per-fifty` with `timesApplied: 1` means the rate went up 25% when DA crossed 50% on
  01.01.2024. `indexFactor()` applies it to rupee figures and to floors and ceilings, and never to a
  percentage — a percentage of pay indexes itself.
- **The pay datasets reach the browser as `?raw` dynamic imports, never a `fetch`**, exactly as the
  statute does (ADR-013, ADR-018). That is what makes the offline pay calculation in
  `tests/e2e/pay.spec.ts` work on a device that has never opened `/pay` online.
- **`tests/no-external-urls.test.ts` now allows a URL that is in a committed dataset AND on
  `CITATION_HOSTS`** (ADR-019). Both halves are required, and a paired test fails if any module under
  `src/` so much as contains one of those nineteen host names. Adding a host means adding it to that
  list, which is the review.
- **`parsePayParams` deliberately takes no datasets.** It is pure string work, so `/pay` renders on
  the first frame; `scenarioFromParams` applies the tables afterwards. Making it need the tables would
  mean downloading 1.2 MB before an empty form could paint.
- **Playwright matches a string `name` as a case-insensitive SUBSTRING.** `getByRole('combobox', {
name: 'Post' })` also matches "Place of posting". The pay spec passes `exact: true`; it cost half an
  hour to find the first time.
- **The result list is deliberately NOT virtualised** (ADR-016). Windowing produced three user-visible
  defects in a row — a blank list twice, and a list that looked capped at thirty rows — against a
  corpus that is 1,059 sections of six DOM nodes each. Measure before reintroducing it; the figure
  that would change the answer is the corpus size, not the frame rate.
- `pnpm typecheck` runs **TypeScript 7** by path (`node_modules/typescript-native/bin/tsc`). The bare
  `typescript` package is 6.0.3 and exists only for `typescript-eslint` and editors — ADR-009. Do not
  "simplify" the script back to `tsc`: which compiler runs would then depend on a bin-link race.
- The `dist/` assertions in `tests/no-external-urls.test.ts` **skip** unless a build exists.
  `pnpm check` does not build, so run `pnpm build && pnpm test` to exercise them (CI does this).
- Adding a translation key means adding it to **both** `en.json` and `hi.json`, or CI fails. Adding a
  nav destination means adding it to `src/lib/nav.ts` only — sidebar, bottom bar and router all read it.
- A colour edit must keep `src/styles/tokens.test.ts` green. It resolves values numerically from
  `tokens.css`; there is no way to satisfy it by changing a class name.
- The service worker only exists in a production build (`import.meta.env.PROD` guard in
  `src/app/pwa.tsx`) — `pnpm dev` never registers one. `pnpm test:e2e` needs Chromium once:
  `pnpm exec playwright install chromium`.
- Kill any stray `pnpm dev` before running `pnpm build`. One left watching the tree turned a 0.3s
  build into 15 minutes.
- `docs/DATA-GAPS.md` #8 / ADR-008: current `@lhci/cli` pulls a Lighthouse with no PWA category left.
  Re-verify installability with a one-off `pnpm dlx lighthouse@9 <preview-url> --only-categories=pwa`
  if that signal is needed again.
- `tests/bundle-budget.test.ts` also skips without a build. Its `BASELINE_GZIP` is the measured
  pre-AI figure and is deliberately a fixed number, so the budget cannot drift up one commit at a time.
- **The law datasets reach the browser as `?raw` dynamic imports, never a `fetch`** (ADR-013). That is
  what keeps `src/ai/providers/wire.ts` the only module in the app that may call `fetch`, and it is why
  the service worker precaches 3.9 MB of statute through the ordinary JavaScript glob — an offline
  lookup must not depend on having opened `/law` while online. Do not "simplify" this to a fetch of
  `/data/*.json`. `tests/law-data.test.ts` and `tests/law-search.test.ts` still read the files off disk
  with `readFromRoot`, so they test the committed bytes — the artefact the cron opens a PR against.
- **`useLawEngine(enabled)` must stay lazy.** The converter passes `false` until the reader has typed
  something, which was worth 62 → 84 on Lighthouse mobile for `/law`. Loading eagerly "so the first
  search is instant" hands 490 KB to every reader who only wanted to look at the page.
- **Search ranking is the `SCORE` table in `src/lib/search.ts`, and it is a set of claims about the
  law.** A heading outranks a curated keyword because the ingest lexicon attaches "theft" to 26 sections
  and only one of them is the offence of theft. `tests/fixtures/law-search.ts` is the specification —
  50 queries with the answer written beside each. Change the table only with that suite in front of you.
- **`src/lib/lexicon.ts` reads `scripts/ingest/lexicon.json`, the same file the Python ingest uses.**
  It is what makes "jamanat" reach a heading that says "bail". Do not fork it into a second copy under
  `src/`.
- `data/law/overlays/` is hand-curated and the cron cannot write to it. Number-swap warnings, the BNSS
  §531 transitional rule and the curated Hindi live there. Everything else is regenerated weekly and
  editing it by hand will be silently overwritten.
- Two schemas describe one shape: `schemas/law-*.schema.json` (Python, at write time) and
  `src/modules/law/schema.ts` (zod, in `pnpm test`). Changing the dataset means changing both, which is
  the point — neither producer nor consumer can drift alone.
- The curated Hindi carries `verify: true`, and the Law Converter renders it as a marigold "Verify"
  banner on the card; `get_section` returns `hindiIsCurated` so an agent is told the same thing. Keep
  both when you touch either — it is the one place a reader could mistake hand-authored text for the
  Act (DATA-GAPS #18).
- `tests/no-external-urls.test.ts` now allowlists the NCRB Sankalan citation, because
  `data/_meta/versions.json` is bundled. It is paired with an assertion that no module under `src/` names
  the host — do not remove one without the other (ADR-012).
- The ingest is tested with **Python `unittest`**, not `pnpm test`:
  `scripts/ingest/.venv/bin/python -m unittest discover -s scripts/ingest -t scripts/ingest`. `pnpm check`
  does not run it; CI does. Add a parser test there, not in Vitest.
- Two invariants the cron depends on, both covered by tests that failed before they were written: a run
  whose data is unchanged must write **nothing** (timestamps are masked before comparison, or the weekly
  PR is empty and nobody reads it), and `--code <one>` must **merge** into `index.json` and the DATA-GAPS
  table rather than replacing them.
- Section references are not uniformly cased. The suffix is upper (`498A`, `65B`), the sub-clause is
  lower (`2(f)`, `65B(3)(a)`). `normaliseSectionRef` preserves that split; upper-casing the whole thing
  makes a sub-clause silently answer with its parent section.
- **One module may reach the network, and `eslint.config.js` says which**:
  `src/ai/providers/wire.ts` may call `fetch`, and only after AI consent.
  `tests/no-external-urls.test.ts` asserts the count independently of the lint
  rule. Adding a second means an ADR, not a disable comment.
- Session 24 owes: the WebLLM Tier 0 provider, the Cloudflare Worker for Tier 2, and the first real AI
  surface. `docs/DATA-GAPS.md` #13-#15 record what each still needs. The five law tools
  (`src/ai/tools/law.ts`) are registered and tested and are waiting for it.
- **Lighthouse.** `/law?q=302` scores 96 on the desktop preset and 67 on the default mobile one, where
  the shell itself caps at 90 (`/settings`). `docs/DATA-GAPS.md` #22 has the full numbers and the two
  levers. Re-measure before changing anything for performance; the figures there are the baseline.
- The offence date is written **nowhere** — not IndexedDB, not `sessionStorage`. It lives in a module
  variable in `src/modules/law/url.ts` for the tab's life and in the URL when a link is shared.
- **The pay datasets are not imported by anything under `src/` yet, and how they get there matters.**
  When the Pay module is built, reach them the way the Law Converter reaches the statute — a `?raw`
  dynamic import, never a `fetch` of `/data/*.json` (ADR-013). That is what keeps
  `src/ai/providers/wire.ts` the only module in the app that may call `fetch`. `data/pay` is 1.2 MB,
  so load per dataset and only once the reader has asked for something, the way
  `useLawEngine(enabled)` does.
- **`verify: true` is not decoration.** 22 of 32 allowances, 66 of 67 posts and all 21 tax records
  carry it, because no order was fetched for those figures. A record with `verify: true` owes the
  reader the same marigold banner the Law Converter shows for curated Hindi, and an AI tool that
  returns one owes the same sentence. `docs/DATA-GAPS.md` #23-#32 name the order that would settle
  each group.
- **`daLinked` is the field a pay calculator will forget.** Most fixed allowances in
  `data/pay/allowances.json` state the rate the 2017 order set, and that rate goes up by 25% each
  time Dearness Allowance crosses 50% — which happened on 01.01.2024. Rendering `2250` for Children
  Education Allowance is a quarter short of the ₹2,812.50 actually payable. Read
  `daLinked.timesApplied` and apply it. Transport Allowance is different again: it is
  `fully-indexed`, so DA is paid _on_ it.
- **Grade pay 5400 appears twice**, at Level 9 (PB-2) and Level 10 (PB-3). Any lookup keyed on grade
  pay alone silently puts an officer in the wrong level. Key on `level`, and use `payBand.name` to
  tell the two apart. `tests/pay-data.test.ts` asserts both.
- **Level 13 in `data/pay/matrix.json` is the amended one** — ₹1,23,100 over 20 cells, not the
  ₹1,18,500 over 21 cells the 2016 gazette printed. The 2017 Amendment Rules replaced it from
  01.01.2016 and DoE O.M. 4-6/2017-IC calls the earlier one "non-existent ab-initio". Pay in it is
  still fixed with the fitment factor of **2.57**, not the index of rationalisation of 2.67; the same
  OM says pay fixed at 2.67 is liable to be recovered.
- **`data/pay/cpc8.json` has no matrix and must never grow one.** Nothing has been recommended, so
  anything a calculator shows as an "8th CPC salary" is a guess multiplied by a pay matrix. The three
  fitment factors it does carry are `status: "projected"` with what each is attributed to, and
  `tests/pay-data.test.ts` asserts the absence of a matrix because that absence is the feature.
- **The pay entries in `data/_meta/versions.json` deliberately carry no `source.url`.** `versions.json`
  is bundled, so a URL in it reaches `dist/` and needs an allowlist line in
  `tests/no-external-urls.test.ts`. The law datasets each cite one source and earned one line; the pay
  datasets are compiled from dozens of orders across as many hosts, and putting all of those on the
  allowlist would turn a reviewed exception into an open door. Every citation the UI actually shows
  lives in the per-record `source` inside each dataset (ADR-016).
- **The pay JSON Schemas are validated by Python, the zod schemas by `pnpm test`, and both must pass.**
  `scripts/ingest/validate_data.py` has a manifest of every file in `/data`; a file listed there that
  does not exist is a failure, not a skip. Adding a dataset means adding it to that manifest, to
  `schemas/`, and to `src/modules/pay/schema.ts` — which is the point.
- **Everything under `data/` has one formatter and it is not prettier.** `ingest_common.write_json` is
  it, and `data/law/`, `data/pay/` and `data/_meta/` are all in `.prettierignore` for the reason
  recorded there: `data/pay/matrix.json` is generated, so prettier and `pay_matrix.py` would take
  turns rewriting it forever. Hand-authored datasets go through `write_json` too, so the directory
  stays uniform. The schemas under `schemas/` and everything under `src/` and `tests/` are prettier's.
- **`pnpm check` does not run prettier.** It is lint, typecheck, i18n parity and unit tests. Run
  `pnpm exec prettier --check .` before a commit that adds files, or the next person's `pnpm format`
  produces a diff that looks like theirs and is yours.
- **The zod schemas in `src/modules/pay/schema.ts` are `strictObject`, deliberately.** Plain
  `z.object` strips unknown keys, so a mistyped `delhiRateProtected` or `ceiling` would parse clean,
  vanish, and be reported by nothing — while the JSON Schemas reject it. Keep new objects strict or
  the two halves stop describing the same shape (ADR-016 addendum).
