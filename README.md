# Sahayak · सरकारी सहायक

**English** — Sahayak is a free, offline-first, bilingual reference and productivity tool for Indian central
government officers and for people about to join government service. It converts sections between the old and
new criminal codes (IPC↔BNS, CrPC↔BNSS, Evidence Act↔BSA), calculates pay and allowances on the 7th CPC
matrix, drafts every CSMOP 2022 document type, drills the conduct, leave, pension and financial rules by
spaced repetition, and answers the everyday questions — holidays, leave balance, pension, the Hindi
administrative term, which portal. Hindi and English are on equal footing everywhere — not a translation
layer over an English app.

**हिन्दी** — सहायक भारतीय केंद्रीय सरकारी अधिकारियों तथा सरकारी सेवा में आने वाले उम्मीदवारों के लिए एक
निःशुल्क, ऑफ़लाइन-प्रथम, द्विभाषी संदर्भ एवं कार्य-सहायक उपकरण है। यह पुरानी और नई दंड संहिताओं के बीच धाराओं
का मिलान करता है, 7वें वेतन आयोग के अनुसार वेतन एवं भत्तों की गणना करता है, सीएसएमओपी 2022 के सभी दस्तावेज़
प्रारूपित करता है, आचरण, अवकाश, पेंशन एवं वित्तीय नियमों का अभ्यास कराता है, तथा अवकाश-गणना, पेंशन, हिंदी
शब्दावली एवं पोर्टल-निर्देशिका जैसे रोज़मर्रा के प्रश्नों का उत्तर देता है। हिंदी और अंग्रेज़ी दोनों को समान
स्थान प्राप्त है।

It is a Progressive Web App. Install it once and every module — the whole statute, the whole pay matrix, all
twelve rule books — works with the aeroplane mode on.

---

## Features

### Law Converter — `/law`

IPC ↔ BNS, CrPC ↔ BNSS, Evidence Act ↔ BSA, in both directions, for **every** section: 1,059 of them,
covering BNS 1–358, BNSS 1–531 and BSA 1–170 in full. Search by section number (Devanagari digits included),
by English or Hindi text, by roman-Hindi (`hatya` finds हत्या), or by Act name in either script; or browse an
Act end to end. Each section opens as an old-vs-new card with a word-level heading diff, the First Schedule
classification (cognizable, bailable, triable by), trap banners where a number means something different
under the new code, and bilingual citations you can copy, share or print.

**Offence-date aware.** Which code applies turns on when the offence was committed — 1 July 2024 is the
boundary — so the converter asks for the date and answers accordingly. The date is written nowhere: not to
IndexedDB, not to `sessionStorage`. It lives in a module variable for the tab's life.

### Rules Trainer — `/learn`

Spaced repetition over twelve rule books — CCS (Conduct), CCS (CCA), CCS (Leave), CCS (Pension), GFR 2017,
FR/SR, the RTI Act, the Official Secrets Act, PoSH 2013, the Official Languages Act and Rules, and
CSMOP 2022 — extracted into 818 rules and 2,607 cards, of which 571 are hand-reviewed and served.
Scheduling is FSRS (`ts-fsrs`), with the fuzz deliberately switched off so two devices holding the same
history agree about the schedule.

Home with a due count and a streak, review over five card kinds, a timed mock test with an accuracy-by-rule-book
chart, browse by Act and rule with per-rule mastery, bookmarks, a report-a-card queue with CSV export, and a
local review queue. Every question cites the rule it comes from, in both languages.

### Drafting Studio — `/draft`

All fourteen document types an officer actually writes — Office Memorandum, D.O. letter, U.O. / I.D. note,
noting on a file, notification, circular, endorsement, ordinary letter, leave application, representation,
RTI reply, show-cause reply, tour programme, T.A. bill covering letter — each with a guided bilingual form
beside a live A4 preview (English / हिंदी / side-by-side), a Hindi administrative glossary and phrase library
in the body editor, and a live checklist that **refuses** an export while a required item fails.

Export to `.docx` (real Word, correct margins, both font slots so bilingual text comes out right) or print to
PDF. Drafts autosave locally, with duplicate, rename and an undoable delete. Seven of the fourteen forms are
ones CSMOP prescribes no format for; those are badged, and each names the form whose format it borrows.

### Pay & Allowances — `/pay`

The complete 7th CPC matrix — 19 levels, 540 cells — with grade pay shown, a picker over 67 posts that knows
its acronyms (`ACIO` finds a post whose title never spells it) and 102 cities with aliases. Pick a post and
it adds that post's own allowances: IB SSA at 20%, CBI incentive, CAPF risk & hardship, railway running
allowance, each editable and each with a link to the order it comes from.

DA, HRA, TA, CEA, NPS / UPS / GPF, CGHS, CGEGIS and income tax under both regimes including 80CCD(2); a
payslip card with a "why" disclosure on every line that prints open on A4; increment, FR 22 fixation, DA
what-if and 8th CPC simulations; compare two posts, or a government post against a private offer.

The 8th CPC screen shows **no matrix and never will** — nothing has been recommended, so any figure would be
a guess multiplied by a pay matrix. It carries the constitution date, the status and the projections it is
labelled with.

### Utilities — `/utils`

- **Holiday calendar** — gazetted and restricted holidays from the DoPT O.M., a month grid, restricted-holiday
  picks, and an `.ics` export of the gazetted list.
- **Leave calculator** — EL, HPL, Casual Leave and Restricted Holidays under the CCS (Leave) Rules 1972, with
  the rule cited beside each figure; EL and LTC encashment; LTC block years.
- **Pension & retirement** — superannuation date (including the "born on the 1st" rule), NPS or UPS
  projection, retirement gratuity with the DA-linked ceiling, commutation, GPF.
- **Hindi administrative glossary** — 1,891 terms across seven categories, searchable in English, Hindi and
  roman-Hindi, with favourites and recents.
- **Portals & helplines** — 22 Government of India portals with their published helplines.

### Everywhere

Command palette on Ctrl/⌘-K over law sections, posts, glossary terms, document types, rule books and portals;
`g` + a letter to jump modules; a language toggle on every screen; light and dark themes; first-run
onboarding; export, import and erase of everything the app has stored about you.

## Screenshots

_To add — one per module, light and dark, English and Hindi:_

- `docs/screenshots/law-converter.png` — a section open with the old-vs-new diff
- `docs/screenshots/law-converter-hi.png` — the same section in Hindi
- `docs/screenshots/pay-calculator.png` — the payslip card with a "why" disclosure open
- `docs/screenshots/drafting-studio.png` — the O.M. editor beside its A4 preview
- `docs/screenshots/rules-trainer.png` — a review card and the due/streak home
- `docs/screenshots/utilities.png` — the holiday calendar
- `docs/screenshots/command-palette.png` — Ctrl-K over a bilingual query
- `docs/screenshots/installed-android.png` — the installed PWA on a phone, offline

## Privacy

Everything you enter stays in your browser, on your device, in IndexedDB.

- **No accounts.** There is nothing to sign up for.
- **No backend for user data.** The app is a static bundle; there is no server to send anything to.
- **No analytics, no ads, no trackers** — not even privacy-preserving ones.
- **No third-party requests at runtime.** Fonts are self-hosted. Datasets are bundled, not fetched.
- **The AI layer is off, and off means not downloaded.** It is built in full and dormant. Turning it on is an
  explicit, revocable choice; until then the browser never downloads the code that could reach a network.

Three tests hold this rather than a promise: `tests/no-external-urls.test.ts` sweeps the production build for
any fetchable external reference, `tests/e2e/zero-third-party-requests.spec.ts` drives the real app through
every route while counting cross-origin requests, and `tests/bundle-budget.test.ts` proves the AI layer's
network-capable code is absent from the initial download.

The deployed site sends a strict Content-Security-Policy (`connect-src 'self'`, no `unsafe-eval`,
`frame-ancestors 'none'`) from [`public/_headers`](public/_headers), and `tests/e2e/csp.spec.ts` replays that
exact policy in a real browser on every route.

**Backups are your own.** Settings → Backup exports everything to a file and imports it back. Clearing your
browser's site data erases your settings and progress, and nobody — including us — can restore them.

## Public data only

Sahayak uses **public, non-departmental data only**. It holds no departmental data and has no feature that
collects, profiles, monitors, investigates or surveils anyone.

| Area         | Sources                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| Criminal law | NCRB Sankalan section tables (BNS / BNSS / BSA), India Code                           |
| Pay          | 7th CPC report, Department of Expenditure O.M.s and gazette notifications             |
| Rules        | DoPT, DoPPW and Department of Expenditure published rule books; ISTM reading material |
| Drafting     | CSMOP 2022 (16th edition), DARPG                                                      |
| Hindi terms  | Department of Official Language, Central Translation Bureau                           |
| Holidays     | DoPT annual holiday O.M.                                                              |
| Pension      | CCS (Pension) Rules 2021, CCS (Commutation) Rules 1981, PFRDA                         |

Every data card shows its source URL and dataset version in the interface, and Settings → Data sources lists
all of them with the date each was fetched. `docs/DATA-GAPS.md` records, openly, every figure that could not
be traced to a fetched order — those are marked `verify: true` in the interface too.

**This project is not affiliated with, endorsed by, or connected to any government department, ministry or
agency.** Every figure it shows is a reference. Verify with the official gazette, the relevant order, or
your DDO before you act on it.

Fonts are used under the SIL Open Font License 1.1 (see [`public/OFL.txt`](public/OFL.txt)). data.gov.in
material, where used, is under GODL-India with attribution.

## Reporting a data error

A wrong figure in a reference tool is worse than a missing one, so corrections are the most valuable thing
you can send.

**Open an issue** with:

1. **Where** — the screen and the exact card (for example, "Pay → allowances → Children Education Allowance").
2. **What it says**, and **what it should say**.
3. **The source** — the O.M., gazette notification or rule number, with a link if it is online. This is the
   part that matters most: a correction with a citation can be applied and tested; one without it can only be
   marked `verify: true`, which it may already be.

Settings → About also has a "Report a data error" link that opens a mail draft with the app version and the
dataset version already filled in.

If you would rather send a patch: datasets live under [`data/`](data) and are **generated** — edit the script
in [`scripts/ingest/`](scripts/ingest) or [`scripts/authoring/`](scripts/authoring) that writes the file, not
the JSON, or the next pipeline run will overwrite you. Hand-curated overlays are the exception and are marked
as such. Every dataset is validated against a JSON Schema in [`schemas/`](schemas) by Python and against a zod
schema under `src/modules/*/schema.ts` by the test suite; both must pass.

## Running it

Node 24 and pnpm 9.15 (via corepack).

```bash
corepack enable
pnpm install       # fonts come with it, from @fontsource
pnpm dev           # http://localhost:5173
```

| Command              | Does                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server, with axe logging accessibility violations to the console |
| `pnpm build`         | Typecheck, then production build into `dist/`                             |
| `pnpm check`         | Lint, typecheck, i18n parity and unit tests — run before every commit     |
| `pnpm test:coverage` | Unit tests with the `src/lib/**` coverage thresholds enforced             |
| `pnpm test:e2e`      | Playwright, on a desktop and a phone viewport, against a production build |
| `pnpm size`          | The initial-route size budget (`scripts/size-budget.json`)                |
| `pnpm analyze`       | Build with a bundle treemap at `dist/stats.html`                          |
| `pnpm serve:dist`    | Serve `dist/` with the production `_headers` applied                      |
| `pnpm lighthouse`    | Lighthouse over every route, into `docs/lighthouse/`                      |

See [CLAUDE.md](CLAUDE.md) for the full script list, project context and current status,
[docs/TESTING.md](docs/TESTING.md) for how to run each suite and what each one guarantees,
[docs/COVERAGE.md](docs/COVERAGE.md) for the current coverage of the pure layer,
[docs/DECISIONS.md](docs/DECISIONS.md) for architectural decisions, and
[docs/DATA-GAPS.md](docs/DATA-GAPS.md) for what is known to be unverified.

## Deployment

Cloudflare Pages. `.github/workflows/deploy.yml` publishes on a green CI run: `main` to production, every
other branch to a preview URL. It needs three repository secrets — `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PROJECT_NAME` — and optionally a `SITE_URL` repository variable, which
sets the canonical and Open Graph origin.

## Licence

MIT — see [LICENSE](LICENSE). The datasets under `data/` are compiled from public government sources; each
record carries its own attribution.
