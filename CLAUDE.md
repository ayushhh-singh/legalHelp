# CLAUDE.md — Sahayak (सरकारी सहायक)

> Read this file and `docs/DECISIONS.md` at the start of every session.

---

## MASTER CONTEXT

PROJECT: Sahayak (Hindi tagline: सरकारी सहायक). Working title in code: "sahayak".

WHAT: Offline-first, bilingual (Hindi ⇄ English, EQUAL footing, toggle everywhere) PWA for Indian central
government officers and people about to join government service. Personal productivity + reference tool.

MODULES:

1. **Law Converter** — IPC↔BNS, CrPC↔BNSS, Evidence Act↔BSA, bidirectional, every section, offence-date aware.
2. **Rules Trainer** — spaced repetition (FSRS via ts-fsrs) over CCS Conduct/CCA/Leave/Pension, FR-SR, GFR 2017,
   CSMOP 2022, RTI, OSA, PoSH 2013, Rajbhasha rules. Bilingual questions with rule citations.
3. **Drafting Studio** — every CSMOP 2022 document type (OM, DO, UO, noting, notification, circular,
   endorsement, letter, leave application, representation, RTI reply, show-cause reply, tour programme,
   TA bill covering letter) with live A4 preview, Hindi admin glossary helper, phrase library,
   .docx + print-PDF export.
4. **Pay & Allowances Calculator** — 7th CPC matrix (all levels/cells) with grade pay shown, job-title picker
   that auto-adds post-specific allowances (IB SSA 20%, CBI incentive, CAPF risk/hardship, railway running
   allowance, etc.) with editable toggles and source links, DA/HRA/TA/CEA, NPS/UPS/GPF, CGHS, CGEGIS,
   income tax old vs new incl. 80CCD(2), increment/MACP/8th-CPC simulations (8th CPC = projection only),
   compare two posts, private-vs-govt comparison.
5. **Utilities** — holiday calendar (gazetted/restricted), leave calculator, pension/GPF/NPS/gratuity/
   commutation, Hindi admin glossary, portals & helplines directory.

### HARD RULES (never violate, never "improve" around)

- **PUBLIC, NON-DEPARTMENTAL DATA ONLY.** No feature that collects, profiles, monitors, investigates, or
  surveils anyone. No OSINT. No departmental data. If a request would cross this line, refuse and say why.
- All user state lives in IndexedDB (Dexie). No accounts. No backend for user data. No analytics by default.
  Zero network requests carrying user-entered data (enforced by a Playwright test).
- Free for users. No ads. No Razorpay in v1; leave a dormant, commented "billing seam" only.
- Every data card shows its source URL and dataset version. Disclaimer:
  "Reference only; verify with the official gazette/order or your DDO."
- Equal bilingual content: every data record stores `{ en, hi }` objects, not flat strings.
  Missing `hi` is a CI failure, not a fallback.

### STACK (pinned; do not swap without writing a DECISIONS.md entry)

Node 20 LTS _(see ADR-002 — currently Node 24)_, pnpm 9, React 18.3, Vite 5.4, TypeScript 5.6 strict,
Tailwind 3.4 + shadcn/ui, i18next + react-i18next (typed keys), Dexie 4, vite-plugin-pwa (Workbox), zod,
fuse.js, ts-fsrs, docx, cmdk, recharts, date-fns, zustand.
Tests: Vitest, Testing Library, Playwright, axe. Data pipeline: Python 3.12 (requests, bs4, pdfplumber,
PyMuPDF, jsonschema) run ONLY in GitHub Actions/scripts, never in the browser. Hosting: Cloudflare Pages.

### DESIGN

"Government file" identity. Tokens: `--paper` #F7F1E3, `--paper-2` #EFE7D2, `--ink` #1B2A4A,
`--ink-2` #55658A _(see ADR-003)_, `--thread` #B23A2E (single accent = red file thread), `--ok` #2F6B3A.
Dark mode = warm inverse. Fonts self-hosted WOFF2: Tiro Devanagari Hindi (display + Hindi body),
IBM Plex Sans (UI), IBM Plex Mono (section numbers, citations). Mobile-first; bottom tabs on mobile,
sidebar on desktop. WCAG AA. No decorative animation; respect `prefers-reduced-motion`.

### DATA SOURCES (public)

- NCRB Sankalan static tables — https://www.ncrb.gov.in/uploads/SankalanPortal/SectionTableBNS.html
  (+ BNSS, BSA; PDFs under `DownloadPDF/`)
- India Code — https://indiacode.gov.in (robots.txt disallows bots → fetch manually/one-off, cite, never cron)
- DoE / DoPT / DoPPW / PFRDA orders (PDF)
- DoPT annual holiday O.M.
- ISTM e-LMS reading material
- Dept of Official Language — Prashasanik Shabdavali
- data.gov.in (GODL-India licence, attribution required)

### KEY FACTS (verify at ingest; store in data, never hardcode in UI)

- DA 60% from 1 Jan 2026 (DoE OM 1/1(i)/2026-E.II(B))
- HRA 30/20/10 X/Y/Z with floors 5400/3600/1800
- TA slabs L9+: 7200/3600, L3-8: 3600/1800, L1-2: 1350/900 (X&Y / Z), DA on TA
- NPS emp 10% govt 14%; UPS govt 18.5%
- CGHS L1-5 ₹250, L6 ₹450, L7-11 ₹650, L12+ ₹1000
- grade-pay↔level: 1800=L1, 1900=L2, 2000=L3, 2400=L4, 2800=L5, 4200=L6, 4600=L7, 4800=L8,
  5400(PB2)=L9, 5400(PB3)=L10, 6600=L11, 7600=L12, 8700=L13, 8900=L13A, 10000=L14
- IB ACIO-II = L7 GP4600 + SSA 20% of basic
- 8th CPC constituted 3 Nov 2025, report ~mid-2027, no fitment factor notified

### REPO LAYOUT

`/data` (versioned JSON, bundled at build) · `/schemas` · `/scripts` (python + node) ·
`/src/modules/{law,trainer,drafting,pay,utils}` · `/src/{app,components,i18n,db,lib,styles}` ·
`/tests/e2e` · `/docs` · `.github/workflows`

### WORKING AGREEMENTS FOR CLAUDE CODE

- **ZERO PAID SERVICES.** Never add a dependency on a paid API or service. Content authoring (quiz questions,
  Hindi text) is done by YOU, Claude Code, inside the session, in batches — not via the Anthropic API.
- Read `CLAUDE.md` and `docs/DECISIONS.md` at the start of every session.
- Do all research, fetching, seeding, verification, testing and committing yourself. Ask the human only for
  secrets, logins, or product decisions. If a source is unreachable, record it in `docs/DATA-GAPS.md` with
  what you tried and continue with the best public alternative — do not stop.
- Every fact that lands in `/data` must carry `{ source: { name, url }, fetchedAt }` and be schema-validated.
- When unsure whether a number is official, keep it but set `verify: true` so the UI shows "verify with DDO".
- Write tests for every calculation and every search. Run `pnpm check` before every commit.
  Conventional commits.

### SESSION CLOSE-OUT (mandatory)

1. Run every acceptance check listed in the session; fix until green.
2. Update `CLAUDE.md` (current status, how to run), `docs/DECISIONS.md`, `docs/DATA-GAPS.md`.
3. Print a short summary: what was built, what was verified, anything the human must look at on a device.
4. Commit with the given message. End with the literal line: `ALL ACCEPTANCE CHECKS PASSED`
   (or `BLOCKED: <reason>`).

---

## CURRENT STATUS

**Session 1 complete — application shell only. No module has real data or logic yet.**

| Area          | State                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Toolchain     | pnpm 9.15.9 via corepack, Node 24 (ADR-002), TS 5.6 strict + `noUncheckedIndexedAccess` |
| Design system | `src/styles/tokens.css`, light + warm-inverse dark, all pairs verified WCAG AA          |
| Fonts         | 10 self-hosted WOFF2 in `public/fonts` (268 KiB). No runtime third-party request        |
| i18n          | 66 keys × {en, hi}, typed via module augmentation, `fallbackLng: false`                 |
| Persistence   | Dexie v1 with a `settings` table; zustand store hydrates from it                        |
| Shell         | 6 lazy routes, sidebar ≥1024px / bottom tabs below, skip link, landmarks                |
| Modules       | All five are placeholder pages (PageHeader + EmptyState + Disclaimer)                   |
| Tests         | 53 passing across 6 files                                                               |
| Deferred      | vite-plugin-pwa, Playwright, fuse.js, ts-fsrs, docx, cmdk, recharts                     |

## HOW TO RUN

```bash
corepack enable          # once — pins pnpm to the version in package.json
pnpm install
pnpm fonts:fetch         # once — downloads WOFF2 into public/fonts (needs network)
pnpm dev                 # http://localhost:5173
```

### Scripts

| Command            | Does                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `pnpm dev`         | Vite dev server, with the dev-only axe reporter logging to the console |
| `pnpm build`       | Typecheck, then production build into `dist/`                          |
| `pnpm preview`     | Serve the built `dist/` on :4173                                       |
| `pnpm lint`        | ESLint 9 flat config, type-aware on `src/`                             |
| `pnpm typecheck`   | `tsc --noEmit` over both the app and the Node config projects          |
| `pnpm test`        | Vitest (jsdom)                                                         |
| `pnpm i18n:check`  | Fails if `en.json` and `hi.json` disagree on keys                      |
| `pnpm fonts:fetch` | Re-download and regenerate `public/fonts` (idempotent)                 |
| `pnpm check`       | `lint && typecheck && i18n:check && test` — run before every commit    |

### Notes for the next session

- The `dist/` assertions in `tests/no-external-urls.test.ts` **skip** unless a build exists.
  `pnpm check` does not build, so run `pnpm build && pnpm test` to exercise them (CI does this).
- `pnpm fonts:fetch` needs network access. The WOFF2 files are committed, so a fresh clone does not
  need to run it.
- Adding a translation key means adding it to **both** `en.json` and `hi.json`, or CI fails.
