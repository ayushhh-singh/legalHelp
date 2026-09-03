# Testing

Everything this repository checks, how to run it, and — the part that matters when a test fails —
what each suite actually guarantees.

The organising idea is that **a test belongs where its failure mode lives**. A wrong rupee figure is
a unit test over a pure function; a colour that fails contrast is an axe run in a real browser,
because jsdom has no paint; a control nobody can reach with the keyboard is a `Tab` loop, because
`toBeVisible()` passes for it. Chasing one number across all of them produces tests that pass and
prove nothing.

---

## Running it

```bash
pnpm check          # lint + typecheck + i18n parity + unit tests. Before every commit.
pnpm test           # Vitest, jsdom, ~1,900 tests across ~100 files (~90s)
pnpm test:watch     # the same, watching
pnpm test:coverage  # the same, with thresholds over src/lib/** (see below)
pnpm test:e2e       # Playwright: both projects, ~285 tests (~3.5 min). Builds dist/ itself.
```

Two things `pnpm check` deliberately does **not** do, both because they need a build:

```bash
pnpm build && pnpm test   # runs the dist-only suites too (bundle budget, no-external-urls, seo)
pnpm size                 # the same budget, printed as a per-asset table
```

and one it does not do because it needs Python:

```bash
cd scripts/ingest && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
python -m unittest discover -s scripts/ingest -t scripts/ingest -v
python scripts/ingest/validate_data.py
```

One suite is opt-in and reaches the network — the only one in this repository that does:

```bash
AI_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… pnpm exec vitest run src/ai/agents/drafting.live.test.ts
```

Without **both** of those it is skipped, so `pnpm check`, `pnpm test` and CI never make a request.
See §8 below for what it is for and why its assertions are about shape rather than wording.

First Playwright run on a machine needs the browser once:

```bash
pnpm exec playwright install chromium
```

Useful while working on one spec:

```bash
pnpm exec playwright test --project=desktop-chromium tests/e2e/law.spec.ts
pnpm exec playwright test -g "copies its citation" --repeat-each=10   # chase a flake
pnpm exec playwright show-trace test-results/<dir>/trace.zip          # read a CI failure
```

---

## The suites, and what each one guarantees

### 1. Unit — `pnpm test`

Vitest under jsdom, with `fake-indexeddb` so Dexie is real rather than mocked. `src/test/setup.ts`
clears **every** table before each test, so no test can leak an AI key, a cached answer or a
scenario into the next one.

| Area                   | Files                                                                                | Guarantees                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure calculation       | `src/lib/**/*.test.ts`                                                               | Golden figures worked out from the orders **before** the code ran (73 pay slips, the FSRS schedules, the leave and pension arithmetic). A test that asserts what the code currently returns tests nothing.                                                                                                                                                                                                                             |
| Properties             | `src/lib/pay/rounding.property.test.ts`, `src/lib/srs/fsrs.property.test.ts`         | What must hold for _every_ input: rounding is monotonic and idempotent, a pay slip's lines add up to its own gross, and `Again ≤ Hard ≤ Good ≤ Easy` for any card in any state. See below.                                                                                                                                                                                                                                             |
| Datasets               | `tests/*-data.test.ts`                                                               | The committed bytes under `/data`, read off disk — the artefact the weekly cron opens a PR against, not an import. Every assertion in `tests/pay-data.test.ts` was confirmed to fail against a deliberately corrupted copy. `tests/library-data.test.ts` additionally checks a POINTER: every unit id a Library work names has to exist in the corpus it points at, and every record in that corpus has to be reachable from the work. |
| Components and routes  | `src/**/*.test.tsx`, `src/app/App.a11y.test.tsx`                                     | Rendering, hooks and axe under jsdom. `color-contrast` cannot run here — jsdom has no layout — so it reports as _incomplete_, which is why suite 3 exists.                                                                                                                                                                                                                                                                             |
| Design tokens          | `src/styles/tokens.test.ts`                                                          | 85 contrast assertions, resolving `var()` chains and compositing `/15` tints **numerically** from `tokens.css`. There is no way to satisfy it by changing a class name.                                                                                                                                                                                                                                                                |
| The e2e harness itself | `tests/e2e-harness.test.ts`                                                          | That every Playwright spec imports the gated `test` (suite 4). Run by `pnpm test`, so forgetting is a red build rather than a silent hole.                                                                                                                                                                                                                                                                                             |
| Build artefacts        | `tests/bundle-budget.test.ts`, `tests/no-external-urls.test.ts`, `tests/seo.test.ts` | **Skip silently without a build.** Run `pnpm build && pnpm test`; CI has its own job.                                                                                                                                                                                                                                                                                                                                                  |

### 2. Coverage — `pnpm test:coverage`

`vite.config.ts` scopes coverage to `src/lib/**` and fails below **90% of lines, functions and
statements**. Current figures and the per-file table are in [COVERAGE.md](./COVERAGE.md), which is
committed and which CI regenerates and diffs — so the numbers in the repository are always the ones
the last green run measured.

Scoped to `src/lib` on purpose. It is the pure layer, and the only part of this app where a number
can be wrong without anyone noticing. Everything else has a suite that catches its own kind of
defect, and a global line-coverage target would push effort towards rendering components in jsdom to
raise a percentage rather than towards the browser runs that find real problems.

Branch coverage is reported and not thresholded; [COVERAGE.md](./COVERAGE.md) says why.

### 3. Property-based tests

Two files, using `fast-check`. They exist because golden tests and property tests fail at different
things: an off-by-one shows up as a golden figure one rupee out, but a rounding rule that is not
monotonic, or a scheduler whose "Good" button sometimes schedules sooner than "Hard", only shows up
over a range of inputs.

- **`src/lib/pay/rounding.property.test.ts`** — `rupees`, `percentOf` and `nearestTen` are whole,
  monotonic, idempotent and half-up; and over ~120 random scenarios `computePay` never produces a
  negative, non-finite or fractional figure, its lines add up to its own gross and net, more DA is
  never less pay, a later cell is never less basic, `quarters: true` always means no HRA, and
  `regime: 'auto'` never picks the dearer of the two.
- **`src/lib/srs/fsrs.property.test.ts`** — over cards put through arbitrary review histories,
  **grade monotonicity** (`Again ≤ Hard ≤ Good ≤ Easy` in interval and stability, and the reverse in
  difficulty) at any retention setting; `reps` advances by exactly one; nothing is ever scheduled
  into the past; every stored timestamp is exactly what `toISOString()` produces (`reviewLog.at` is
  a Dexie index that `store.ts` range-queries, and IndexedDB orders strings by code unit); and the
  same grade at the same instant repeats, which is what fuzz being off buys (ADR-025).

A counterexample is a bug report rather than a hint: fast-check shrinks to the smallest failing
input and prints the seed to reproduce it.

### 4. End-to-end — `pnpm test:e2e`

Playwright against a **production build** (`playwright.config.ts` `webServer`), because the service
worker only exists there and axe's `color-contrast` needs real paint.

**Two projects.** `desktop-chromium` (Desktop Chrome) and `mobile-chromium` (Pixel 7 — 412×915,
touch). The phone project is not a duplicate run: the shell swaps its whole navigation below 1024px
(sidebar → bottom tab bar, four tabs + a "More" sheet under 768px), the Drafting Studio becomes two
tabs rather than two columns, and the Law Converter stacks. A control reachable on a desktop and
unreachable on a phone is what that project exists to find — and it did, twice, on the run that
introduced it (see _Findings_, below). Three specs run once, on desktop: `csp.spec.ts`,
`pwa-install.spec.ts` and `typography.spec.ts`, each device-independent and each waiting on the
service worker with a 30-second ceiling.

**Both languages.** `tests/e2e/journeys.spec.ts` runs the eight journeys from the brief in English
and in Hindi: a converter lookup and copy, the IB ACIO-II pay slip, an Office Memorandum and its
live preview, a Trainer review, all four Utilities tools, onboarding, and Settings' export followed
by erase. Every label comes from `src/i18n/{en,hi}.json` through `t()` in the fixture rather than
being hard-coded — a renamed key then fails to resolve instead of silently asserting against a
string the app no longer renders.

The module specs (`law`, `pay`, `draft`, `learn`, `glossary`, `palette`) go deeper on one module
each and are not duplicated per language; `journeys.spec.ts` is the breadth, they are the depth.

**Offline.** `tests/e2e/offline.spec.ts` reloads **every** route with the network switched off and
asserts each renders its own `<h1>`, not merely the shell — `navigateFallback` means a client-routed
path is never precached under its own name, so a hard reload has to be answered by the cached shell
and then re-routed. That is the case an officer actually hits: a PWA is reopened, not navigated to.
Plus an offline section lookup, an offline glossary lookup, an offline pay calculation and an
offline review session, each from a device that has never opened that route online.

### 5. The privacy gate — automatic, every e2e test

The master context's hard rule is "zero network requests carrying user-entered data, enforced by a
Playwright test". `tests/e2e/fixtures.ts` is that enforcement, and it is **automatic**: importing
`test` from there — which every spec does — arms a fixture that, at teardown, fails the test if

1. any request crossed the origin, or
2. any request URL, query string or **body** contained a value the test typed.

Values are minted with `network.sentinel('label')`, which returns `SNTNL-<label>-<n>` — a string
that appears nowhere in this repository except where a test puts it. Sentinels rather than realistic
input on purpose: `"302"` or `"Delhi"` appear in chunk filenames and cached dataset URLs by
coincidence, and a privacy assertion that produces false positives gets weakened until it produces
false negatives instead.

The listener is on the **browser context**, not the page, so a request made by the service worker or
by a second page escapes nothing. The one declared exception is `tests/e2e/ai-byok.spec.ts`, which
calls `network.allowCrossOrigin(/api\.anthropic\.com/)` because Tier 1 _is_ that request — declared
in the spec, not assumed.

`tests/e2e-harness.test.ts` (a **unit** test, so it runs on every commit) fails if any spec imports
`test` from `@playwright/test` directly. Exemptions live in its `UNGATED` map and must carry a
reason; `csp.spec.ts` is the only one, because it manufactures request-level behaviour through
`page.route` that the gate is written to treat as a defect.

The static half of the same rule is `tests/no-external-urls.test.ts`: it sweeps built source for
fetchable references, and `eslint.config.js` restricts `fetch` to two named files.

### 6. Accessibility

Four layers, each catching what the others cannot:

| Layer                        | Catches                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.test.ts`  | Contrast, numerically, from the token values. Runs in `pnpm check` and names which pairs it checks.                                                                                                                                                                                            |
| `src/app/App.a11y.test.tsx`  | axe under jsdom, fast, per route. `color-contrast` is _incomplete_ here, not passing.                                                                                                                                                                                                          |
| `tests/e2e/a11y.spec.ts`     | axe in a real browser over **21 routes × 2 languages × 2 themes**, plus the pay tabs, an open section card, the More sheet, the command palette, the shortcuts sheet, the AI consent modal and onboarding. Zero violations of any impact — stricter than the brief's "no serious or critical". |
| `tests/e2e/keyboard.spec.ts` | Reachability and focus order, `prefers-reduced-motion`, and live regions.                                                                                                                                                                                                                      |

`keyboard.spec.ts` is keyboard-**only** in the literal sense: no `click()`, no `fill()` on a
locator, nothing that teleports focus. Every step is `Tab`, `Shift+Tab`, `Enter`, `Space` or a
printable character sent to whatever has focus, and a failure prints the whole focus trail. It walks
the Law Converter in both languages (skip link first, reach the search box, type, open the top hit
with `Enter`, reach the section's own actions) and a Trainer review (reach "Start review", `Space`
to reveal, `3` to grade). `toBeVisible()` passes for a control no amount of tabbing can reach, which
is exactly what this is for.

Reduced motion is asserted against the **computed** style under
`page.emulateMedia({ reducedMotion: 'reduce' })` — nothing animates for longer than 50ms — with a
negative case that fails if transitions were simply deleted from the stylesheet rather than
conditioned on the setting.

Live regions: every copy confirmation is asserted to be inside `[aria-live]` or `[role="status"]`,
not merely on the page. The icon swap alone is `aria-hidden`, so an un-announced copy is a button
that, to a screen reader, did nothing.

### 7. The AI layer — `MockProvider` everywhere, and one opt-in live test

Every AI test runs against `src/ai/providers/mock.ts`: a fixture lists the turns the provider will
return, in order. That makes the tool loop, the step cap, argument recovery, cancellation, the
grounding rule and the budget stop all deterministic — none of them depends on a model choosing to
behave a particular way. `src/ai/fixtures/scripts.ts` holds the loop's fixtures as frozen literals;
`src/ai/fixtures/drafting-scripts.ts` holds the drafting agent's as **builders**, because there the
thing under test is a policy over values that must come from the real committed templates. A test
asserting "the checklist passes" against values a test author invented is a test of the test author.

Three properties the drafting agent's suite asserts that are worth copying into any agent written
later (`src/ai/agents/drafting.test.ts`, ADR-032):

- **The exact tool sequence**, collected from `onProgress`. It includes the calls the AGENT makes
  itself (`render_draft`, `check_draft`) as well as the model's, because the point is that the
  checklist the reader is shown is one the code evaluated rather than one the model claimed.
- **That a refusal sends nothing**, by asserting `MockProvider.calls` is empty. "We told the model
  to refuse" and "nothing was sent" are different claims and only the second is worth anything.
- **That the revision cap holds**, by asserting `provider.turnsTaken`.

The panel is tested the same way rather than by stubbing the hook:
`src/modules/drafting/components/AiDraftPanel.test.tsx` hands a `MockProvider` in through
`ai.provider`, so pressing "Draft it" runs the real agent, the real engine and the real diff. A test
that stubbed `useDraftingAi` would assert that the component renders the props it was given, which is
not the thing that can be wrong.

**The live test** (`src/ai/agents/drafting.live.test.ts`) exists for the failures a mock cannot
reach: a JSON schema the provider rejects, a rationale with no citation in it, a field id the model
infers from a label rather than reading from `get_draft_template`. Its assertions are deliberately
about shape, never wording — a test that asserted a model's prose would fail on the next model and
everyone would learn to ignore it. The one assertion worth having is that a brief which withholds
the file number comes back with a blank rather than a number.

In the browser, `tests/e2e/ai-draft.spec.ts` turns AI on through Settings the way a reader does,
opens the panel and runs axe over it both gated and open. It declares **no** `allowCrossOrigin`,
unlike `ai-byok.spec.ts`, so the automatic gate proves that enabling AI and reading the whole panel
sends nothing; pressing "Draft it" is what sends, and that spec never does. The counterpart is in
`tests/e2e/draft.spec.ts`: with AI off, the panel, the ✨ controls and any chunk matching
`AiDraftPanel|anthropic` are all absent.

### Tier 0, which is the one tier a test cannot run end to end

`src/ai/providers/local.ts` takes its generator as an injected function, so
`src/ai/providers/local.test.ts` exercises the whole provider — the prompt it builds, the emulated
tool protocol, the two-step cap, cancellation, usage — against a scripted stub with no GPU and no
download, and then runs a complete grounded run through the real `runAgent`.
`src/ai/local/protocol.test.ts` drives that parser from named fixtures in
`src/ai/fixtures/local-turns.ts`: every string there is a shape a small quantised model actually
emits (a fence, a `<think>` block, the OpenAI function-calling shape with stringified arguments, a
Devanagari argument containing a brace). `src/ai/local/catalogue.test.ts` reads every id, size and
host back out of `@mlc-ai/web-llm`'s own `prebuiltAppConfig`, so a library upgrade cannot ship a
picker quoting a number nobody can reproduce.

`tests/e2e/ai-local.spec.ts` proves what a browser can prove and not more. Headless Chromium has no
WebGPU adapter and a real download would be a test of Hugging Face's uptime, so it asserts that
choosing the tier and reading the whole model list **contacts nothing** (no `allowCrossOrigin`
declared), that a device which cannot run a model is told so and the Download button is disabled,
that the section passes axe, and — with `navigator.gpu` stubbed and every cross-origin request
answered `404` — that the download reaches **only** `huggingface.co` and
`raw.githubusercontent.com`, asserted host by host from what the browser actually requested.

### The Tier 2 proxy has its own runner

`worker/` is a standalone package and **`pnpm check` does not cover it** — `ci.yml`'s `worker` job
does, and `pnpm --dir worker test` is how to run it by hand. 42 tests in two files, and the split is
the same one `src/lib/**` has from the components: `test/policy.test.ts` proves the four guards
(origin, per-IP rate limit, model allowlist, daily token budget) by calling them with a Map-backed
KV stub, because a limit that is off by one is invisible to an integration test that sends one
request; `test/worker.test.ts` runs the same Worker in **miniflare** — real workerd, upstream stubbed
with `outboundService` — for the two things only a runtime settles: that the outbound request carries
the operator's key and none of the caller's headers (asserted with sentinels planted in a cookie, a
referer, an `authorization` and a caller-supplied `x-api-key`), and that an SSE body streams through
rather than buffering. Neither suite reaches the network.

---

### 8. The Library's annotation layer — where the split runs

Session 27's work divides unusually cleanly between what jsdom can answer and what it cannot, and the
division is worth knowing before adding a test to it.

**jsdom answers the anchoring**, which is the breakable part. jsdom has a real `Selection` and a real
`Range`, so `src/modules/library/annotations.test.tsx` drives a selection over rendered paragraphs and
checks that `selectionOffsets` produces offsets that slice back to what was selected — including
across the spans a highlight splits a paragraph into, which is the case a text-node walk would get
wrong. It also covers the three-layer render (highlights nest inside citations, never the reverse),
the note editor's debounce and its cross-tab notice, and that "add to trainer" writes an `unreviewed`
row and nothing else.

**Only a browser answers whether a mark survives.**
`tests/e2e/library-annotations.spec.ts` highlights a real phrase in the CCS (Conduct) Rules, reloads,
finds it still drawn over the text, writes a note on it, reloads again, and then adds it to the
Trainer and finds it in `/learn/review-queue`. A second test pastes an act, confirms the split and
reads the result with the network off. Neither declares `allowCrossOrigin`, so both are also privacy
assertions.

That spec selects by building a `Range` in the page rather than dragging the mouse: Playwright's
mouse emulation across a wrapped line is unreliable, and what is under test is the offset mapping,
not the platform's drag handling.

**Two defects came out of that split and both were on the browser side.** A personal work bounced back
to the shelf on the first render after it was saved, because `useLiveQuery` reports "still asking" and
`Table.get` reports "no such row" with the same `undefined` — nothing in jsdom opened a personal work
by its route. And `/library/add` shipped an `sr-only` file input, which is still in the accessibility
tree and still needs a label; only the axe sweep says so.

### 8b. The document editor — where THAT split runs

Session 29 replaced the Drafting Studio's form with a real document editor
(ADR-041), and the split between what jsdom proves and what a browser proves is
worth stating, because one of the obvious tests turned out to prove nothing.

**Pure, and the bulk of it** — `src/lib/drafting/{model,skeleton,renderDoc,lint,migrate,numbering,versions,personal}.test.ts`
plus `tests/drafting-library.test.ts`. Nothing here imports Tiptap: the body is
plain JSON, `bindings` and `instantiate` and `renderOfficialDoc` are functions
over it, and `lintDocument` takes `now` and the glossary as arguments so both
can be tested at all. `tests/drafting-library.test.ts` is the one that matters
most — it renders **every one of the forty-three forms from its own skeleton, in
both languages, and runs that form's own checklist and lint over the result.**
A form whose skeleton its own checklist rejects fails the build.

**jsdom** — `src/modules/drafting/editor/{extensions,editor}.test.tsx`. Tiptap's
`Editor` constructs headlessly under jsdom, which is what lets `extensions.test.ts`
assert that the editor's schema produces only node types
`src/lib/drafting/model.ts` can store. `editor.test.tsx` covers roles, names,
`aria-pressed`, the placeholder chips and the find-and-replace panel.

**Not in jsdom, deliberately.** There is no jsdom test that the editor does not
re-seed itself on every keystroke. The obvious one — assert the paragraph's DOM
node is the same object after a re-render — was written and it PASSES against a
version with the guard deleted, because ProseMirror diffs the document it is
given and reuses the nodes. The only thing the guard protects is the SELECTION,
and jsdom implements no layout at all: `Range.getClientRects` is absent, and
stubbing it makes ProseMirror place typed characters _worse_ than the absence
does. The claim lives in `tests/e2e/draft-editor.spec.ts`, where a real browser
types two separate runs and the second lands where the caret was. A test that
cannot fail is not evidence.

**A real browser** — `tests/e2e/draft-editor.spec.ts`. One journey end to end
(create → fill the placeholders → issue a number → save a version → edit → diff
→ restore → reload), the too-new refusal, the export gate, an axe sweep of all
six tabs, a keyboard-only pass and a Hindi run. Its first execution found four
things nothing else could: a bullet inside a tab's accessible name (which reads
as "Review bullet" and made `getByRole('tab', { name: 'Review' })` ambiguous with
"Preview"), two hints nested inside their `<label>` and so swallowed into the
input's name, `bg-destructive/10` with `text-destructive-foreground` failing
`color-contrast` on fourteen elements, and an `h1` → `h3` heading jump.

### 8c. Import and export — where a FILE is the untrusted input

Session 30 (ADR-042) opened the model's two ends, and the split is the same
shape one level down: a mapping decision is pure and testable against a string,
a `File` is not, and a print stylesheet is not testable anywhere but a browser.

**Pure, and the bulk of it again** — `src/lib/drafting/{html,zip,importDocx,
importPdf,extract,paste,letterhead,print,docxExport}.test.ts`. Every mapping
decision is a string in and a `BodyNode[]` out, so a table with a `rowspan`, a
Devanagari paragraph number and a legacy-font text layer are all one-line
fixtures. Two of these are worth copying the shape of:

- **`zip.test.ts` checks the writer against Node's own `zlib`, not against the
  reader.** A round trip through both passes with two matching bugs. It also
  reads a real `.docx` written by the `docx` package, because the importer opens
  files Word wrote, not files this file wrote — the same rule `docx.test.ts`
  states about not using a zip library to check a zip library.
- **`importPdf.test.ts` drives the heuristics with synthetic text runs at
  coordinates.** A full-pipeline failure tells you a document came out wrong; it
  does not tell you which of the five join rules was responsible.

**The committed fixtures are GENERATED** — `scripts/drafting-fixtures.mjs`
writes all eleven of `tests/fixtures/drafting/` from source that says what each is
for, and CI runs `--check`. A `.docx` is opaque in a diff, and a fixture nobody
can read is a fixture nobody can correct. The `.docx` files are written by the
app's own zip writer through Vite's SSR module runner, which exercises it
against mammoth as a side effect.

**jsdom, with two accommodations that are worth knowing** —
`tests/drafting-io.test.ts` drives the whole pipeline from a real `File`.
mammoth ships two builds and Vitest resolves the NODE one, so `readFile.ts`
passes both `arrayBuffer` and `buffer` and the shipped code path is what runs
here. pdf.js's `workerSrc` is set only when unset, so the test can point it at
the worker on disk — under jsdom the app's own `new URL(..., import.meta.url)`
resolves to `http://localhost/...`, which pdf.js's fake-worker fallback refuses.

**A real browser** — `tests/e2e/draft-io.spec.ts`, eight tests over both
projects. One journey end to end (import a `.docx` → the review screen → create
→ the export gate refuses → open the checklist → fill the signature → export →
re-import), a scanned PDF's message, a `.doc` under a `.docx` name, the captured
letterhead, a Hindi run, the print route with its generated `@page` rule and its
counters, and a batch `.zip` counted by its local file headers. Its first
execution found three things nothing else could: an export refusal pointing at a
control that did not exist, `extensionOf` returning the last character of a name
with no dot in it (Playwright saves a download to a path with no extension), and
a `link-in-text-block` violation on `/draft/profile` that arrived with the route
being added to the axe sweep.

### 9. Data pipeline — Python

`scripts/ingest` and `scripts/authoring` are tested with stdlib `unittest`, not Vitest — 185 tests
across the two. `validate_data.py` checks all 107 datasets against `schemas/`, and **fails on a file
that is in neither its manifest nor its stated no-schema list**, so a new dataset cannot go
unvalidated. Read `scripts/ingest/README.md` and `docs/AUTHORING.md` before touching either.

---

## CI

Five jobs, so a failure names its own cause (`.github/workflows/ci.yml`):

| Job      | Runs                                                                  | Why separate                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`   | lint, typecheck, i18n parity, Vitest with coverage thresholds         | Fails in ~2 minutes on a typo. Uploads `coverage/`; fails if `docs/COVERAGE.md` is stale.                                                                                                                                                                             |
| `data`   | the Python parsers and every dataset schema                           | A parser regression should not be hidden behind a TypeScript error.                                                                                                                                                                                                   |
| `worker` | `worker/`'s own typecheck and its 42 tests, in its own install        | A separate package with a separate dependency tree (miniflare pulls workerd, ~90 MB). Pulling that into the app's install to test a Worker the app does not import would be the wrong trade; leaving it untested because `pnpm check` cannot reach it would be worse. |
| `build`  | `pnpm build`, then the three dist-only suites and `pnpm size`         | Uploads `dist/` as an artefact.                                                                                                                                                                                                                                       |
| `e2e`    | Playwright, a matrix over the two projects, against that same `dist/` | `fail-fast: false` — a phone-only defect is the point of the matrix.                                                                                                                                                                                                  |

`e2e` downloads the `dist/` the `build` job produced rather than building its own: testing a
separately-built artefact would be testing something other than what the previous job verified. The
browser binary is cached on the resolved `@playwright/test` version, so a lockfile change that does
not move Playwright still hits the cache. On failure, traces, screenshots, video and the HTML report
are uploaded for 14 days — `pnpm exec playwright show-trace <file>`.

---

## Writing a test here

- **Import `test` and `expect` from `./fixtures`** in every new Playwright spec. `tests/e2e-harness.test.ts` enforces it.
- **Read labels from the catalogue**, not from memory: `t('hi', 'utils.leave.doj')`, never a pasted Hindi string.
- **Never assert what the code currently returns.** Work the expected figure out from the order, the rule or the specification first, and write it as a literal.
- **A new lazy route or dataset needs an offline test.** Add the route to `EVERY_ROUTE` in `offline.spec.ts` and to `ROUTES` in `a11y.spec.ts`; both are plain arrays for that reason.
- **A page that renders more than a few hundred rows needs its render capped**, and only axe in a real browser will tell you. An unfiltered 1,891-row glossary ran `axe.run()` past a 30-second timeout; `MAX_RENDERED = 100` bounds the list, never the search.
- **`pnpm test:e2e` cannot see a StrictMode bug.** Playwright runs a production build, where StrictMode is inert, so an effect that is not idempotent across mount → cleanup → mount passes every e2e spec and is broken the moment anyone opens `pnpm dev`. Any new effect that guards a ref, or that a cleanup disarms, wants a test that renders inside `<StrictMode>` — `src/lib/useAsync.test.tsx` and `src/modules/drafting/useDraft.test.tsx` are the pattern.
- **A race that will not reproduce outside the real test runner is not evidence the runner is wrong.** An `aria-required-children` failure appeared only under `playwright test --repeat-each=10` and never in a hand-written replay of the same steps (ADR-029).
- **A test that installs fake timers and then times out never restores the clock.** `vi.useFakeTimers()` in a `try` whose `finally` calls `vi.useRealTimers()` does NOT protect the tests after it: a test killed by its own timeout never reaches the `finally`, and every test that follows then hangs for the full 30 seconds. One leaked clock reads as six broken components. Prefer waiting out a real debounce — 500 ms is cheap — and reach for fake timers only where the interval is minutes.

## Findings this harness has produced

Kept as a record of what each layer is actually for.

- **The "Upcoming" holiday strip could not be scrolled with a keyboard** — a sideways-scrolling region whose contents are all plain text, so there was nothing to focus and everything past the viewport edge was unreachable (WCAG 2.1.1). Found by extending the axe sweep to Utilities' four tools; invisible to jsdom, which has no layout and so never overflows. Fixed with a labelled `ScrollStrip` wrapper.
- **`/utils/portals` copied a URL and announced nothing** — the button swapped an `aria-hidden` icon and said nothing at all, while every other copy affordance in the app writes into a live region. Found by asking, for each confirmation, whether it was inside one.
- **A suggestion diff silently discarded the model's capitalisation and punctuation** — `diffWords`
  folds case and punctuation before comparing and re-attaches the BEFORE token on an `equal` run,
  which is right for the Law Converter and wrong for a diff the reader ACCEPTS: a rewrite whose only
  change to a word was a capital letter rendered as "No change is suggested", and applying one that
  contained such a word produced neither text. Found by a unit test asserting the applied subject
  line, not by looking at the screen — the diff LOOKED correct. `SuggestionDiff` now passes
  `{ exact: true }` (ADR-032 §6).
- **The PWA "Ready to work offline." toast blocked a primary action on a phone** — a full-width bar at `bottom-[4.5rem]` waiting for an acknowledgement, sitting exactly on the mock test's "Next question" button and intercepting every click on it. Found by the `mobile-chromium` project on its first run; `docs/DATA-GAPS.md` #59.
- **A language chunk that failed to load left the app showing raw translation keys, permanently** — i18next resolves rather than rejecting on a backend failure, and the broken preference was then persisted. Found by asking what the ADR-031 split had made newly possible; fixed in `store.ts` and `src/i18n/index.ts`, with the library behaviour pinned in `src/i18n/chunk-failure.test.ts`.
- **`/learn/review` was swept by neither axe nor the offline reload** — the Trainer's most-used screen, with every route around it covered. `tests/route-coverage.test.ts` now derives the route set from the routers and fails on any route in neither sweep.
- **`/utils/portals` announced a repeat copy to nobody** — one live region shared by every row, so the second identical message was silent. Fixed by keying the announcement; the test asserts node identity, because asserting the text passes against the broken version.
- **The coverage report sorted its rows with `localeCompare`**, in a file CI byte-compares.
- **`isWorkId` said yes to `constructor`, `toString` and `__proto__`** — `WORK_LOADERS` is an object
  literal and `in` walks the prototype chain, so a work id out of the address bar could name a
  function on `Object.prototype` and be called as though it were a dynamic import. Found by asking
  what the URL can actually contain; the fix is `Object.hasOwn`.
- **Three Library screens blocked their whole render on a Dexie read they only decorate themselves
  with** — on a device whose storage is refused, `useLiveQuery` never produces a value and the hub,
  the work page and the reader each sat on a skeleton for ever, with the library the reader wanted
  sitting in a precached chunk that needs no database. Found by holding the query open on purpose,
  the way `GlossaryPage.test.tsx` and `pay-restore.test.tsx` hold a promise open rather than trusting
  a real timing window to land the same way twice.
- **A search result was labelled by a hand-rolled fallback, so every hit in FR/SR and CSMOP rendered
  a number beside an empty string** — and the first version of the test that was supposed to catch it
  read the whole row, which also carries a snippet of the body, and passed against the broken code.
  It asserts on the row's own two elements now. A test that cannot fail is not evidence.
- **The Library reader printed every rule with sub-rules twice** — `data/rules/text/*.json` stores
  `subRules[]` as verbatim slices of the same `text`, so a page that renders the body AND the parts
  list renders the whole rule again. Each half was individually correct and jsdom would never have
  shown it; it was found by reading a Playwright failure's page snapshot for a different bug. The
  containment property is now asserted over all 219 such rules (ADR-038 §6).
- **"Read this in Hindi" silently showed the English text with no notice, on 219 of 818 rules** —
  the missing-Hindi condition was `body.hi.length === 0 && parts.length === 0`, and `parts` counts
  records regardless of language, so the condition was false for exactly the rules that have
  sub-rules. That is the silent fallback the master context forbids, produced by a clause that
  looked like extra care. Found by `tests/e2e/library.spec.ts`, whose whole subject is that the
  notice appears.
- **A Devanagari proviso was never a paragraph break** — `/परन्तु\b/` matches nothing, ever:
  JavaScript defines a word boundary over `[A-Za-z0-9_]`, so the Devanagari half of a
  symmetric-looking pattern silently covered one language. The same trap ADR-035 records for
  `src/ai/agents/law.ts`, hit again in an unrelated file, and caught by writing the Devanagari case
  of a test whose English case already passed.
- **A two-digit search inside a rule book found nothing** — `fuse`'s `minMatchCharLength` is 3, so
  "11", the most obvious thing a reader types into the CCS (Conduct) Rules, never reached the index.
  A unit number is now matched exactly, first, and a single digit is searchable where a single
  letter is not.
- **Two Playwright specs hard-coded "6 destinations"** and failed when the Library made it seven —
  for a reason that had nothing to do with what either test was checking. Both derive the count now,
  one from the widest viewport and one from the More sheet itself.
- **Four unit files failed intermittently and passed in isolation** — the signature of a budget, not a defect. `waitFor`'s 1-second default and Vitest's 5-second default are races against CPU contention, not against the code; both are raised in `vite.config.ts` and `src/test/setup.ts`, with the assertions unchanged.
