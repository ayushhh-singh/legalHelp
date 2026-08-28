# Architecture Decision Records

Newest last. Every deviation from the pinned stack or the master context needs an entry here.

---

## ADR-001 — Stack, and no backend for user data

**Date:** 2026-08-28 · **Status:** Accepted

### Context

Sahayak is a personal reference and productivity tool for serving government officers. It handles pay
figures, leave balances and draft correspondence — material that is sensitive to the individual even
though every _dataset_ in the app is public. It must also work in offices with poor or no connectivity.

### Decision

1. **No backend for user data, and no accounts.** All user state lives in IndexedDB via Dexie. The app is a
   static bundle on Cloudflare Pages. There is no server to breach, no account to compromise, and no
   operating cost that could later justify ads or a subscription.
2. **No analytics by default.** Not even privacy-preserving analytics. The threat model is an officer who
   must be able to say the tool sends nothing anywhere.
3. **Pinned stack**, as recorded in the master context: pnpm 9, React 18.3, Vite 5.4, TypeScript 5.6 strict,
   Tailwind 3.4 + shadcn/ui, i18next, Dexie 4, zustand, zod, date-fns. Vitest + Testing Library + Playwright
   - axe for tests. Python 3.12 for the data pipeline, in CI only.

### Consequences

- Sync between a phone and a desktop is impossible without a future export/import feature. Accepted.
- Clearing browser data destroys user state. A backup/export feature is owed before the app is promoted
  beyond personal use.
- The stack is deliberately behind current upstream (Vite 8, React 19, TS 7, Tailwind 4 all exist).
  Pins hold until an ADR says otherwise.

---

## ADR-002 — Run on Node 24, not the pinned Node 20 LTS

**Date:** 2026-08-28 · **Status:** Accepted · **Supersedes:** the Node 20 pin in the master context

### Context

The master context pins Node 20 LTS. The development machine has Node 24.13.1 installed, with nvm present
but no Node 20 build. Vite 5.4, ESLint 9 and Vitest 2 all support Node 24.

The options were: install Node 20 via nvm; run on 24 while `.nvmrc` claims 20; or move the pin to 24.

### Decision

Run on **Node 24**, and set `.nvmrc` to `24` so the declared and actual versions agree. CI reads
`node-version-file: .nvmrc`, so local and CI stay on the same major.

### Consequences

- Local, `.nvmrc` and CI agree — no class of bug that only appears in CI.
- The project is off LTS. Node 24 becomes LTS in October 2026, so this is temporary.
- `package.json` keeps `engines.node: ">=20"`, so a Node 20 contributor is not locked out.
- Revisit if any pinned dependency turns out to misbehave on 24.

---

## ADR-003 — Darken `--ink-2` from #5A6B8C to #55658A

**Date:** 2026-08-28 · **Status:** Accepted · **Amends:** the palette in the master context

### Context

The master context fixes the palette _and_ requires WCAG AA. Measured against the two paper surfaces, the
specified `--ink-2` (#5A6B8C) fails:

| Pair                           | Ratio      | AA normal text (4.5:1) |
| ------------------------------ | ---------- | ---------------------- |
| #5A6B8C on `--paper` #F7F1E3   | 4.76:1     | pass                   |
| #5A6B8C on `--paper-2` #EFE7D2 | **4.35:1** | **fail**               |

Every other token pair passed. `--ink-2` is the muted-text colour and `--paper-2` is the card/stripe surface,
so the failing combination is one the app would use constantly.

Three options: keep the colour and forbid it as body text on `--paper-2`; lighten `--paper-2`; or darken
`--ink-2`. The first relies on every future contributor remembering an unwritten rule; the second weakens
the two-tone paper layering that carries the "government file" identity.

### Decision

Darken `--ink-2` to **#55658A** — `221.9 23.8% 43.7%`. It scores 5.16:1 on `--paper` and 4.71:1 on
`--paper-2`, and the change is visually imperceptible next to the original.

`src/styles/tokens.test.ts` now asserts every foreground/background pair in **both** themes clears 4.5:1,
so the palette cannot regress silently. The test was verified to fail on the original value.

### Consequences

- AA holds on every surface with no usage rules for contributors to remember.
- The master context's stated hex is superseded; `CLAUDE.md` points at this ADR.
- The dark ("warm inverse") palette was derived in this session, not specified in the master context:
  `--paper` #1A1714, `--paper-2` #24201B, `--ink` #F0E9DA, `--ink-2` #B3A891, `--thread` #E2705C,
  `--ok` #6FBE7E. Lowest pair is 5.17:1.

---

## ADR-004 — Pin the shadcn CLI to 2.x

**Date:** 2026-08-28 · **Status:** Accepted

### Context

The current shadcn CLI (4.19.0) generates components for Tailwind v4, whose `@theme` directive and OKLCH
variables are incompatible with the pinned Tailwind 3.4.

### Decision

Generate components with `pnpm dlx shadcn@2.10.0`. `components.json` is hand-written (New York style, CSS
variables, `@/` aliases) and committed, so regeneration is reproducible.

shadcn's HSL variables (`--background`, `--primary`, `--ring`, …) are **aliased onto the brand tokens**
in `tokens.css` rather than given their own values, so `--ink` and `--thread` drive every primitive and
there is a single source of truth. `--radius` is `2px` — government stationery, not a consumer app.

### Consequences

- `src/components/ui/**` is generated code: excluded from ESLint and Prettier, edited only deliberately.
- The CLI does not create `src/lib/utils.ts` when run with `add` before `init`; it is hand-written.
- Moving to Tailwind 4 later means regenerating every primitive. That is an ADR of its own.

---

## ADR-005 — Colours as bare HSL triplets, fonts as CSS variables

**Date:** 2026-08-28 · **Status:** Accepted

### Context

Tailwind's alpha modifiers (`bg-ink/10`) need `hsl(var(--ink) / <alpha-value>)`, which requires the variable
to hold a bare `H S% L%` triplet rather than a finished colour. shadcn/ui uses the same convention.

Separately, jsdom does not resolve `var()` in `getComputedStyle` and never sees Tailwind's JIT output, so
asserting that a Hindi heading renders in Tiro Devanagari Hindi needs the font stack reachable as plain CSS.

### Decision

- Colour tokens are stored as **bare HSL triplets**, with the hex in a comment. One declaration serves both
  Tailwind and shadcn.
- Font stacks are declared as `--font-display` / `--font-ui` / `--font-mono` in `tokens.css`, and
  `tailwind.config.ts` points its `fontFamily` entries at those same variables.

### Consequences

- Editing a colour means editing an HSL triplet, not a hex. The comment keeps it legible, and
  `tokens.test.ts` converts back to verify contrast.
- `src/components/common/PageHeader.test.tsx` can bind `.font-display` to the literal stack read from
  `tokens.css` and assert the resolved `font-family`. It verifies the token chain, not glyph rendering —
  that needs a real browser, and is owed to the Playwright session.

---

## ADR-006 — Apply the dark palette from `prefers-color-scheme`, not only from a class

**Date:** 2026-08-28 · **Status:** Accepted

### Context

The theme preference lives in IndexedDB, which can only be read asynchronously — the read cannot finish
before first paint. With the palette switched solely by a `.dark` class applied after hydration, every
dark-mode reader saw a flash of light paper on every single load.

The usual fix is to mirror the preference into `localStorage` and read it from a blocking inline script.
That would put user state outside IndexedDB, against a hard rule, for a rendering hint.

### Decision

Switch the palette on **both** conditions, in CSS, with no new storage:

```css
@media (prefers-color-scheme: dark) {
  :root:not(.light) {
    /* dark tokens */
  }
}
.dark {
  /* dark tokens */
}
```

The media query applies before paint. `.dark` and `.light` are both written explicitly by the store, so an
explicit choice always beats the system setting — `.light` is what lets a reader on a dark system actually
get light.

The dark values are declared once as `--dark-*` on `:root`; both selectors only remap. `tokens.test.ts`
asserts the two remap blocks stay identical and that every remap points at a `--dark-*` value.

`tailwind.config.ts` uses a matching dual `dark:` variant, so a `dark:` utility cannot disagree with the
palette it sits on.

### Consequences

- No flash for a reader whose system is dark and who has expressed no preference — the common case.
- A reader who explicitly chose the opposite of their system setting still sees a brief flash. Fixing that
  needs a synchronous pre-paint read, which means storage outside IndexedDB. Not worth the rule.
- IndexedDB remains the only place a preference is stored.

---

## ADR-007 — Split `--input` from `--border` for non-text contrast

**Date:** 2026-08-28 · **Status:** Accepted

### Context

Both tokens held the same value (`43 25% 78%` light), which scores **1.41:1** against `--paper`. WCAG 1.4.11
(Non-text Contrast) requires **3:1** for the visual boundary of a UI component — but explicitly does not
cover decorative dividers or container edges.

One token was serving both jobs, so either form fields got an almost invisible boundary or dividers got a
heavy one. The modules still to come (Drafting Studio, Pay calculator) are form-dense.

### Decision

Two tokens with different jobs:

| Token      | Job                                                               | Light        | Dark         | vs `--paper` |
| ---------- | ----------------------------------------------------------------- | ------------ | ------------ | ------------ |
| `--border` | dividers, card edges — decorative, 1.4.11 does not apply          | `43 25% 78%` | `36 10% 24%` | 1.41:1       |
| `--input`  | text fields, outline buttons — a control boundary, 1.4.11 applies | `43 20% 45%` | `36 12% 42%` | 3.62:1       |

`tokens.test.ts` asserts `--input` clears 3:1 against both paper surfaces in both themes, and documents why
`--border` is exempt.

### Consequences

- shadcn's `input` and `outline` button variants already use `border-input`, so they inherit this for free.
- Form fields read as noticeably firmer than dividers, which is correct for a paper-form identity.

---

## ADR-008 — Offline shell: manual `workbox-window` registration, hand-generated icons, `lighthouse@9` for the PWA check

**Date:** 2026-08-28 · **Status:** Accepted

### Context

`vite-plugin-pwa` (`generateSW` strategy) builds the service worker and the web manifest, but three parts
of the brief needed a decision beyond the plugin's defaults.

**Registration.** The plugin can inject its own register script (`injectRegister`), driven by
`virtual:pwa-register`'s callback API. The brief instead asked for `workbox-window` directly, with a
bilingual update toast — so `injectRegister: false`, and `src/app/pwa.tsx` registers the `Workbox` instance
itself and drives `waiting` / `installed` / `controlling` by hand.

**Icons.** `vite-plugin-pwa` ships a companion asset generator (`@vite-pwa/assets-generator`, config via a
`pwaAssets` option) that can rasterize icons from a source image automatically. It was not used: it wants
its own config surface and preset system, and the maskable safe-zone padding is easier to get right by
placing shapes deliberately in the source SVG. Instead, `src/assets/pwa-icon.svg` (full-bleed paper
background, folder shape kept inside the maskable safe circle) is rasterized by `scripts/generate-icons.mjs`
using `sharp`, the same way `scripts/fetch-fonts.mjs` produces `public/fonts`: a committed, idempotent,
offline-capable script, output committed to `public/icons/`. `sharp` is a devDependency only — it never
ships to the browser.

**Lighthouse.** The brief's acceptance check calls for "Lighthouse PWA category ... reports installable" via
`@lhci/cli`. `pnpm dlx @lhci/cli collect` resolves `lighthouse@12.6.1`, and current Lighthouse has no `pwa`
category or PWA-specific audits at all — Google removed them upstream (`categories: {}` in the collected
report; none of `installable-manifest` / `service-worker` / `maskable-icon` / etc. exist in the audit list).
Recorded as `docs/DATA-GAPS.md` #7 rather than skipped: a one-off `pnpm dlx lighthouse@9` run (the last
major version with the PWA category) against `pnpm preview` scored the category **1.0**, with every audit
passing — `service-worker`, `installable-manifest`, `apple-touch-icon`, `splash-screen`, `themed-omnibox`,
`maskable-icon`, `viewport`, `content-width`. Neither `@lhci/cli` nor `lighthouse@9` is a project dependency;
both were run via `pnpm dlx` and are reproducible the same way in a future session.

### Decision

1. `registerType: 'prompt'`, `injectRegister: false`; `src/app/pwa.tsx` owns the update-toast and
   offline-ready-toast lifecycle via `workbox-window`.
2. `clientsClaim: true` is required for the update flow (the client must actually become controlled by the
   new worker after `messageSkipWaiting()` for the `controlling` event — the reload trigger — to fire). That
   same option also fires `controlling` the very first time a worker claims a previously-uncontrolled page,
   not only on a user-triggered update, so `src/app/pwa.tsx` gates the reload behind a
   `skipWaitingRequestedRef` flag set only inside the toast's own reload handler. Missed on the first pass —
   caught by a Playwright run that showed the page auto-reloading on install, before any offline behaviour
   was even being tested.
3. Runtime caching: `/data/**/*.json` (not yet populated — `docs/DATA-GAPS.md` #6) → `StaleWhileRevalidate`,
   cache `data-v1`, 30-day expiry. Everything else → `NetworkFirst`. `navigateFallback: '/index.html'`
   serves the precached shell for any client-routed page (`/pay`, `/draft`, …) Workbox has no exact
   precache entry for.
4. Icon set: `src/assets/pwa-icon.svg` → `scripts/generate-icons.mjs` (`sharp`) → `public/icons/pwa-
{192x192,512x512}.png` + `apple-touch-icon.png` (180×180). One render per size, listed in the manifest
   with `purpose: 'any maskable'` — see the addendum below; there is no separate maskable file.
5. `tests/no-external-urls.test.ts`'s allowlist gained one entry: `bit.ly/wb-precache`, a `console.warn`
   string inside workbox-precaching's own source, bundled verbatim into `dist/workbox-*.js` — never fetched,
   same class of entry as the existing Dexie `bit.ly` / `tinyurl` links.

### Consequences

- The update and offline-ready toasts are plain components with local state, not the `virtual:pwa-register`
  module — a later session touching update UX should look at `src/app/pwa.tsx`, not for a Vite virtual
  import.
- `pnpm icons:generate` needs `sharp` (native bindings) locally; output is committed, so a fresh clone does
  not need to run it, matching the fonts.
- No Lighthouse PWA score is enforced in CI — there is currently no tool in the pinned stack that can
  compute one. `tests/e2e/offline.spec.ts` is the enforced-in-CI proxy: it fails if the built shell stops
  actually working offline.

### Addendum — edge-case pass (same session)

A dedicated review pass (own reading plus a multi-agent code review) turned up several issues in the first
cut above, all fixed before commit:

- **Update toast, dismissed once, silenced every later update.** `updateDismissed` was a `PwaNotices`-local
  boolean that, once set, never cleared. Moved into `usePwaLifecycle` and reset on every `waiting` event, so
  a second, independent deployment gets its own toast even if the first was dismissed. Verified against two
  real, separately-built service workers (not just reasoned about): built, installed, dismissed, rebuilt
  again, reloaded — the toast reappeared, and clicking Reload still activated the new worker correctly.
- **`wb.register()` and the old offline-ready persistence could throw unhandled rejections.** Fixed by adding
  `.catch()` to `register()` (`console.warn`, matching `store.ts`'s storage-failure convention) and by
  removing the IndexedDB round-trip entirely (next point) rather than wrapping it in `try`/`catch`.
- **The offline-ready "shown once" flag didn't need IndexedDB at all.** `wb`'s `installed` event fires with
  `isUpdate: false` at most once per origin for the life of a service worker registration — a `register()`
  call against an already-active worker of the same version never re-enters the installing state. The
  persisted flag added nothing, and `clearAllData` clearing it would have been misleading: that clears
  settings, not the service worker registration, so the notice would not have reappeared anyway. Simplified
  to plain component state; `SETTING_KEYS.pwaOfflineReadyNoticeShown` is gone.
- **The `NetworkFirst` runtime-cache rule was origin-agnostic.** `request.mode !== 'navigate'` alone also
  matches a hypothetical cross-origin request. Nothing exploits this today (the app makes none), but an
  opaque cross-origin response can't be inspected and browsers reserve outsized quota against it — added an
  explicit `url.origin === self.location.origin` guard to both runtime-caching rules. (`self` inside that
  predicate is the _generated service worker's_ global scope, not this Node process — workbox-build
  serializes the function into `dist/sw.js` — so `vite.config.ts` carries a narrow local `declare const self`
  shim rather than pulling the DOM lib into `tsconfig.node.json`.)
- **Manifest description duplicated `en.json`'s `app.shortDescription` as a hand-copied literal.** Now
  imported directly (`import en from './src/i18n/en.json'`), so the two cannot drift. Needed
  `resolveJsonModule: true` plus both JSON files added to `tsconfig.node.json`'s `include`.
- **CI built the app twice.** `playwright.config.ts`'s `webServer.reuseExistingServer` is `false` in CI, so
  its `command` always ran — which was `pnpm build && pnpm preview`, right after CI's own separate "Build"
  step had just done the same build. `command` is now `process.env.CI ? 'pnpm preview' : 'pnpm build && pnpm
preview'`: CI serves the build the prior step already produced and verified; local runs still work
  standalone.
- **The "any" and maskable icon PNGs were byte-identical, listed and precached as four files.** Since the
  artwork never differed between purposes (the whole point of the safe-zone-padded source), that was two
  redundant downloads per install for no benefit. Consolidated to two files (192, 512), each declared
  `purpose: 'any maskable'` — a single space-separated value the manifest spec supports for exactly this
  case.
- **No dark-mode-aware `theme-color`.** The installed-app/status-bar tint was pinned to the light paper
  colour even under `prefers-color-scheme: dark`, inconsistent with `tokens.css` painting the dark palette
  before first paint (ADR-006). `index.html` now carries two `media`-scoped `theme-color` tags. This does not
  reach the _web manifest's_ static `theme_color` (used for the splash screen) — that field has no media-
  query equivalent in the spec, so it stays the light colour; picking a single manifest colour that works
  passably in both themes was judged good enough without adding a second manifest or a JS-driven `<meta>`
  sync.
- **The master context's "(enforced by a Playwright test)" claim for zero network requests was not yet
  true.** `tests/e2e/zero-third-party-requests.spec.ts` is a new test: it visits every route plus a language
  toggle and asserts no cross-origin request occurs. It does not (yet) assert that no _user-entered_ value
  leaves the page — there is no form that captures one yet (`docs/DATA-GAPS.md` #4, updated rather than
  closed).

**Looked at, deliberately left alone:**

- `OfflineBadge` still reads `navigator.onLine`, which reports "online" behind a captive portal or a dead
  uplink — exactly when a government-office reader most wants the badge to be right. Fixing this needs an
  active reachability probe, not a badge tweak; recorded as `docs/DATA-GAPS.md` #9 rather than built now.
- The manifest's `lang: 'hi'` is a literal instruction from this session's brief, in tension with the master
  context's equal-bilingual-footing rule (the actual in-page language is detected per reader, often English).
  Left as instructed rather than silently changed; recorded as `docs/DATA-GAPS.md` #10 for a human product
  decision.

---

## TODO — rename before launch (Session 18)

The human did not supply an app name, so **"Sahayak"** is a working title, used in `package.json`
(`name: sahayak`), the Dexie database name (`sahayak`), `index.html`, and the `app.name` translation key.

Renaming touches: `package.json`, `index.html` `<title>`, `src/i18n/{en,hi}.json` → `app.name`,
`src/db/index.ts` (the Dexie database name — **needs a migration or the user's data is orphaned**),
`README.md`, `CLAUDE.md`. The database name is the one that is not cosmetic.

---

## ADR-009 — Move to the current-latest stack (React 19, Vite 8, TypeScript 7, Tailwind 4, zod 4, Vitest 4)

**Date:** 2026-08-28 · **Status:** Accepted · **Supersedes:** the pins in ADR-001, and ADR-004/ADR-005's
partial reliance on `tailwind.config.ts`

### Context

ADR-001 deliberately pinned the stack one or two majors behind upstream and said "pins hold until an ADR
says otherwise". A session's worth of upstream had accumulated: React 19.2, Vite 8.2, TypeScript 7.0 (the
native compiler), Tailwind 4.3 (no JS config), zod 4.4, Vitest 4.1, ESLint 10, React Router 7, i18next 26.
Doing this now, while the app is still a shell with no module logic, is far cheaper than doing it once five
modules and a data pipeline are riding on it.

### Decision

Every dependency moved to the current latest published version, verified against the npm registry rather
than from memory. Four migrations needed real work rather than a version bump:

**Tailwind 4.** `tailwind.config.ts`, `postcss.config.js`, `postcss`, `autoprefixer` and
`tailwindcss-animate` are gone; `@tailwindcss/vite` + `tw-animate-css` replace them. The Tailwind entry
point, the source globs, the `dark` variant and the whole theme now live in `src/styles/tokens.css`:

- Colour tokens map through **`@theme inline`**. `inline` is load-bearing: it substitutes the expression
  into each utility (`.bg-paper { background-color: hsl(var(--paper)) }`) so the utility follows the
  `.dark` / `prefers-color-scheme` remapping. A plain `@theme` would freeze the light value into
  `--color-paper` and dark mode would silently stop switching.
- Font stacks map through a plain **`@theme`**, because that also emits `--font-display` etc. as real
  custom properties on `:root` — which is what `PageHeader.test.tsx` resolves under jsdom, where Tailwind's
  generated utilities do not exist.
- ADR-006's dual dark condition survives as a multi-rule `@custom-variant dark` (class **and**
  `prefers-color-scheme`, with `.light` opting out), replacing Tailwind 3's `darkMode: ['variant', […]]`.
- `tailwind-merge` had to go 2 → 3; v2 does not know Tailwind 4's class list.
- v4 renamed the shadow scale (`shadow` → `shadow-sm`, `shadow-sm` → `shadow-xs`). `shadow` still resolves
  as a deprecated alias, so the shadcn primitives would have silently rendered a _heavier_ shadow than
  before; the names in `src/components/ui/**` were shifted so the rendered result is unchanged.

**TypeScript 7 side by side with TypeScript 6.** TypeScript 7 is the native (Go) compiler, and its npm
package **does not ship the classic JavaScript compiler API** — its `exports["."]` is `lib/version.cjs`,
nothing more. `typescript-eslint` 8.68 `require("typescript")`, reads `ts.versionMajorMinor`, and throws
outright on major ≥ 7 (it points at Microsoft's own "running side by side with TypeScript 6.0" guidance;
tracked upstream as typescript-eslint#10940). So a single `typescript` entry cannot serve both `tsc` and
type-aware linting.

Attempts that do **not** work, recorded so they are not retried: pnpm `packageExtensions` adding
`typescript` as a dependency of the `@typescript-eslint/*` packages, and pnpm `overrides` with the
`parent>child` syntax. `typescript` is a **peer** dependency there, and pnpm resolves peers from the root
importer, so both were deduped straight back to the root's 7.0.2.

What is in place instead — the arrangement Microsoft documents:

| package                                      | version | job                                                     |
| -------------------------------------------- | ------- | ------------------------------------------------------- |
| `typescript`                                 | 6.0.3   | the JavaScript compiler API — `typescript-eslint`, IDEs |
| `typescript-native` (`npm:typescript@7.0.2`) | 7.0.2   | the native compiler that `pnpm typecheck` actually runs |

Both packages provide a `tsc` bin, so `node_modules/.bin/tsc` is ambiguous. `pnpm typecheck` therefore
invokes `node node_modules/typescript-native/bin/tsc` **by path**: which compiler runs is never left to
whichever package happened to win the bin link.

TypeScript 7 rejected exactly one thing in this repo: `baseUrl` (TS5102, removed). `paths` alone replaces
it. Everything else — `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `resolveJsonModule`,
`moduleResolution: bundler`, `allowImportingTsExtensions` — compiles clean. It is also stricter about
ambient Node types: `src/test/paths.ts` and `tests/no-external-urls.test.ts` genuinely use `node:fs`, so
`"node"` is now explicit in `tsconfig.json`'s `types` rather than arriving by accident.

**React Router 7.** `<BrowserRouter future={{ v7_startTransition, v7_relativeSplatPath }}>` is a type error
now: those flags described v6 opt-ins that are simply the behaviour in v7. Removed from `main.tsx` and from
the three test harnesses. The data-router API is unchanged.

**React 19.** `src/components/ui/{button,card,separator}.tsx` dropped `React.forwardRef` for ref-as-prop
(`React.ComponentPropsWithRef`), which also removed six `displayName` assignments.

### Consequences

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (108 unit), `pnpm build` and `pnpm test:e2e` (2 Playwright)
  are all green on the new stack. `vite-plugin-pwa` 1.3 needed no change on Vite 8 — the generated
  `sw.js` and the offline e2e both still pass.
- `eslint-plugin-jsx-a11y` 6.10.2 declares `eslint: ^3 || … || ^9` and has no ESLint 10 release. It was
  **verified working** on ESLint 10 with a deliberate `jsx-a11y/alt-text` violation, so the peer warning is
  silenced through `pnpm.peerDependencyRules` rather than left as noise. Revisit when the plugin ships an
  ESLint 10 peer.
- `eslint-plugin-react-hooks` 7 folds the React Compiler rules (`purity`, `immutability`,
  `set-state-in-effect`, `refs`, `error-boundaries`, …) into `recommended`. All 16 are on and the codebase
  passes them. `eslint-plugin-react-refresh` 0.5 no longer flags a class component exported beside its
  function fallback, so `ErrorBoundary.tsx`'s disable directive is gone.
- `engines.node` moved `>=20` → `>=22`; Vite 8 and Vitest 4 both require it. `.nvmrc` stays 24 (ADR-002).
- `tests/no-external-urls.test.ts`'s inert-URL allowlist gained five entries, each read in context in the
  built bundle before being listed: React 19's `react.dev/errors/` decoder text, React Router's
  `reactroutercom/…/picking-a-router` warning, react-i18next's `usetranslation-hook` warning, Tailwind 4's
  licence banner comment in the built CSS, and `http://localhost` — React Router's fallback **base** for
  `new URL()` when `window.location` is absent, which is parsed and never fetched. The stale
  `reactjs.org/docs/error-decoder.html` entry (React 18) was removed rather than left to rot.

### Addendum — `@axe-core/react` removed, not upgraded

`@axe-core/react` 4.13.0 is the latest release and it cannot work on React 19. It monkey-patches
`React.createElement` and identifies what to re-audit by reading `_reactInternalInstance`,
`_reactInternalFiber` and `_owner._instance` — internals React 19 removed, and which the automatic JSX
runtime does not route through `createElement` at all. In practice it threw `require_react is not a
function` on load in `pnpm dev` and reported nothing.

Rather than pin React back for a dev-only reporter, `src/app/axe-dev.ts` now drives `axe-core` directly:
a `MutationObserver` on `document.body`, debounced 1s, running `axe.run(document, { resultTypes:
['violations'] })` and grouping violations to the console. `axe-core` was already a dependency
(`App.a11y.test.tsx`), it has no React coupling, and a MutationObserver is a strictly better "the tree
changed" signal than a `createElement` hook. Verified both ways in a real browser: silent on the clean
shell, and it reports `image-alt` within the debounce window when an `<img>` without `alt` is injected.
`main.tsx` still imports it dynamically behind `import.meta.env.DEV`, so nothing ships.

---

## ADR-010 — Adopt the Neev token system; light is the default, dark only on an explicit toggle

**Date:** 2026-08-28 · **Status:** Accepted · **Supersedes:** ADR-003, ADR-005 and ADR-006 ·
**Re-applies:** ADR-007

### Context

The "government file" identity — cream paper, Tiro Devanagari Hindi, a single red thread — was built in
Session 1 from the master context as it then read. The master context now specifies a different system,
ported from Neev: a navy-and-blue institutional palette with one marigold accent, Inter/Poppins/Noto Sans
Devanagari, and **light as the default with dark reachable only from the in-app toggle**.

That last point is a direct reversal. ADR-006 applied the dark palette from `prefers-color-scheme` as well
as from `.dark`, specifically so a dark-system reader saw no flash of light paper before IndexedDB could be
read. The new direction says the opposite: the OS setting must not decide.

### Decision

**1. The palette, wholesale.** `src/styles/tokens.css` now carries the Neev tokens as plain hex on `:root`
(light) and `.dark` (dark), mapped into Tailwind through `@theme inline`. `--action` is the one
theme-inverting token — navy on white in light, gold on navy in dark — because navy on a navy page is
invisible. `--primary` stays the interactive blue for links, active states and the focus ring, and is
deliberately **not** a button fill.

Colours are plain hex, not the bare HSL triplets of ADR-005. Tailwind 4 composes opacity with `color-mix`
rather than `<alpha-value>`, so the triplet convention bought nothing and cost legibility.

**2. Dark is an explicit choice.** There is no `prefers-color-scheme` rule anywhere in the CSS —
`tokens.test.ts` asserts its absence against the comment-stripped file. `src/app/store.ts` defaults to
light and never calls `matchMedia`; the `.light` class is gone, because light _is_ `:root` and there is now
nothing for it to opt out of. `tests/e2e/theme.spec.ts` runs the built app with the OS emulated as dark and
asserts the page is light until the toggle is pressed, dark after, and still dark after a reload.

The cost is the one ADR-006 was written to avoid: a reader who has chosen dark sees one frame of light on
every load, because IndexedDB cannot be read before first paint. That is now the accepted trade
(`docs/DATA-GAPS.md` #7, rewritten), and it is the direct consequence of the instruction.

**3. Three values deviate from the palette as specified**, each because it failed a contrast floor this
project already enforces. Each was measured before and after:

| Token                   | Specified | Shipped   | Why                                                                                         |
| ----------------------- | --------- | --------- | ------------------------------------------------------------------------------------------- |
| `--destructive` (light) | `#DA3125` | `#C92A1E` | 4.48:1 as text on `--background`, 4.32:1 on `--muted`. Now 5.19 / 5.01, white-on-solid 5.48 |
| `--destructive` (dark)  | `#F2685C` | `#FB8378` | 4.40:1 as text on `--muted`. Now 5.48                                                       |
| `--sidebar` (light)     | `#EFF3FA` | `#F1F5FB` | 4.47:1 with `--muted-foreground`, which every inactive nav label uses. Now 4.55             |

And two more that are ADR-007 re-applied rather than new judgement:

| Token             | Specified                | Shipped   | Why                                                                              |
| ----------------- | ------------------------ | --------- | -------------------------------------------------------------------------------- |
| `--input` (light) | `#DFE5EF` (= `--border`) | `#7B8BA8` | 1.20:1 on `--background`; WCAG 1.4.11 wants 3:1 for a control boundary. Now 3.26 |
| `--input` (dark)  | `oklch(1 0 0 / 16%)`     | `#6B80A4` | translucent white leaves ~1.6:1 over `--card`. Now 3.84                          |

`--border` keeps the specified value in both themes: 1.4.11 does not cover dividers and card edges, which
identify no control and convey no state.

The dark `--border` and `--input` are also **solid hex rather than `oklch(1 0 0 / 12%)`**. A token whose
real contrast depends on what it happens to be composited over is a token nobody re-checks, and the test
would have had to composite it to say anything at all.

**4. `--muted-foreground` was NOT moved, and `--secondary` was NOT lightened.** `#667085` on `--secondary`
`#E4EAF4` measures 4.12:1 — but `--secondary` is a _fill_ that carries `--secondary-foreground` (13.9:1),
and muted text is never placed on it. Making that pair pass would have meant lightening `--secondary` until
it was indistinguishable from `--muted`, destroying a real distinction to satisfy a combination the design
does not use. The assertion matrix in `tokens.test.ts` states exactly which pairs are checked and why,
rather than checking every token against every other and then carrying exemptions.

**5. Fonts.** `public/fonts/` (10 hand-fetched WOFF2 files) and `scripts/fetch-fonts.mjs` are deleted.
`src/styles/fonts.css` imports `@fontsource-variable/inter`, `@fontsource/poppins` (**Latin only**, 500/600/700)
and `@fontsource/noto-sans-devanagari` (Devanagari only, 400/500/600/700); Vite emits the WOFF2 into
`dist/assets` and rewrites the URLs, so nothing is fetched from Google at runtime.

Poppins carrying no Devanagari is the point, not an oversight: Noto Sans Devanagari sits directly behind it
in `--font-heading`, so a Hindi heading falls through glyph-by-glyph to Noto rather than to a platform face.

Three things this forced:

- **`--font-display` is no longer a theme font.** `.font-display` is an unlayered CSS rule (Inter 800,
  `tabular-nums`, `-0.02em`) so it beats the `h1-h6` rule in `@layer base`. Poppins has no tabular figures,
  so scoreboard numerals must not use the heading face.
- **The OFL travels with the fonts.** `scripts/collect-font-licenses.mjs` (`pnpm fonts:licenses`)
  concatenates the three packages' `LICENSE` files into `public/OFL.txt`, which Vite copies into `dist/`.
  CI regenerates it and fails on a diff, so a font dependency cannot change without its attribution
  following. Its four inert URLs are on the allowlist in `tests/no-external-urls.test.ts`.
- **The service worker skips subsets the app cannot reach.** `@fontsource-variable/inter` ships one
  variable file per Unicode subset. `unicode-range` already stops a _browser_ fetching Cyrillic, Greek or
  Vietnamese, but the precache would have downloaded them on install regardless — 92 KiB on every offline
  install, for an app that is English and Hindi only. `vite.config.ts` now carries a `globIgnores` for them.

**6. Devanagari line height is ≥ 1.75 always, headings included.** Every Tailwind text-size utility ships
its own line-height in the utilities layer and wins over a `body` rule, so `index.css` carries a `:lang(hi)`
rule at specificity (0,2,0) that reclaims it across `text-xs` … `text-xl`. `leading-none` / `-tight` /
`-snug` and arbitrary `leading-[…]` are exempt through a zero-specificity `:not(:where(…))`, because those
sit on numerals, badges and chips where 1.75 would blow out a fixed-height box.

Applying the floor to headings too is a literal reading of the master context ("Noto Sans Devanagari with
line-height ≥ 1.75 always"). It makes Hindi headings noticeably airier than Latin ones — Neev itself set
Devanagari headings to 1.45. Followed as written, flagged for a look on a device
(`docs/DATA-GAPS.md` #11).

**7. One nav config.** `src/lib/nav.ts` replaces `src/app/routes.ts` and drives the sidebar, the bottom bar
and the router. Labels are `{ en, hi }` objects typed as `Record<Language, string>`, so a missing Hindi
label is a compile error — the same guarantee `scripts/i18n-check.mjs` gives the JSON catalogues. The
`nav.*` label keys are gone from `en.json` / `hi.json`, which now hold only the More sheet's own strings.

Below 768px the bar is four flagship modules plus a **More** sheet; from 768px every destination appears
inline and More disappears. Both states are pure CSS — a breakpoint held in React state would disagree with
the rendered layout for a frame after each resize. The sheet's open state is **derived** from the route it
was opened on (`openedAt === pathname`), not tracked separately and reset in an effect: navigating anywhere
makes it stale and closes the sheet in the same render. `react-hooks/set-state-in-effect`, new in
eslint-plugin-react-hooks 7, is what caught the effect version.

**8. Active state is never colour alone** — a 3px `--marigold` rule on the chrome's own edge (the sidebar's
left, the tab bar's top) plus a `font-semibold` label. That is the same gesture as the file tab, which is
the signature: a 3px marigold index tab on the top edge of the active module card (`SectionCard active`),
with the `SectionNumber` chip (tabular numerals on `--muted`) as its partner. No gauge — that is Neev's.

### Consequences

- `pnpm check` (177 unit tests), `pnpm build` and `pnpm test:e2e` (13 Playwright specs) are green.
- **Two long-standing data gaps are closed.** `tests/e2e/a11y.spec.ts` runs axe over every route × both
  languages × both themes in a real browser, which is the only place `color-contrast` can actually be
  evaluated (#2). `tests/e2e/typography.spec.ts` reads Chromium's _used_ fonts through
  `CSS.getPlatformFontsForNode` — not `font-family`, which reports the stack whether or not a font loaded —
  and confirms Poppins for a Latin heading, Noto Sans Devanagari for a Devanagari one, and Inter for body
  copy (#3).
- The axe sweep found one thing worth recording: sampling during the theme toggle reported a `color-contrast`
  violation on a pair that measures 8.1:1 once settled, because the nav's `transition-colors` was still
  mid-flight. The audit now waits on `document.getAnimations()` rather than sleeping, so the race cannot
  come back disguised as a flake.
- It also found a real defect: the More sheet's links sat outside every landmark (axe `region`). The sheet
  now lives inside the `<nav>` rather than beside it.
- The precached shell grew from 735 KiB to 838 KiB. Noto Sans Devanagari at four weights is 220 KiB of that
  and is not optional for this app. The `.woff` legacy fallbacks that `@fontsource` declares alongside each
  `.woff2` are deployed but never precached and never requested — `globPatterns` names only `woff2`.
- `src/components/ui-x/` is new: Chip, Badge, ProgressBar, InfoCard, SectionCard, SectionNumber, StatCard,
  Skeleton, QueryErrorState, Breadcrumbs, written fresh rather than copied. The pairing rule is enforced by
  a test that greps every shipped component for `text-<accent>` without `-foreground`, so a new component
  cannot quietly opt out.
- `.claude/skills/frontend-design/SKILL.md` is the working reference for all of the above.

### Addendum — edge-case pass (same session)

A deliberate probing pass over everything Phase B touched, run against the built app in a real browser
rather than reasoned about. Eight issues, each fixed and each now covered:

- **`tests/e2e/a11y.spec.ts` would have hung, not failed.** `settle()` awaited `animation.finished` for
  every running animation. `Skeleton` renders `animate-pulse`, which is infinite, so its promise never
  resolves — the spec would have stalled until Playwright's 30s timeout the first time any page rendered a
  skeleton, in whichever session happened to add one, looking like a flake. Infinite animations are now
  filtered out. The regression test injects exactly what `Skeleton` renders, and was confirmed to hang
  without the filter and pass with it.
- **The More sheet was unreachable by forward Tab.** It was rendered _before_ the bar in the DOM, so
  pressing Tab from the open trigger skipped the sheet entirely and landed in the page header — the sheet
  was only reachable by Shift-Tabbing back through all four tabs. The sheet now follows the bar in the DOM
  (so it immediately follows its own trigger, as the ARIA disclosure pattern requires) and
  `flex-col-reverse` puts it back above the bar visually.
- **`aria-controls` pointed at nothing while the sheet was shut.** The sheet is now always rendered and
  carries the `hidden` attribute when closed, so the IDREF always resolves and the content stays out of
  both the tab order and the accessibility tree.
- **Tapping the destination you were already on left the sheet open**, because `openedAt === pathname`
  never goes stale when the route does not change. The sheet's links now clear the state on click.
- **`overflowIsActive` used `startsWith`**, so `/utils` would have claimed `/utilsomething`. Replaced with a
  segment-boundary match that still claims `/utils/leave` once the module has child routes.
- **`ProgressBar` rendered `aria-valuenow="NaN"`** for a non-finite value, and React dropped the width
  declaration entirely — a bar that looks empty and announces garbage. `NaN` now reads 0; `Infinity` is
  left to the clamp, because an overflow really is "full".
- **`tokens.test.ts` looked blocks up by prefix.** `.dark { … }` and `:root, .dark { … }` both start a line
  with `.dark {`, so the lookup returned whichever came first in the file. It worked only by source order:
  moving the brand block above the palette would have silently swapped the dark theme's tokens for the
  three brand colours, and every dark-theme assertion would then have been measuring the light palette and
  passing. Blocks are now matched on their full, whitespace-normalised selector, with a test for it.
- **`Chip` / `Badge` rendered no colour at all** for a tone arriving from untyped JavaScript. They fall back
  to `neutral`.

Two more were found and deliberately left as they are:

- **`tests/e2e/theme.spec.ts` was racing IndexedDB.** The toggle applies in memory synchronously and
  persists asynchronously, so polling the rendered colour and reloading immediately reloaded into light
  perhaps one run in three. The test now waits for the value to actually be _in_ IndexedDB before
  reloading, which is also the stronger assertion — it is the persistence that has to survive a reload,
  not the paint. The underlying product behaviour (toggle, then reload within the write window, loses the
  preference) is inherent to async storage and is not worth engineering around.
- **`shell.edge.test.tsx` asserted `min-h-14` literally.** Once the sheet moved inside the nav landmark,
  its 44px rows failed a test that was checking a class name rather than the 44px rule. Now it parses the
  `min-h-*` value and asserts ≥ 44px, so it cannot fail on a legal size or pass on an illegal one.

Verified clean at 320 / 390 / 767 / 768 / 1023 / 1024 / 1280px: all six destinations reachable at every
one, with no gap at either breakpoint boundary. Every Devanagari node measured at exactly line-height 1.75,
headings included. `tailwind-merge` 3 was checked directly against the custom token names — `text-sm` beside
`text-marigold-foreground`, `bg-card` beside `bg-marigold/15` and so on — and drops nothing.

---

## ADR-011 — The AI layer ships dormant, behind a consent gate, with grounding enforced in code

**Date:** 2026-08-28 · **Status:** Accepted · **Implements:** the master context's AI layer (Session 3A)

### Context

The master context calls for an AI layer built in full and dormant by default, in three activation
tiers, with a consent gate, a classified-content banner and a kill switch. That sits in obvious tension
with the hard rule the whole app rests on — "zero network requests carrying user-entered data" — so the
question is not whether to build it but what makes the promise still true, and still testable, once it
exists.

Three sub-decisions needed making, and none of them is reversible cheaply once a surface has shipped.

### Decision

**1. Consent is the feature flag, not a modal in front of it.**
`isAiEnabled()` is `tier !== 'off' && consentVersion === CONSENT_VERSION`. The settings UI and every
module read the same field, so no sequence of clicks reaches an enabled state without the notice, and
`parseAiSettings()` discards anything it does not recognise — a hand-edited settings row cannot forge
consent. Bumping `CONSENT_VERSION` re-gates every device.

**2. Laziness is treated as a privacy property, not a performance one.**
`src/app/store.ts` imports only `src/ai/flags.ts` — a type, a parser and a gate, with no zod, no
WebCrypto and no provider behind it. Everything else is dynamically imported, so a reader who never
turns AI on never downloads the code that could reach the network. `tests/bundle-budget.test.ts` asserts
that `api.anthropic.com`, `anthropic-dangerous-direct-browser-access`, `anthropic-version` and `PBKDF2`
appear in no initial-route chunk, and that the route stays within 30 KB gzip of the pre-AI baseline
(measured: **+5.9 KB**, essentially all of it the bilingual consent copy in the i18n catalogues).

**3. Exactly one module may call `fetch`, and the lint config says which.**
`eslint.config.js` keeps `no-restricted-globals: fetch` across `src/` and grants a single file-scoped
exception to `src/ai/providers/wire.ts`. Reaching the network as `globalThis.fetch` would have satisfied
the linter silently; the written exception is what keeps "what in this app can talk to the network?"
answerable from one file. `tests/no-external-urls.test.ts` gains a matching assertion that
`api.anthropic.com` is named in exactly one source file, and the URL is allowlisted as opt-in rather
than inert — the one entry in that list that really is fetched, and only after consent.

**4. Grounding fails closed, in the agent loop, not in a prompt.**
Each tool result gets a citable handle (`T1`, `T2`, … in execution order). Every agent in `TASK_DEFAULTS`
sets `groundedRequired`, and a final answer citing none of them ends the run with `error: ungrounded` and
is never shown. Independently, `validateCitations()` rejects an out-of-range `[k]` and any section or
rule number that appears in no cited snippet. A prompt instruction would have been advisory; in this
app an invented section number is the worst thing that can happen, so it is a code path with tests.

**5. `device` mode is the default for the key vault, and the modal says what that is worth.**
The AES-GCM key is generated non-extractable and stored as a `CryptoKey` handle, so a table dump yields
nothing reusable; a passphrase mode (PBKDF2-SHA256, 600,000 iterations) is offered for readers who want
it. Neither defends against code running on the origin, and `src/ai/crypto.ts`, `docs/AI.md` and the
consent modal all say so in those words rather than implying more.

**6. The default model is Claude Sonnet 4.6, not the largest available.**
These agents are grounded lookups over bundled tables, not open reasoning, and a BYOK reader pays per
token. Claude Opus 5 is in the picker. `src/ai/models.ts` is the one place a model id, a price or an
effort level is written; it also records which parameters each model accepts, so a request never 400s on
a parameter that model removed.

### Consequences

- **Tier 0 and Tier 2 ship disabled, not hidden.** `LocalProvider` is an interface plus a stub that
  throws `not_installed`; `ProxyProvider` is complete but this build sets no `VITE_AI_PROXY_URL`. Both
  appear in Settings greyed with a reason, because a hidden option reads as a missing feature.
- **`fuse.js` 7.5.0 joins the dependency list**, inside the lazy AI chunk, for the answer cache's
  similarity search. It was already in the master context's pinned stack as deferred.
- **Dexie schema version 2** adds `secrets`, `aiAnswers` and `aiUsage`. All three stay empty until AI is
  turned on; declaring them now means the kill switch has somewhere to clear from on day one.
- **151 i18n keys, up from 108.** The consent copy is the largest single block of prose in the app and
  had to be written in both languages before anything could be enabled.
- The layer costs a reader who never enables it: 5.9 KB gzip of translation strings and a settings
  section that says "off".

### Two defects this work surfaced, both fixed

- **`instanceof Uint8Array` is the wrong check on a value read back out of IndexedDB.** A structured
  clone can return a view whose prototype belongs to another realm — the jsdom-over-Node test
  environment reproduces exactly that, and the browser can too. Every stored key read `null`. Replaced
  with `ArrayBuffer.isView` plus a same-realm copy (`toBytes()` in `src/ai/crypto.ts`).
- **`normaliseQuestion()` destroyed Devanagari.** Matras and the virama are combining marks, not
  letters, so a `\p{L}\p{N}` filter turned "धारा 302 क्या है" into "ध र 302 क य ह" — every Hindi
  question would have normalised to roughly the same consonant skeleton and the answer cache would have
  served the wrong answer. `\p{M}` is now in the keep set, with a test in both scripts.

Additionally, `tests/e2e/a11y.spec.ts` grew a run over the consent modal and the enabled AI banner, and
immediately caught a real contrast failure: `OptionRow`'s hint line dimmed `--muted-foreground` with
`opacity-80`, dropping it below 4.5:1. Size and weight now carry that hierarchy instead of opacity.

### Addendum — edge-case pass (same session)

A deliberate hunt for edge cases across `src/ai`, after the layer was working. Sixteen defects, each
now covered by a test that was verified to fail against the code as first written.

**Transport (`providers/wire.ts`)**

- **A CRLF-framed stream was mis-read as one enormous frame.** `indexOf('\n\n')` never matches
  `\r\n\r\n`. Anthropic sends bare LF, but nothing in the path guarantees that a corporate proxy — or
  the Session 24 Worker — will. The whole buffer is now normalised, not just each new chunk, because a
  `\r` can arrive at the end of one chunk and its `\n` at the start of the next, and per-chunk
  normalisation would leave that pair intact and mis-frame everything after it.
- **A stream ending without its final blank line silently lost its last frame** — which is usually the
  `message_delta` carrying `stop_reason` and the output token count. A turn that stopped on
  `max_tokens` would have been reported as a clean `end_turn`, and the token ledger would have
  under-counted.
- **A cancelled request surfaced as "the AI service could not be reached".** `fetch` rejects with a
  DOMException on abort, never with an `AiError`; the classification now happens in one `send()` used
  by both the streaming and the one-token paths.
- **An empty system block would have 400'd the request.** An absent profile segment or an empty context
  block produces one, and the API rejects a text block with empty text.
- **The response body was left un-cancelled on a mid-stream failure**, holding the connection until GC.
- `data:` with no space after the colon is legal SSE and is now accepted as such rather than by
  accident of `.trim()`.

**The agent loop**

- **`specsFor` filtered a registry-wide spec list down to the agent's tools, which could drop the entry
  carrying the `cache_control` breakpoint** — silently disabling prompt caching for the tool block, the
  largest stable prefix in every request. It also dropped any tool not in the global registry instead of
  sending it. Both gone: the agent now builds its own list via `toSpecs(tools)`.
- **A turn that stopped on `max_tokens` was treated as a finished answer.** A truncated answer can carry
  a well-formed citation and a section number, which is exactly why it must not be shown — it reads as
  complete. New code `truncated`.
- **A turn with no text at all passed as a successful run** when grounding was not required. New code
  `empty`, which also now rejects an empty question before any request is made.
- **The `messages` snapshot handed to the provider was shallow**, so the `content` arrays were still
  aliased to the agent's live state.

**Storage and accounting**

- **`recordUsage` was a read-modify-write with no transaction.** Two runs finishing a turn at the same
  moment — ordinary — and the second `put` overwrote the first. A ledger that under-counts is not a
  hard stop.
- **The answer cache had no ceiling.** Every distinct question added a row holding a whole answer, and
  IndexedDB's failure mode at quota is that some unrelated write starts throwing. Capped at 200,
  evicted oldest-first.
- **A passphrase was verified only against the Anthropic key.** A vault holding some future Tier 2 token
  and no API key accepted every passphrase, reported success, then returned null on the first read.
- **`decryptString` swallowed an environment failure as a wrong key**, sending the reader to fix the
  wrong thing; and `randomBytes` threw a bare `TypeError` where WebCrypto is absent. It now refuses
  loudly — there is no circumstance in which a nonce falls back to `Math.random`.

**Interface**

- **The kill switch's confirmation could never be seen.** Turning AI off is what removes the kill
  switch's own reason to be on screen, so the component unmounted in the same tick it set its own
  "nothing was left behind" message. The parent owns that message now.
- **A key that could not be stored failed silently** — on an insecure origin (no WebCrypto) or with
  IndexedDB blocked, `storeSecret` rejected into a `void` call and the reader was left believing the key
  had been saved.
- **The monthly budget field could not be cleared to retype.** `Number('')` is 0, and a budget of 0
  refuses every run, so a backspace mid-edit silently disabled the feature. The field is uncontrolled
  and commits only a value that parses.
- **A model id written by a newer build rendered as the first option**, telling the reader they had
  chosen something they had not. It is now shown as itself.
- **The consent modal's focus trap had a hole at its own entry point.** The panel takes focus on open
  (`tabIndex={-1}`) and is the last element in the document, so an unhandled Tab from it walked out of
  the dialog. Focus is also now restored to the button that opened it, and the page behind no longer
  scrolls under the modal.

**Two changes of judgement rather than defects**

- **`isPersonalQuery` matched a bare "me"**, so "give me the DA rate" was classified as a personal
  question and excluded from the answer cache — the one feature that keeps a BYOK reader's bill down.
  "me" now counts only after a preposition ("for me", "to me"). The one-way bias is unchanged and
  deliberate: reading a general question as personal costs a cache hit, whereas the reverse would store
  it.
- **`AiErrorCode` became a runtime array**, so `src/ai/errors.test.ts` can walk it and prove every code
  has a message in both catalogues. A union type alone let a new code ship with nothing to render but
  the code itself, or an English string in a Hindi session.

Also added: a Dexie **v1 → v2 upgrade test** — the migration every already-installed device will take,
and the one path a freshly-opened database can never exercise — and a test that `db.tables` lists
exactly the four tables `clearAllData()` (and therefore the kill switch) has to clear.

---

## ADR-012 — The law datasets are generated, the judgement calls are overlaid, and Hindi says which it is

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 2 (NCRB law ingestion)

### Context

The Law Converter needs the whole of three codes — 358 BNS, 531 BNSS, 170 BSA sections — mapped in both
directions, with headings, section text, offence classification and punishment, in both languages, from
public sources, refreshed by a cron nobody watches.

Four things about the sources shaped everything else:

1. **NCRB Sankalan carries far more than the correspondence tables.** Alongside
   `SectionTable{BNS,BNSS,BSA}.html` it publishes `Chapters*.html` (the full English text of every
   section, one `<span id="N">` each), `ScheduleBNSS.html` (the BNSS First Schedule — cognizable,
   bailable, triable) and BNSS §359 (the two compounding tables). The brief expected classification and
   punishment to be hand-curated for 80 sections from a First Schedule PDF; the same data is available
   as parseable HTML for 288.
2. **The rows are inline HTML today, and that is not a promise.** The pages are DataTables-driven and
   the `<tbody>` happens to be rendered server-side. A cron that assumes this silently produces an empty
   dataset the day it changes.
3. **There is no Hindi anywhere.** `GazetteBNS2023.pdf` and `BNS2023.pdf` contain zero Devanagari
   characters. `legislative.gov.in` 404s for the Act; MHA hosts English only. India Code — the one place
   the Hindi text would be — was rebuilt as an Angular application that serves a mount point, and its
   legacy DSpace host now serves a migration notice. `indiacode_seed.py --discover` recorded 0 of 248
   sections.
4. **Some of what a reader most needs is not in any table.** That CrPC 438 and 482 swap places with BNSS
   482 and 528, that "420" is now BNS 318(4) and not BNS 318, that IPC 124A is marked "Deleted" while
   BNS 152 is a differently-worded offence rather than a renumbering — no source states these as facts.
   They are the difference between a correct citation and a wrong one.

### Decision

**Generate everything a source states; overlay everything a human judges; never let the cron write to
the overlays.**

- `scripts/ingest/ncrb_sankalan.py` writes `data/law/{bns,bnss,bsa}.json` and `data/law/index.json`.
  `data/law/overlays/*.json` is hand-curated, merged last, and wins on conflict. A step in
  `.github/workflows/ingest-law.yml` runs `git diff --exit-code -- data/law/overlays/` and fails the run
  if a refresh has touched one.
- **Classification and punishment are generated, not curated.** The BNSS First Schedule and §359 give
  288 BNS sections cognizable/bailable/triable/compoundable and an English punishment, from an official
  source with a URL and a sha256 — more coverage than the 80 the brief asked for, and refreshed weekly
  rather than frozen at authoring time. The overlay keeps what only a human can supply.
- **The PDF fallback is real and reachable.** `rows_are_inline()` checks for a populated `<tbody>` on
  every run and falls through to `pdfplumber` over the bare act if it is empty. Which path ran is
  recorded in `data/_meta/versions.json` as `parsePath` and printed into `docs/DATA-GAPS.md`, and
  `--force-pdf` exercises it deliberately so it is not discovered to be rotten on the day it is needed.
- **Hindi is either official, absent, or labelled.** Nothing is machine-translated. 965 of 1,059
  headings and all 1,059 section texts carry `hi: ""` and are counted in `docs/DATA-GAPS.md`. For the 94
  BNS sections officers cite most, `bns-hindi-curated.json` supplies hand-authored Hindi with
  `provenance.official: false` and `verify: true` on every section it touches;
  `tests/law-data.test.ts` fails if a curated section is not flagged.
- **India Code stays off the cron.** `indiacode_seed.py` is a separate script, absent from the workflow,
  rate-limited to one request per 3 seconds, naming the project in its User-Agent, refusing to request
  `/discover` or `/simple-search`, and stopping dead on the first 403 without retry or mirror.
- **Two schemas for one shape.** `schemas/law-*.schema.json` validates at write time in Python;
  `src/modules/law/schema.ts` validates the committed bytes with zod in `pnpm test`. A dataset cannot
  land unless the producer and the consumer agree on it.

### Consequences

- The weekly pull request is small and readable, or it does not exist. Deterministic JSON writing means
  an unchanged source produces no diff and no PR.
- A source-shape change is loud rather than silent: the coverage counts in `docs/DATA-GAPS.md` move
  before the mappings do.
- **`tests/no-external-urls.test.ts` grew its first data-citation allowlist entry.** The master context
  requires every data card to show its source URL, so `data/_meta/versions.json` now carries
  `https://www.ncrb.gov.in/uploads/SankalanPortal/…`, and that file is bundled through
  `src/lib/dataVersion.ts`. The entry is scoped to that one directory, and a new assertion —
  `keeps dataset source citations in data/, out of the source tree` — fails if any module under `src/`
  ever names the host. Without that second half, the allowlist would have quietly permitted a
  `fetch('https://www.ncrb.gov.in/…')` in application code.
- `data/law/` is 3.9 MB. Nothing imports it, so the initial route is unchanged and the service worker
  does not precache it; Session 4 decides how the Law Converter route fetches it (DATA-GAPS #21).
- The curated Hindi is a debt with a name. It is better than an empty Hindi column on the sections
  officers use daily, and it is worse than the statutory text. DATA-GAPS #16 and #18 say so, and the UI
  is required to render `verify: true` visibly.

### Rejected

- **Machine-translating the headings.** The brief forbids it and it is the right call: a wrong Hindi
  heading on a criminal provision is worse than a missing one, and a reader cannot tell the two apart.
- **Curating classification for 80 sections by hand.** It would have been less coverage, frozen at
  authoring time, and unverifiable against the source a year from now.
- **Scraping India Code's undocumented API.** Its `robots.txt` is currently unreachable and CLAUDE.md
  treats the site as bot-disallowed. An unreachable `robots.txt` is not permission.
- **Auto-merging the refresh PR.** This is section-level criminal law. A stale mapping is recoverable; a
  wrong one shown to an officer is not.

### Addendum — edge-case pass (same session)

A deliberate hunt across the ingest, the datasets and the resolver after the pipeline was working. Nine
defects, each demonstrated against the committed code before it was fixed, and each now covered by a
test. The Python had no tests at all; it has 29 now, wired into both `ci.yml` and the refresh workflow,
because a dataset is only as trustworthy as the parser that produced it.

**The two that would have mattered most**

- **The weekly cron would have opened an empty pull request every week.** `update_versions` stamped
  `generatedAt` _before_ comparing, so a run on a later date rewrote `versions.json` even when all three
  datasets were byte-identical. The whole premise of the workflow is "a PR only when the law moved"; a
  reviewer who dismisses fifty no-op PRs is not reading the fifty-first. The date now advances only when
  a dataset entry actually changed, and two consecutive live runs are quiet.
- **IEA 65B resolved to BSA 63 while carrying a note saying it had no counterpart.** NCRB marks
  sub-clauses `65B(3)(a)`–`(d)` "Deleted", and the note was stamped onto the base entry — on one of the
  sections the acceptance criteria name by number. `CrPC 2` and `IPC 124A` were affected too. Whether a
  section is gone is only knowable once every row has been read, so that decision moved to a final pass:
  a section with no counterpart is `omitted` with a note, a section that survives with parts dropped
  says exactly which parts, and each dropped sub-clause becomes a resolvable entry of its own.

**Transport and repeatability**

- **`fetch` had no retry.** NCRB truncated the BSA PDF mid-body on a real run and the whole refresh died.
  Network failures and 5xx now retry with a linear backoff; a 403 still stops everything with no retry
  and no mirror, and a 4xx is treated as an answer rather than as weather. A short body against a
  declared `Content-Length` is a failure too — a truncated document that _parsed_ would look exactly
  like a source that had dropped half its sections.
- **The PDF fallback had never executed.** It does now, and it is measured rather than assumed: 178 of
  the 179 BSA mappings the HTML path finds, 99.4%. Degraded but usable, which is what a fallback needs
  to be. It is exercised on demand with `--force-pdf`.
- **`--code bns` would have published shared files built from one code** — `index.json` losing CrPC and
  IEA, the DATA-GAPS table losing two of three rows. Both now start from what is on disk and replace
  only the codes that ran.

**Silent failure**

- **An overlay patch matching no section was skipped without a word**, so a typo'd number meant curation
  the author believed was live. The run now fails and names it.
- **`parse_chapters` trusted that every section span hangs off one container.** If NCRB reshapes that
  page the sections would simply not appear — the quietest possible failure. It is checked.
- **The workflow's "the cron may not touch the overlays" guard used `git diff`**, which cannot see an
  _added_ file. It uses `git status --porcelain`.

**Client-side**

- **`normaliseSectionRef` upper-cased the whole reference.** Indian drafting writes the suffix upper
  (498A, 65B) and the sub-clause lower (2(f), 65B(3)(a)), so `65B(3)(a)` normalised to `65B(3)(A)`,
  missed its own entry, fell back to the base, and answered a question about clause (a) with the whole
  of 65B. Found by a test written for the _previous_ fix, which is the argument for writing them.
- **Four bracket-juggling passes were provably redundant**, one of them a lookbehind — a parse-time
  `SyntaxError` in Safari before 16.4, which takes down the whole chunk rather than the call. Removed
  for identical output on every input.
- **Lookups reached `Object.prototype`.** `sections` and `entries` come from `JSON.parse`, so a reader
  typing "constructor" got a function. `Object.hasOwn` now guards both.

**Smaller**

`str.title()` on chapter titles produced "Of Contempts Of The Lawful Authority Of Public Servants"; it is
sentence case now. `has_hindi` was a single-character test, so one Devanagari glyph in India Code's
bilingual chrome would have filed an English provision as the Hindi text; it needs 15% of letters.
`raw/` grew ~5 MB a run with no bound and had reached 30 MB; three generations per document are kept.

---

## ADR-013 — The Law Converter: how 3.9 MB of statute reaches the device, and how a query finds it

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 4 (Law Converter UI) ·
**Supersedes:** the "fetch per code on the route" assumption in `docs/DATA-GAPS.md` #21

### Context

Session 2 produced `data/law/*.json` — 1,059 sections across three codes, 3.9 MB — and deliberately left
it unimported (ADR-012). This session had to put a screen over it. Four questions had no obvious answer.

**1. How does the data reach the browser?** `docs/DATA-GAPS.md` #21 assumed a `fetch` of `/data/*.json`.

**2. What does "search" mean here?** The reader types `302`, `hatya`, `हत्या`, `sec 438 crpc` or
`anticipatory bail`, and all five have to reach the same records.

**3. Where does the offence date live?** The brief says "session state only", and the hard rule says all
user state lives in IndexedDB.

**4. What is "works fully offline" worth if the answer is not in the cache?**

### Decision

**1. The datasets are `?raw` dynamic imports, not fetches.**

```ts
const raw = (await import('../../../data/law/bns.json?raw')).default
return JSON.parse(raw) as LawDataset
```

Three reasons, in order of weight:

- `eslint.config.js` grants `fetch` to exactly one file, `src/ai/providers/wire.ts` (ADR-011), so
  "what in this app can talk to the network?" is answerable from one file. A loader here would have
  needed a second exception — for data that is not on the network at all.
- A dynamic import becomes a content-hashed chunk, so `globPatterns` in `vite.config.ts` precaches it
  through the existing JavaScript glob, and an unchanged dataset keeps its hash across a release. The
  `/data/*.json` `runtimeCaching` rule would only have populated the cache for a reader who had already
  opened this route **online**, which is not what "offline-first" promises.
- `?raw` yields a string, so this is one `JSON.parse` of a compact string rather than a megabyte-scale
  object literal for the engine to build field by field — and TypeScript types it `string` instead of
  inferring a type over 1,059 sections on every `pnpm typecheck`.

The precache grew from 838 KiB to 4.9 MiB (≈490 KB over the wire, gzipped). That is the price of the
promise, and `tests/e2e/offline.spec.ts` now installs the worker from `/settings`, goes offline, and
answers a section lookup on `/law` — a page that has never been loaded with a network available.

**2. The section tables are not loaded until there is a query.** `useLawEngine(enabled)` is passed
`false` while the search box is empty, so opening `/law` and reading it downloads nothing. Lighthouse
mobile on `/law` went 62 → 84 for that change alone; the service worker still warms the cache in the
background, so a reader who does search pays once.

**3. Ranking is a documented score table, not a fuzzy-search library's defaults.**

`src/lib/search.ts` computes three bands — an exact section match, the same number read the other way,
then everything else — and within the last band a score from `SCORE`, every entry of which is a claim
about the law rather than about search:

| Signal                                    | Score           |
| ----------------------------------------- | --------------- |
| the heading, whole, is the query          | 0               |
| a word of the heading is the query        | 0.05 + 0.001/wd |
| a repealed heading is the query           | 0.02            |
| a word of a repealed heading is the query | 0.15            |
| a curated keyword is the query            | 0.25            |
| a prefix of either                        | 0.30            |
| Fuse's own score                          | 0.35 + 0.4·s    |
| the query appears in the section text     | 0.85            |

**A heading is worth more than a keyword** is the load-bearing line. `scripts/ingest/lexicon.json`
attaches a term to a section whenever it appears in the heading _or the text_, so 26 sections carry the
keyword "theft" — every one correctly, and only one of them is the offence of theft. Scoring a keyword
as highly as a heading put BNS 42 (abetment) above BNS 303 (theft) for the query "theft": not a near
miss, the wrong answer at the top of the page.

**4. The lexicon is a translation table, and that is what makes bilingual search work.**
`src/lib/lexicon.ts` reads the same hand-authored file the Python ingest uses and turns each entry's
`en`/`hi`/`roman` lists into one equivalence class. A reader types "jamanat"; not one BNSS bail heading
contains that string in any script, because "bail" and "jamanat" are not the same word and no
transliteration can bridge them. A translation can. The expansion is scored 0.02 worse than a direct
hit, so a section literally headed with the word typed still comes first.

`src/lib/transliterate.ts` does the other half — Devanagari ⇄ Latin plus a `foldRoman` that collapses
what roman Hindi spells inconsistently (vowel length, `v`/`w`, `z`/`j`, a trailing schwa), so "hatya",
"hatyaa" and the transcription of "हत्या" become one key. Neither direction is a transliteration
standard and neither is ever shown to a reader.

**5. The offence date is written nowhere.** Not IndexedDB, not `sessionStorage`. It lives in a
module-scoped variable in `src/modules/law/url.ts` for the life of the tab, and in the URL when the
reader shares a link. It is the most identifying thing anyone types into this module, and there is no
version of "remember it" worth writing to disk for. Everything else about the view — query, code,
direction, date — is in the URL, and `parseLawParams` validates every parameter because a deep link is
untrusted input.

**6. `/law/whats-new` is a list of pointers, not a page of summaries.** Each bullet in
`src/modules/law/whatsNew.ts` names a provision and one bilingual sentence saying why it matters;
the heading, status and source are read from the datasets at render time. `tests/law-whats-new.test.ts`
resolves all 28 against the committed data and checks the claims as well as the references — that a
bullet marked "new" points at a section the dataset records as new, and that one marked "dropped"
points at a provision with no counterpart.

### Consequences

- **Lighthouse.** `/law?q=302` with the section tables loaded scores **96 on the desktop preset**
  (FCP 0.6 s, LCP 1.4 s, TBT 70 ms, CLS 0) — the acceptance target. On the **default mobile preset it
  scores 67**, and it cannot reach 90 there: `/settings`, which loads no module data at all, scores 90,
  so the application shell is the ceiling and 490 KB of statute sits under it. Recorded as
  `docs/DATA-GAPS.md` #22 with the measured split that would fix most of it.
- **`fuse.js` moves out of the AI chunk** and into the Law Converter's. It is no longer only the answer
  cache's similarity search.
- **Dexie schema version 3** adds `lawFavourites` and `lawRecents`. Recent lookups are capped at 20 and
  written only after a section has been on screen for 1.5 s — without the dwell, typing "302" wrote
  three rows (the first hit for "3", "30" and "302") and the list was mostly sections nobody had read.
- **268 i18n keys, up from 153.** The `law.*` block is the module's whole vocabulary in both languages.
- `data/law/overlays/traps-and-transitional.json` earns its keep: the trap banners for "302", "420",
  "376" and the 438/482 swap are the highest-value thing on a result card and no source states them.

### Six defects this work surfaced, each now covered by a test

- **The section-prefix regex ate the first letter of any word beginning with `s`.** `(?:^|\s)(?:…|ss?\.?|…)`
  turned "suicide" into "uicide" and "sedition" into "edition" — and the fuzzy matcher covered for it by
  returning plausible results anyway, which is why it survived a first pass. These prefixes only ever
  mean "section" when a number follows; the regex now requires one (`(?=\d)`).
- **The search field lost keystrokes.** Driving the input straight from `useSearchParams` looked cleaner
  and re-rendered it with a stale value: typing "420" quickly left "2" in the box. Anyone typing at speed
  hits this, and a Devanagari IME — which commits several characters at once — hits it harder. The field
  is now locally stateful with the URL as an output, reconciled by comparing against the value the draft
  was started from rather than by an effect.
- **`useLawEngine` could report "loading" forever with the data in memory.** Clearing the query and
  typing again cancelled the first run before it reported, and the second run saw a populated cache,
  returned early, and never set state.
- **The windowed result list never scrolled.** The window was clamped to `activeIndex - OVERSCAN`
  unconditionally, and `activeIndex` is -1 whenever the reader has not used the keyboard — so the first
  row index was always 0 and scrolling a long list revealed blank space.
- **The selected result row failed contrast.** `--muted-foreground` on `--accent` measures below 4.5:1.
  The supporting line now uses `--accent-foreground` and the hierarchy is carried by size and weight —
  the same fix `OptionRow` needed in ADR-011.
- **`aria-controls` pointed at nothing.** The search field named the result list even when there were no
  results and the list was not in the document (axe `aria-valid-attr-value`) — the same class of defect
  as the More sheet's in ADR-010.

Also: a rejected corpus load is no longer cached, in either `src/modules/law/data.ts` or the AI tools'
engine — one interrupted download would otherwise have poisoned every later attempt in the tab.

Two more found by reading rendered screenshots rather than by a test, and fixed:

- **The curated-Hindi warning fired in English**, where the card shows nothing curated (the English text
  is the Act's own words; only the Hindi is hand-authored). A banner that cries wolf on every English
  card is how readers learn to stop reading banners. It is now scoped to the Hindi view, which is the
  view `docs/DATA-GAPS.md` #18 is actually about.
- **"New sub-sections: 103" on BNS 103.** The dataset uses the section number as the clause when a
  section has only one, so the whole section was being listed as a sub-section of itself. Clauses equal
  to the section number are filtered out; the status pill above already says the section changed.

### Addendum — adversarial edge-case pass (same session)

A second, deliberately adversarial sweep after the module was working: probing
scripts over the real datasets rather than invented inputs, plus reading rendered
screenshots. Nine more defects, each now covered by a test that was checked
against the code as written.

**Search and parsing**

- **Devanagari digits were not section numbers.** `normalize('NFKC')` folds
  fullwidth `３０२` to `302` and leaves `३०२` alone — they are a different number
  system, not a compatibility variant. "धारा ३०२" produced a text search rather
  than a lookup, in the module whose whole premise is that Hindi is not a
  second-class way in. `toAsciiDigits` now runs before the reference test.
- **"The first Act named" named the wrong one.** The scan walked `ACT_TOKENS` in
  table order, so "ipc 302 bns 103" was read as a question about BNS 302 — the
  comment said one thing and the code did another. It now takes the token
  matching earliest in the QUERY, longest match winning a tie, which is what
  keeps "bnss" from being read as "bns".
- **"438/CrPC" did not parse.** `/` was not a separator, so the reference kept a
  trailing slash and failed. Officers write references that way constantly.
  `u/s` still works: `SECTION_PREFIX` strips it earlier.
- A sweep of all 2,267 heading words and keywords in the three datasets for
  accidental Act-name substrings (`bns` inside an ordinary word, and so on)
  found **none**, so the `includes` match is safe against the real vocabulary.
  That is worth recording because it is the obvious thing to worry about.

**Diff and transliteration**

- **The danda was not punctuation.** `।` and `॥` are the Devanagari full stop;
  the ingest's Hindi headings end in one and the English ones do not, so every
  Hindi heading pair reported a spurious deletion plus insertion.
- **Zero-width joiners leaked into transcriptions.** A Devanagari keyboard puts
  U+200D inside conjuncts; `romanise('क्\u200dष')` returned `"k\u200dsha"`.

**Storage**

- **The recent-lookups trim deleted the wrong rows.** `Date.now()` has
  millisecond resolution, several lookups land inside one, and Dexie breaks a
  tie on the primary key — a string, where `"bns:10"` sorts before `"bns:2"`.
  A burst of twenty-five lookups kept 4–9 and deleted 10 and 11. Timestamps are
  now strictly increasing within the tab, which makes the ordering total and
  leaves the value a real date.

**The result list**

- **A stale `activeIndex` took the whole list out of the tab order.** The page
  owns that index and a new query can return fewer rows; when it pointed past
  the end, no row got `tabIndex={0}`.
- **The windowing arithmetic stretched the window instead of moving it.**
  `first = min(fromScroll, active - OVERSCAN)` spans row 0 down to the focused
  row, so a row near the end of 400 rendered all 400 and switched virtualisation
  off, while `active` of -1 (nothing focused, the usual state) pinned `first` to
  0 so scrolling showed blank space. It is now a fixed-width slice that follows
  the scroll position and re-centres only when the focused row falls outside it.

### Browsing an Act, added after the first pass

The code chips did nothing at all with an empty search box — they selected a
filter over no results. Picking a code now lists that Act end to end, which is a
real way to use a law reference and is what `ResultList`'s windowing was built
for (531 rows for the BNSS).

It stays behind an explicit chip press rather than happening on load, because
that is what keeps the 3.9 MB download off a bare `/law`. Three things separate
it from a search, and each was wrong in the first cut: a browse row shows no
"why this matched" badge (nothing matched), the result cap notice never applies
(nothing is truncated), and **nothing is auto-opened** — a search opens its best
result because that is the answer the reader asked for, whereas opening BNS 1
and recording it as a lookup would be the app answering a question nobody put.

### Looked at, deliberately not done

- **Splitting the section text out of the search payload.** Measured: dropping `text` takes the
  searchable payload from 391 KB gzip to 139 KB. It would need a build-time transformation emitting two
  modules per code, and it still could not lift the mobile score past the shell's own 90. Recorded as
  `docs/DATA-GAPS.md` #22 rather than built at the end of this session.
- **Showing results as each code arrives.** It would cut the wait for the first answer, and a partial
  result list that looks complete is exactly the failure this module exists to prevent.
- **Voice search.** Asked for, and it cannot be built the ordinary way here. `SpeechRecognition` in
  Chrome streams the audio to Google's servers; it is not on-device. A spoken query is user-entered
  data leaving the device, which is the hard rule `tests/e2e/zero-third-party-requests.spec.ts`
  enforces. The compatible shape is the AI layer's: off by default, behind a notice that says where
  the audio goes, with `hi-IN` / `en-IN` locales — a product decision about a hard rule, so it is the
  human's to make. Recorded as `docs/DATA-GAPS.md` #23.

---

## ADR-014 — Voice search ships behind its own consent gate, because it is a network feature

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 4 (follow-up) ·
**Follows:** ADR-011's consent-as-feature-flag pattern

### Context

Voice search was asked for, and it collides head-on with the hard rule this app rests on.

`SpeechRecognition` looks like a browser API and behaves like a network client. Chrome's implementation
**streams the captured audio to Google's servers**; it is not on-device recognition. Firefox implements
none of it. Safari implements some of it, with no guarantee about where the audio goes.

So a spoken query is user-entered data leaving the device — the thing the master context forbids and
`tests/e2e/zero-third-party-requests.spec.ts` enforces. And a spoken query is the _most_ identifying
input this module can take: an officer says an offence and a date out loud.

Building it the ordinary way (a mic button that just works) would have meant weakening the one test that
proves the promise. The human was asked and chose the opt-in design.

### Decision

**The AI layer's pattern, applied unchanged.** Consent IS the feature flag; there is no second switch
that could get out of step with it.

1. **`src/lib/voiceConsent.ts` — flags only.** No runtime imports, no browser API. `src/app/store.ts`
   loads it eagerly, so `voice.enabled` is readable anywhere without pulling in the recogniser.
   `isVoiceEnabled` requires `enabled === true` **and** `consentVersion === VOICE_CONSENT_VERSION`, so a
   hand-edited settings row cannot turn the microphone on — `parseVoiceSettings` discards anything it
   does not recognise, exactly as `parseAiSettings` does.
2. **`src/lib/voice.ts` — the second network seam, named as one.** `eslint.config.js` now restricts
   **both** spellings of the global everywhere and grants a single file-scoped exception here, beside
   the existing one for `fetch` in `src/ai/providers/wire.ts`. "What in this app can send something off
   the device?" is still answerable by reading two files.
   `tests/no-external-urls.test.ts` asserts the count independently of the lint rule, so disabling the
   rule does not also disable the check.
3. **Reached by a dynamic import on the first press.** The presence check (`'SpeechRecognition' in
window`) ships, because it decides whether to draw the button at all; the recogniser does not.
   `tests/bundle-budget.test.ts` asserts that `maxAlternatives`, `interimResults`, `audio-capture` and
   `service-not-allowed` — strings that exist only inside `listen()` — are absent from the initial route.
4. **One utterance, never continuous.** A search box is not a dictation surface, and an open microphone
   that keeps streaming is not something to leave running under somebody who pressed a button once.
   The session also aborts on unmount: a microphone must not outlive the screen it was opened from.
5. **Listening is visible and announced** — the icon changes, the button's accessible name becomes
   "Stop listening", `aria-pressed` flips, and an `aria-live="assertive"` region says so. An open
   microphone with no indicator is not shippable, and an icon on its own is not an indicator.
6. **The notice is short and specific.** It names the company that receives the audio, says it is not
   on-device, and says it can be turned off again. A long notice is a notice nobody reads.
7. **Turned on from the search bar, off from Settings.** Consent belongs next to the action it enables;
   a kill switch belongs somewhere findable. Turning it off keeps the recorded consent, so turning it
   back on does not re-prompt — bumping `VOICE_CONSENT_VERSION` is what re-prompts everybody.
8. **Recognition runs in the reader's own language** — `hi-IN` and `en-IN`, from the app language.
   Devanagari-language recognition is the entire point for a reader who does not want to switch keyboards.

### Consequences

- **The privacy suite gained the assertion that matters**: a Playwright test replaces the global with a
  counting stub _before the app loads_, uses the page normally, opens the notice, declines — and asserts
  that **zero** recognisers were constructed and no cross-origin request was made. That is the property,
  stated as a test rather than as a promise.
- Firefox readers see no microphone button rather than a broken one.
- 291 i18n keys, up from 270. The notice and five distinct error sentences are written in both languages:
  "it failed" is not an answer when a microphone is involved, so a refused permission, a missing device,
  silence, an unreachable service and an unknown fault each say something a reader can act on.
- `docs/DATA-GAPS.md` #23 is closed by this. It is replaced by nothing: the decision is recorded here.

### The alternative, recorded

On-device recognition would remove the need for any of this — no notice, no seam, no exception. Chrome
is shipping an on-device mode for the Web Speech API and Safari does some recognition locally. When it
can be feature-detected and _required_, the honest move is to require it and drop the consent gate.
Until then the notice is the only truthful thing to show.

---

## ADR-015 — Browsing an Act: the list is the screen until a section is opened

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 4 (follow-up) ·
**Amends:** ADR-013's result-list design

### Context

Browsing (ADR-013 addendum) put a code chip to work when the search box is empty. Using it turned up
five problems in a row, every one of them found by looking at the screen rather than at the tests:

1. Picking **"All"** did nothing — it is the DEFAULT chip, and a radio that is already checked fires no
   change event. The most obvious control on the page was the one that appeared broken.
2. The list **ended in blank space** after twenty rows.
3. Opening a section put the card **below the fold**, and a reader had no way to tell that anything had
   happened.
4. An opened section **could not be closed**.
5. The **direction toggle did nothing** while browsing.

### Decision

**1. Browse intent is its own URL parameter.** `browse=1`, separate from `code`, because "All" is the
default code and a click on it is otherwise indistinguishable from a page load. Without it the choice
was between a bare `/law` downloading 3.9 MB nobody asked for and the All chip doing nothing. It also
makes a browse shareable and reload-safe. The chips carry `onClick` as well as `onChange`, so an
already-checked radio still registers the press; `onChange` stays for the keyboard, where arrow keys
move between radios without a click.

**2. The list has the page until a section is opened.** A 24rem column of sections beside an empty
half-page reads as a broken layout. Full width while browsing; two panes — sticky list, section beside
it — once something is open, from 1024px. Below that they stack and the card is scrolled into view.

**3. The card scrolls into view only when it is not already in it.** The test is the card's own top
edge, not a breakpoint: beside the list on a wide screen nothing moves, stacked on a phone it moves.
`block: 'nearest'` alone was not enough — the card is taller than the viewport, so "nearest" aligned
its top and scrolled the search box away on a desktop where the card was perfectly visible. Focus is
deliberately NOT moved; it would strand a reader arrowing through the list, and a live region carries
the same information without it.

**4. The card can be closed**, and closing is remembered against the QUERY it was closed on — so a new
search opens its best result again rather than leaving the reader in a mode they cannot get out of.

**5. The direction toggle is disabled while browsing, with the reason written next to it.** Direction
decides what a bare number means; with nothing typed it has nothing to decide. It works correctly for
a search — "302" gives BNS 103 one way and BNS 302 the other — so the fix was to stop showing a live
control that could not do anything, not to change the ranking.

### Two defects in the list itself, both from the same instinct

- **Absolute positioning was the wrong way to virtualise here.** Opening a section reflows the list
  from full width into a column, and the browser clamps the pane's scroll position when it does — so
  the remembered offset pointed at rows the reader was no longer looking at, and every row was rendered
  at a coordinate off screen. **The list went blank on a click.** It is now two spacer rows in normal
  flow: the same scrollbar, but a stale offset shows the WRONG rows for a frame instead of NO rows at
  all. A list that silently goes blank is not a recoverable failure.
- **The window size is measured, not assumed** — from a `ResizeObserver` and again on every scroll,
  because the scroll is the interaction whose correctness depends on it. There is also a floor of 30
  rows, so a pane measured at zero still renders enough to scroll rather than appearing to stop.

### And two the screenshots caught

- **The page scrolled sideways on a phone.** A grid item's default `min-width: auto` is its min-content
  width, and the card carries a 36rem classification table — so the card was 576px wide inside a 390px
  viewport. `min-w-0` on both grid children. The design system forbids horizontal body scroll outright,
  and it is now asserted at 390 / 768 / 1024 / 1440.
- **That table also became a scrollable region with no way in from the keyboard** once the card moved
  into a narrower pane (axe `scrollable-region-focusable`). It takes `role="region"` and `tabIndex={0}`
  — and `eslint.config.js` had to be told, because `jsx-a11y/no-noninteractive-tabindex` allows that
  only on `tabpanel` by default and the two rules otherwise contradict each other on the very markup
  that satisfies WCAG.

### Consequences

- Every one of these was invisible to the unit suite, because jsdom has no layout. The regression tests
  are Playwright, run at four viewports — phone, tablet portrait, tablet landscape, desktop.
- `pnpm check` green (831 unit), 59 Playwright e2e green.

---

## ADR-016 — The pay datasets: generate the matrix, OCR the orders, and let `verify` carry the doubt

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 5 (Pay & Allowances data)

### Context

The Pay & Allowances Calculator needs eleven datasets before it needs a single component: the
7th CPC pay matrix, the Dearness Allowance series since 2016, the House Rent Allowance city
classification, the allowances themselves, the posts an officer might hold, the four deduction
schemes, the income tax position and the status of the 8th CPC. Four questions had no obvious
answer, and the fourth is the one that shapes the module.

**1. How do you get 540 numbers out of a scanned table without getting one of them wrong?**
The pay matrix is published only as an image. `doe.gov.in` hosts no text-layer copy of the
CCS (Revised Pay) Rules, 2016 and no mirror found has one.

**2. How do you read a Department of Expenditure order at all?** Almost every one of them is a
scan. The single exception turned out to be the most valuable document in the session.

**3. What does the reader see when the number is right but unconfirmed?** The master context says
to keep a figure and set `verify: true`. On a pay slip that is not a footnote — it is the
difference between a figure to act on and a figure to check.

**4. Where does "no matrix" belong for the 8th CPC?** Every pay calculator on the internet shows an
"8th CPC salary". None of them can, because nothing has been recommended.

### Decision

**1. The pay matrix is generated from the Commission's own rule, and checked against the scan.**

`scripts/ingest/pay_matrix.py` derives all 540 cells from 19 entry pays and 19 cell counts:
cell _n_ is cell _n−1_ raised by 3 per cent and rounded to the nearest hundred, and cell 1 is the
pre-revised entry pay times that level's index of rationalisation (7th CPC report, Table 4). Only
38 numbers have to be right, and all 38 sit in one `ANCHORS` list a reviewer can read at once.

`verify_against_gazette()` is what makes that defensible rather than merely convenient. It asserts
the last cell of every level against the figure printed in the Schedule, spot-checks eleven interior
cells spread across the width of the table, and re-derives every entry pay from its pre-revised pay
and index. It passes on all 19 levels. `tests/pay-data.test.ts` then re-derives the rule
independently, so the generator and the test would have to be wrong in the same way.

The reason this is not a shortcut: transcribing a 19-column numeric table is exactly the operation
that produces one wrong digit in one cell that nobody ever notices. Deriving it means a wrong digit
is impossible unless an anchor is wrong, and every anchor is asserted against the printed page.

The entry-pay check tolerates half a unit in the last published decimal of the index rather than
demanding equality: the report prints `80000 × 2.81 = 225000`, and 80,000 × 2.81 is 2,24,800. The
index is published to two decimals and cannot pin the entry pay more tightly than that. Asserting
exact equality would have meant either deleting the check or writing a false one.

**Level 13 ships as substituted.** The 2016 gazette runs it from ₹1,18,500 to ₹2,14,100 over 21
cells at an index of 2.57; the CCS (Revised Pay) (Amendment) Rules, 2017 replaced it from
01.01.2016 by a 20-cell level from ₹1,23,100 to ₹2,15,900 at 2.67, and DoE O.M. 4-6/2017-IC/E-III(A)
of 28.09.2017 calls the earlier one "non-existent ab-initio". Shipping the 2016 level would be
shipping a level that legally never existed. Pay in it is still fixed with the fitment factor of
2.57 — the same OM says the 2.67 is an index of rationalisation, not a fitment factor, and that pay
fixed at 2.67 "is liable to be rectified and excess amount recovered forthwith". Both facts are in
the level's `note`.

**2. The scanned orders were read by rendering and recognising, and then by eye.**

No `tesseract` on the machine and none in the stack. Every page of every order was rendered to PNG
with PyMuPDF and put through the macOS Vision text recogniser, and the figures were then checked
against the rendered page visually before being written down. That is how the House Rent Allowance
annexure — 102 cities across 35 States and Union Territories — reached `data/pay/cities.json`, and
how the Tough Location Allowance rate table reached `allowances.json`. The recogniser reads a table
column-first when the page is rotated, so every table was also read as an image before its numbers
were trusted; that is what caught R3H2, which is ₹3,400 / ₹2,700 and not the ₹4,100 / ₹3,400 that a
symmetry argument would suggest.

None of this is in the repository. The renderer and the recogniser are a one-off, the raw PDFs are
git-ignored like everything else in `raw/`, and what ships is the JSON with the order's number, date
and URL beside each figure.

**The 7th CPC report itself has a text layer.** 899 pages, fetched from `doe.gov.in`, searchable.
It is the source for the Risk and Hardship Matrix, Dress Allowance, Children Education Allowance,
Detachment, Deputation (Duty), Running Allowance, Night Duty, Non-Practising Allowance and the
Special Security Allowances — every allowance whose notifying order could not be found. Those
records say the Commission recommended the figure; they do not say the Government notified it, and
they all carry `verify: true`.

**3. `verify` is a claim about provenance, and the counts are the honest summary.**

`verify: false` means a figure was read from the order that made it. Everything else is `true`.
That yields, deliberately, an uncomfortable set of numbers: 0 of 19 matrix levels, 0 of 102 cities
and 10 of 32 allowances are confirmed, but 66 of 67 posts and all 21 tax records are not. Nine rows
in `docs/DATA-GAPS.md` (#23 to #32) say for each group which order would settle it.

Two consequences follow for the UI, and they are the reason the flag is worth its cost. A record
with `verify: true` owes the reader the marigold banner the Law Converter already uses for curated
Hindi (ADR-013), and an AI tool that returns one owes the same sentence. Second, `data/pay/jobs.json`
is almost entirely unconfirmed, so the Pay calculator must not present a job-title pick as an
authority — it is a starting point for a form the officer then checks.

**The one place the brief's number was not taken.** It named the Central Bureau of Investigation
allowance at 25 per cent. The 7th CPC records 25 per cent as the rate _before_ rationalisation, for
officers up to Superintendent of Police, and recommends a single rate of 20 per cent. The dataset
carries 20 with `verify: true` and a note stating both figures and where each comes from, and
`docs/DATA-GAPS.md` #26 asks a human which one the CBI actually pays. Recording the brief's figure
without the recommendation, or the recommendation without the brief's figure, would each have hidden
half of what is known.

**4. `data/pay/cpc8.json` carries status facts and a list of things nobody knows.**

Constituted 3 November 2025 by Resolution F. No. 01-01/2025-E.III(A); Justice Ranjana Prakash Desai
as Chairperson, Prof. Pulak Ghosh as part-time Member, Shri Pankaj Jain as Member-Secretary;
headquarters Delhi; recommendations within 18 months, which is 3 May 2027. All of that was read
from the gazette PDF, which has a text layer, and carries `verify: false`.

There is no matrix, and the schema has no place to put one. The three fitment factors in public
circulation — 1.92, 2.57 and 2.86 — are recorded as `status: "projected"` with what each is
attributed to, and `whatIsNotKnown` is a five-item list in both languages saying there is no matrix,
no fitment factor, no date of effect, nothing about allowances, and that any calculator producing an
"8th CPC salary" is multiplying a guess by a pay matrix. `tests/pay-data.test.ts` asserts the
absence of a matrix, because that absence is the feature.

**5. Two schemas per dataset, and neither producer nor consumer can drift alone.**

`schemas/pay-*.schema.json` is validated by Python — `pay_matrix.py` before it writes, and the new
`scripts/ingest/validate_data.py` over every file in a manifest. `src/modules/pay/schema.ts` is zod,
run by `pnpm test`. This is the arrangement ADR-012 set up for the law datasets, extended rather than
reinvented. CI now runs `validate_data.py` and `pay_matrix.py --check` alongside the ingest unit
tests.

`validate_data.py` treats a file in its manifest that does not exist as a failure rather than a skip.
A dataset that silently stops being validated is worse than one that was never validated.

**6. `data/_meta/versions.json` names the pay sources but carries no pay URL.**

`versions.json` is bundled — `src/lib/dataVersion.ts` imports it — so any URL in it reaches `dist/`
and has to be added to the allowlist in `tests/no-external-urls.test.ts`. The law entries each cite
one source and earned one allowlist line (ADR-012). The pay datasets are compiled from dozens of
orders across `doe.gov.in`, `pfrda.org.in`, `ssc.gov.in`, `upsc.gov.in` and more, and adding all of
those to the allowlist would turn a deliberate, reviewed exception into a wide-open door.

So the pay entries in `versions.json` carry `source.name` and no `source.url`. Nothing is lost: the
UI reads label, version and date from `versions.json` and reads the citation it actually shows from
the per-record `source` inside each dataset, where every URL is. The allowlist is unchanged and the
audit question — what may this app request? — still has the same one-line answer.

### Consequences

- **1.2 MB of new data, none of it in the bundle.** `data/pay` is not imported by anything under
  `src/`. When the Pay module is built it must reach the datasets the way the Law Converter reaches
  the statute — a `?raw` dynamic import, not a `fetch` (ADR-013) — so `src/ai/providers/wire.ts`
  stays the only module in the app that may call `fetch`.
- **`tests/pay-data.test.ts`: 89 assertions over the committed bytes**, read off disk with
  `readFromRoot` like the law suites. They check the 3-per-cent rule on every cell, the grade-pay to
  level map including the two 5400s, that Level 13 is the amended one, that the Risk and Hardship
  Matrix is symmetrical about its diagonal, that every `allowanceId` on every post resolves, that
  every post's grade pay matches the level it claims, that IB ACIO-II lands on Level 7 / GP 4600 with
  the Special Security Allowance switched on, and that the 8th CPC record has no matrix. Each was
  confirmed to fail against a deliberately corrupted copy before being kept.
- **A test for Hindi that is copied English.** The zod schemas require both members of every
  bilingual object to be non-empty, which a copy-paste passes. The suite walks every dataset and
  fails on any `{ en, hi }` where the two are identical and longer than four characters. It found
  nothing, which is the point of running it now rather than after the first shortcut.
- **`enabledByDefault` is a claim, and it is tested.** It is true only where an allowance follows the
  post — the Intelligence Bureau's Special Security Allowance, a uniformed post's Dress Allowance,
  Ration Money for personnel below officer rank. Anything that depends on where an officer is posted
  or on an option they exercise is false, and the suite asserts that eleven named allowances are
  never defaulted on.
- **`daLinked` is load-bearing and easy to miss.** Most fixed allowances state the 2017 rate and rise
  by 25 per cent each time Dearness Allowance crosses 50 per cent, which happened on 01.01.2024. A
  calculator that renders `2250` for Children Education Allowance is a quarter short; the field says
  `quarter-per-fifty`, `timesApplied: 1`, `since: 2024-01-01`, and the suite asserts all three on
  every semi-indexed allowance.
- **The Dearness Allowance series has two rows for 01.07.2021.** 28 per cent restored the three
  frozen instalments; 31 per cent superseded it from the same date three months later. Both are
  recorded because both were notified, and `supersededBy` is what tells a lookup which one to use.
  Dropping the 28 would have lost the fact that the frozen instalments were never paid as arrears.
- **One projection, and it is fenced.** 63 per cent from 01.07.2026 carries `status: "projected"`, a
  range of 62 to 64, `verify: true` and a note saying no order exists. The suite asserts there is
  exactly one and that it is the last row.

### Rejected

- **Committing the OCR text alongside the JSON.** It would look like provenance and be worse than
  none: the recogniser mangles enough of every page that a reader comparing a figure against the
  dump would find a discrepancy that is the recogniser's, not the data's. The order's number, date
  and URL are the provenance; the PDF at that URL is the artefact.
- **A `pnpm data:validate` script.** It would need either a new JSON Schema dependency for Node or a
  Python interpreter inside `pnpm check`. The zod schemas already run in `pnpm test`, which
  `pnpm check` runs, and the JSON Schema half runs in CI beside the ingest unit tests, which is where
  the Python already is.
- **Carrying the Railway Kilometreage rates.** They are per-category, per-100-kilometre, differ for
  shunting, and are notified by the Railway Board rather than the Department of Expenditure. The pay
  element of 30 per cent is what a pay calculator can actually use and is what ships; the rest is
  `docs/DATA-GAPS.md` #32, and the card will have to say the kilometreage part is not included.
- **Rounding the July 2026 Dearness Allowance projection to a single confident number.** The monthly
  AICPI-IW figures reported by secondary sources for the first half of 2026 do not agree to the
  decimal. A range and a flag is what the evidence supports.

---

### Addendum — edge-case pass (same session)

Eleven defects, found by mutation-testing the suite against deliberately corrupted copies of the data
and by probing the invariants the tests did not state. Nine were in this session's own work.

**The zod schemas were not the guarantee their own comment claimed.** `z.object` _strips_ unknown
keys, so `gradePayy`, `taxabl` and `entryLevell` all parsed clean while the JSON Schemas — every one
of which sets `additionalProperties: false` — reject them. That made "both must pass for a dataset to
ship" false for every optional field, and it meant the app would silently drop a mistyped `note`,
`ceiling`, `aliases` or `delhiRateProtected` at runtime and tell nobody. All 43 objects in
`src/modules/pay/schema.ts` are now `z.strictObject`.

**`pay_matrix.py` rewrote `data/_meta/versions.json` on a run that changed nothing.** This is the
invariant the weekly law cron already depends on — an unchanged run must write nothing, or the PR is
empty and nobody reads the one that matters. The cause was that the committed entry had been written
by a one-off script whose shape differed from the generator's: a stray `fetchedAt` and a generic
source name against the generator's real one. All eleven pay entries now carry the generator's shape,
each naming its own primary source, and a second run is byte-identical. `test_ingest.py` asserts it.

**`validate_data.py` ignored any dataset not in its manifest.** A new file under `data/` would have
been validated by nothing while the run still reported success. It now fails on any JSON that is in
neither `MANIFEST` nor a `NO_SCHEMA` list that states, per file, why it has no schema. Adding that
check immediately caught a stray `data/pay/versions.json` that a mutation-test restore loop had
dropped into the directory minutes earlier — untracked, but one `git add data/pay` away from being
committed.

**`pnpm format` would have reformatted ten of the new files, and fought the generator over one of
them.** `data/pay/matrix.json` is generated by `write_json`; prettier reformats it, the next run
rewrites it, forever. `data/pay/` and `data/_meta/` join `data/law/` in `.prettierignore` for exactly
the reason already recorded there — everything under `data/` has one formatter, and it is
`ingest_common.write_json`. The six hand-authored datasets that had drifted from it were renormalised
through it. The schemas, the test file and the two documentation files are hand-written and are now
prettier-clean.

**Six holes in the test suite**, each found by making the corresponding mutation and watching all 89
tests pass:

- A job could promote _downward_. Levels do not sort lexically — `'10' < '2'` — so the new test walks
  the matrix's own `order` field rather than the level string.
- `order` itself was unasserted, which is what made the point above possible to get wrong. It is now
  checked to be 1…19 in sequence, with entry pay rising monotonically along it — that is what makes
  it a rank rather than a label.
- A rate could promise rupees or a percentage and carry no amount, rendering as an empty figure. Now
  allowed only where an `expression` or a `note` says why.
- A `formula` rate could carry no expression, rendering as nothing at all.
- Two cities could share a spelling. `'Delhi'` as an alias of Patna would have moved an officer from
  20 per cent House Rent Allowance to 30 with no test objecting.
- A post could lose an allowance entirely. The existing test caught an allowance switched _on_ where
  it should not be, and said nothing about one going missing — an Intelligence Bureau post with no
  Special Security Allowance is a fifth of the pay packet gone.

**Two data defects.** `ration-money-allowance` carried a rate with no amount, no expression and no
note, so its card would have shown an empty figure and nothing explaining it; it now says the rate is
set by the Ministry of Home Affairs and the Ministry of Defence, gives the pre-7th-CPC figures, and
says to ask the force headquarters. Noida carried the alias `"NOIDA"`, which differs from its own name
only by case and so matched nothing new.

**Nine new Python tests** in `test_ingest.py` — the generator's rounding rule reproduces the first
row of the gazette, a wrong entry pay and a wrong cell count are each caught rather than written, a
no-op run writes nothing, and every dataset on disk is accounted for by the validator. Flipping the
rounding from half-up to down fails four of them and makes `pay_matrix.py` exit 1 without touching
`data/`, which is the behaviour that matters.

Confirmed clean by the same probes: the tax slabs are contiguous with no gaps and the computed tax at
each rebate ceiling is exactly the rebate (₹60,000 at ₹12 lakh, ₹12,500 at ₹5 lakh); the surcharge
bands are contiguous per regime; CGHS covers all 19 levels exactly once; CGEGIS cover is 1,000 times
the subscription for every group; the 18-month report date in `cpc8.json` is exactly 18 months from
the constitution date; a naive "latest notified rate not superseded" lookup over `da-history.json`
returns 17 per cent through the whole freeze and 31 per cent from July 2021; and across every pay
dataset there is no empty Hindi string, no Hindi that is the English copied across, and no Hindi that
is mostly Latin.

## ADR-016 — The result list is not virtualised

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 4 (follow-up) ·
**Supersedes:** the "results virtualised if > 50" instruction in the Session 4 brief

### Context

The brief asked for the result list to be virtualised above fifty rows, and it was. Windowing then
produced three separate user-visible defects, each found by a person looking at the screen rather than
by a test:

1. The window was clamped to the focused row's index, which is `-1` whenever the reader has not used
   the keyboard — so the first rendered row was always 0 and **scrolling a browse list showed blank
   space** after twenty rows.
2. Opening a section reflows the list from full width into a column, and the browser clamps the pane's
   scroll position when it does. The window was computed from the remembered offset, so every row was
   rendered at a coordinate the reader was not looking at and **the list went blank on a click**.
3. With both fixed, the list still _looked_ capped, because only thirty rows were ever in the DOM and
   thirty is a number a reader can count.

Each fix was correct and each was followed by another failure of the same kind. That is the signal.

### Decision

**Render every row.** The virtualisation is deleted, not repaired.

The measurement that settles it, taken on a 4x-CPU-throttled phone at 390px:

| List               | Rows  | Page DOM nodes | Ready  |
| ------------------ | ----- | -------------- | ------ |
| BNS, browsed       | 358   | 2,421          | 1.56 s |
| All three, browsed | 1,059 | 6,627          | 2.14 s |

A row is six DOM nodes. The longest list this module can produce is the whole corpus — 1,059 sections —
and search results are capped at 200 by `SEARCH_RESULT_LIMIT` before they reach the list at all. Both
figures include the 3.9 MB data load, which dominates them; the marginal cost of the extra 700 rows is
about 570 ms throttled, so roughly 140 ms on the device itself.

That is an ordinary amount of DOM for a bounded, known corpus. **The condition that makes virtualisation
worth its complexity — a list of unknown or unbounded length — is not true here.**

### Consequences

- The class of defect is gone rather than fixed: there is no window to be stale, no offset to be reset,
  no measurement to be wrong. A list either has its rows or it does not, and `ResultList` lost about
  seventy lines.
- The pane still scrolls (`max-height` per breakpoint); it is the rows inside it that are all present.
  `scrollHeight` is asserted to be exactly `rows x 76px`, which is only true if every row has height.
- Re-measure before reintroducing windowing. The number that would change the answer is the corpus
  size: three Acts are 1,059 sections, and this decision does not survive a corpus ten times that.
- `tests/e2e/a11y.spec.ts` gained an unrelated but necessary fix while this landed. Its `setChrome`
  helper waited for the DOM to reflect a preference, not for the preference to be written to IndexedDB —
  and the sweep growing from six routes to eight made that race fire. It now waits on the stored value,
  and only for a preference that was actually toggled: a default is never written, so waiting for
  `theme: light` would wait for a row that will never exist.

---

## ADR-017 — Voice search recognises speech on the device, or refuses

**Date:** 2026-08-28 · **Status:** Accepted · **Supersedes:** ADR-014

### Context

ADR-014 shipped voice search behind a consent notice, because Chrome's default speech path streams the
captured audio to Google. That was the honest design for the platform as it was: explain the trade and
let the reader decide.

It is no longer the platform. Chrome exposes on-device recognition — `SpeechRecognition.available()`,
`SpeechRecognition.install()` and a `processLocally` flag on the recogniser — verified present in the
Chromium this project tests against. With `processLocally` set, the user agent must transcribe on the
device or raise an error; it may not fall back to a server.

So the choice was no longer "explain the compromise or drop the feature". It was "require the thing
that removes the compromise".

### Decision

**Require on-device recognition. Refuse where it is unavailable — never fall back to the cloud.**

1. `processLocally = true` on every recogniser this app creates, and `availability()` is consulted
   before one is started so an absent model is reported as a missing model rather than a generic error.
2. **The consent gate is deleted.** With nothing leaving the device there is nothing to consent to, and
   a notice that says "this is private" is worse than no notice — it trains readers to click through.
   `VoiceSettings` collapses to a single `enabled` flag, default true: a preference, not a gate.
3. **A browser that has the API but not `processLocally` shows no microphone at all.** `isVoiceSupported`
   tests for the flag on the prototype, not merely for the constructor. Firefox has neither. A button
   that quietly uploads what you say is worse than no button.
4. **The language model is a button, not a side effect.** `available()` reporting `downloadable` offers
   the reader a download, performed by the browser, of a speech model that carries nothing they said.
5. **Everything unexpected fails closed** — an older browser with no `available()`, a rejection, an
   unrecognised status. The alternative to on-device recognition here is not cloud recognition; it is
   typing, and the error message says so.

### Consequences

- **The hard rule holds with no exception.** Voice was the one feature that needed a carve-out from
  "nothing a reader enters leaves the device"; it no longer does.
- `src/lib/voice.ts` keeps its file-scoped eslint exception, and the reason changes: not "this is the
  module allowed to send audio" but "this is the module that must set `processLocally`, and confining
  it to one file is what keeps that checkable by reading". `tests/no-external-urls.test.ts` still
  asserts the count independently of the lint rule.
- The privacy suite asserts the guarantee rather than describing it: a Playwright test replaces the
  global with a stub that records what was asked for, drives the microphone, and checks that every
  recogniser started with `processLocally` set and that availability was queried the same way.
- `src/lib/voiceConsent.ts` is now `src/lib/voiceSettings.ts`; the module was renamed because a file
  called "consent" that grants none is a trap for the next reader.
- Recognition runs in the reader's own language, `hi-IN` or `en-IN`. That was always the point for a
  reader who does not want to switch keyboards, and it is now true without a caveat.

### What would change this

`processLocally` is Chrome-only today. If a browser this app must support implements the speech API
without it, the choice returns — and the answer should still be "no microphone there", not a silent
cloud fallback. The consent-gated design is in ADR-014 if it is ever genuinely needed.

---

## ADR-018 — The Pay & Allowances Calculator: three bases, a rule that refuses to guess, and Inter for the numerals

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 5 (Pay & Allowances module)

### Context

`data/pay` had eleven datasets and no consumer (ADR-016). Building the calculator over them raised
five questions the datasets could not answer, and each one is a place where a plausible
implementation produces a wrong pay slip rather than an obviously broken one.

**1. What is "basic pay"?** It is not one quantity. Non-Practising Allowance is counted as pay for
Dearness Allowance and not for House Rent Allowance; the 30 per cent pay element of Running Allowance
counts for Dearness Allowance, House Rent Allowance and pension — those three — and not for every
allowance that happens to be expressed as a percentage.

**2. What does the calculator do when an order carries several rates and cannot tell which
applies?** Ten of the thirty-two allowances do. Which cell of the Risk and Hardship Matrix a posting
falls in, whether a deputation involved a change of station, which uniform an officer wears: none of
these is a fact this app has.

**3. How does a payslip's numerals behave?** The brief asked for IBM Plex Mono.

**4. Where does the pay slip put the `verify` flag?** `data/pay/jobs.json` is 66 of 67 posts
unconfirmed and `data/pay/matrix.json` is 0 of 19 levels confirmed.

**5. What happens when the eleventh named scenario is saved?**

### Decision

**1. Three bases, named, in `src/lib/pay/engine.ts`.**

| Base                  | Contents                                   |
| --------------------- | ------------------------------------------ |
| Dearness Allowance    | cell pay + running-staff pay element + NPA |
| House Rent Allowance  | cell pay + running-staff pay element       |
| Percentage allowances | cell pay alone                             |

Collapsing them into one number is the single most tempting simplification in the module and it
mis-states a medical officer's slip in both directions at once — 20 per cent of basic too much House
Rent Allowance, and 60 per cent of the NPA too little Dearness Allowance. The golden test asserts
both halves on a Level 11 medical officer.

**2. A rate that cannot be resolved returns nothing, and says so.**

`resolveRate` narrows an allowance's rates by the reader's Level, then: an explicit choice wins; a
family named `standard` is the default where the dataset has one (Children Education Allowance's
`standard` against its `divyang`); a single remaining family is used; and **more than one remaining
family produces a line with `needsChoice: true`, an amount of zero, and the list of choices.** The
UI renders that as a select, not as ₹0.

The alternative — take the first rate — would have handed a CAPF constable the Dress Allowance of an
officer of the Army (₹20,000 a year against ₹5,000) with no indication that a choice had been made
on their behalf. A confident wrong figure is the failure mode this whole module is built against.

**3. The numerals are Inter with `tabular-nums`, not IBM Plex Mono.** The master context's own DESIGN
block settles the numeral question — "scoreboard numerals = Inter 800 tabular-nums" — and
`.font-display` implements it. Adding a fourth self-hosted family would put ~25 KB of woff2 into
every offline install, add a face to `tests/e2e/typography.spec.ts` (which reads back the fonts
Chromium actually _used_), and buy an alignment that Inter's tabular figures already give. The brief's
instruction and the master context's disagree; the master context wins, and this records it.

**Every line label carries both languages**, which is the other half of "payslip-style": the reader's
language decides which of the two is the larger, not which one exists. A government pay slip does the
same, and an officer showing the slip to a colleague does not have to toggle anything.

**4. `verify` is a banner on the slip, a badge on the allowance row, and a sentence in every agent
tool result.** `PayResult.verify` is true when any line with a non-zero amount rests on an
unconfirmed figure, which for a picked post is always. The tools return the same sentence in
`verifyNote`, so an agent cannot present a job-title pick as an authority either.

**5. The eleventh scenario is REFUSED.** `saveScenario` returns `{ ok: false, reason: 'full' }` and
the bar says which one to delete. Evicting the least recently used is the obvious implementation and
it means this app silently deleting something a reader named on purpose. Ten is the brief's limit;
what the brief does not say is who gets to do the deleting.

**Two smaller decisions worth recording**, because both are the difference between a number an
officer would believe and one they would not:

- **Marginal relief under the proviso to section 87A** is applied in the new regime. Without it
  ₹12,00,000 of income pays nothing and ₹12,00,100 pays ₹61,515. The real figure is ₹100. Surcharge
  gets the same treatment at each band edge, which matters only at the very top of the matrix —
  exactly where nobody would notice it was wrong.
- **Section 288A** rounds total income to the nearest ten rupees before the slabs are applied, and
  every pay-slip line is rounded to the rupee as it is computed, not once at the bottom. The
  Dearness Allowance order states that rule in terms and `data/pay/allowances.json` carries the
  sentence.

### Consequences

- **`src/lib/pay/*` is pure and takes its datasets as an argument.** Nothing under it imports a JSON
  file. The unit suite reads the committed bytes off disk, the UI hands it the lazily-imported
  chunks, and `src/ai/tools/pay.ts` hands it the same ones — one implementation, three callers, no
  module-level state to reset between them.
- **The datasets reach the browser as `?raw` dynamic imports, never a `fetch`** — the arrangement
  ADR-013 set up for the statute, for the same three reasons. That is what makes
  `tests/e2e/pay.spec.ts`'s "answers a pay calculation with no network at all" possible on a device
  that has never opened `/pay` online, and it is what kept `src/ai/providers/wire.ts` the only
  module in the app that may call `fetch`. It also brought several hundred citation URLs into the
  build; ADR-019 is what that cost.
- **73 unit tests over the engine, and every expected figure was worked out from the orders before
  the code ran.** IB ACIO-II at Level 7 cell 1 in Delhi on 60 per cent DA: basic 44,900, DA 26,940,
  HRA 13,470, TA 3,600, DA on TA 2,160, Special Security Allowance 8,980, gross 1,00,050, NPS 7,184,
  CGHS 650, CGEGIS 60, tax nil under the new regime and ₹1,05,290 under the old, net 92,156, annual
  cost to Government 13,21,296. 38 of the 39 passed on the first run; the one that did not was a
  wrong city id in the test.
- **The URL is the state**, as in the Law Converter. The post's own defaults are not repeated in the
  link — only the reader's departures from them (`on`, `off`, `rk`), so a shared link stays readable
  and a post whose default allowances change in a later dataset release still opens with the
  reader's actual choices rather than a frozen copy of last month's defaults.
- **Parsing the URL needs no datasets.** `parsePayParams` is pure string work and
  `scenarioFromParams` applies the tables afterwards, so the route renders on the first frame rather
  than after 1.2 MB has arrived.
- **Lighthouse**, measured against `pnpm preview`: `/pay?job=ib-acio-ii-executive&city=delhi&da=60`
  scores **99 desktop** (FCP 0.6 s, LCP 0.9 s, TBT 0 ms, CLS 0) and **78 mobile** (FCP 2.9 s,
  LCP 4.6 s, TBT 110 ms). The ceiling is the application shell: `/settings`, which loads no module
  data at all, scores **89** mobile on the same run. `docs/DATA-GAPS.md` #22 carries the numbers and
  the two levers.
- **Starting the dataset load at module scope rather than in an effect** halved the gap between the
  route chunk arriving and the first dataset request (89 ms → 42 ms, unthrottled). It did not move
  the Lighthouse score, which is dominated by the shell's own critical path; it is kept because the
  waterfall improvement is real and the cost is one line.
- **A `<details>` rather than a floating popover** for every "why is this figure what it is"
  disclosure, and `[data-print-open]` in `index.css` opens all of them on paper. A printed pay slip
  whose workings are collapsed is a page of numbers with no provenance, and provenance is the reason
  this app shows the figure at all. `@page { size: A4 }` is there for the same reason: this print
  goes into a file beside the order it cites.

### Rejected

- **Guessing a rate and flagging it.** A figure with a warning beside it is still a figure, and it is
  the one that gets copied into a note. `needsChoice` shows no number at all.
- **`cmdk` for the two pickers.** It is a command palette; what these need is a form control a screen
  reader announces as one. `Combobox.tsx` is the ARIA 1.2 combobox-with-listbox pattern in about
  eighty lines, it prints, and it does not put a second interaction model on a page whose other
  controls are ordinary form fields. `cmdk` stays deferred.
- **`fuse.js` for the pickers.** The law module indexes 1,059 records of statute and needs fuzzy
  scoring; this is 67 posts and 102 cities, where fuzzy matching is a hazard rather than a help —
  "Inspector" fuzzily matches four posts about equally and the reader has to read all four anyway.
  Exact-and-prefix over a precomputed term list is faster and explainable, and indexing each post id
  segment by segment is what makes "ACIO" find a post whose title never says it.
- **Totalling the government benefits in the private-versus-government panel.** Adding an "annual
  value of CGHS" to a net pay would be an opinion dressed as arithmetic. The benefits are listed with
  their sources and a sentence saying their value is indicative, and they are never summed.
- **Treating a private cost to company as cash.** It is the most common error in this comparison and
  it flatters the private side by about a sixth of basic pay. Every step from a CTC to a take-home is
  an assumption; each one is an editable field with its default stated, and all of them are printed
  under the answer rather than hidden behind a disclosure.

---

## ADR-020 — The Drafting Studio's data model: a layout is data, the engine knows only block roles

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 7

### Context

Fourteen document types, each bilingual, each with its own arrangement of the same handful of parts.
An Office Memorandum puts its addressee **below** the signature; a letter puts it above the subject.
A letter leaves its first paragraph unnumbered and numbers from 2; an Inter-Departmental note and a
note on a file number every paragraph from 1. A demi-official letter carries the writer's name at
the top left and is signed by name alone. None of this is decoration — each is a specimen printed in
CSMOP 2022 Appendix 8.1, and getting one wrong is the thing the module exists to prevent.

The obvious implementation is a React component per document type. It puts fourteen layouts, twenty-
eight language variants and every formatting rule into TSX, where none of it can be validated, tested
off disk, cited, or handed to an AI tool without pulling the UI in behind it.

### Decision

**A template is a JSON file. The engine knows block roles and nothing about document types.**

`data/drafting/templates/<id>.json` holds one `DocTemplate`: the fields an officer fills, a layout
per language as a list of blocks, a checklist whose items carry machine-evaluable rules, the CSMOP
paragraph each claim comes from, and the source. `src/lib/drafting/engine.ts` renders any of them.
There is no branch in the engine for an O.M.; a fifteenth form is a fifteenth JSON file.

Three behaviours are the engine's rather than the data's, because each is a rule about documents and
not about one form: **paragraph numbering** (`numberFrom` picks, the engine counts), **the enclosure
line** (`Encl.: as above (3)` is appended to any block that lists enclosures — CSMOP 9.2(vii) wants
the count and nobody remembers to type it), and **dates** (normalised to dd.mm.yyyy however typed,
Devanagari digits in Hindi on request).

**The checklist is split in the same way.** "An Office Memorandum is written in the third person" is
a claim about the manual and lives in the template with its paragraph reference; "third person means
no first-person pronouns in the body" is a claim about text and lives in
`src/lib/drafting/checklist.ts`. Thirteen rule kinds are implemented there, and an unknown kind
**throws** — a checklist item that silently passed because nobody implemented its rule would be worse
than no checklist.

**The data is written by a script, not by hand.** `scripts/ingest/drafting_seed.py` builds all
seventeen files and writes them through `ingest_common.write_json`, the one formatter for `data/`.
It reaches no host; every input was fetched by hand once and is cited in every record. `--check`
rebuilds and compares without writing, which is what CI runs. It is on no cron, for the reason
`pay_matrix.py` is on none: a manual is revised by a new edition, and a new edition is a reading job.

Its `self_check` rejects what a JSON Schema cannot express — a layout placeholder naming a field the
template does not define, a block whose `source` is not a list field, a checklist rule naming a field
that does not exist, a `select` sample that is not one of its own options, a required field with an
empty sample, two layouts that place different blocks, a phrase pointed at a template that is not
there. Every one of those would otherwise reach an officer as a `{{signatoryName}}` in a signed
document; `scripts/ingest/test_drafting_seed.py` breaks a copy of the O.M. in each of those ways and
asserts the check catches it.

### The Hindi is read off the page, not out of the PDF

The Hindi issue of CSMOP 2022 has a **text layer that cannot be used**: it was typeset from a legacy
font whose glyph map yields `अभधकायी` where the page renders `अधिकारी`. Extraction with PyMuPDF,
which works perfectly on the English issue, returns that scrambling for all 284 pages.

Every Hindi string attributed to CSMOP in `data/drafting/` was therefore read off a **rendering** of
the page — the same route ADR-016 records for the scanned Department of Expenditure orders. The pages
that were rendered and read are the Appendix 8.1 specimens (Hindi printed 121–130), 8.4 (108–110) and
6.13 (64).

That work bought something worth having: **the manual's own Hindi is not the Hindi anyone would
guess.** It prints `परम अग्रता` for Top Priority, not `सर्वोच्च अग्रता`; `अर्ध-सरकारी पत्र` for a
demi-official letter, not `अर्ध-शासकीय पत्र`; and `अंतर-विभागीय टिप्पणी` for what every section still
calls the `अशासकीय टिप्पणी`. All three expected forms are carried in `alsoHi`, because an officer will
meet them and a search for one must find the term. None of the three is what this app prints.

### Seven of the fourteen forms are not in the manual

CSMOP 8.4 lists ten forms. Of the fourteen this session builds, seven — circular, leave application,
representation, RTI reply, show-cause reply, tour programme, T.A. bill covering letter — are
documents the Central Secretariat produces every day and the manual prescribes **no format for**.

They are not dropped and they are not passed off as CSMOP. Each carries `verify: true`, a
`csmopRef.chassis` naming the form whose format it borrows, and a `csmopRef.note` saying in both
languages what the manual does and does not contribute. `tests/drafting-data.test.ts` fails a
template that claims to be unverified without naming a chassis and explaining itself. This is the
same treatment `verify: true` gets in the pay datasets, for the same reason: the reader must never
have to guess which figures the Government has actually written down.

### Consequences

- A new document type is a JSON file, a manifest line in `validate_data.py`, and a loader line in
  `src/modules/drafting/data.ts`. No engine change.
- The templates are validated twice — `schemas/drafting-*.schema.json` by Python at write time, the
  zod schemas in `src/modules/drafting/schema.ts` by `pnpm test` — so neither producer nor consumer
  can drift alone, exactly as for law (ADR-012) and pay (ADR-016).
- Every template renders from its own samples in English, Hindi and bilingually, with no unresolved
  placeholder and no validation issue, and passes its own checklist; blanking every field moves at
  least one `must` item to failing, so the evaluator is shown to be capable of saying no.
- The engine is pure and takes the template as an argument, so `tests/drafting-data.test.ts` renders
  the committed bytes and the future AI tool will render the same ones.
- Two hosts join `CITATION_HOSTS` in `tests/no-external-urls.test.ts`: `www.darpg.gov.in` for CSMOP
  and `rajbhasha.gov.in` for the Department of Official Language's glossary. Adding them was the
  review (ADR-019).
- `data/drafting` is ~476 KB, and the picker loads `index.json` alone — one template is fetched only
  once a form has been chosen, the way `useLawEngine(enabled)` stays lazy.

### Addendum (edge-case pass, same session) — three of these decisions were wrong

Going back over the module for edge cases found seven defects. Four were ordinary bugs and are in
the commit message; three were **decisions above that did not survive contact**, and the record
should say so.

**1. The engine filled values in for the caller, and that was dangerous.** `renderDocument` fell back
to each field's `sample`, per field, so that a template could always be rendered. What it actually
meant was that a form with one field edited produced a _complete_ document — signed by the specimen's
"(A.B.C.), Under Secretary", carrying the specimen's telephone number and file number — and reported
**no issue at all**. Every guard in this module points at the reader sending out a document that is
wrong in a way they cannot see, and the default did precisely that. The fallback is gone. An absent
field renders as nothing and is reported when the template requires it; `sampleValues(template)`
builds the worked example, and a caller has to ask for it. The Session 8 form initialises from it.

**2. Bilingual pairing on `role` was wrong because roles repeat.** A demi-official letter has two
`header` blocks — the writer's letterhead and the Government of India block, with the D.O. number
between them — and two `closing` blocks. Pairing by role grouped both headers at the position of the
first, so the side-by-side view showed `D.O. No.` _below_ the letterhead. Every `RenderedBlock` now
carries the `layoutIndex` it came from and pairing is on that, which is safe precisely because
`self_check` already refused a template whose two layouts place different blocks in a different
order. It is also the correct React key, which pairing by role never was.

**3. A `role` on a checklist rule was typed as a free string.** A typo then matches no block —
`blockPresent` fails, which someone notices, but `regexAbsent` **passes**, which is a checklist item
that silently checks nothing. It is now the block-role enum in both schemas, and `self_check`
additionally requires that the template actually places the role.

### What the pass taught, which is more useful than the fixes

**A defect that renders as nothing is invisible to a snapshot.** The urgency grading — CSMOP 6.13,
a whole section of `docs/CSMOP-FORMATS.md`, three bilingual labels, three Rajbhasha terms with their
paragraph references — was missing from the layouts of the letter, the Office Memorandum, the
circular and the endorsement for an entire commit. The field was there, the options were there, the
terms were there; only the block was gone, so choosing IMMEDIATE printed nothing anywhere. Not one
of 1,200 tests failed, because the sample value is `none`, which renders as nothing, so every `.txt`
snapshot was byte-identical. The lesson is narrow and worth keeping: **when a field's sample is the
empty case, the suite must also render the non-empty one.**

The same shape appeared again at the boundary with the UI. An emptied text box arrives as `['']`,
which renders as nothing but read as non-empty, so a required list reported no issue and
`listNonEmpty` passed over an empty list. The fix is that `resolveValues` normalises a list to
exactly what will render — the invariant being that **what the checklist reads and what the page
shows cannot disagree**, since the checklist reads `resolved` and the reader reads the page.

**And a JSON Schema cannot check a template against itself.** `self_check` gained five rules, each
of which had a defect waiting behind it: an unknown or unplaced rule role; a block with both `lines`
and a `source` (one silently wins); `numberFrom` without `numbered`; `urgencyAllowed` disagreeing
with whether the field exists; and **any field appearing in no layout and no rule** — which found a
demi-official letter that required an e-mail address and printed it nowhere. A field that renders
nowhere on purpose goes in `GUIDANCE_ONLY` with its reason, the way `validate_data.py` makes an
unschemaed dataset say why.

---

## ADR-019 — Dataset citations in the build: a reviewed host list, not a per-URL allowlist

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 5 · **Amends:** ADR-012, ADR-016

### Context

`tests/no-external-urls.test.ts` sweeps the whole build for URL-shaped strings and fails on anything
not on an explicit allowlist. That is the static half of the master context's hard rule, and its
value is precisely that **anything new fails until a human has looked at it**.

ADR-016 kept the pay sources out of `data/_meta/versions.json` for exactly this reason: that file is
bundled, so a URL in it reaches `dist/` and would have needed an allowlist line. The pay datasets are
compiled from dozens of orders across `doe.gov.in`, `pfrda.org.in`, `ssc.gov.in`, `upsc.gov.in` and
more, and adding all of those would have turned a deliberate, reviewed exception into a wide-open
door.

Building the Pay module made the point moot. `data/pay/*.json` now reaches the browser as `?raw`
chunks (ADR-018), so several hundred citation URLs across nineteen hosts are in `dist/` whatever
`versions.json` says. The master context requires every data card to show its source, so this is not
optional.

Three options: list every URL (hundreds of lines, unreviewable, and it changes every ingest); list
every host as an inert pattern (nineteen lines, but it then lets a `fetch('https://doe.gov.in/…')`
in `src/` through the sweep unnoticed); or make the rule structural.

### Decision

A URL in the build is allowed if **both** hold:

1. it appears verbatim in a committed dataset under `data/`, and
2. its host is on `CITATION_HOSTS` — a written list of nineteen names, every one a Government of
   India domain or the PFRDA's.

Neither half is sufficient. A reviewed host cannot smuggle in a URL that is not in the data; a URL in
the data cannot smuggle in a new host.

Two tests hold it up, and both fail in the right direction:

- **`cites only hosts that have been reviewed, and every one on the list`** compares the hosts the
  datasets actually cite against `CITATION_HOSTS` **in both directions**. A dataset that starts
  citing a new host fails until someone writes it down; a host left on the list after its last
  citation was removed fails too, so the list cannot silently widen.
- **`keeps dataset source citations in data/, out of the source tree`** fails if any module under
  `src/` so much as contains one of those host names. This is what stops the first rule being a way
  in: the same URL that is allowed through the `dist` sweep is forbidden in a component.

Both were confirmed to fail against a deliberate `https://doe.gov.in/probe` added to
`src/lib/pay/format.ts`, and to pass again once it was removed.

The NCRB-specific allowlist entry ADR-012 added, and the paired "no module names the host"
assertion beside it, are both **deleted** — the general rule subsumes them and covers the law
datasets on the same terms. `CLAUDE.md`'s note to "not remove one without the other" is honoured by
replacing both at once with a stronger pair.

### Consequences

- The audit question — _what may this app request?_ — still has the same one-line answer:
  `api.anthropic.com`, from `src/ai/providers/wire.ts`, after explicit consent. Nothing else.
- The second question — _what URLs ship as text?_ — now has an answer a reviewer can check in one
  place: nineteen Government of India hosts, cited by the datasets, rendered as links.
- A future dataset that cites a commercial host fails CI rather than shipping.
- `data/_meta/versions.json` could now carry the pay `source.url` fields ADR-016 left out. It is left
  as it is: nothing reads them, and the UI shows the per-record citation, which is where every URL
  already is.

---

## ADR-018 — Voice search is removed

**Date:** 2026-08-28 · **Status:** Accepted · **Supersedes:** ADR-014 and ADR-017

### Context

Voice search shipped twice in one session. ADR-014 put it behind a consent notice, because Chrome's
default speech path streams audio to Google. ADR-017 replaced that with a stricter rule — `processLocally`
required, no cloud fallback, no consent gate needed — which was a better design and worked, in Chrome.

It never worked anywhere else, and the attempt to make it work is what settled this. Self-hosting Whisper
through transformers.js was measured in full:

- the build blocker was solved (forcing `onnxruntime-web@1.29.0` through a pnpm override);
- the privacy properties held — model and runtime from our own origin, zero cross-origin requests;
- the footprint was 54 MB, not the 39 MB first estimated;
- and the transcription was not usable. **Hindi never came back in Devanagari from either whisper-tiny
  or whisper-base**, and base was not reliably better than tiny while being twice the size and twice as
  slow. "अग्रिम जमानत" became "Agrim Jamanat"; "हत्या" became "Hadi.." and then "حدя".

So the feature worked in one browser, and could not be made to work in the others without shipping 54 MB
of English-only-and-unreliable to an app whose premise is that Hindi is not a second-class way in.

### Decision

**Remove it.** Not disable, not hide behind a flag — delete the code, the settings, the strings, the
eslint seam and the tests.

A feature that works in one browser is a feature most readers never see, and every line of it was still
being maintained: a restricted global with a file-scoped exception, a settings section, a WebKit
Playwright project, four assertions across the privacy and bundle suites. That is a real carrying cost
for something no reader on Safari, Firefox or any Chromium fork without the flag could use.

`eslint.config.js` goes back to ONE named network seam — `src/ai/providers/wire.ts` and `fetch` —
which is the cleaner thing to have to explain.

### What this does not change

Nothing about how the search box works. Typing was always the primary path; dictation was an addition to
it. On a phone or a Mac the keyboard's own dictation still types into the field, exactly as it always
did, using the operating system's recogniser — which handles Hindi properly. That needed no code from
this app, which is part of why the in-app version was hard to justify.

### What would bring it back

A multilingual on-device model that handles Devanagari, or the Web Speech API's `processLocally` landing
in more than one browser. ADR-014 and ADR-017 stay on record with the designs, and the removal commit
carries the measured transcription table so the next attempt starts from evidence.

---

## ADR-021 — The Drafting Studio: a form beside a page, a gate that can say no, and an AI seam that stays shut

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 8

### Context

Session 7 landed the data model: fourteen `DocTemplate` JSON files, a pure engine that knows block
roles and not document types, and a checklist evaluator whose rules are declarative (ADR-020). This
session builds the module over it — a picker, an editor, a live A4 preview, export, and drafts that
persist. Everything below is a decision the data model did not already make.

### Decisions

**1. The form is one column and the page is the other, and the page is not editable.**

The preview renders `document.blocks` and interprets nothing. Paragraph numbers, the enclosure count
and the normalised date all arrive already decided by the engine, so if the preview is wrong the
template or the engine is wrong — which is what makes it worth trusting. A WYSIWYG editor over the
page would have to invent a mapping back to the template's list of paragraphs, and would let an
officer produce a break the numbering cannot see.

**2. `layoutIndex`, never `role`, is the identity of a block.**

Roles repeat: a demi-official letter has two `header` blocks and two `closing` blocks. Both the React
keys and the side-by-side pairing use the layout position the engine now carries.

**3. A field holds ONE shared value until the officer says the two issues differ.**

Equal bilingual footing is a rule about the product, not a rule that every box must be typed twice. A
file number, a telephone number and an e-mail address are the same string in both issues; a subject
line and a body paragraph are not. So `src/modules/drafting/values.ts` writes a plain value until the
"Write Hindi separately" control is pressed, and only then an `{ en, hi }` pair — a shape the engine
already reads. "Fill with the worked example" runs the specimen through `collapseIdentical`, because
every `sample` is stored as a pair and without it all fifteen fields opened as two boxes.

**4. A failing `must` item blocks the export; a failing `should` item asks once.**

The `must` class is the set of things that make a document the wrong document — an Office Memorandum
in the first person, paragraphs numbered against the specimen, a `{{signatoryName}}` still in the
signature block. Exporting one produces a file that looks finished and is not. The `should` class is
what a careful officer fixes and a busy one might reasonably not, and treating the two as equally
fatal teaches officers to click past both.

**"Copy as text" is deliberately outside the gate.** An app that held an officer's own words hostage
to its own checklist would be the wrong kind of app.

**5. The `.docx` names two fonts per run, and embeds none.**

A Word run names one font per script slot, so every run sets `ascii`/`hAnsi` to a Latin face and `cs`
— the complex-script slot — to a Devanagari one, and the word processor picks per character. That is
what makes a bilingual signature block come out right with no string scanning. Nirmala UI and Mangal
ship with Windows, which is what government desktops run; elsewhere the reader's word processor
substitutes its own Devanagari face. Embedding one would put ~200 KB into every exported file and
raises a licence question, so it is not done.

The preview is set in the same Times New Roman, through a new `--font-document` token whose whole
stack is either already bundled or already on the machine. That downloads nothing — the same call
ADR-018 made against IBM Plex Mono — and buys agreement with the export, which is the only thing a
preview is for.

**6. `docx` is imported inside the export handler.**

~340 KB (100 KB gzip) for something a reader uses once per document at most, and never if they print.
`tests/no-external-urls.test.ts` now confines its OOXML namespace strings to that one chunk and
asserts the chunk is absent from the initial route, so the exception cannot widen quietly.

**7. Every OOXML namespace is an allowed inert URL, confined to one chunk.**

They are `xmlns` values — opaque identifiers per ECMA-376, never dereferenced, exactly as the `w3.org`
entry already covers for SVG. Matching by host rather than one line per URI keeps the list readable;
the confinement assertion is what keeps it a review rather than a hole.

**8. Drafts are uncapped, and deletion is undoable.**

Unlike the Pay module's ten named scenarios, there is no limit: an officer who has written sixty
office memoranda has sixty documents, not fifty-nine and a mistake. And unlike a scenario, a draft
cannot be refused when the limit is hit, so the other protection applies — `deleteDraft` returns the
row it removed and that row IS the undo. The offer has no timeout, because a five-second toast is a
race between an officer noticing and the app forgetting.

**9. "Save as my template" keeps the letterhead and refuses the document.**

Ministry, Department, name, designation, telephone, e-mail. Never the subject, the body, the
enclosures or the date: restoring last week's paragraphs into a blank form is how a wrong sentence
gets signed, and a stale date is how it gets signed on the wrong day.

### The AI seam, and how it would be gated

`src/modules/drafting/ai-seam.ts` declares the interface and exports `DRAFTING_AI_ENABLED = false`.
**Nothing in the UI reads it and nothing renders from it.** It exists so the shape is settled while
the reasons are fresh. The gating, in order:

1. `DRAFTING_AI_ENABLED` is not wired to a build flag, an environment variable or a setting. Turning
   it on is a code change that appears in a diff and in a review.
2. The app-wide AI consent gate still governs. That gate IS the feature flag for the AI layer
   (ADR-011); this constant can only ever subtract from it.
3. **Tier 0 (on-device WebLLM) first.** A draft is the most sensitive thing this app holds — it may
   name a case, a colleague or a grievance — so the default assistant must be one that cannot make a
   request. Tier 1 and Tier 2 send the draft's text to a model endpoint and may not be the default
   for this surface even where they are the reader's default elsewhere.
4. A warning modal, not a banner, before the first use on a given draft: the officer must have said
   that _this_ draft contains nothing official, sensitive or classified.
5. **Never applied silently.** A suggestion arrives as a word-level diff with accept and reject per
   change — `components/SuggestionDiff.tsx`, built and unit-tested now precisely so that the day this
   is turned on is not also the day someone writes the review UI in a hurry.

The six agent tools registered today (`src/ai/tools/drafting.ts`) are about **templates and rules,
never the reader's draft**. `render_draft` takes values as an argument; nothing registered can reach
the `drafts` table, and `registers NO tool that can read the reader's own drafts` asserts it. Adding
one would silently convert every agent in the app into one that reads unfinished work.

### Consequences

- `src/modules/law/diff.ts` moved to `src/lib/diff.ts`. The project's own convention — stated in the
  Pay module's `Fields.tsx` — is that a helper moves up on its second caller, and the suggestion diff
  is that second caller. Three law imports updated; the algorithm is unchanged.
- Dexie is at version 5, with `drafts` and `draftDefaults`.
- `data/drafting/index.json` gains a one-line bilingual `useWhen` per template, so the picker can show
  "use when" from `index.json` alone. Reading it off the templates' `whenToUse` would have meant
  downloading all fourteen (~330 KB) to draw a grid. `drafting_seed.py`'s `self_check` rejects one
  over 130 characters or not ending in a full stop.
- Three defects found in a real browser and fixed, each with a unit test that now fails without the
  fix: an emptied list box produced `['']` rather than `[]`, so the checklist read a cleared Copy-to
  box as filled and an emptied body reported no required issue; the sheet's initial focus landed on
  its close button, which is first in DOM order, rather than its search box; and fifteen
  identically-named "Write Hindi separately" controls left a screen-reader user counting rows.
- **Two more were found only in `pnpm dev`, and they are the ones worth remembering.** `main.tsx`
  renders under `<StrictMode>`, which double-invokes effects — mount, clean up, mount again — in
  DEVELOPMENT ONLY; Playwright runs a production build, where it is inert. So both passed all 82 e2e
  specs while the module was unusable in the dev server. The first: `useDraft`'s load guard was armed
  before its own `await`, so the second mount skipped the read the first mount had discarded, and the
  form sat on three skeletons forever — no field to type into, and a checklist that could never pass.
  The second: the flush effect's cleanup cleared an `alive` flag that nothing re-armed, so the new
  draft's id never reached the URL and a reload opened an empty form. `useDraft.test.tsx` renders the
  hook inside `<StrictMode>` deliberately, and is where any future effect of this shape belongs.

---

## ADR-022 — A write from an async continuation must be cancelled AND its latch released

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 8 · **Amends:** ADR-018

### Context

The same defect appeared twice in one day, in two modules, written by two sessions, and the second was
only recognised because the first had a name. Both are the shape:

```
effect: arm a latch, start an async read, write on resolve
```

Two things can go wrong with it, they are independent, and fixing either one alone leaves the other:

1. **The write is not cancelled.** `setSearchParams` navigates to **its own route's** path with the
   new search, not to wherever the reader now is — so a write from an unmounted `/pay` does not put a
   stray query on `/law`, it pulls the reader back onto `/pay?level=8&cell=3`. Confirmed under both
   `MemoryRouter` and `BrowserRouter` with the unmount asserted.
2. **The latch is not released.** A latch armed by an attempt whose result is discarded is not a
   guard. `<StrictMode>` mounts, cleans up and mounts again in development, so the second mount finds
   the latch set and returns without doing the work the first mount threw away. In the Drafting
   Studio this left the editor on three skeletons for ever; in the Pay calculator it would silently
   stop restoring the last scenario in `pnpm dev`.

### Decision

**Every effect of that shape carries both halves**: a local `alive` flag checked before the write,
and a `completed` flag so the cleanup releases the latch only for an attempt that never finished.

```ts
let alive = true
let completed = false
void read().then((value) => {
  completed = true
  if (!alive) return
  write(value)
})
return () => {
  alive = false
  if (!completed) latch.current = false
}
```

Releasing the latch unconditionally is wrong in the other direction: a completed restore leaves the
URL populated, and re-arming would let a later re-render restore over the reader's own edits.

### How this was got wrong twice, which is the part worth keeping

The Pay half was first reported as unreproducible **by this session, incorrectly**. The probe that
"disproved" it drove the navigation from a component mounted OUTSIDE `<Routes>`, whose
`useEffect(..., [go, navigate])` re-fired every time `navigate`'s identity changed — including
immediately after the stale setter moved the location, navigating straight back and hiding the very
effect under test. The harness was undoing the thing it was measuring, and it reported a clean pass.

What settled it was running the other session's probe **verbatim** instead of reconstructing it. The
reconstruction is where the error entered both times: once when the original probe left the component
mounted, and once when the rebuttal added a navigation loop.

### Consequences

- `src/modules/pay/PayPage.tsx` carries both halves, with `src/modules/pay/pay-restore.test.tsx`
  covering them: the first test fails against the code before the fix, the second fails against an
  `alive` flag with no latch release. A fix must satisfy both.
- `src/modules/drafting/useDraft.ts` already carries both, from 089ce8e.
- `docs/DATA-GAPS.md` #42 is closed by this.
- The e2e suite cannot see the StrictMode half at all — it builds for production, where StrictMode is
  inert. Both halves are unit-tested for that reason, and any new effect of this shape needs the same.

---

## ADR-023 — The Rules Trainer's content pipeline: extract the rule, generate the card, author the Hindi

**Status:** accepted, Session 9.

### Context

The Rules Trainer needs cards over eleven rule books and one manual. The brief asks for rule text
extracted from the published PDFs, rule and cloze cards generated from that text, and 150+ questions
authored in session through a four-stage pipeline — all bilingual, and all with zero paid services.

Two facts about the sources decided most of the design.

**The English text layers are good; the Hindi ones are byte soup.** Twenty-one documents were
fetched. Every English PDF but one has a real text layer. Every _Hindi_ PDF that has a text layer at
all is typeset from a legacy font, and what comes out looks like Devanagari and is not:

| Document                          | Extracted                     | Should read   |
| --------------------------------- | ----------------------------- | ------------- |
| DoPT, CCS (Conduct) Rules — Hindi | `ूशासन`                       | `प्रशासन`     |
| DoPT, CCS (CCA) Rules — Hindi     | `शािःत`                       | `शास्ति`      |
| DoPT, RTI Act — Hindi             | `ᳰकसी` (U+1CF0, a Vedic sign) | `किसी`        |
| rajbhasha, OL Act — Hindi         | `कायाषिय`                     | `कार्यालय`    |
| DARPG, CSMOP — Hindi              | `भनम्नानुसाय`                 | `निम्नानुसार` |

CLAUDE.md already recorded this for CSMOP (DATA-GAPS #36). Measuring the other four found the same
thing, and `extract_rules.py --audit-hindi` is the measurement. None of them is reversible by a
substitution table — the ambiguity is real, which is exactly what DATA-GAPS #36 says.

**The 296-page Hindi FR/SR compilation extracts zero characters.** It is a scan.

### Decision

**Rule text is extracted; Hindi is authored.** `data/rules/text/<act>.json` carries `text.hi: ""` on
every record and a bilingual `hindiNote` saying why, and `hindiTextExtractable: false` on the
envelope. The alternative to authoring is machine-translating statutory text, which this project
will not ship.

**A rule card runs heading → citation, and names its act.** "Communication of Official Information —
which rule of the CCS (Conduct) Rules?" → "Rule 11, CCS (Conduct) Rules, 1964". That is the direction
an officer is examined in, and it makes a card bilingual for the price of **one authored heading**
rather than a translated rule book. 236 headings were authored, covering eight of the twelve acts.

Naming the act is not decoration. The first version asked "Definitions — which rule?", and twelve of
these rule books head a rule "Definitions": the duplicate-front test found **forty-two** collisions
across acts. Two more classes of rule get a card that is deliberately **not served**: a rule the book
has emptied ("Deleted", "Omitted" — the Leave rules have six), and a heading the same act uses twice
(the RTI Act heads both s.13 and s.16 "Term of office and conditions of service"). Both are
unanswerable from the card, both keep their card so rule coverage stays 100%, and both carry the
reason in `reviewNote`.

**`reviewState` has four values, and only one is served.** `approved` is served; `needs-hindi` means
the English is right and the Hindi is not written; `unreviewed` means generated and not yet
hand-reviewed; `rejected` means reviewed and refused, with the reason. A rejected card stays in the
file — that is the audit trail the brief asks for — and `isServed` is the one predicate that decides
what a reader sees.

**The four stages are four files.** Stage A in `authored/`, stages B, C and D in `review/`, merged by
`make_cards.py` into each card's `generationMeta`. Four fields of one file would be indistinguishable
from four fields written at once; four files show that the critic did not have the generation notes
and the blind verify did not have the key.

### The sequence walk, and why the parser is shaped the way it is

Twelve documents, twelve layouts, one parser. `^12. Something` matches the start of Rule 12 and it
also matches the twelfth item of a list, a paragraph of a Government of India decision, and a page
number that ran into a sentence. So candidates are collected and then filtered by walking the
sequence. Five refinements, each of which was a wrong parse first:

1. **The chain is scored by substantive members, not by length.** The Conduct rules end with
   twenty-five numbered amendment entries ("S.O. 2859, dated the 30th September, 1978"), which is a
   longer increasing sequence than the twenty-four rules the parser first managed to chain through
   the body. A member counts only if it is followed by 120 characters of text. An amendment table
   scores zero; a rule book scores its rule count.
2. **A footnote marker fuses onto the rule number it precedes.** Rule 11 of the Conduct rules is
   printed `3911.` — footnote 39, then the rule. Every candidate offers its number _and_ its trims,
   and the walk takes the reading that continues the sequence. Only three digits or more are trimmed:
   trimming two turned the RTI arrangement-of-sections entry "31. Repeal." into a Section 1 headed
   "Repeal" whose text was the table of contents.
3. **Nothing is trimmed from a number alone on its line.** The Leave rules end a sentence with the
   bare line `1972.`, which trimmed to "2" and became Rule 2, carrying Rule 1's second sub-rule.
4. **A line beginning `(2)` is not a rule start.** A rule's own sub-rules begin at `(1)`. Without
   this, `…(Pension) Rules, 2021` wrapping onto `(2) They shall come into force` read as Rule 21 and
   cut the Pension rules from 86 records to 18.
5. **Repetition alone does not make a line furniture.** The DoPT books print a rule's number on a
   line of its own, and every book repeats `(i)` and `(ii)` on dozens of pages. A plain frequency
   filter deleted the rule markers and the clause markers; a running head has to be prose.

### Consequences

- **818 rules across twelve acts**, no duplicate numbers, headings where the document has them.
- **2,607 cards; 584 served** — 222 rule, 220 cloze, 142 authored questions.
- **340 cloze cards reviewed** by hand (220 approved, 120 rejected with a reason).
- **151 questions authored, 142 approved** through A→D. Six were rejected by the critic, three by
  rapidfuzz at the specified threshold, none by blind verify.
- The blind pass paid for itself on its first run: stage A had put the correct answer at **index 0 in
  91%** of its questions. Every key was right and the card set was still gameable.
  `make_cards.py` now rotates options by `sha256` of the card id — deterministic, because this file is
  regenerated on every run and a shuffle would make every run a diff — and a test asserts no position
  holds more than half.
- `data/rules` joins `data/law`, `data/pay` and `data/drafting` in `.prettierignore`: it is written
  by `ingest_common`-style `write_json`, and prettier and the generator would take turns rewriting
  4 MB.
- `scripts/ingest/validate_data.py` now covers 58 datasets. `src/modules/trainer/schema.ts` is the
  zod half, `strictObject` throughout, with `Question` exported as an alias of `Card`.
- Certificate verification is never disabled. Several Government of India hosts serve an incomplete
  Let's Encrypt chain — `documents.doptcirculars.nic.in` omits its intermediate and `www.istm.gov.in`
  chains to _ISRG Root YR_, newer than our pinned `certifi` — so `build_ca_bundle()` supplies the
  missing links, fetched from `letsencrypt.org` over a connection that verifies against the roots we
  already trust, with the new root taken **cross-signed by X1** so no anchor is trusted that does not
  chain to an existing one. `test_authoring.py` parses every module with `ast` and fails on any call
  passing `verify=False`.

### What was rejected

**Machine-translating the rule text.** It would have made every card bilingual immediately and it
would have put machine Hindi of statutory text in front of officers who are examined on it.

**Repairing the legacy-font Hindi with a substitution table.** DATA-GAPS #36 already settled this for
CSMOP and the other four are no better: `भनम्नानुसाय` → `निम्नानुसार` needs two substitutions that
are not one-to-one, and a table that is right 95% of the time produces Hindi nobody can trust and
nobody can spot.

**Serving a card whose Hindi is missing, with English as a fallback.** The hard rule in CLAUDE.md is
that a missing `hi` is a CI failure, not a fallback. `needs-hindi` is how a card waits without being
shown, and the test asserts no approved card is missing Hindi.

**Shuffling options randomly.** Deterministic rotation, for the reason above; and rotation rather
than a shuffle, because several questions end their option list with a deliberate catch-all that a
shuffle would strand in the middle.
