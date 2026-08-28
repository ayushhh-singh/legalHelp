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
About card with a data-sources table. It ran concurrently with another session building a command
palette, keyboard shortcuts and share links, in the same working tree; each coordinated directly with
the other rather than guessing from file diffs, the same arrangement Sessions 12/13 used.**

| Area            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain       | pnpm 9.15.9 via corepack, Node 24 (ADR-002), TypeScript 7.0 native compiler, strict + `noUncheckedIndexedAccess` (ADR-009)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Design system   | Neev tokens in `src/styles/tokens.css` — Tailwind 4 CSS-first (`@theme inline`, `@custom-variant dark`). Light is `:root`, dark only on `.dark` from the toggle (ADR-010). 85 contrast assertions in `tokens.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Fonts           | `@fontsource` Inter / Poppins (Latin only) / Noto Sans Devanagari, bundled by Vite. `public/OFL.txt` generated by `pnpm fonts:licenses`. No runtime third-party request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| i18n            | 995 keys × {en, hi} at last count (up from 909; the figure moves with whichever concurrent session's work landed most recently — check `pnpm i18n:check`'s own output for the live number), typed via module augmentation, `fallbackLng: false`. Nav labels live in `src/lib/nav.ts` as `{ en, hi }`. The `pay.*` block is still the largest single one (186 keys); a new top-level `trainer.*` block (160 keys — Session 12, the whole Trainer UI), Session 13's `utils.holidays.*`/`utils.leave.*`/`utils.pension.*`/`utils.portals.*`, and Session 14's new `onboarding.*` block plus `pages.settings.digits`/`.reminder`/`.updates`/`.backup`/`.erase`/`.about`/`.dataSources` are the newest. All land in the same eagerly-loaded resource bundle and, together, keep the initial route over its 30 KB gzip budget — `docs/DATA-GAPS.md` #55, not resolved by any one session's content alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Persistence     | Dexie **v10** (up from v6 — v7 is the Trainer scheduler, ADR-025; v8 is the Trainer UI's bookmarks/reports/review-queue tables, ADR-027; v9 adds `holidayPicks`, keyed `"<year>:<holidayId>"`, indexed on `year` — Session 13's restricted-holiday picks; v10 adds `commandRecents`, the concurrent command-palette session's own table). `settings`, `secrets` / `aiAnswers` / `aiUsage` (AI, empty until turned on), `lawFavourites` / `lawRecents`, `payScenarios` (up to 10 named, and an eleventh is refused rather than evicting one), `drafts` (uncapped — a draft is work, not a comparison set — with an undoable delete), `draftDefaults` (one saved letterhead per form) and `glossaryFavourites` / `glossaryRecents` (Session 10, the same `{id, createdAt}` / `{id, viewedAt}` shape the law tables use). Settings rows: language, theme, `ai`, `pay` (the last scenario), `learnReminder`, and (Session 14) `onboarded` / `devanagariDigits` — plain booleans, no new table needed. Store hydrates from it and tolerates blocked storage. Dexie v7's four trainer tables — `srsCards` (keyed `qId`, indexed on `due`), append-only `reviewLog`, `streaks` (keyed on an **IST** date) and a one-row `trainerSettings` — have their row shapes declared in `src/lib/srs/types.ts` and imported here as types (ADR-025). Dexie v8 adds `trainerBookmarks` and `cardOverrides` (both keyed on `qId` alone — a decision about one card, not a log) and the append-only `trainerReports` / `proposedCards` (ADR-027)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Shell           | 6 lazy routes from the one `src/lib/nav.ts` config: sidebar ≥1024px, bottom bar below (4 tabs + a "More" sheet under 768px), skip link, landmarks. Active state = 3px gold rule on the chrome edge + semibold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Components      | `src/components/ui-x/`: Chip, Badge, ProgressBar, InfoCard, SectionCard (the file tab), SectionNumber, StatCard, Skeleton, QueryErrorState, Breadcrumbs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Law Converter   | `/law` search (section numbers incl. Devanagari digits, English, Hindi, roman-Hindi, Act names in both scripts) and **browse** — a code chip with an empty box reads that Act end to end, "All" reads all three. Sticky list beside the open section from 1024px, stacked below it. Old-vs-new card with a word-level heading diff, the First Schedule table, trap banners, bilingual citations, share / save / print / close. Offence-date rule on the 1 July 2024 boundary. The whole view lives in the URL (ADR-013, ADR-015)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pay calculator  | `/pay`, four tabs, the whole view in the URL. A `cmdk`-shaped combobox over 67 posts (acronyms included — "ACIO" finds a post whose title never says it) and 102 cities with aliases; Level select showing grade pay, cell stepper showing basic; DA select prefilled from the latest **notified** rate with the projection offered and labelled; payslip card with a "why" disclosure on every line that prints open on A4; simulations (increment, FR 22 fixation, 8th CPC behind a non-dismissible projection banner, DA what-if); two-post diff and private-vs-government. Pure engine in `src/lib/pay` (ADR-018)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Modules         | **Law Converter, Pay & Allowances, the Drafting Studio and Utilities are all built** (rows above and below) — Utilities' fifth and last tool, portals, landed this session alongside holidays/leave/pension, so `UtilsHubPage` no longer has a "coming later" card. **Trainer is built too** — its data, its scheduler (ADR-025) and now its UI (ADR-027): Home, review, mock tests, Browse, Bookmarks, Reports, Settings and the Local Review Queue at `/learn/*` |
| AI layer        | `src/ai` — built in full, **off by default** (ADR-011, `docs/AI.md`). Consent gate _is_ the feature flag; four tiers (`byok` works, `local` / `proxy` shown disabled with a reason); AES-GCM key vault; agent loop with step cap, zod validation, per-tool timeouts, a hard monthly token budget and grounding that fails closed; tool registry with an MCP-shaped JSON export; numbered type-labelled context + citation validation; bilingual heuristics; local answer cache. Twenty-two tools registered: five over the statute, five over pay, **six over drafting** (`src/ai/tools/drafting.ts` — templates and CSMOP rules only; nothing registered can reach the reader's `drafts` rows, and a test asserts it), **four over the Trainer** (`src/ai/tools/rules.ts` — `get_rule_text`, `get_user_weak_areas`, `get_card_history`, and `propose_card`, the one tool in the app that WRITES, to `proposedCards`, never directly to the schedule, ADR-027), two common. Lazy-loaded: **+5.9 KB gzip** on the initial route, essentially all of it consent copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PWA / offline   | `vite-plugin-pwa` (`generateSW`, `registerType: 'prompt'`); manual `workbox-window` registration + bilingual update/offline-ready toasts (`src/app/pwa.tsx`); real service-worker-era `OfflineBadge`; installable (Lighthouse PWA category 1.0 via a one-off `lighthouse@9` run — ADR-008)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Tests           | 1,346 unit across 58 files + 82 Playwright e2e, the law ones run at four viewports. The law suites read the committed `data/law/*.json` off disk — dataset coverage, ranking against a 50-query bilingual acceptance set (`tests/fixtures/law-search.ts`), every "What's new" bullet resolved and its claim checked. `tests/pay-data.test.ts` reads `data/pay/*.json` off disk the same way — 95 assertions, every one confirmed to fail against a deliberately corrupted copy (ADR-016 addendum). `src/lib/pay/*.test.ts` holds 73 golden pay slips whose figures were worked out from the orders before the code ran. e2e adds an offline section lookup AND an offline pay calculation, both with no network at all, a real-input privacy run, the keyboard path, and axe over every route × 2 languages × 2 themes plus the three non-default pay tabs. `tests/drafting-data.test.ts` renders all fourteen committed templates in both languages and in Devanagari digits and runs each one's own checklist over the result; `tests/drafting-render.test.ts` snapshots the Office Memorandum and a note on a file as `.txt` files, because the thing under test is the shape of a page. Session 8 adds `src/lib/drafting/docx.test.ts` (the packed archive unzipped with Node's own zlib and read: A4, 1-inch margins, both font slots, Devanagari intact, well-formed XML against a hostile subject line, all fourteen templates in both languages), `src/modules/drafting/drafting.test.ts` (46 over the bilingual value model, the URL, the drafts table and the suggestion diff) and `src/ai/tools/drafting.test.ts` (29, through the registry so the zod schemas run). e2e adds `tests/e2e/draft.spec.ts`: one run that writes an O.M., clears the checklist, exports a real `.docx` and reads the file off disk, switches the preview to Hindi, reloads into the restored draft — with a request counter armed across the whole flow — plus an offline editor run, and axe now covers `/draft/office-memorandum`. Session 10 adds `tests/glossary-data.test.ts` (reads `data/glossary.json` off disk the same way the other dataset suites do — count floor, no duplicate ids/English terms, no overlap with `structure-terms.json`, every `hi` real Devanagari, fails against a corrupted copy), `src/modules/utils/glossary/{search,useGlossarySuggest,favourites}.test.ts` (34 tests, including the roman-Hindi "avar sachiv" search case) and `tests/e2e/glossary.spec.ts` (search, category filter, favourites/recents surviving a reload, the render cap, the Drafting Studio's Full glossary tab and the body editor's replace-suggestion chip), plus one offline lookup and one clipboard/IndexedDB privacy run added to the existing offline and zero-third-party-requests specs. **1,744 unit tests as of Session 13** (the 1,346 figure above predates both this session and Session 12's Trainer UI, ADR-027). Session 12 adds `src/modules/trainer/{reviewQueue,store,reminder,intervalLabel}.test.ts` (over the local-override merge, the bookmarks/reports/review-queue Dexie helpers, the best-effort reminder's pure decision logic and the grade-button interval labels) and `src/ai/tools/rules.test.ts` (through the registry, against the real committed `data/rules`), plus `tests/e2e/learn.spec.ts` — one run asserting the brief's own acceptance flow by NAME (CCS (Conduct) Rule 1, then Rule 2 — the first two approved cards a fresh device with no history will ever show, not a fixture) with a language toggle mid-card and a request counter armed throughout, a completed mock test, and an offline review session — and extends `tests/e2e/a11y.spec.ts` / `tests/e2e/zero-third-party-requests.spec.ts` over the new routes. Session 13 adds `src/lib/holidays/engine.test.ts` (25, including the .ics export's CRLF framing, per-event UID uniqueness and text escaping), `src/lib/leave/engine.test.ts` (12, including EL/HPL credit landing exactly on the half-yearly figures and the 300-day cap holding once credit exceeds it either side of a leave-taken deduction) and `src/lib/pension/engine.test.ts` (21, including the DoB-on-the-1st superannuation edge case in both directions across a year boundary, the gratuity ceiling's DA-linked uplift, and the UPS Rs. 10,000 floor) — no `tests/e2e/*.spec.ts` was added this session, since none of Session 13's own acceptance checks named one and the generic offline/zero-network specs already sweep every route |
| Law data        | `data/law/{bns,bnss,bsa}.json` + `index.json` — 1,059 sections covering every one of BNS 1-358, BNSS 1-531 and BSA 1-170, full English text, 288 BNS sections classified from the BNSS First Schedule, reverse index over IPC/CrPC/IEA with number-swap warnings. 3.9 MB, reaching the browser as `?raw` chunks and precached (ADR-012, ADR-013)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ingest          | `scripts/ingest/` (Python 3.12): `ncrb_sankalan.py` weekly, `indiacode_seed.py` by hand only, `pay_matrix.py` by hand (`--check` in CI), `drafting_seed.py` by hand (`--check` in CI), `validate_data.py` over all 32 datasets in CI — it fails on a dataset that is in neither its manifest nor its stated no-schema list, so a new file cannot go unvalidated. 67 stdlib-`unittest` tests. Inline-HTML parse with a `pdfplumber` fallback measured at 99.4% agreement, hand-curated overlays the cron cannot write to, an 86-term bilingual offence lexicon. Run by `ci.yml` and by the refresh workflow before it touches `data/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pay data        | `data/pay/` — 11 datasets, 1.2 MB, reaching the browser as `?raw` chunks and precached (ADR-018). The whole 7th CPC matrix (19 levels, 540 cells, generated from the gazette rule and checked against the scan); 22 Dearness Allowance rates from nil to 60% plus one flagged projection; 102 X/Y cities from the DoE annexure with aliases and the four Delhi-rate towns; 32 allowances with rates, tax position and DA-escalation; 67 posts, each resolving to a Level and a set of allowance ids; CGHS, CGEGIS, NPS, UPS; income tax for FY 2026-27 both regimes; and 8th CPC status facts with no matrix (ADR-016)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pay sourcing    | 10 of 32 allowances, the matrix and every city are read from a fetched order; the rest carry `verify: true` with `docs/DATA-GAPS.md` #23-#32 naming the order that would settle each. The 899-page 7th CPC report is the one pay source with a text layer; every DoE order is a scan, read by rendering and recognising and then checking by eye                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Drafting data   | `data/drafting/` — 17 files, 476 KB, written by `scripts/ingest/drafting_seed.py` and reaching the browser as `?raw` chunks. 14 `DocTemplate`s (letter, D.O., O.M., circular, I.D. note, noting, notification, endorsement, leave application, representation, RTI reply, show-cause reply, tour programme, T.A. bill cover), each with fields, a bilingual block layout, a machine-evaluable bilingual checklist and the CSMOP paragraph it comes from; 78 Rajbhasha structural terms; 49 bilingual phrases; an index the picker can load alone (ADR-020)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Drafting engine | `src/lib/drafting/` — pure, takes the template as an argument. `render(template, values, 'en' \| 'hi' \| 'bilingual')` → a structured model (header, refLine, subject, paras[], closing, signature, copyTo[], enclosures[]) plus a plain-text serialiser that wraps and aligns; required-field, date-format and unknown-option validation; auto paragraph numbering; auto `Encl.: as above (n)`. `checklist.ts` implements thirteen rule kinds and throws on an unimplemented one. Values are never filled in for the caller — `sampleValues(template)` is the worked example, asked for explicitly; every rendered block carries the `layoutIndex` the bilingual view pairs on; a multiline value is split into real lines; and a list is normalised to exactly what renders, so what the checklist reads and what the page shows cannot disagree (ADR-020 addendum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Drafting source | CSMOP 2022 (16th edition) English and Hindi, fetched from DARPG; `docs/CSMOP-FORMATS.md` is the reading of it, with paragraph references. The Hindi issue's text layer is scrambled by a legacy font, so every Hindi string was read off a rendered page — which is how `परम अग्रता` (not `सर्वोच्च अग्रता`) and `अर्ध-सरकारी पत्र` (not `अर्ध-शासकीय`) survived. Seven of the 14 forms are ones CSMOP prescribes no format for: each carries `verify: true` and names its chassis (DATA-GAPS #36-#39)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Drafting Studio | `/draft` picker — 14 cards grouped by what an officer is doing, each with its one-line CSMOP "use when" from `index.json` alone (6 KB; a template is fetched only once a form is chosen), its paragraphs, and a badge on the seven forms the manual prescribes **no** format for. `/draft/:type` editor — guided bilingual form beside a live A4 preview with English / हिंदी / side-by-side tabs; a body editor with a numbering gutter and a phrase / glossary / urgency / enclosure / copy-to toolbar; a live checklist drawer; `.docx` + print + clipboard export behind a gate that **refuses** a failing required item and asks once for a recommended one; drafts that autosave to Dexie with duplicate, rename and undoable delete; "Save as my template" for the letterhead only. The whole view is in the URL — the draft's text never is (ADR-021)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Glossary data   | `data/glossary.json` — 1,891 terms across seven categories (designation, office, file, finance, establishment, legal, it), ~970 KB, reaching the browser as a single `?raw` chunk gated behind `useGlossary(enabled)`. Compiled from standard Rajbhasha administrative usage rather than read off one fetched page — the source PDF (`rajbhasha.gov.in/sites/default/files/saralshabdavali.pdf`, the same one `structure-terms.json` cites) exceeded `WebFetch`'s 10 MB ceiling — so every entry carries `verify: true` unconditionally (ADR-024, `docs/DATA-GAPS.md` #48). `scripts/ingest/glossary_seed.py` reads the raw category pairs from `scripts/ingest/glossary_sources/*.json`, cross-deduplicates by English term and drops the seven terms `data/drafting/structure-terms.json` already carries |
| Glossary module | `/utils/glossary` — instant search (English, Hindi, roman-Hindi via `romanKey()`, no new lexicon), a category filter, copy buttons, favourites and recents in Dexie. Render capped at 100 rows regardless of view (`MAX_RENDERED`) — an unfiltered 1,891-row list ran `axe.run()` past a 30s timeout in `pnpm exec playwright test`; the search itself is uncapped. The Drafting Studio's own `GlossarySheet.tsx` gained a second "Full glossary" tab reaching this dataset through the SAME `onInsert` callback its existing 78-term structural tab already used, and `BodyEditor.tsx`'s `useGlossarySuggest` hook underlines-by-chip any English term with a known Hindi equivalent when the officer is typing in Hindi mode, with a one-click replace (ADR-024) |
| Holidays data   | `data/holidays/holidays-2026.json` — 17 gazetted + 34 restricted holidays for Delhi/New Delhi, from DoPT O.M. F.No. 12/2/2023-JCA dated 03.07.2025. `dopt.gov.in` itself refused every fetch this session (403 / broken certificate), so the dated list is read from a secondary reproduction with every day-of-week independently recomputed and checked (`verify: true`, ADR-026, `docs/DATA-GAPS.md` #51). `scripts/ingest/holidays.py <year>` keeps this repeatable — `YEARS` is keyed by calendar year, so 2027 is a second entry |
| Leave engine    | `src/lib/leave/` — pure, no dataset: `rules.ts` holds the CCS (Leave) Rules 1972 constants (EL 2.5 days/month capped at 300, HPL 20/12 days/month, commuted leave at 2× debit) each with its rule citation, `engine.ts` accrues EL/HPL by completed month and pro-rates Casual Leave/Restricted Holidays (DoPT instructions, not the 1972 Rules — `verify: true`) in the year of joining. `cashEquivalent()` is the (basic+DA)/30×days formula shared by EL and LTC encashment |
| Pension data    | `data/pension/pension-facts.json` — superannuation (FR 56(a)), retirement/death gratuity (CCS Pension Rules 2021 Rule 45, including the DA-linked ceiling escalation — allowances.json's own pattern, reused: Rs. 20 lakh → Rs. 25 lakh), the CCS Commutation Rules 1981 age-factor table (62 rows, fetched PDF's table unparseable this session — cross-checked against a second source instead, `verify: true`, `docs/DATA-GAPS.md` #52) and the GPF rate history (7.1%, `dea.gov.in` certificate failure — `docs/DATA-GAPS.md` #49). NPS and UPS are NOT repeated here — `src/modules/utils/pension/data.ts` re-parses `data/pay/nps.json`/`ups.json` through the Pay module's own `schemeSchema` (ADR-026) |
| Pension engine  | `src/lib/pension/engine.ts` — pure: `superannuationDate()` (the "born on the 1st retires at the end of the PRECEDING month" rule, one formula, no branch), `retirementGratuity()`, `commuteePension()`, `projectNpsCorpus()`/`projectGpfBalance()` (simplified monthly-compounding projections, held in today's rupees), `upsAssuredPayout()`/`upsLumpSum()` |
| Portals data    | `data/portals.json` — 22 Government of India portals and helplines (e-HRMS, SPARROW, CGHS, DoPT, Bhavishya, CPENGRAMS, CPGRAMS, iGOT Karmayogi, EPFO, NPS/CRA, UPS, GeM, PFMS, CGEGIS, Kendriya Bhandar, CSSS, Kanthasth, Bharati, India Code, e-Gazette, NCRB Sankalan, DoE), bilingual purpose and category, a public helpline where one is published. Every record `verify: true` — several URLs (SPARROW, e-HRMS, CSSS) could not be independently confirmed this session (`docs/DATA-GAPS.md` #50) |
| Utilities' other tools | `/utils/holidays` (month-at-a-glance grid + full list, G/R tags, restricted-holiday picks capped at two in a new `holidayPicks` Dexie table, an upcoming strip, an RFC 5545 `.ics` export of the gazetted list only, a delegation note), `/utils/leave` (EL/HPL/CL/RH balances with `SourceChip` citations, EL and LTC encashment, LTC block years, EOL and leave-preparatory-to-retirement notes), `/utils/pension` (superannuation date, NPS-or-UPS projection, gratuity, commutation, GPF), `/utils/portals` (search + category filter + copy-URL). `UtilsHubPage`'s four "coming later" cards are now live links (ADR-026) |
| Rules data      | `data/rules/` — 25 files, ~4 MB. `text/<act>.json` for twelve rule books (CCS Conduct, CCA, Leave, Pension; GFR 2017; FR/SR; RTI, OSA, PoSH; OL Act and Rules; CSMOP 2022) — **818 rules**, no duplicate numbers, each with number, heading, text and sub-rules. `cards/<act>.json` — 2,607 cards, **571 served**: 221 rule, 209 cloze, 141 authored questions. `index.json` carries the counts so the picker loads nothing else (ADR-023)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Rules authoring | `scripts/authoring/` (Python 3.12), hand-run and on no cron: `fetch_sources.py` (21 documents, cited in `SOURCES.md`), `extract_rules.py`, `make_cards.py`, `qa_pipeline.py` (stages C and D, and the acceptance report). 43 stdlib-`unittest` tests. **Hindi is authored, never extracted** — every Ministry Hindi issue is legacy-font byte soup (ADR-023, DATA-GAPS #42)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rules questions | 151 bilingual MCQ / true-false / scenario questions over CCS Conduct, CCA, Leave, RTI and PoSH, written in session and put through four separate passes — generate, critic, blind verify, rapidfuzz dedup — of which **141 approved**. Rejects stay in the card file with their reason and are never served. `docs/authoring-reports/2026-08-28.md` is the acceptance report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Trainer engine  | `src/lib/srs` — FSRS over `ts-fsrs` 5.4, **fuzz off** so the same grade at the same instant always gives the same due date. Seven files: `types.ts` (the stored shape), `day.ts` (IST day boundaries and the streak), `engine.ts`, `queue.ts`, `stats.ts` and `transfer.ts` — all pure — and `store.ts`, the only one that opens Dexie. No React, no dataset import, no clock of its own; `purity.test.ts` asserts all three by reading the files (and that nothing sorts with `localeCompare`). 162 tests against a frozen clock — including `edge.test.ts`, seven defects an edge-case pass found, each confirmed to fail against the code before its fix — plus `tests/srs-corpus.test.ts` over the committed cards (ADR-025) |
| Trainer UI      | `src/modules/trainer/` — `/learn` Home (due count, streak, a `ProgressBar` "today's goal" indicator, weak-area chips that link into a filtered review, act toggles); `/learn/review` (one `CardView` per card, all five kinds, keyboard 1-4/space, bookmark/report); `/learn/mock` (timed, scoped to `mcq`/`trueFalse`/`scenario` — the kinds with one right answer — no reveal until the end, a `recharts` accuracy-by-rule-book bar chart on the results screen); `/learn/browse` (Act → rule → per-rule mastery bar, from `srsCards`, no `data/rules/text` load); `/learn/bookmarks`, `/learn/reports` (CSV export), `/learn/settings` (daily new, review cap, target retention, act toggles, the reminder); `/learn/review-queue` (j/k/a/e/r, generationMeta shown when present, bulk-approve on a matched critic+blind-verify). `useLiveQuery` throughout — no manual refetch anywhere, since Dexie's live query tracks every table `src/lib/srs/store.ts`'s functions actually read. A local decision never mutates a `Card`: `cardOverrides`/`proposedCards` are folded over the dataset at read time by `reviewQueue.ts#effectiveCatalogue`, which is the only thing `isServed` ever sees (ADR-027) |
| Onboarding      | `/onboarding` (Session 14) — three skippable steps, reached ONLY from a bare `/` on a device that has never completed or skipped it (`App.tsx`'s `path="/"` route branches on `hydrated` then `onboarded`; every other route, deep link included, is untouched — ADR-028). Step 1: language, the same `setLanguage` toggle Settings uses. Step 2: an optional post + city via the Pay module's own `JobPicker`/`CityPicker` — picking one writes a `PayScenario` to `settings.pay` (`writeLastScenario`, so a bare `/pay` opens prefilled) and, for a small set of intelligence/enforcement organisations only, narrows `TrainerSettings.actsEnabled` to `['ccs-conduct', 'osa']` (`src/modules/onboarding/actHints.ts#trainerActHintsForJob`) — every other post makes no change, since an empty `actsEnabled` already means "every rule book" and narrowing it for a fresh install would have made the Trainer look broken for the common case. Step 3: the three-promise privacy statement, "Understood" finishes. "Skip setup" is one tap on every step |
| Settings        | `/settings` — language, theme, a global Devanagari-digits toggle (`useAppStore().devanagariDigits`, wired into the Drafting Studio's `render`/`renderDocument` calls — the engine option existed since Session 8 with no control anywhere; Session 14 closes that), a daily-reminder status line linking to `/learn/settings` for the actual toggle (one setting, read by both screens, not duplicated), the AI section, "Check for data updates" (`src/lib/dataUpdates.ts` — fetches `data/_meta/versions.json` fresh, bypassing the browser cache and the service worker's `StaleWhileRevalidate` rule with a cache-busting query param, diffs it against the bundled copy), export/import/erase (`src/lib/backup.ts` — export/import cover every Dexie table except `secrets`/`aiAnswers`/`aiUsage` by name, so a table a later session adds is backed up by default; erase is gated by a typed `ERASE` confirmation), an About card (version, build sha via a `vite.config.ts` `define`, licence, a `mailto:` "Report a data error" link) and a data-sources table reading `data/_meta/versions.json` directly. `src/lib/dataUpdates.ts` is a second, narrowly-scoped `fetch` exemption in `eslint.config.js` alongside `src/ai/providers/wire.ts` — ADR-028 |
| Deferred        | cmdk (`ts-fsrs` landed in Session 11, `recharts` in Session 12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## HOW TO RUN

```bash
corepack enable          # once — pins pnpm to the version in package.json
pnpm install             # fonts come with it, from @fontsource
pnpm dev                 # http://localhost:5173
```

### Scripts

| Command               | Does                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Vite dev server, with `src/app/axe-dev.ts` logging axe violations to the console                      |
| `pnpm build`          | Typecheck, then production build into `dist/`                                                         |
| `pnpm preview`        | Serve the built `dist/` on :4173                                                                      |
| `pnpm lint`           | ESLint 9 flat config, type-aware on `src/`                                                            |
| `pnpm typecheck`      | TypeScript 7 (`typescript-native`) over both the app and the Node config projects                     |
| `pnpm test`           | Vitest (jsdom)                                                                                        |
| `pnpm i18n:check`     | Fails if `en.json` and `hi.json` disagree on keys                                                     |
| `pnpm fonts:licenses` | Regenerate `public/OFL.txt` from the installed `@fontsource` licences (idempotent, offline)           |
| `pnpm icons:generate` | Re-rasterize `public/icons/*.png` from `src/assets/pwa-icon.svg` (idempotent, offline, needs `sharp`) |
| `pnpm test:e2e`       | Playwright; builds + serves `dist/` itself (see `playwright.config.ts`)                               |
| `pnpm check`          | `lint && typecheck && i18n:check && test` — run before every commit                                   |

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
