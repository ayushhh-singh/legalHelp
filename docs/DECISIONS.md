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

### ADR-023 addendum — what an edge-case pass over the finished dataset found

Six defects, all in code that had passed its own tests, and each one now has a test that fails
against the data as it was committed.

**A cloze card's id must be stable, because every review file is keyed on it.** The id was
`{act}-cloze-{rule}-{n}` where `n` counted the cards emitted for that rule. Add any filter — and the
next item on this list is a filter — and every card after the first rejected span in a rule is
renumbered, silently re-pointing 340 hand-written review entries at the wrong cards. The id is now
`{act}-cloze-{rule}-{kind}`, which is unique because at most one card per (rule, kind) is emitted,
and stable because rejecting one kind never renumbers another.

**Twelve served cloze cards repeated their own answer.** Section 9(1) of the PoSH Act blanks "three
months" and then says "within a period of three months from the date of the last incident"; Rule 14
of the CCA rules blanks "fifteen days" and then offers an extension "not exceeding fifteen days".
The hand review missed all twelve because a reviewer reads the sentence around the blank and not the
one three clauses later. `leaks_answer` now runs as the last gate, on the **final** stem — after an
`edit` has replaced it, because an edit can introduce the leak as easily as the generator can.

**And the first version of that guard was itself wrong.** `\b` + answer + `\b` reads correctly and
never matches an answer that starts or ends with punctuation, because there is no word boundary
between a space and a bracket. That silently exempted every `(1)`-style cross-reference and every
`₹250`-style amount — half of what the check exists to catch. The boundary is now asserted only on
the ends of the answer that are alphanumeric. Devanagari needs no special case in Python, whose `\w`
covers the block; the TypeScript half, where it does not, writes the class out.

**"Repeal and Saving" is an operative rule.** Broadening the emptied-rule test from
`deleted|omitted|repealed` to `...|repeal` — to catch the Official Secrets Act's "[Repeals.] Rep. by
the Repealing Act, 1927" — took the closing rule away from five of these books. The two cases are
now separate: a heading that _is_ "Deleted" or "Omitted", and a heading that says "Rep. by".

**A rule number that carries its own unit must not get the act's.** The FR/SR compilation prints
"F.R. 17", and `citation()` produced "Rule F.R. 17(1)" on 179 cards.

**`readings()` dropped the number as printed.** The leading-zero filter that stops "1000" offering
"000" also removed the untrimmed reading, so `readings("007")` returned `("7",)` — a candidate whose
own number was not among its readings.

**An authored key that matches nothing now fails the run.** A typo in `hindi/<act>.json` or
`review/cloze-<act>.json` broke nothing: the entry was never looked up, the card stayed unserved, and
the run reported success. `check_authored_keys` raises instead — the same reason `validate_data.py`
fails on a dataset in neither manifest and `drafting_seed.py`'s `self_check` rejects a placeholder
naming a field the template lacks.

**Consequences for the numbers.** 584 served becomes 571: eleven leaking cloze cards and one
repealed section rejected, and one authored question that crossed the dedup threshold only after the
rule-card fronts grew the act's name. Every rejection carries its reason and stays in the file.
`docs/authoring-reports/2026-08-28.md` is regenerated from the data.

Three of the four dedup rejections in the CCA batch, and the RTI one, are `token_set_ratio` false
positives — the measure ignores word order, so two questions about the same rule that share their
vocabulary score above 90 even when they ask different things. The threshold is the brief's, the
rejections are recorded with their scores, and the questions stay in the file. Lowering the
threshold would let real duplicates through; raising it is a judgement call for whoever next reads
`review/dedup-*.json`.

## ADR-024 — The Hindi administrative glossary: one compiled dataset, capped on screen, wired into the existing toolbar hook rather than a new one

**Date:** 2026-08-28 · **Status:** Accepted · **Session:** 10

### Context

The brief asked for `data/glossary.json` and `src/modules/utils/glossary`: ≥1,500 designation, office,
file, finance, establishment, legal and IT terms, sourced from the Department of Official Language's
Prashasanik Shabdavali where reachable and compiled from other official glossaries otherwise, with
search, a category filter, copy, favourites, recents, "insert into draft", and a `useGlossarySuggest`
hook for the Drafting Studio's editor.

Three things were already on disk before this session touched anything. `data/drafting/structure-terms.json`
(78 terms, ADR-020) is a **different** dataset for a different question — the Hindi CSMOP 2022 prints for
the _parts of a document itself_ — and its own `GlossarySheet.tsx` carries a comment written in
anticipation of this exact session, naming `structure-terms.json` as unchanged and this session's job as
"the glossary as its OWN destination under Utilities, with the full Rajbhasha Shabdavali behind it".
`src/lib/transliterate.ts` already had `romanKey()` — Devanagari⇄Latin folding built for the law search —
and `rajbhasha.gov.in` was already a reviewed host in `tests/no-external-urls.test.ts`'s `CITATION_HOSTS`.

### The source: fetched once, compiled after that

`WebFetch` on the 651-page Shabdavali PDF hit the tool's 10 MB response ceiling; the glossary page on
`rajbhasha.gov.in` answers "Request Rejected". This matches what row 39 already recorded about the same
PDF — even the Python ingest's own fetch of it could only be read fifty terms at a time, by rendering
pages and reading them by eye, which is not a technique that reaches 1,500 terms in one session. So this
dataset takes the brief's stated fallback: seven parallel authoring passes, one per category, each
compiling standard, well-established Rajbhasha administrative vocabulary from general knowledge — the
vocabulary a CSTT _Shabdavali_ or an ISTM training module would also print — rather than reading it off
one cited page. Every entry carries `verify: true` unconditionally (`docs/DATA-GAPS.md` #48); there is no
`verify: false` tier the way `structure-terms.json` has one for its fifty CSMOP-sourced terms, because
nothing here was read off a specific page of a specific fetched document.

### Decisions

- **One file, `data/glossary.json`,** not a per-category split like `data/drafting/templates/`. The
  templates split because the picker needs an index and nothing else; here the whole point is one instant
  search across every category, so splitting would only mean re-assembling the index client-side. It
  reaches the browser exactly like every other large dataset — a single `?raw` dynamic import, gated
  behind `enabled` in `useGlossary(enabled)`, loaded only once `/utils/glossary` opens or a toolbar sheet
  does (ADR-013).
- **Seven categories — designation, office, file, finance, establishment, legal, it** — matching the
  brief's own list exactly, so a term's category is never a judgement call the schema has to arbitrate.
  `scripts/ingest/glossary_seed.py` cross-deduplicates by English term across categories (a "Purchase
  committee" a finance pass and an office-procedure pass both wrote keeps the first category in a fixed
  priority order) and drops the seven terms that collide with `structure-terms.json` by exact English
  string, so the two datasets never answer the same query with two different ids.
- **The raw category pairs live in `scripts/ingest/glossary_sources/*.json`, not as Python literals** in
  `glossary_seed.py` itself. `drafting_seed.py` inlines its content as Python because it is transcribing a
  specific fetched document page by page; this content has no page to anchor a literal to, so it is
  authored JSON the seed script reads, slugifies into ids, envelopes and validates — closer to how
  `scripts/authoring/hindi/<act>.json` feeds `make_cards.py` than to how `drafting_seed.py`'s `TERMS`
  list is written.
- **No new lexicon file.** The task asked for roman-Hindi search ("avar sachiv" finding अवर सचिव); rather
  than fork `src/lib/lexicon.ts` (law-specific synonym vocabulary) into a second copy, `src/modules/utils/
glossary/search.ts` calls `romanKey()` directly on each term's `en`/`hi`/`alsoHi` at index time and folds
  the query the same way at search time. `search.test.ts` asserts the roman-Hindi case works before
  anything downstream depends on it.
- **The Drafting Studio's glossary sheet gained a tab, not a replacement.** `GlossarySheet.tsx` now has
  "Structural terms" (the original 78, unchanged, still the default) and "Full glossary" (this dataset,
  loaded only once that tab opens), both inserting through the SAME `onInsert: (text: string) => void`
  callback `BodyEditor.tsx` already wired up. This is literally "wiring the Session 9 toolbar hook" —
  there is no second insertion mechanism to maintain, and `tests/e2e/draft.spec.ts`'s existing structural-
  glossary test needed no change because the default tab's behaviour is unchanged.
- **`useGlossarySuggest` finds matches; the editor decides what to do with them.** The hook
  (`src/modules/utils/glossary/useGlossarySuggest.ts`) is a pure function of text and glossary — one
  alternation regex over every English term, longest-first so "Under Secretary" wins over "Secretary" at
  the same position, offsets returned rather than a rendered fragment. `BodyEditor.tsx` renders the matches
  as a row of replace buttons below the box, gated on `target === 'hi'` (the language the officer is
  ACTUALLY typing into, split-aware, not the app's UI language) — not as an inline underline drawn over the
  `<textarea>`. A real underline needs a mirror-div overlay kept in exact sync with the textarea's font,
  line-height and scroll position on every keystroke across two boxes (`BodyEditor.tsx` already tracks
  `en`/`hi` refs separately); CLAUDE.md's own catalogue of StrictMode-era defects in this exact file is
  what a fragile addition to it would risk repeating. A row of chips is real, keyboard-reachable, and
  costs one `<div>`.
- **The render is capped; the search is not.** `GlossaryPage.tsx`'s "All terms" view with an empty query
  and no category picked is 1,891 rows — nearly double the 1,059-section corpus ADR-016 measured before
  deciding NOT to virtualise the Law Converter's list, and each row here is heavier (two copy buttons, a
  favourite toggle, a category chip, a verify badge, a source link, a live-region status paragraph, versus
  six plain nodes). Rendering all 1,891 ran `tests/e2e/a11y.spec.ts`'s `axe.run()` past its 30 s timeout in
  a real browser — ADR-016's own instruction, "measure before reintroducing virtualisation", measured this
  and the corpus size DID change the answer. `MAX_RENDERED = 100` caps what is drawn, not what the fuzzy
  search covers; `GlossarySheet`'s own full-glossary tab already did this (`results.slice(0, 60)`) for the
  same reason, independently, before this was written down.
- **Dexie moves to version 6** — `glossaryFavourites`/`glossaryRecents`, the same `{id, createdAt}` /
  `{id, viewedAt}` shape `lawFavourites`/`lawRecents` already use, with `src/modules/utils/glossary/
favourites.ts` a near-identical copy of `src/modules/law/saved.ts`'s CRUD for the reason the rest of this
  app repeats a shape rather than abstracting it early: three call sites are not yet a pattern.
- **`/utils` becomes a router** (`src/app/App.tsx`'s route changes from `/utils` to `/utils/*`), mounted the
  same way `/law/*` and `/draft/*` already are. `UtilsHubPage.tsx` is the new index route — one linked card
  for the glossary, four inert "coming later" cards for the tools this session did not build — and
  `/utils/glossary` is the module's own destination. `src/lib/nav.ts` is untouched: a tool inside Utilities
  is a screen inside the module, not a place in the nav, exactly as ADR-020's templates are not routes.

### What real testing found, twice

Both were caught by actually loading the built app, not by the unit suite (`pnpm build && pnpm test`
exercises the dist-dependent checks; `pnpm check` does not build):

- The "coming later" cards used `opacity-70` on the whole card to read as disabled. That fades the text
  along with everything else, and the card's own `Badge` was already at the tokens' contrast floor — the
  uniform fade took it below WCAG AA, caught by `tests/e2e/a11y.spec.ts` in a real browser and invisible to
  `src/styles/tokens.test.ts`, which never renders a `Badge` inside a faded ancestor. Fixed with a dashed
  border instead of an opacity trick, which reads as "not here yet" without touching any text colour.
- Zod 4's `toJSONSchema()` — already used by `src/ai/tools/registry.ts` for the AI layer's tool manifests,
  entirely unrelated to this session — has dead branches for the `draft-07`/`draft-04` JSON Schema dialects
  and an IPv6-literal validation trick (`new URL(\`http://[${address}]\`)`), neither ever exercised. A
bundler tree-shakes by module, not by branch, so once `to-json-schema.js`is reachable from ANYWHERE in
the app it ships wherever the chunker places zod's core — which chunk that is moved on this build and
landed inside`GlossaryPage`'s own chunk, tripping `tests/no-external-urls.test.ts`'s dist sweep on four
string literals that had never shipped in one physical chunk before. Three new `ALLOWED_INERT` entries,
  matched by pattern rather than by the minified variable name inside the IPv6 template (which is not
  stable across builds), record why: none of the four is ever dereferenced.

### Consequences

- `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check` and `pnpm test` (1,474 tests, 63 files) are green; the
  full Playwright suite (88 tests, `--workers=1`) is green including four new specs
  (`tests/e2e/glossary.spec.ts`) and two additions to `tests/e2e/offline.spec.ts` and
  `tests/e2e/zero-third-party-requests.spec.ts`.
- `docs/DATA-GAPS.md` #48 records the compiled-not-fetched provenance and names the next step: checking
  entries against the Department of Official Language's own term list, the same source row 39 already
  points at.
- **This session ran concurrently with another one building the Rules Trainer's `data/rules/` content
  (ADR-023).** Both sessions touched `scripts/ingest/validate_data.py` and `tests/no-external-urls.test.ts`
  additively, with no conflict; this session's changes to those two files are scoped to the glossary line
  in the manifest and the three `ALLOWED_INERT` entries above. Nothing in `data/rules/`, `scripts/
authoring/`, or the Rules Trainer's own `CITATION_HOSTS` additions was touched or reviewed by this session.

### Addendum (edge-case pass, same session) — two of these were live bugs, not style

A user-requested review over the glossary commit — seven independent finder passes (line-by-line diff,
cross-file tracer, removed-behaviour audit, reuse-of-helpers audit, altitude/depth, simplification,
CLAUDE.md conventions) — found six things worth fixing. Two are correctness bugs a reader would actually
hit; the rest are real but smaller.

- **Favourites and recents showed "No term matches that." instead of loading, while the dataset was still
  loading.** `byId` (`GlossaryPage.tsx`) needs the full ~700 KB dataset to turn a saved `termId` into a
  displayable term, and favourites/recents themselves are IndexedDB rows that usually settle FIRST,
  independently. Two agents (the cross-file tracer and the reuse-of-helpers audit) found this
  independently: a reader who opens "Favourites" in that window, with real saved terms, was told none of
  them matched — indistinguishable from having saved nothing. Fixed by giving that view its own
  loading/error branches keyed on `glossary.status`, gated separately from the "All terms" search.
  `GlossaryPage.test.tsx` holds a promise open on purpose (the same technique `pay-restore.test.tsx` uses
  for its own race) and asserts the failure against the code before the fix, and the fix, both — the same
  discipline ADR-022 already established for exactly this class of defect.
- **The Fuse index rebuilt on every keystroke, not once per load.** `useGlossary`'s `useAsync` returns a
  fresh wrapper object — `{ ...settled, retry }` — on every call, so `useMemo(() => buildGlossaryIndex(...),
[glossary])` in both `GlossaryPage.tsx` and `GlossarySheet.tsx`'s `FullGlossaryPanel` never actually hit
  their cache: typing "avar sachiv" ran eleven full index rebuilds over ~1,891 terms instead of one.
  `BodyEditor.tsx`'s `useGlossarySuggest` call, written in the same commit, already did this correctly —
  memoising on `glossary.status === 'ready' ? glossary.data : null`, a reference that IS stable once
  settled — and both other call sites now match it.
- **`useGlossarySuggest`'s word boundary let a term glued to a reference number through.**
  `(?<![A-Za-z])`/`(?![A-Za-z])` excludes adjacent letters but not digits or a hyphen-then-digit, so
  "Panel2" and "Audit-2024" both offered their glossary term as a replacement — accepting either would
  splice Hindi into what is actually a file or panel number, not the English word. Fixed with
  `[A-Za-z0-9_]` plus a second, separate `(?!-\d)`/`(?<!\d-)` pair for the hyphenated shape a plain
  character-class exclusion cannot express. `useGlossarySuggest.test.ts` gained both cases, plus a check
  that a term followed by ordinary punctuation ("Secretary's") still matches — the fix narrows what a
  reference number looks like, not what a sentence looks like.
- **`GlossarySheet`'s header kept the structural tab's claim on screen while the full-glossary tab was
  open.** The subtitle — "the manual's own Hindi... not the rendering most people expect" — is true of the
  78-term CSMOP glossary and false of the ~1,891-term general one, which is explicitly NOT from the manual.
  The subtitle is now keyed on `mode`. The same pass found `FullGlossaryPanel`'s search box was missing
  `data-autofocus`, currently harmless only because `mode` always starts `'structural'` and the sheet
  remounts fresh on every open — a latent trap for the natural next feature (remembering the last tab used)
  that would have silently focused the Close button instead. Both panels carry it now; only one is ever
  mounted at a time, so there is no ambiguity for `Sheet.tsx`'s own focus effect to resolve.
- **`toggle`/`recordUsed` were bare `void`-called promises with no `.catch`,** unlike every other
  fire-and-forget IndexedDB write in this codebase (`src/modules/law/ConverterPage.tsx`'s equivalent, and
  `store.ts`'s). A blocked or full IndexedDB turned a tap on the favourite icon into a genuine unhandled
  promise rejection. Both are wrapped now, matching the established "losing this row is not worth a
  message" line. Fixing this alongside `useGlossaryFavourites.ts`'s mutation handlers — which used to
  re-run `listFavourites()`/`listRecents()` against IndexedDB after every single action — also closed a
  second-order race: two rapid toggles used to race two reads with no ordering guarantee, so a fast
  double-tap's list could be overwritten by the FIRST tap's slower read resolving after the second. Both
  handlers now patch the local list from the mutation's own known result via a functional `setState`
  updater, which React guarantees always sees the latest state regardless of resolution order.
- `pages.utils.emptyTitle`/`emptyBody` — the placeholder-page copy `ModulePlaceholder` printed before this
  session — were left in both locale files with nothing referencing them once `UtilsHubPage.tsx` replaced
  `ModulePlaceholder` on this route, and their content ("Tools not loaded yet") had gone stale the moment
  the glossary shipped. `scripts/i18n-check.mjs` checks parity, not use, so this passed CI silently; removed
  from both files.
- `scripts/ingest/glossary_seed.py`'s cross-dataset drops were counted but not named. A term dropped for
  colliding with `structure-terms.json`, or with an earlier category's own entry, is now logged by name to
  `scripts/ingest/reports/glossary-drops.json` (mirroring `scripts/ingest/reports/law-gaps.json`'s existing
  role) — so a future change to either dataset can see WHICH term moved, not just that the count changed.

Three findings were read and deliberately not acted on, each for a stated reason rather than by omission:
pinning zod's `to-json-schema.js` to its own build chunk (via `manualChunks`) would settle the
`ALLOWED_INERT` churn ADR-024's own text above admits is possible again, but touches `vite.config.ts` for
the whole app rather than this feature, while it ran concurrently with another session also building; a
`useGlossarySuggest`-style suggestion strip for `FormFields.tsx`'s other bilingual field types (Subject,
Remarks) is a real feature gap, not a defect in what shipped; and the three near-identical term-card
components (`TermRow.tsx`, `GlossarySheet.tsx`'s two) stay duplicated, consistent with this project's
stated "three call sites are not yet a pattern" line — each has different action buttons, not divergent
copies of the same one.

`pnpm check` (1,624 tests, 72 files) and the full Playwright suite (88 tests, `--workers=1`) are green
after this pass, including `GlossaryPage.test.tsx` (new) and two new cases in `useGlossarySuggest.test.ts`.

---

## ADR-025 — The FSRS scheduler: a pure library, a plain-JSON row, and an IST day

**Date:** 2026-08-28 · **Status:** Accepted · **Implements:** the `ts-fsrs` line of the pinned stack

### Context

The Rules Trainer's content pipeline (ADR-023) produced 818 rules and 2,607 cards, 571 of them served.
What it did not have was a scheduler. `ts-fsrs` has been in the master context's stack list from the
start and on the "Deferred" row of CLAUDE.md since Session 1; this session adds it and builds
`src/lib/srs` over it, with the schedule kept in IndexedDB.

Five questions had to be settled before any of it could be written.

### Decision

**1. `src/lib/srs` is pure, and takes the catalogue as an argument.**

Six of the seven files touch nothing but their arguments; `store.ts` is the only one that opens Dexie.
Nothing in the directory imports React, and nothing imports `data/rules`. The second half matters as
much as the first: `data/rules` is ~4 MB, it belongs behind the Trainer route's lazy import exactly as
the statute and the pay tables are (ADR-013, ADR-018), and importing it here would put it into whatever
chunk imports the scheduler. So every function that needs to know which act a card belongs to, or
whether it is approved, is handed the cards it is to work over — the caller has them already.

This is the arrangement `src/lib/pay` already keeps (ADR-018) and for the same reason. It is asserted
rather than agreed: `src/lib/srs/purity.test.ts` reads every source file in the directory and fails on
a React import, on JSX, on a hook name, on a dataset specifier, on `fetch`, on a `Date.now()`, and on
any file other than `store.ts` importing the database.

**2. The stored row is plain JSON, not a `ts-fsrs` `Card`.**

`SrsCardRow` holds strings, numbers, booleans and nulls; `due` and `lastReview` are ISO-8601 UTC
strings, not `Date`s. Three reasons: a round trip through `JSON.stringify` has to come back **equal**
for export/import to be testable, and a `Date` survives IndexedDB's structured clone but not JSON; the
library's own `Card` carries two fields it has already marked for removal in 6.0.0, and persisting it
would put `ts-fsrs`'s release schedule inside the reader's device; and an ISO-8601 string sorts
lexicographically in the order it sorts chronologically, so Dexie indexes `due` and answers "what is
due" as a range query.

The row carries three fields the session brief did not list, each because leaving it out is a defect
rather than a simplification:

- `learningSteps` on the card. FSRS's default steps are `1m, 10m`; a card halfway through them that
  comes back from storage as step 0 is sent round the first minute again instead of graduating. It is
  the one field that cannot be re-derived from the others.
- `stateBefore` and `retrievability` on the log. **Retention cannot be measured from the card rows.**
  A card row says where the schedule is now, and grading a card overwrites where it was; "of the cards
  you had actually learnt, what share did you recall?" is a question about the state a card was in when
  it was asked. If it is not written down at the moment of the review, it is gone.

**3. Fuzz is off.**

`ts-fsrs` can scatter each interval by a few per cent so a large collection's daily load flattens out.
The cost of leaving it on is that the same card, graded the same way at the same instant, gets a
different due date on each run — which makes the export/import round trip untestable, makes a golden
schedule impossible to assert, and makes two devices holding the same review history disagree about
the schedule. The benefit it buys is load balancing across tens of thousands of cards; the whole served
corpus is 571. Determinism is worth more than that.

**4. The day boundary is midnight IST, implemented as a fixed +05:30 offset.**

A streak has to break at a boundary the reader recognises, and for an app written for officers of the
Government of India that is midnight IST — not midnight wherever the device thinks it is. An officer on
a course abroad, or one whose laptop is set to UTC, must not lose a streak for reviewing at nine in the
evening.

The fixed offset is exact rather than an approximation: India has observed no daylight saving since
1945 and IST is a single statutory offset for the whole country, so there is no rule a timezone
database could carry that the constant does not already state. It is also what keeps `day.ts` pure and
testable against a frozen clock, which `Intl.DateTimeFormat` would not be. Every window is
`[start, end)`, so no review can land in two days or in neither.

**5. `goalMet` is "the day's work is finished", not a card count.**

There is no arbitrary daily target in `TrainerSettings` and there should not be: the day's work is what
the schedule asked for, which is a different number every day. A day is met when nothing is due **and**
nothing more falls due before IST midnight. The second clause is load-bearing — `Again` on the last
card leaves the queue momentarily empty and the card back in a minute, and without it a failed card
would count as a finished day. A reader who has spent `dailyReviewCap` has finished too, learning steps
pending or not: the cap is their own instruction about what a day means, and a goal the reader has
forbidden themselves to reach is not a goal. Once met, a day stays met, so carrying on afterwards
cannot lose it.

### Two further choices worth recording

**New cards are introduced round-robin across the enabled acts, in index order within each.** Index
order is the order `make_cards.py` wrote them, which is rule order, so a reader meets Rule 3 before
Rule 11. Round-robin across acts is what makes `actsEnabled` mean anything: a flat concatenation with
`dailyNew` at 10 would spend six months inside the CCS (Conduct) Rules before the CCA Rules were ever
offered a card. `tests/srs-corpus.test.ts` asserts it over the real eight served acts.

**Import merges; it never replaces.** ADR-001 accepted that "clearing browser data destroys user state"
and recorded that a backup feature was owed. This is it for the Trainer, and it is also the only sync
two devices will ever have — so the merge is symmetric in effect and idempotent. Cards merge by `qId`
keeping the **later review**, not the later file: a device that exported yesterday can still hold the
newer review of a particular card. The log takes the union by id (`<qId>#<reps>#<at>`, the same id on
both devices, so nothing is counted twice). Streaks take the higher count and `goalMet` if either met
it. Settings are the one field with a stated precedence — the incoming file wins, because a settings
row has nothing in it to merge.

### Consequences

- `data/rules` is unchanged; this session added no data and fetched nothing.
- Dexie goes to **version 7**, adding `srsCards`, `reviewLog`, `streaks` and `trainerSettings`. The row
  interfaces are declared in `src/lib/srs/types.ts` and `src/db/index.ts` imports them as types — the
  one place `src/db` reaches into a library directory. `import type` means no runtime edge, so nothing
  in `src/lib/srs` is downloaded by a reader who never opens the Trainer.
- `ts-fsrs` 5.4.0 is a dependency and is **in no chunk yet**: nothing under `src/app` or
  `src/modules/trainer` imports `src/lib/srs`, so `dist/` after this session contains none of it. The
  Trainer UI is what will pull it in, and it must do so behind the route's lazy import.
- 147 new unit tests across eight files, all against a frozen clock. `tests/srs-corpus.test.ts` drives
  the queue and the engine over the committed `data/rules/cards/*.json` rather than a fixture.
- What is still owed: the Trainer UI, and a place in Settings for export/import. `store.ts` has the
  functions; nothing calls them yet.

### Addendum — seven defects an edge-case pass found, and what each one taught

Every one of these was found by probing the built code rather than by reading it, every one crossed a
file boundary — which is why none showed up in the per-file suites — and every one now has a test in
`src/lib/srs/edge.test.ts` that was confirmed to fail against the code before the fix.

1. **`localeCompare` cannot make the promise the export makes.** Four comparators used it. Its collation
   depends on the runtime's locale and its ICU build; it sorts `A-1` after `a-1` where code-unit order
   does the opposite, and it treats a hyphen as a variable-weight character — the one punctuation mark
   every card id in `data/rules` is built from. The stated property is that two devices holding the same
   history produce the same file, and a comparator that is a property of the _runtime_ cannot deliver it.
   `compareStrings` in `types.ts` is now the only one, and `purity.test.ts` fails on `.localeCompare(`
   anywhere in the directory.

2. **`2026-02-31` is a date JavaScript parses — as the 3rd of March.** The streak day was validated by
   pattern alone, so a row naming an impossible day was accepted by an import, and then meant two
   different things: the 3rd of March to anything that walked the calendar, and a day that never happens
   to `currentStreak`, which matches the literal string. `day.ts#isIstDay` validates by round trip
   instead, which is exact.

3. **A bad day in a backup could take the stats screen down.** `longestStreak` is the one function that
   steps a stored date _forward_, and `addIstDays` throws `RangeError` on a day that cannot be parsed.
   Fixing (2) closes the import route; `longestStreak` now also filters, because a row could still arrive
   from a future release.

4. **The tolerant layer and the crashing layer disagreed about the same row.** A corrupt `at` was
   silently skipped by `usageForDay` and `dayStats`, and threw `RangeError: Not an instant` — as an
   _unhandled rejection_ — out of `store.ts#logsForDay`, killing `getDueQueue`. One row, two behaviours.

5. **The queue was reading the whole review log on every card graded.** `logsForDay` did
   `toArray().filter(...)` over an append-only table that grows for as long as the app is used, to find
   the handful of rows belonging to today — while `reviewLog` carries an index on `at` that nothing used.
   It is now a range query, which also fixes (4): a row outside the range is simply outside it.

   That range query is only correct while every stored timestamp has the same shape, because IndexedDB
   orders strings by code unit. So `isoInstant` in `transfer.ts` now requires exactly what
   `toISOString()` produces — a round trip, not a `Date.parse` test, which would also have admitted
   `2026-02-31T00:00:00.000Z`.

6. **Dropping an unreadable `last_review` is not a safe degradation.** The first attempt at hardening
   `toFsrsCard` omitted the field when it could not be parsed; ts-fsrs then refuses the card outright
   (`FSRSValidationError: Invalid date`) because a `review`-state card must have one. It falls back to
   `now` instead — elapsed zero, the conservative reading when the interval is unknown. The original
   defect was worse: an `Invalid Date` came back out of `toRow` as `RangeError: Invalid time value`,
   losing the review the reader had just given.

7. **A day's goal could become unreachable.** `remaining` was computed with the reader's `actsEnabled`
   and `pendingLater` without it, so a card left standing on a learning step in a book the reader had
   since switched away from held the day open for ever: the queue empty, everything they asked for done,
   and `goalMet` false. Both now use the same scope.

The pattern in five of the seven is the same one: **two code paths reading the same row and disagreeing
about it.** The pure layer tolerating what the store layer throws on (4); the import validating a shape
loosely that an index depends on strictly (5); the queue and the goal check scoping differently (7);
prose validation against calendar reality (2, 3). Each was invisible to a suite that tests one file.

---

## ADR-026 — Utilities' remaining three tools: a second fixed-offset IST library, engines that take facts as arguments, and gratuity reusing the allowances' own DA-linked escalation

**Date:** 2026-08-29 · **Status:** Accepted · **Session:** 13 (holidays, leave, pension, portals)

### Context

Session 10 built the glossary as Utilities' first real tool; this session brings the other three —
holiday calendar, leave calculator, retirement & pension — up to the same bar, plus the portals
directory. All three calculators need IST calendar-date arithmetic, and `src/lib/srs/day.ts` already
has exactly that logic, built for the Trainer.

### Decision

**1. A second, separate IST day library (`src/lib/istDay.ts`), not a shared import from `src/lib/srs`.**
`src/lib/srs/purity.test.ts` enumerates every file in that directory by name and asserts what each one
may and may not do — it exists to police the Trainer's own file list, not a general-purpose module
boundary. Importing `day.ts` from three unrelated features would couple Utilities to the Trainer through
a test written for a different purpose, and the reusable part is a handful of pure functions, which cost
less to duplicate than the coupling would. The `+330`-minute fixed-offset reasoning (no DST in India
since 1945) is copied verbatim; `addMonths`/`addYears`/`completedMonths`/`completedYears`/
`lastDayOfMonth` are new, needed for leave accrual and the superannuation-date rule.

**2. Every engine takes its facts as an argument — pay's pattern, not a new one.** `src/lib/holidays`,
`src/lib/leave` and `src/lib/pension` are pure: no React, no Dexie, no dataset import, no clock of their
own, mirroring `src/lib/pay/engine.ts`'s own stated rule. `src/lib/leave/rules.ts` is the one exception
worth naming: the CCS (Leave) Rules 1972 constants (EL/HPL credit rates, the commutation factor) live in
code rather than a `/data` JSON file, because they are a dozen numbers that do not change between pay
commissions the way a matrix does — Casual Leave and Restricted Holidays are flagged `verify: true` in
that same file because they are DoPT administrative instructions outside the 1972 Rules, not the Rules
themselves, and citing a specific O.M. number without having fetched it would overstate the citation.

**3. NPS and UPS are not re-declared — `data/pay/nps.json` and `data/pay/ups.json` are read again,
through `src/modules/pay/schema.ts`'s own `schemeSchema`.** The pension module's `data.ts` imports that
one zod schema rather than writing a second copy of the same shape; `src/lib/pension/types.ts` re-exports
its `PensionFacts` type from `src/modules/utils/pension/schema.ts` the same way `src/lib/pay/tables.ts`
imports its types from `src/modules/pay/schema.ts` — the zod schema is the one definition, the pure
engine's types are `import type` only.

**4. The gratuity ceiling reuses the allowances' own DA-linked escalation, not a new rule.** CCS
(Pension) Rules 2021 Rule 45 states a Rs. 20 lakh ceiling; the figure actually payable today is Rs. 25
lakh, because the ceiling — like a fixed allowance in `data/pay/allowances.json` — is raised 25 per cent
each time Dearness Allowance crosses 50 per cent, which happened on 01.01.2024. `data/pension/
pension-facts.json`'s `gratuity.daLinked` is the same `{ kind, timesApplied }` shape `allowances.json`
already uses, and `gratuityCeiling()` in `src/lib/pension/engine.ts` applies it with the same `1.25 **
timesApplied` the pay engine's `indexFactor()` does.

**5. The superannuation date handles the "born on the 1st" case as a distinct legal rule, not an
edge case of date arithmetic.** FR 56(a) retires a Government servant on the last day of the month in
which he attains 60; age in law is attained on the day BEFORE the anniversary of birth. For most birth
dates that is still the birth month, so the two readings agree — but a birth date of the 1st attains 60
on the last day of the PRECEDING month, and retires at the end of that earlier month. `superannuationDate()`
computes `lastDayOfMonth(addDays(addYears(dob, 60), -1))` rather than special-casing the 1st, so the same
formula produces the ordinary answer and the edge case without a branch; `engine.test.ts` asserts both,
plus the December-1st and January-1st cases where the edge crosses a year boundary.

**6. `data/holidays/holidays-2026.json` and `data/pension/pension-facts.json`'s commutation table are
both `verify: true`, and both name a specific reason in their `source.note`.** `dopt.gov.in` answered
403 or failed certificate verification on every fetch attempted this session (`docs/DATA-GAPS.md` #51);
the fetched CCS (Commutation of Pension) Rules 1981 PDF's Schedule table could not be parsed from its
compressed content stream (`docs/DATA-GAPS.md` #52). Both fall back to the project's established pattern
— a secondary reproduction, cross-checked (the holiday calendar's every day-of-week independently
recomputed from its date and asserted to match; the commutation table's values checked against a second,
independent reproduction) — rather than stopping. `scripts/ingest/holidays.py`'s `YEARS` dict is keyed
by year specifically so a 2027 circular is a second entry, not a rewrite.

**7. Dexie moves to version 9 for one table**: `holidayPicks`, the "choose any two" restricted-holiday
picks, the only piece of this session's state that outlives a single visit — keyed `"<year>:<holidayId>"`
so a re-pick overwrites rather than accumulates, indexed on `year`. Leave and pension calculator inputs
are deliberately NOT persisted: nothing in the session brief asked for a saved scenario the way Pay's
`payScenarios` table does, and every figure they need (date of birth, date of joining, current basic pay)
is short enough to re-type, unlike a full pay slip's worth of choices.

### Consequences

- `pnpm test` (1,744 tests, 84 new: 25 in `src/lib/holidays`, 12 in `src/lib/leave`, 21 in
  `src/lib/pension`, plus data/i18n coverage), `pnpm build` and the Python ingest suite (67 tests) are
  green for everything this session touched. `scripts/ingest/holidays.py --check` and `scripts/ingest/
utils_seed.py --check` both confirm a re-run is byte-identical.
- `data/holidays`, `data/pension` and `data/portals.json` join `data/law`, `data/pay`, `data/drafting`
  and `data/rules` in `.prettierignore`, for the same reason: written by `ingest_common.write_json`,
  and prettier would fight the generator over formatting on every run.
- `CITATION_HOSTS` in `tests/no-external-urls.test.ts` gained seventeen entries for the portals
  directory's own links and the three new datasets' sources — reviewed the same way every earlier
  addition to that list was, each host appearing in a committed dataset's `url` field being the other
  half of the assertion.
- This session found the working tree already carrying substantial uncommitted work on the Rules
  Trainer's UI (a `recharts` dependency, `src/modules/trainer/{store,reviewQueue,data,useCatalogue}.ts`
  and more, a `src/db` schema already at version 8) that was not reflected in `CLAUDE.md`'s own status
  table. That work was left untouched throughout — this session's Dexie version 9 was built on top of
  the already-present version 8 rather than around it, and nothing under `src/modules/trainer` or
  `src/ai/tools` was edited. Two pre-existing gaps outside this session's scope surfaced as a result and
  are recorded rather than fixed here: `src/ai/tools/rules.ts` (untracked) cites a placeholder
  `example.gov.in` URL that fails `tests/no-external-urls.test.ts`, and the built `MockPage` chunk cites
  `redux.js.org`/`bit.ly` URLs not yet on `ALLOWED_INERT` — both pre-date this session's changes.

---

## ADR-027 — The Rules Trainer's UI: decisions never mutate the dataset, a mock test scoped to what has one right answer, and `useLiveQuery` over the store rather than a refetch

**Date:** 2026-08-29 · **Status:** Accepted · **Session:** 12 (Trainer UI, mock tests, analytics, local
reminders) · **Builds on:** ADR-023 (content pipeline), ADR-025 (the FSRS scheduler)

### Context

Session 11 left `src/lib/srs` — a scheduler with nothing above it to call it — and `data/rules` with 818
rules and 2,607 cards, 571 served and a meaningful remainder still `unreviewed`. This session builds the
eight screens the brief asks for: `/learn` (home), `/learn/review`, `/learn/mock`, `/learn/browse`,
`/learn/bookmarks`, `/learn/reports`, `/learn/settings` and `/learn/review-queue`, plus four AI tools
(`src/ai/tools/rules.ts`) and a local daily-reminder seam.

It ran concurrently with Session 13 (Utilities' holidays/leave/pension/portals), in the same working
tree with no branch isolation. That session found this one's uncommitted work mid-flight, deliberately
left it untouched, built its own Dexie version 9 on top of this session's version 8 rather than around
it, and recorded two pre-existing gaps it found but correctly left for this session to fix rather than
touching code outside its own scope (`docs/DECISIONS.md`'s ADR-026 consequences). Both are fixed below.

### Decision

**1. A card the reader locally approves or rejects is never written back into a `Card` — it is a
`CardOverrideRow` keyed on `qId`, folded over the dataset at read time.** `src/modules/trainer/
reviewQueue.ts#effectiveCatalogue(rawCards, overrides, proposed)` is the one function that answers "what
may the FSRS scheduler draw on": the dataset's own `approved` cards, plus any `unreviewed` dataset card
or `propose_card`-drafted AI card with an `approved` override, `reviewState` forced to `approved` and any
edit patch applied. A rejected card, and an undecided one, are simply absent. `src/lib/srs#isServed` sees
only the RESULT of that merge and has no idea an override exists — the scheduler's contract from ADR-025
("every function takes the catalogue as an argument") is what makes this possible with zero changes to
`src/lib/srs` itself. `pendingReviewQueue()` is the same file's other half: cards with no decision yet,
from either source, which is what `/learn/review-queue` lists.

**2. The mock test is scoped to `mcq` / `trueFalse` / `scenario` cards, not the whole catalogue.** A
rule-flip card and a cloze card are open recall — there is no single pick a timed test can silently mark
right or wrong. The three kinds it does draw from are exactly `data/rules`'s "authored questions" (141
approved, per the master context's own status line), which is not a coincidence: those are the only
kinds `scripts/authoring/make_cards.py` ever gives an `answerIndex`. `CardView`'s `mode="mock"` suppresses
the review mode's immediate correct/incorrect highlight on a pick — "no explanations until the end" means
the option list must never show which one was right before the reader has answered every question — and
records the answer silently via `onAnswer`, advanced by an explicit Next/Finish button rather than
auto-advancing, so a reader can change their mind before committing.

**3. Every reactive number in the UI is a `useLiveQuery` over an `src/lib/srs/store.ts` function, not a
load-once effect with a manual refetch.** `getDueQueue`, `statsForDay` and `weakAreasFor` all read
`db.srsCards` / `db.reviewLog` / `db.streaks` internally; Dexie's live query tracks every table a querier
function actually touches, transitively through awaited calls, regardless of the calling component's own
dependency array. Grading a card writes those three tables in one transaction (`reviewCard`, ADR-025), so
every screen showing a due count or a stat updates the instant the transaction commits — with no
"refresh when navigating back to Home" logic anywhere. `useEffectiveCatalogue` uses the same lever over
`cardOverrides`/`proposedCards` for the Local Review Queue's approvals to reach the very next review
session with no navigation.

**4. The four grade buttons' interval hints ("3 d") call `previewGrades`, already exported by
`src/lib/srs/engine.ts` before this session started.** It runs `gradeCard` for all four grades against the
same row and instant without persisting any of them — pure, and specifically shaped for this UI, which
reads as Session 11 anticipating it even though nothing above the scheduler existed yet to call it.

**5. `recharts` 3.10 is a real dependency now** (CLAUDE.md's stack line pinned it, `Deferred` listed it
until this session), for the mock results' accuracy-by-rule-book bar chart — the one chart in this app.
Colours are passed as `var(--token)` strings directly to `fill`/`stroke`/`tick.fill`, which modern
browsers resolve as CSS custom properties even on SVG presentation attributes; there is no separate
recharts-specific theming layer. Its own internal use of Redux bundles `redux.js.org`/`redux-toolkit.js.org`
error-message links and a `bit.ly` warning shortlink into `MockPage`'s chunk — inert, never fetched, three
new `ALLOWED_INERT` entries in `tests/no-external-urls.test.ts` record why, closing the gap Session 13
found and correctly left alone.

**6. `propose_card`'s placeholder `source.url` (`https://example.gov.in/ai-proposed`) is a fourth new
`ALLOWED_INERT` entry, not a redesign.** `cardSchema` requires an absolute `https://` URL on every card
and an AI-drafted one has no real citation yet; `example.gov.in` is the same non-resolving placeholder
host `src/test/rules-cards.ts`'s fixtures already use. The card stays `reviewState: "unreviewed"` —
unservable — until a human reviews it in `/learn/review-queue`, which is also where a real citation
would be added before approval.

**7. The daily reminder is local-tab-only, and that ceiling is structural, not a shortcut.** The master
context rules out a backend and a push server; `src/app/pwa.tsx` registers a workbox-generated service
worker with no custom message handler to extend. `src/modules/trainer/reminder.ts#checkAndShowReminder`
is the one impure function — `Notification.requestPermission()` on an explicit Settings click, never
automatically, and `registration.showNotification()` — checked on every `useNow(60_000)` tick for as long
as a `/learn/*` tab is open. It cannot fire while no tab of this app is open; `docs/DATA-GAPS.md` #53
records this as a design ceiling, not a bug.

**8. Dexie moves to version 8 for four tables**: `trainerBookmarks` and `cardOverrides`, keyed on `qId`
alone because both are a decision about one card, not a log; `trainerReports` and `proposedCards`,
append-only and keyed on their own `id`. `TrainerReportRow` is never deleted by the reader — "exportable"
in the brief means read out as CSV, not cleared — an auditor with the dataset in front of them is the
one who resolves a report.

**9. A real defect in `data/rules/cards/csmop.json` surfaced through the URL sweep, not through review**:
`csmop-cloze-4-3-definedterm`'s cloze blank lands inside a URL CSMOP's own Table 4.2 quotes in prose
(`http://cabsec.nic.in/showpdf.php?type=____ s_highlevel_committee&special`), mangling it. It is
`reviewState: "unreviewed"` — `isServed` already keeps it from any reader — and is exactly the kind of
defect `/learn/review-queue` exists to catch; `docs/DATA-GAPS.md` #54 records it for a human to reject
there rather than hand-editing the generated file.

### Consequences

- `pnpm test` (1,744 tests: 40 new across `src/modules/trainer/{reviewQueue,store,reminder,
intervalLabel}.test.ts` and `src/ai/tools/rules.test.ts`), `pnpm typecheck` and `pnpm lint` are clean.
  `pnpm build` succeeds; `tests/e2e/learn.spec.ts` (three tests: the full start-review-to-home-counts
  loop with a language toggle mid-card, a completed mock test, and the whole review loop offline) and
  the extended `tests/e2e/a11y.spec.ts` / `tests/e2e/zero-third-party-requests.spec.ts` sweeps pass.
- `tests/bundle-budget.test.ts`'s initial-route check now fails: 184,996 bytes gzip against a 176,758
  ceiling. Measured in isolation (a throwaway build with `trainer`'s i18n keys removed, restored
  immediately after): Session 13's own additions already land the initial route at ~179,191 bytes gzip
  — over budget on their own, before this session's content — and this session's ~21 KB of raw bilingual
  JSON adds a further ~5.8 KB gzip on top. Neither session's `i18n` additions are individually
  reasonable to gut for a shared ceiling that predates both of them by many sessions of incremental
  growth; `docs/DATA-GAPS.md` #55 records the measurement and defers the actual call — re-baseline via
  an ADR, or move to per-route i18next namespaces — to whichever session picks it up next, since it is
  not one either concurrent session can resolve alone by trimming its own content.
- `src/ai/tools/index.ts` registers `registerRulesTools()` alongside the other three; eighteen tools
  becomes twenty-two (four `learn`-scope: `get_rule_text`, `get_user_weak_areas`, `get_card_history`,
  `propose_card`).

---

## ADR-028 — Onboarding and Settings: a second fetch exemption, an onboarding gate scoped to `/` alone, and a global Devanagari-digits toggle that finally has something wired to it

**Date:** 2026-08-29 · **Status:** Accepted

### Context

This session's brief: a three-step, skippable first-run onboarding (language; optional job + city, which
should prefill Pay and enable relevant Trainer acts; a privacy statement), and a Settings screen with
theme/language (already built), a Devanagari-digits toggle, a daily-reminder shortcut, "Check for data
updates" (a live fetch against `data/_meta/versions.json`, bypassing cache, diffed against the bundled
copy), export/import/erase, an About card and a data-sources table. Four of those needed a real decision
against standing rules rather than a routine build.

### Decision

**1. A second, narrowly-scoped fetch exemption.** ADR-011 point 3 makes `src/ai/providers/wire.ts` the
only module allowed to call the `fetch` global — `eslint.config.js`'s `no-restricted-globals` rule bans it
everywhere else in `src/`, on purpose, so "what in this app can talk to the network?" stays answerable
from one file. "Check for data updates" needs a genuine network round trip: comparing the bundled
`data/_meta/versions.json` (a build-time import, like `DataVersion.tsx` already does) against what the
origin currently serves is not answerable from anything already in the bundle. `src/lib/dataUpdates.ts` is
now a second named exception in that same eslint block, for the same reason wire.ts got one rather than
reaching the global as `globalThis.fetch` to dodge the rule silently: the request is same-origin, carries
no user-entered data, and its path is a literal string with a `Date.now()` cache-buster appended — never
built from a parameter — so the module cannot become a way to fetch anything else. `tests/no-external-
urls.test.ts` gains a test mirroring `names api.anthropic.com in exactly one module`: it greps `src/` for a
BARE `fetch(` call (not `globalThis.fetch`, which three AI provider modules reference purely as a type —
`fetchImpl?: typeof globalThis.fetch` — so an implementation can be injected in tests without any of them
calling it) and asserts the only file exempted by name that actually contains one is `dataUpdates.ts` —
`wire.ts` itself never calls the bare identifier either, it always calls an injected `doFetch` — so the
independent check is "no OTHER file does", not "exactly these two do".

The request bypasses two cache layers, not one: `cache: 'no-store'` skips the browser's HTTP cache, and a
`?bypass=<timestamp>` query param defeats the service worker's own `StaleWhileRevalidate` rule for `/data/
**/*.json` (`vite.config.ts`) — that rule serves a cached response for a URL it has already seen, but this
exact URL, with this exact timestamp, has never been cached, so a miss there is a real network fetch. The
comparison itself (`diffVersions`) is pure and unit-tested without a network at all; `fetchLatestVersions`
is the one untested-by-design line that makes the call.

**2. Onboarding gates exactly one route: a bare `/`.** The obvious design — redirect every unauthenticated
route to `/onboarding` until a flag is set — would have broken every one of the roughly eighty existing
Playwright specs and dozens of component tests that navigate straight to `/law`, `/pay`, `/settings` and
so on, none of which seed an `onboarded` row first, because none of them are simulating a fresh install; a
shared law-section link or a saved pay scenario is exactly the case an onboarding wizard must never
interrupt. `App.tsx`'s existing `path="/"` route — previously an unconditional `<Navigate to={HOME_PATH}
/>` — now branches on `hydrated` (show the loading fallback) and, once hydrated, on `onboarded` (Law
Converter or `/onboarding`). Every other route, known or unknown, is untouched — the catch-all `path="*"`
still goes straight to `HOME_PATH`. This is also the literal PWA `start_url` (`vite.config.ts`), so the one
path this gates is the one a fresh install actually opens on.

The hydrated-guard is not decoration: deciding before `hydrate()` resolves would either flash the normal
shell for an unonboarded device for one frame, or — worse — send an already-onboarded reader who reloaded
`/` back through the whole wizard for the frame before IndexedDB answers. Two existing test files' own
`renderShell` helpers had to gain the same `useAppStore.setState({ hydrated: false })` reset `store.edge.
test.ts` already uses before calling `hydrate()` by hand: `useAppStore` is a module-level singleton that
outlives any one test within a file, so a `hydrated: true` left over from an earlier case let the `/`
route's onboarding check decide on stale state for one render frame, before the new mount's own `hydrate()`
had resolved — `src/components/common/common.edge.test.tsx`'s two new root-route cases (fresh device →
onboarding; `onboarded: true` written first → straight to Law) are what caught it.

**3. `TrainerActHint.acts: []` means "make no change", not "enable nothing".** `TrainerSettings.actsEnabled`
already treats an empty array as "every rule book" (`src/lib/srs/types.ts`). The brief's own example — "IB →
Conduct, OSA, RTI s.24 note" — reads as ADDING relevance, but `actsEnabled` is a restrictive allowlist, and
narrowing a fresh install's Trainer queue down to one or two rule books for every post (most of `data/pay/
jobs.json`'s twenty-two organisations have no special relevance to name) would have made the Trainer look
broken for the common case. `src/modules/onboarding/actHints.ts#trainerActHintsForJob` returns `acts: []`
— read by the caller as "leave `actsEnabled` alone" — for every organisation with no self-evident link to
intelligence, investigation or classified material, and only narrows to `['ccs-conduct', 'osa']` for the
nine that do (`ib`, `nia`, `cbi`, `ncb`, `ed`, `capf`, `delhi-police`, `mod-civ`, `drdo`). The RTI s.24 note
is shown only for the two organisations named in the RTI Act's Second Schedule beyond any reasonable
dispute — Intelligence Bureau and National Investigation Agency, the brief's own worked example — rather
than attempting a legal classification of all twenty-two, which this app is not positioned to make and
where a wrong "your organisation is exempt from X" is worse than saying nothing. Every one of these is a
starting preset, changeable in one tap at `/learn/settings`, and the onboarding screen's own note says so.

**4. The Devanagari-digits toggle is global, and it is now wired to something real.** `src/lib/drafting/
format.ts#toDevanagariDigits` and `RenderOptions.devanagariDigits` (ADR-020's engine) have existed since
the Drafting Studio shipped, exercised by `tests/drafting-data.test.ts` and exposed as a parameter on the
`render_draft` AI tool — but no UI control anywhere ever set it; a reader could not actually turn it on.
Rather than build a second, drafting-local toggle, `devanagariDigits` joins `theme` as a top-level
`useAppStore` field (`SETTING_KEYS.devanagariDigits`, hydrated and persisted the same way), and `src/
modules/drafting/EditorPage.tsx`'s two `render`/`renderDocument` calls now read it from the store instead
of defaulting the option to `false` inline — a change with no default-behaviour risk, since the store's own
default is `false` too, so every existing drafting test and `.txt` snapshot is unaffected until a reader
actually flips the switch. It deliberately does NOT reach the Pay calculator's payslip: ADR-018 fixes those
numerals at Inter `tabular-nums` for column alignment, a decision this toggle does not reopen, and the
store field's own doc comment says so.

**5. `data/_meta/versions.json` gains twelve entries it should have had already.** The "Data sources &
versions" table reads this file directly, the same way `DataVersion.tsx` does, and the acceptance check
asks it to list every dataset in `/data`. It did not: Session 9's whole `data/rules/` — twelve rule books,
818 rules, 2,607 cards — was never added to `versions.json`, unrelated to anything this session's brief
asked for. Closed by adding one `rules-<act>` entry per act, generated from `data/rules/index.json`'s own
per-act `short` label and `source` (already fetched and cited there), rather than leaving the gap for the
About screen to inherit. All twelve source hosts were already on `tests/no-external-urls.test.ts`'s
`CITATION_HOSTS` allowlist — `data/rules/text/*.json` cites the same ones — so no allowlist change was
needed.

### Consequences

- `pnpm typecheck` and `pnpm lint` are clean; `pnpm test` is clean except for pre-existing, unrelated
  items also visible on `main` before this session (`tests/bundle-budget.test.ts`'s initial-route ceiling,
  `docs/DATA-GAPS.md` #55) and issues that belong to concurrent work in the same tree at the time of
  writing (a second session's session's own uncommitted Dexie v10 bump and `PaletteRoot` component;
  neither is this session's to fix).
- `src/db/index.ts` gained two more keys in the existing `settings` table (`onboarded`,
  `devanagariDigits`) and no new Dexie table or schema version — both are booleans a reader can only ever
  overwrite, not a log or a scheduled row, so the existing key-value table is the right shape.
- `src/lib/backup.ts` (export/import/erase) and `src/lib/dataUpdates.ts` (the update check) are new,
  small, pure-where-possible modules with their own unit tests; the settings components that call them
  (`src/modules/settings/components/*`) are thin UI shells over them, matching the split `usePayTables` /
  `data.ts` already draw elsewhere.
- Export excludes `secrets` (the AI key vault — a passphrase-mode vault is only as safe as the passphrase,
  and moving it into a portable file is a real weakening of "on-device only" even encrypted), `aiAnswers`
  and `aiUsage` (a cache and a billing ledger, neither saved on purpose) by NAME rather than including the
  rest by name, so a table a later session adds is backed up by default — the same convention
  `clearAllData` already uses for erase.

### Addendum — edge-case pass, requested after the commit

A deliberate review pass over this session's own commit (`cf69afb`), run against the code rather than
reasoned about. Two real defects, both fixed and now covered by a regression test that was confirmed to
fail against the pre-fix code by inspection (neither fix touches a code path a test could not reach
without one):

- **Importing a backup with a `settings` row had no visible effect until a manual reload.**
  `BackupSection.tsx`'s import flow calls `restoreBackup()`, which `bulkPut`s straight into Dexie — correct
  for `drafts`, `payScenarios`, `lawFavourites` and every other table, all of which the app reads through
  `useLiveQuery` and therefore picks up immediately. `settings` is the one table that is not: `theme`,
  `language`, `ai`, `onboarded` and `devanagariDigits` are read into `useAppStore` once at `hydrate()` and
  never re-subscribed to Dexie, so a reader who imported a backup taken on another device saw "Restored N
  rows." and an otherwise unchanged screen. Fixed by showing a "Reload" button whenever the restored file's
  `tables` object contains a `settings` key — `src/modules/settings/components/BackupSection.test.tsx` is
  the regression file, including a case asserting the button does NOT appear when `settings` was not part
  of the restore, and a case asserting a setting NOT in the restored file survives untouched.
- **`OnboardingPage`'s `finish()` had no error handling.** `writeLastScenario` and `saveSettings` are
  ordinary Dexie `put`s with no failure fallback of their own (unlike `setOnboarded`, which downgrades a
  storage failure to `storageBlocked` inside the store and still applies in memory — `src/app/store.ts`'s
  `persist()`). A thrown write left the reader stuck on step 3 with a re-enabled "Understood" button and no
  indication anything had gone wrong; "Skip setup" was the only way out, and it silently drops the post and
  city they had just chosen. Fixed with a `catch` that surfaces a bilingual, role="alert" message naming
  "Skip setup" as the fallback, without disabling either button — `src/modules/onboarding/
OnboardingPage.test.tsx` mocks `writeLastScenario` to reject and asserts the alert appears, the reader is
  still on step 3, and both buttons stay enabled.

**Looked at, deliberately left alone:** the review also flagged that `cf69afb` alone — checked out into a
clean worktree, independent of the commit that followed it — fails `pnpm typecheck` and `pnpm test`,
because `src/app/App.tsx` (and two new e2e specs) already referenced `./paletteStore`,
`./useGlobalShortcuts` and `@/components/palette/PaletteRoot`, files the concurrent command-palette
session's own commit (`d89abf4`) had not landed yet at the moment this one was made. This is a real
bisectability gap — `git bisect`, a revert, or a deploy pinned to that exact SHA would all fail — but it is
the direct, unavoidable consequence of two sessions sharing one working tree and one `App.tsx` at once
(the same arrangement Sessions 12/13 used, ADR-026/027): both `path="/"` and the palette's own mount point
live in that file, and neither commit could be made self-contained without either squashing the two
together (destroying the separate authorship and review history this document relies on) or one session
blocking on the other's unrelated feature. Left as recorded history rather than rewritten — `main` at
`d89abf4` and after is a normal, buildable, bisectable line; only the single intermediate commit is not.

---

## ADR-029 — The command palette: cmdk's own Radix Dialog for the a11y contract, every section reusing its module's own search, and a "latest ref" listener for the global shortcuts

**Date:** 2026-08-29 · **Status:** Accepted

### Context

This session's brief: a global Ctrl/⌘-K command palette searching Law sections, Job posts, Glossary,
Document types, Trainer topics, Portals and Settings actions; global keyboard shortcuts (`g` + a letter to
jump modules, `?` for help, `/` to focus a page's own search); and "Copy link" for glossary entries and
Trainer topics alongside the Law Converter's and Pay calculator's existing share buttons. It ran
concurrently with Session 14 (onboarding + Settings) in the same working tree — read that session's own
CLAUDE.md paragraph and ADR-028 for how the two coordinated; this ADR is this session's half.

Four things needed a real decision rather than a routine build.

### Decision

**1. `cmdk`'s `Command.Dialog` is the whole accessibility contract, not something built beside it.**
`Command.Dialog` (`src/components/palette/CommandPalette.tsx`) wraps `@radix-ui/react-dialog` — now a
direct dependency alongside `cmdk`, rather than only reachable as `cmdk`'s own transitive one, the same
reasoning that pins every other shadcn-adjacent Radix package this app already carries. That buys, for
free, exactly what `AiConsentModal.tsx` had to hand-write before Radix was available for this: a real
focus trap, Escape-to-close, `role="dialog"` with `aria-modal`, and background scroll lock. `Command.Input`
supplies the other half — `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` —
so nothing in this module hand-rolls ARIA 1.2 combobox wiring the way `Combobox.tsx` in the Pay module
deliberately does for its own, much narrower two-picker case (that file's own comment explains why fuzzy
matching over 67 posts doesn't want `cmdk`; this module is the one place in the app `cmdk` was always
pinned for, per the master context's stack list).

**2. Every section reuses its module's own search — `shouldFilter={false}` makes `cmdk` a list renderer,
not a second search engine.** `src/components/palette/sections.ts` calls `searchLaw` (the Law Converter's
own banded ranking and bilingual offence lexicon), `searchJobs` (the Pay module's own acronym-aware
`pick.ts`) and `searchGlossary` (the glossary's own Fuse index) directly, and hands `cmdk` an
already-ordered list per section. Document types and Trainer topics have no reusable search of their own
— fourteen templates and twelve rule books are small enough that a plain `romanKey`-folded match is the
whole job, including an acronym check (`acronymOf(shortName.en)`) for the case CLAUDE.md's own acceptance
line calls out: "OM" finding "Office Memorandum (O.M.)" without the reader typing the sentence out.
Reusing rather than reimplementing is what makes "hatya" reach BNS 103 and "ACIO" reach a post whose title
never spells it — those are the SAME bilingual lexicon and the SAME id-segment acronym index `/law` and
`/pay` already ship, not a parallel index that could quietly disagree with them.

**3. Laziness, twice over — the whole overlay, and each dataset inside it.** `App.tsx` mounts
`<PaletteRoot/>` (one lazy `import()` covering both `CommandPalette` and `ShortcutsHelp`) only once
`usePaletteStore`'s `open || helpOpen` is true — a reader who never presses Ctrl-K, the search button or
`?` downloads none of `cmdk`, Radix Dialog, or the six section modules' search machinery, the same
"laziness as a privacy/perf property" line ADR-011 draws for the AI layer. Inside that, `usePaletteData`
gates every dataset loader behind `open && query.trim().length > 0` — opening the palette and closing it
again without typing costs nothing, matching `useLawEngine(enabled)`'s own rule for `/law` itself. Every
loader is the module's OWN loader (`loadCorpus`, `loadPayTables`, `loadGlossary`, …), each already
memoised at module scope; the three that need an INDEX built over them (the law Fuse index, the job-post
index, the glossary Fuse index) cache that build a second time at `usePaletteData`'s own module scope,
because the palette mounts and unmounts on every open/close and rebuilding a Fuse index over 1,891
glossary terms on every keystroke-triggered mount would be real, measurable cost.

**4. A law hit's share link names the Act, not just the number — bare section-number reuse is real and
ambiguous.** The first cut built `toLawHref({ query: doc.section, code })` — `/law?q=101&code=bns` for
BNS 101, "Murder". That looks right and is wrong: BNS 101 shares its bare number with IPC 101 ("When such
right extends to causing any harm other than death"), and the Law Converter's own default search
direction (old→new) re-parses a bare `"101"` as "the OLD Act's section 101" first, landing the reader on
an unrelated repealed-Act provision instead of the BNS section they picked. Caught only by driving the
built app end to end (`searchLaw(engine, {query:'hatya', ...})`, clicking the actual top hit, reading what
`/law?q=101&code=bns` rendered) — no unit test exercises this because none combines "a real ambiguous
number" with "a hand-built href" the way this module's hits do a hundred times over. The fix is the query
itself: `toLawHref({ query: \`${actOf(code)} ${section}\`, code })`—`"BNS 101"`— because naming the Act
is the one signal`directionContradicted()`in`src/modules/law/search.ts`already treats as strong enough
to rule out the old-Act reading entirely.`src/components/palette/sections.ts#lawItems` carries the note
in place so the next person does not "simplify" it back to the bare number.

**5. The global shortcuts' listener is attached once, for the component's whole lifetime, reading
everything through a ref — not re-subscribed on every `navigate` identity change.** The first cut's
`useGlobalShortcuts` effect depended on `[navigate, openPalette, closePalette, openHelp]`, the ordinary
`react-hooks/exhaustive-deps` shape. In a real browser it dropped roughly one chord in five, always the
SECOND half of a `g` + letter pair pressed right after a route change: React Router hands out a fresh
`navigate` identity on some transitions, the effect re-ran (tearing down and rebuilding the `keydown`
listener) BETWEEN the `g` press and the letter that completes the chord, and the freshly re-created
closure's `pendingG` started back at `false` — so the letter landed as an ordinary keypress. `pendingG` and
its timeout live in a closure that has to survive for exactly as long as `App` does, which is the
component's whole lifetime, not one render's worth. The fix: a `useRef` holding `{ navigate, open,
openPalette, closePalette, openHelp }`, updated by its own separate effect; the listener-attaching effect
runs with an EMPTY dependency array and reads everything through the ref inside the handler. Confirmed
against the failure first — six back-to-back Playwright runs of the five-chord sequence, ~1-in-5 failure
rate before the fix, 0-in-16 after (single runs and `--repeat-each` both).

**6. `Command.Loading`'s `role="progressbar"` lives outside `Command.List`'s `role="listbox"`, not inside
it.** The first cut put the "still searching" indicator as the last child of `<Command.List>`, alongside
the result groups — a reasonable-looking layout choice that intermittently failed axe's
`aria-required-children` in a real browser (roughly 4 runs in 5, only ever on the "with results" half of
the check, never the empty one), because a `role="listbox"` briefly carrying only the progressbar as its
sole real child — the state every non-empty query passes through before ANY of the six datasets has
settled — has no valid owned element for the check to find. Manually replaying the exact same steps
outside the Playwright test runner never reproduced it, even with matched timing and parallelism; only
`pnpm exec playwright test ... --repeat-each=10` against the real suite did, consistently, at the same
element id. Moved `Command.Loading` to a sibling of `<Command.List>` instead — cmdk's `useCommandState`
reads from `Command`'s own context regardless of where in the tree a consumer sits, so nothing about its
behaviour changed, only its ARIA neighbourhood. 10/10 clean afterward, at the same `--repeat-each=10`.

**7. Two existing informal deep-link shapes are formalised rather than duplicated.** `/utils/glossary?term=
<id>` (`src/modules/utils/glossary/url.ts`) and `/learn/review?act=<id>` (`src/modules/trainer/url.ts`,
already read by `ReviewPage.tsx`'s `useSearchParams` and linked by `HomePage.tsx`'s weak-area chips before
this session, just never through a shared helper) are what the palette's own results and each module's new
"Copy link"/"Share" button both build through — one function per shape, so the reader-facing route and the
one the palette navigates to cannot drift apart. Both follow `SectionActions.tsx`'s established share
pattern: `navigator.share` first, the clipboard otherwise, an `AbortError` from a dismissed OS share sheet
swallowed rather than falling through.

**8. `commandRecents` is Dexie version 10, the same shape every other module's recents table already
uses.** Keyed on the item's own id (`put` overwrites rather than accumulates), capped at 8, and populated
only for items that actually navigate — a settings action like "toggle theme" is never recorded, the same
line `LawRecentRow`/`GlossaryRecentRow` draw between "a place to jump back to" and "a log of every
keystroke".

### Consequences

- `pnpm typecheck`, `pnpm lint` and `pnpm i18n:check` are clean. `pnpm test` is clean except the two
  pre-existing, unrelated items already on `main` before this session started: `tests/bundle-budget.test.ts`
  (`docs/DATA-GAPS.md` #55, now measuring a larger figure again because Session 14's onboarding/Settings
  content landed in the same eagerly-loaded bundle) and `tests/rules-data.test.ts`'s near-identical-fronts
  check, which times out only under the CPU contention of a full concurrent-session run and passes clean in
  isolation every time it was tried.
- `tests/e2e/palette.spec.ts` (ten specs: five search queries across all four acceptance-test terms —
  "hatya", "ACIO", "avar sachiv", "OM" — plus every shortcut) and `tests/e2e/a11y.spec.ts`'s two new runs
  (the palette empty and with results, the shortcuts sheet) are the browser-level proof; `src/components/
palette/{sections,recents}.test.ts` cover the hand-rolled Document-type/Trainer-topic/Portal matchers and
  the recents table's own trim-to-8 behaviour at the unit level, since Law/Pay/Glossary already have that
  coverage through the engines they reuse.
- `PaletteRoot` is its own ~18 KB gzip chunk (confirmed via `dist/assets/PaletteRoot-*.js` and absent from
  `index.html`'s own script/preload tags), so none of this session's own code contributes to the initial
  route's bundle-budget overage — the whole regression is Session 14's, and it is Session 14's ADR-028 that
  says so.
- `cmdk` embeds no fetchable URL of its own, but the `@radix-ui/react-dialog` it wraps carries a dev-mode
  warning link (`https://radix-ui.com/primitives/docs/components/${slug}`) into the bundle regardless of
  build mode — a new `ALLOWED_INERT` entry in `tests/no-external-urls.test.ts`, the same "template literal
  captured post-minification" shape the file's existing zod-IPv6-validator entry already documents.
- "Deferred: cmdk" in CLAUDE.md's stack table is gone — it is finally in a chunk, the one this session
  built.

### Addendum — edge-case pass (same session, on request)

A deliberate hunt across the whole surface — the palette's data flow, the share links, the global
shortcuts — after the feature was already committed and working. Six defects, each confirmed against a
real browser before the fix (a manual repro for the four in-app-navigation and keyboard ones; running the
actual failing sequence, not reasoning about it) and each now fixed:

- **Re-selecting an item FROM the "Recent" group did nothing — it never moved back to the top.**
  `CommandPalette.tsx#go` only calls `recordCommandRecent` when the selected item's own `recordRecent` is
  truthy, and `listCommandRecents()`'s mapped rows never set it — so clicking an already-"Recent" row was a
  silent no-op instead of the "re-recording moves it to the top" behaviour `recents.test.ts` already
  asserted for the underlying table function. Fixed by setting `recordRecent: true` on every row
  `listCommandRecents()` returns. A second, related defect rode along: the click handler passed the literal
  string `'recent'` as the section to re-record under, which would have overwritten the item's REAL section
  (`'law'`, `'glossary'`, …) the next time it displayed — fixed by passing `item.hint` (the original section,
  which `listCommandRecents()` already carries there) instead.

- **A share link picked a SECOND time while already on its destination page silently did nothing.**
  `/utils/glossary?term=<id>` and `/utils/portals?q=<name>` each guarded their one-shot apply with either a
  boolean ref (glossary) or a `useState` lazy initialiser with no follow-up effect (portals) — correct for
  the first load of the route, wrong for every navigation after that, because neither route remounts when
  only its own search params change (same route element throughout). Picking a DIFFERENT glossary term or
  portal from the palette while already on `/utils/glossary` or `/utils/portals` updated the URL and did
  nothing else. Confirmed with the palette itself, not a synthetic `goto`: a fresh `page.goto()` always
  reproduces a working first load regardless of the bug, so proving it needed an in-app navigation from an
  already-mounted instance. Fixed by keying the guard on the PARAM'S OWN VALUE (glossary: a
  `lastTermId` ref; portals: a `lastQ` ref plus an effect) rather than "has this ever fired", so a later,
  different value re-applies while the reader's own typing — which never changes `searchParams` — still
  cannot be clobbered by it.

- **`g` then a letter silently failed whenever CapsLock was on.** `event.key` reports the character actually
  produced, so CapsLock (like Shift) turns the physical `g` key into `"G"` — and the code that starts a
  pending chord compared against the literal lower-case `'g'`, while the code that RESOLVES a chord already
  lower-cased before the fix. One `.toLowerCase()` at the top of the handler, used everywhere a letter is
  compared, fixed both the start and the resolve.

- **Ctrl+Shift+K (Firefox's "Web Console", among others) also toggled the palette.** The check only asked
  whether Ctrl or Cmd was held, not whether anything ELSE was — added `!event.shiftKey && !event.altKey`.

- **`g p`, pressed while the shortcuts-help sheet was open, navigated to `/pay` and left the sheet open over
  the new page.** Every shortcut's typing-guard checks the FOCUSED element, and the sheet's own close button
  is a `<button>`, not a text field, so nothing stopped the chord from firing underneath it. The general
  form of the bug: nothing in `useGlobalShortcuts` knew whether a dialog OTHER than the palette itself —
  the shortcuts sheet, the AI consent modal, a Drafting Studio `Sheet` — already had the reader's attention.
  Fixed with one check, `foreignDialogOpen = !latest.current.open && document.querySelector('[role="dialog"]')
!== null` (the palette's OWN open state is already known from the store and does not need a DOM query;
  anything the query still finds belongs to someone else) — gating every shortcut, Ctrl+K included.

- **Ctrl+K, pressed while the AI consent modal was open, stacked the palette on top of it — and the
  interaction that surfaced was worse than the stacking itself.** Radix Dialog supports nested dialogs
  correctly on its own (the AI consent modal stayed in the DOM, correctly `aria-hidden` by the palette's own
  Portal, and reappeared once the palette closed) — the actual defect was Escape: `AiConsentModal.tsx`'s own
  hand-rolled `document`-level Escape handler has no idea a second dialog is now on top of it, so a single
  Escape press closed BOTH at once, losing the reader's place in the middle of turning AI on. The same
  `foreignDialogOpen` guard above fixes this by construction — Ctrl+K is now a no-op while a foreign dialog
  is open, so the two are never stacked to begin with, which is the fix that stays inside this session's own
  files rather than teaching `AiConsentModal.tsx` (a different session's surface, predating this one) about
  a stacking scenario only this feature can create.

None of the six needed a new dataset, a new table, or a new i18n key — `src/components/palette/
recents.test.ts` gained one regression test for the first; the other five are keyboard/navigation
interactions best proven in a real browser and were, but are not (yet) captured as permanent Playwright
specs — `tests/e2e/palette.spec.ts` is a different session's surface as of this session's own commit
(ADR-031/032-adjacent test-hardening work), and duplicating a spec file mid-restructure would have collided
with it rather than helped.

---

## ADR-030 — Shipping it: a Content-Security-Policy the app is tested under, a size budget with one number and two enforcers, an app shell in the HTML, and a Lighthouse target that measurement did not reach

**Date:** 2026-08-29 · **Status:** Accepted

### Context

The session brief: route-level code splitting with an initial-JS budget of 250 KB gzip enforced in CI;
a Cloudflare Pages `_headers` file with a strict CSP and the usual security headers, verified in a real
browser; an SPA `_redirects` fallback; a dependency audit and a Dependabot config; a deploy workflow;
bilingual SEO and social tags with a self-hosted `og.png`; a README; and Lighthouse mobile ≥ 95 on
Performance, Accessibility, Best Practices and SEO across `/`, `/law`, `/pay`, `/draft`, `/learn` and
`/utils`.

It ran concurrently with two other sessions in the same working tree — legalhelp-52 (test hardening; it
owns `.github/workflows/ci.yml` and `playwright.config.ts` from partway through this session, and it
authored ADR-031's i18n split) and legalhelp-78 (an edge-case pass over the command palette). All three
coordinated by direct message rather than by reading each other's diffs, the arrangement Sessions 12/13
and 14 established.

Eleven things needed a decision rather than a routine build. Nine of them were settled by measurement, and
two of those measurements said "no".

### Decision

**1. The app was not renamed, because no name was given.** The brief opens "The final app name is
`<APP_NAME>`" — the literal placeholder from the master context — and then makes the rename conditional:
"if I gave a new name now". None was given, so `<APP_NAME>` still resolves to what it has always resolved
to, and Sahayak / सरकारी सहायक stands as the final name across `package.json`, `index.html`, the web
manifest, the i18n catalogues, the README and this file. Nothing was renamed. The rename is a mechanical
change whenever a name arrives — the string appears in seven files and the icons carry no text, exactly as
the brief anticipated — and it is not a change worth guessing at, because a half-applied product name is
worse than an unapplied one.

**2. The size budget is one number in one file, enforced twice.** `scripts/size-budget.json` holds it;
`scripts/size-check.mjs` gates CI on it and prints a per-asset table so a failing pull request says _which_
asset grew; `tests/bundle-budget.test.ts` reads the same file. That replaces the fixed `BASELINE_GZIP =
146_038` + 30 KB rule from ADR-011, which had been red for three sessions (`docs/DATA-GAPS.md` #55) with no
route back to green: every session's i18n keys landed in one eagerly-loaded bundle, so the budget moved
further out of reach with each one, and CLAUDE.md's own note forbade silencing it without an ADR. This is
that ADR. Two things had to be true before re-baselining was honest rather than convenient: the underlying
mechanism had to be fixed, which ADR-031 did by splitting the catalogues per language so i18n growth no
longer touches the initial route at all; and the new number had to come from outside this session's own
judgement, which it does — 250 KB gzip is the brief's figure. The build measures **137.7 KB**, 55% of it.
The AI-layer assertions in that test file are untouched: they are a privacy property, not a size one, and
no budget re-baselining may weaken them.

**3. `style-src` keeps `'unsafe-inline'`, and `style-src-attr` is `'none'`.** The brief asked for
`'unsafe-inline'` to be dropped "only if shadcn needs it; try to remove". It was tried, and it breaks the
command palette: Radix Dialog's scroll lock (`react-remove-scroll`'s style singleton) injects a `<style>`
element whose content embeds the measured scrollbar width, so its hash differs per device and no
`'sha256-…'` can cover it. Rather than accept a blanket relaxation, the policy splits the directive: style
_elements_ may be inline, style _attributes_ may not (`style-src-attr 'none'`). Nothing in the app needs
the attribute form — React writes styles through CSSOM, which CSP does not govern — so this keeps the half
of `'unsafe-inline'` that actually matters for injected markup. Both halves are asserted in
`tests/e2e/csp.spec.ts`.

**4. `script-src` has no `'unsafe-eval'`, and the one violation the browser reports is allowlisted rather
than accommodated.** zod 4 decides at import time whether it may JIT-compile validators by evaluating
`Function("")` inside a try/catch. Under `script-src 'self'` the browser refuses, zod catches it and takes
its interpreted path, and every schema in the app keeps working — but the refusal is still _reported_,
because a capability probe cannot ask the question without asking it. Adding `'unsafe-eval'` to silence one
caught feature detect would hand real script injection a way in for nothing. `tests/e2e/csp.spec.ts`
allowlists exactly that shape (script-src, blocked `eval`, from a built chunk) and has a separate case
asserting nothing else is ever refused across every route. It costs 4 points of Lighthouse Best Practices
on the two routes that load zod's schemas chunk (96 rather than 100), which is above the 95 floor.

**5. `connect-src` is `'self'`, which will block Tier 1 BYOK the day it ships.** The brief specifies it and
it is right for what is deployed: the AI layer is dormant, nothing in the app may reach a network, and a
CSP that says so is defence in depth behind the consent gate rather than a duplicate of it. But it is a
real, deliberate incompatibility with a feature that is already built: `src/ai/providers/wire.ts` calls
`api.anthropic.com` directly from the browser, and under this policy that call is refused. The day Tier 0/1/2
actually ship (Session 24), `connect-src` needs `https://api.anthropic.com` — a one-line change in
`public/_headers`, recorded in `docs/DATA-GAPS.md` #57 so it is found by the person who needs it rather than
debugged. It is not added pre-emptively: a policy that permits a connection the app never makes is a policy
that has stopped describing the app.

**6. `tests/e2e/csp.spec.ts` parses `public/_headers` rather than restating it.** `vite preview` does not
read Cloudflare's `_headers` format, so the spec reads that file itself and replays the `/*` block onto the
document response through `page.route`. There is no `<meta http-equiv>` copy of the policy to drift from the
header, and a policy edit is exercised on the next run. It fails on two independent signals, because CSP is
quiet by default: the `securitypolicyviolation` event (what the browser refused) and console errors (what
broke as a result) — the brief's own "console errors = failure".

That second signal immediately found a real, pre-existing defect that had nothing to do with CSP: the
command palette's `Command.Dialog` had no `Dialog.Title`, so Radix logged an error in **every** build, not
just development, and a screen reader got the dialog's label with no heading to navigate to. Fixed with a
visually-hidden `Dialog.Title` (coordinated with legalhelp-78, who owns that file).

**7. `index.html` ships the app shell as markup, and it is worth ~2 seconds.** `#root` was empty, so nothing
at all was painted until the entry chunk had downloaded, parsed, executed and resolved the active language's
i18n chunk: First Contentful Paint measured **2.6 s** on Lighthouse's mobile profile, for a header that is a
coloured bar and eleven characters. The shell is now static markup inside `#root` — the same classes
`src/app/TopBar.tsx` uses, at the same `h-14` height, the same border and the same background — which paints
from the document and the stylesheet alone. It is replaced, not hydrated: `createRoot().render()` clears
`#root`'s children. Measured after: **FCP 0.9–1.3 s, Speed Index ~1.2 s, CLS still 0** on every route. The
wordmark is the bilingual one from `<title>` rather than a translated string, because this markup is built
once and cannot know the reader's language, and "Sahayak · सरकारी सहायक" is correct in both.

**8. One variable Devanagari face instead of four static ones, and the rupee sign comes from it.** Two
measured font findings, both invisible without a real waterfall:

- The four static Noto Sans Devanagari weights were ~52 KB each, and the browser fetched every weight a page
  used — three of them (400, 500, 600) on an English `/law`, all four on a Hindi one. The variable
  `devanagari` subset is 121 KB and covers 100–900 in one request.

  **This is a trade, not a pure saving, and an edge-case pass after the fact is what established that** —
  the first version of this ADR claimed "a saving on every route", which the per-route measurement
  disproves. Total font transfer, measured:

  | Route                                | four static weights | one variable file |
  | ------------------------------------ | ------------------: | ----------------: |
  | English `/draft`, `/learn`, `/utils` |              111 KB |            180 KB |
  | English `/`, `/pay`                  |              162 KB |            180 KB |
  | English `/law`                       |              216 KB |            180 KB |
  | Hindi, heading-rich page             |              270 KB |            180 KB |

  The static set charges by how many weights a page happens to use: cheapest for an English page showing
  two Devanagari characters in the language toggle, dearest for a Hindi page, which needs all four. The
  variable file charges 121 KB either way. It is kept because equal bilingual footing is a hard rule here —
  a font strategy whose cost is lowest for English readers and highest for Hindi ones is the wrong shape
  for this project, and capping the worst case is worth more than shaving the best one. It is also one
  request rather than up to four, and it makes `.font-display`'s weight 800 an actual 800 rather than the
  700 the static set rounded down to. Dropping two static weights (400 + 600 only) measures better than
  both and was rejected for the same reason: Hindi bold would render at 600 while English bold stays at
  700, a visible asymmetry between the two languages.

- U+20B9 (₹) sits in **Inter's `latin-ext` subset, which is 85 KB** — the largest font file this app can
  request, downloaded in full so `/pay` can draw one glyph. Noto Sans Devanagari's own `devanagari` subset
  covers U+20B9 and U+20A8, and on those pages it is already being fetched for the bilingual chrome. A
  one-glyph `@font-face` (`'Rupee Devanagari'`, `unicode-range: U+20A8, U+20B9`) named ahead of Inter in
  `--font-sans` is what makes the browser pick it — font matching is per-character, and the first family
  whose `unicode-range` covers the character wins. Same file as the `@import`, so it dedupes to one request.
  `/pay` stopped requesting `inter-latin-ext` entirely: 85 KB off the critical path, LCP 4.6 s → 4.1 s.

Exactly two faces are preloaded — Inter's Latin variable and Poppins 600 — and no Devanagari one, because
this build cannot know the reader's language and preloading 121 KB of Devanagari for an English reader
would cost more than the round trip it saves. Preloading nothing was measured too, and was worse
(`/law` 86 → 84).

**9. Per-route preload hints are page chunks only, and the full graph was measured and rejected — twice.**
Every module is lazy twice (`/law` loads LawPage, which loads ConverterPage), which on a throttled
connection is three sequential round trips before anything meaningful renders. Cloudflare Pages honours a
per-path `Link:` response header, so `vite.config.ts`'s `routePreloadHeaders()` emits one block per route
with the chunks that route is certain to need. Preloading each page chunk's full transitive static import
graph — two dozen hints for `/law` — was measured **twice**, once before the app shell landed and once
after, and was worse both times (`/law` 90 → 87, `/pay` 86 → 83): the small preloads compete with the
stylesheet and the entry chunk for the same throttled bandwidth and buy about 0.1 s of LCP for 0.7 s of
FCP. Two hints per route is the whole win, and `tests/seo.test.ts` asserts every emitted hint points at a
chunk that actually exists — a hint naming a previous build's hash would be a silent pessimisation, since
the app still works.

**10. Lighthouse is measured against `scripts/serve-dist.mjs`, not `vite preview`.** `vite preview` applies
neither `_headers` nor `_redirects`, so a run against it measures a site with no CSP, no cache policy and
none of the preload hints. The new server applies both, and compresses — which is not a detail: Cloudflare
gzips and brotlis every text response, and a first run of this server without compression scored FCP 4.9 s
against `vite preview`'s 2.1 s, which was **entirely** the missing `Content-Encoding` and would have sent
this session chasing a regression that did not exist. `scripts/lighthouse.mjs` serves a _copy_ of `dist/`
for the same class of reason: a full run is seven routes and several minutes, and a concurrent session's
`pnpm build` replaced `dist/` mid-run, which first showed up as `/law` scoring SEO 92 because `index.html`
did not exist for a moment.

**11. `cloudflare/wrangler-action`, not `cloudflare/pages-action`.** The brief named the latter; it is
archived and still declares the `node16` runtime, which GitHub Actions no longer provides, so it fails on
current runners. `wrangler pages deploy` is Cloudflare's supported replacement and takes the same three
secrets. The workflow triggers on `workflow_run` rather than `push`, because "after CI passes" is not
expressible from a push trigger — and it gates on three things, not one: that CI's conclusion was
`success`, that the head repository is this repository (a `workflow_run` job has secrets, so deploying a
fork's code from it would hand the Pages token to anyone who can open a pull request), and the branch,
which decides production from preview.

### Consequences

- **The Lighthouse mobile Performance target was not met, and no amount of tuning available to this session
  reaches it.** Measured on the seven routes, mobile: Performance **85–93**, Accessibility **100**, Best
  Practices **96–100**, SEO **100**. Desktop: Performance **98–100**, the rest the same. Every report is
  committed under `docs/lighthouse/`. Performance rose from a starting 72–92 through this session's work,
  and the remaining gap is one metric: Largest Contentful Paint, 3.2–4.1 s where ≥ 95 needs about 2.5 s.
  It is **89% "render delay"** rather than network — the LCP element is text that does not exist until the
  entry chunk, the module chunk, the view chunk and that view's data have each been fetched and executed in
  sequence. The app shell fixed First Contentful Paint because a paint can come from HTML; it cannot fix LCP,
  because LCP updates to whatever larger element appears later. Closing it needs the route's _content_ in the
  served HTML — prerendering or server rendering — which is an architectural change, needs its own ADR, and
  interacts with the offline-first, data-in-lazy-chunks design that ADR-013 and ADR-018 chose deliberately.
  `docs/DATA-GAPS.md` #58 records the measurement, the reason and the two real options. The three targets
  that were reachable are met with room to spare.
- `public/_headers` is new and is the one copy of the security policy. `dist/_headers` is that file plus a
  generated per-route preload block; `routePreloadHeaders()` appends and never replaces, and
  `tests/seo.test.ts` asserts the security block survived.
- `robots.txt` and `sitemap.xml` are **emitted at build time**, not committed, because both must carry the
  absolute origin and a committed copy goes stale the day the site moves. The sitemap is checked against
  `src/lib/nav.ts` by `tests/seo.test.ts` — `vite.config.ts` cannot import that file (it pulls
  `lucide-react`, and the config runs in Node), so the route list exists twice, and that test is what stops
  the two drifting in either direction.
- `tests/no-external-urls.test.ts` gained the site's own origin, read out of `vite.config.ts` rather than
  written down again, paired — as the file's convention requires — with an assertion that no module under
  `src/` names that host. An absolute URL on the build's own origin is also now treated as same-origin by
  `isSameOrigin`, because that is what the word means: `<link rel="canonical">` has to be absolute and no
  browser fetches it.
- `og.png` is generated from the app icon by `pnpm icons:generate` and committed, like the icons and the
  font licences. It is hand-run and on no CI step for a reason worth stating: the Devanagari line is real
  text rendered by librsvg, so a CI box with no Devanagari font would regenerate the card silently full of
  tofu boxes.
- The web manifest's `theme_color` and `background_color` were `#F7F1E3` — a cream taken from the icon
  artwork, not from the palette — while `index.html` said `#F7F9FC`. An installed app painted its splash
  screen in one colour and its first frame in another, a visible flash on every cold start. Both are now
  `--background`, and `tests/seo.test.ts` asserts the three agree.
- `date-fns` is removed. It was in `package.json`, in the master context's stack list and imported by
  nothing: every date calculation in this app goes through `src/lib/istDay.ts` or `src/lib/srs/day.ts`,
  whose fixed +05:30 reasoning ADR-026 chose deliberately over a library. `pnpm audit` reports no known
  vulnerability in either the production or the full tree, and `pnpm dedupe --check` is clean.
- Dependabot is grouped, weekly, over npm, GitHub Actions and pip. Grouped deliberately: every dependency
  here is pinned to an exact version, so an ungrouped config opens one pull request per package and buries
  the two that matter under thirty that do not. The framework trio is its own group because a major there
  is an ADR, not a merge.
- `rollup-plugin-visualizer` is behind `ANALYZE=1` (`pnpm analyze`) and its ~1.2 MB report is excluded from
  the service worker's precache, because a build that happened to have the flag set would otherwise ship
  the treemap to every reader.
- New scripts, all hand-run except `pnpm size`: `pnpm size`, `pnpm analyze`, `pnpm serve:dist`,
  `pnpm lighthouse`.

### Addendum — the edge-case pass

Run over this session's own changes after the fact. Six defects, one of them in this ADR's own text, and
two things confirmed rather than assumed.

**1. The claim in point 8 was wrong, and the measurement is above.** "A saving on every route" was written
from the routes that improved. Per-route measurement shows the variable Devanagari face is a 69 KB
_regression_ on an English `/draft`, `/learn` and `/utils`, and an 18 KB one on `/` and `/pay`. It is kept —
the reasoning in point 8 stands on the Hindi case and on equal footing — but as a trade with a table, not
as a win. **The rupee `@font-face` is the part of that change that was an unambiguous saving**, and the two
were landed together, which is how one carried the other past review.

**2. `og.png` was being precached onto every device that installs the app.** 47 KB of social card, in
`globPatterns`' `png` glob, for an image referenced only from a `<meta>` tag and never rendered by the
app — a crawler fetches it, a reader never does. Now in `globIgnores` beside `stats.html`. The launcher
icons stay precached; those are the installed app's own artwork.

**3. The app shell made a JavaScript-off browser look like a loading app rather than a broken one.** With
`#root` empty the page stayed blank, which is at least unambiguous. Painting a header and then nothing,
forever, reads as "still loading". A bilingual `<noscript>` now says so. Hardcoded for the same reason the
wordmark is: the i18n catalogues are not available without the scripting it is apologising for.

**4. The shell's hardcoded `सरकारी सहायक` sat in a `lang="en"` document with no `lang="hi"`**, so a screen
reader would read Devanagari with English pronunciation rules for the second before `src/main.tsx` sets the
detected language. The real `TopBar` needs no such attribute — its tagline comes from the catalogue for
whichever language is active, so it always matches the document. Only hardcoded markup has this problem.

**5. `tests/e2e/csp.spec.ts` was silently checking only the last page of any multi-navigation test.** The
init script set `window.__csp = []` at the top, and an init script re-runs on every navigation — so a test
that visited `/law` and then `/draft` before asserting had already thrown away `/law`'s violations. Not a
failure; a coverage hole, which is the kind that survives. Violations accumulate in `sessionStorage` now,
which crosses same-origin navigations.

**6. The values injected into the Open Graph meta tags were not HTML-escaped.** They come from the i18n
catalogues and land inside double-quoted attributes; none contains a quote today, and the day one does an
unescaped value would end the attribute early and produce malformed `<head>` markup that still renders.
Escaped at the point of injection, which is cheaper than a rule saying "never put an apostrophe in
`app.tagline`".

**Confirmed rather than assumed, both in a real browser under the real policy:**

- **All four blob downloads work under the CSP** — the holidays `.ics`, the drafting `.docx` (which is also
  a 340 KB dynamic import), the Settings backup `.json` and the Trainer's reports `.csv`. `default-src
'self'` lists no `blob:`, so this was worth checking rather than reasoning about; a policy that silently
  broke every export in the app would have been the worst outcome of this session.
- **`form-action 'none'` is safe because the app contains no `<form>` element at all.** Every input is a
  controlled component. Had one existed, an implicit submission — Enter in a single-field form — would have
  been blocked, and blocked navigations are quiet.

---

## ADR-031 — Testing as a set of gates: one language per boot, a privacy fixture nobody can forget, a phone in the matrix, and coverage only where a number can be wrong silently

**Status:** accepted · **Date:** 2026-08-29

### Context

The suite this session inherited was large and good — 1,795 unit tests and 82 Playwright specs — but
it had four holes that were structural rather than a matter of writing more tests.

1. **The privacy guarantee was opt-in.** The master context's hard rule is "zero network requests
   carrying user-entered data (enforced by a Playwright test)". Two specs enforced it, each by
   hand-rolling its own `page.on('request')` counter and its own `crossOrigin` array. Every other
   spec — including the ones that type the most identifying things this app receives — enforced
   nothing, and a new spec inherited nothing. A guarantee that each author has to remember to switch
   on is a guarantee that holds for exactly as long as everyone remembers.

2. **Everything ran at one viewport, in one language.** The shell swaps its entire navigation below
   1024px, the Drafting Studio becomes two tabs rather than two columns, and half the app's readers
   read Hindi. None of that was exercised.

3. **`tests/bundle-budget.test.ts` was red, and the mechanism kept it red.** `en.json` and `hi.json`
   were both static imports, so every reader downloaded ~40 KB gzip of translations of which they
   could read half — and every session that added an i18n key made it worse. `docs/DATA-GAPS.md` #55
   recorded this with two proposed fixes, neither of which any one session could take alone.

4. **Four unit files failed intermittently and passed in isolation**, which is the signature of a
   budget rather than a defect, and which nobody had named as such.

### Decision

**1. The privacy gate is an automatic fixture, and forgetting it is a red build.**
`tests/e2e/fixtures.ts` exports `test` and `expect`; every spec imports them from there instead of
from `@playwright/test`. The `network` fixture is declared `{ auto: true }`, so a spec is covered
without mentioning it, and at teardown it fails the test if any request crossed the origin **or** if
any request URL, query string or **body** contained a value the test typed.

Typed values are minted by `network.sentinel('label')` → `SNTNL-<label>-<n>`, rather than being
realistic input. That is deliberate: `"302"` and `"Delhi"` appear in chunk filenames and cached
dataset URLs by coincidence, and a privacy assertion that produces false positives gets weakened
until it produces false negatives instead. The listener sits on the browser **context**, not the
page, because a request made by the service worker or by a second page is exactly the one most
likely to escape a page-scoped listener.

The exception mechanism is a declaration rather than an omission: `tests/e2e/ai-byok.spec.ts` calls
`network.allowCrossOrigin(/api\.anthropic\.com/)` because Tier 1 _is_ that request. And
`tests/e2e-harness.test.ts` — a **unit** test, so it runs on every commit rather than only when a
browser is available — fails if any spec imports a value from `@playwright/test`, with exemptions
in an `UNGATED` map that must each carry a reason. `csp.spec.ts` is the only one, because it
manufactures request-level behaviour through `page.route` that the gate is written to treat as a
defect.

**2. One language reaches the browser at boot, not two — and that is what actually closed
DATA-GAPS #55.** `src/i18n/index.ts`'s two static imports became dynamic ones behind an i18next
`backend` plugin. Registering it as a backend rather than hand-rolling a
`load-then-changeLanguage` wrapper is what keeps the module's public surface identical for the 29
files that import it: `changeLanguage` still just works and awaits the chunk itself. Two callers
did change — `src/main.tsx` awaits a new exported `i18nReady` before `createRoot`, because with
`useSuspense: false` nothing holds the tree back and the shell would otherwise paint one frame of
raw translation keys; and `store.ts`'s `applyLanguage` now returns i18next's promise so
`setLanguage` resolves only once the language has actually been applied. `<html lang>` is still set
synchronously, because that is what assistive tech reads and it needs no strings.

Worth ~18 KB gzip for an English reader and ~22 KB for a Hindi one on every cold load, and — the
part that matters more — **adding an i18n key no longer grows the initial route at all**, which was
the mechanism behind the gap rather than a symptom of it. Both chunks are still precached by the
service worker, so toggling language offline is unchanged. Neither language is privileged: whichever
one is active is the one that loads.

**3. A phone is a project, not a `setViewportSize` call.** `playwright.config.ts` grew a
`mobile-chromium` project (Pixel 7, 412×915, touch) beside `desktop-chromium`, so the whole suite
runs twice. Three specs are in its `testIgnore` — `csp`, `pwa-install` and `typography` — each
device-independent and each waiting on the service worker with a 30-second ceiling, so a second run
doubles a long wait for no signal.

This is not a duplicate run for its own sake, and the first execution proved it: it found that the
Rules Trainer's mock test could not be completed on a phone at all, because the service worker's
"Ready to work offline." toast is a full-width bar at `bottom-[4.5rem]` that waits for an
acknowledgement and sits exactly on the "Next question" button, intercepting every click on it
(`docs/DATA-GAPS.md` #59). No desktop run could see it — `sm:right-4 sm:w-80` makes the same toast a
corner card.

**4. Coverage is thresholded on `src/lib/**` and nowhere else.** 90% of lines, functions and
statements, enforced in `vite.config.ts` rather than reported. `src/lib` is the pure layer and the
only part of this app where a number can be wrong without anyone noticing; everything else has a
suite that catches its own kind of defect. A global line-coverage target would push effort towards
rendering components in jsdom to raise a percentage rather than towards the browser runs that find
real problems. Branch coverage is reported and not thresholded, because what remains uncovered is
defensive — an unreachable `return null` after a Myers diff that always terminates earlier, a
`typeof caches === 'undefined'` arm only one environment can take, and the `never` arms of
exhaustive switches whose whole purpose is to fail a build rather than run.

The measured figure is 99.73% of lines. `docs/COVERAGE.md` is generated by
`scripts/coverage-summary.mjs`, committed, and diffed by CI — so the numbers in the repository are
always the ones the last green run measured. The badge is text: a shields.io image would be the one
outbound request this app does not make.

**5. Property-based tests where a range of inputs is the claim.** `fast-check`, two files. The
pay one asserts that rounding is monotonic, idempotent and half-up, and that over ~120 random
scenarios `computePay` never produces a negative, non-finite or fractional figure, its lines add up
to its own gross and net, more DA is never less pay, and `regime: 'auto'` never picks the dearer of
the two. The FSRS one asserts **grade monotonicity** — `Again ≤ Hard ≤ Good ≤ Easy` in interval and
stability, and the reverse in difficulty — over cards put through arbitrary review histories at any
retention setting. That last one is the reason this file exists: `src/lib/srs/engine.ts` is a
translation layer over `ts-fsrs`, and a swapped entry in `RATING`, a crossed field in
`toRow`/`toFsrsCard` or a lost `learningSteps` would break the ordering without breaking any single
golden interval. It found no defects, which is the honest outcome to report.

**6. Intermittent failures are budgets, and they are named as such.** Four unit files failed under
a full parallel run and passed every time in isolation. `waitFor`'s 1-second default and Vitest's
5-second default are races against CPU contention, not against the code under test, so
`asyncUtilTimeout` is 8s in `src/test/setup.ts` and `testTimeout`/`hookTimeout` are 30s in
`vite.config.ts`, each with the reasoning written in place. `tests/e2e/a11y.spec.ts`'s route sweep
gets an explicit 240s: it is ONE test that navigates 21 routes and runs a full axe pass on each,
~21s quiet, which is already at the default ceiling before any contention. Splitting it per route
would multiply `setChrome()`'s IndexedDB round trip by 21 to make one number smaller. Every
assertion is unchanged; only the patience is.

**7. CI is four jobs, so a failure names its own cause.** `unit` (lint, types, i18n parity, Vitest
with coverage thresholds, ~2 minutes), `data` (the Python parsers and every dataset schema, so a
parser regression is not hidden behind a TypeScript error), `build` (the three dist-only suites and
`pnpm size`, uploading `dist/` as an artefact), and `e2e` (a matrix over the two projects,
`fail-fast: false`, downloading that same `dist/`). Downloading rather than rebuilding is the point:
testing a separately-built artefact would be testing something other than what the previous job
verified. The browser binary is cached on the resolved `@playwright/test` version rather than on a
lockfile hash, so a lockfile change that does not move Playwright still hits the cache. Traces,
screenshots, video and the HTML report are uploaded on failure.

### Consequences

- `pnpm check` is clean. 1,925 unit tests across 97 files. `pnpm test:e2e` is 285 passed, 1 skipped
  across both projects — the skip is `law.spec.ts`'s scroll test, which drives both viewports itself
  and therefore runs once, on desktop, by an explicit `test.skip(onPhone(page))`.
- Three real defects were found and fixed, each by the layer added to find it: the "Upcoming"
  holiday strip was a sideways-scrolling region with nothing focusable in it, so a keyboard-only
  reader could never see past the viewport edge (WCAG 2.1.1, axe `scrollable-region-focusable`,
  invisible to jsdom because it has no layout); `/utils/portals` copied a URL and announced nothing,
  while every other copy affordance in the app writes into a live region; and the PWA toast defect
  above.
- `src/modules/utils/holidays/HolidaysPage.tsx` gained a local `ScrollStrip`. The
  `jsx-a11y/no-noninteractive-tabindex` disable lives there once, with the reason: the rule's
  premise — a tabindex on a non-interactive element is a mistake — is exactly what a scroll
  container has to do. Putting the `role` on the `<ul>` instead was tried and is worse; it takes the
  list's semantics away, orphans every `<li>`, and trades one serious violation for five.
- `utils.portals.copied` / `.copyFailed` are two new bilingual keys.
- `docs/TESTING.md` is the reference: how to run everything, what each suite guarantees, and the
  rules for adding a test here.

### ADR-031 addendum — what an edge-case pass found

Seven defects, in the order they were found. Each was confirmed to fail against the code before its
fix, which is the only thing that distinguishes a regression test from a test that happens to pass.
Two suspicions were investigated and cleared, and those are recorded too — a pass that only reports
hits is a pass whose negative results nobody can reuse.

**1. A language chunk that failed to load left the app unusable, permanently.** The worst of the
seven, and entirely created by this ADR. `i18next` does **not** reject when a backend read fails: it
resolves, sets `language` to the one it could not load, and — because `fallbackLng` is deliberately
`false` — `t()` then returns every key as its own name. `setLanguage` persisted that preference, so
a reload reproduced it, and the language toggle's own label was a raw key by then too: there was no
control left to escape with. Before the split this was impossible, because both catalogues were in
the entry chunk and an app that rendered at all had both. `hasResourceBundle` is the only thing in
the API that distinguishes "loaded" from "asked for and failed"; `store.ts#applyLanguage` now checks
it and refuses to switch, persist or move `<html lang>` for a language it could not load, and
`src/i18n/index.ts` falls through to the other language when the **boot** chunk fails. That last one
is not the silent English fallback `fallbackLng: false` exists to forbid — that rule is about a
missing key inside a catalogue that did load, which must stay a visible CI failure. This is a
delivery failure of the whole file, and a complete interface in the other language beats an unusable
one in the intended language.

**2. `scripts/coverage-summary.mjs` ordered its rows with `localeCompare`.** CI regenerates
`docs/COVERAGE.md` and fails on a diff, so row order has to be a property of the data rather than of
the runner — and ICU collation depends on the locale and on which ICU build was compiled in. Two
files on the same percentage could order one way on a laptop and the other on a runner, failing the
gate on a file nobody edited. Now a code-unit comparison, for the reason `compareStrings` in
`src/lib/srs/types.ts` already gives.

**3. The privacy gate could crash instead of reporting.** `decodeURIComponent` throws `URIError` on
a lone `%`, and a bare percent sign in a query string is ordinary input. A teardown that throws
reports nothing about any of the other requests in that test, which is the one failure a privacy
gate cannot afford. `surfaces()` and the origin check now degrade to the raw URL rather than
throwing.

**4. A sentinel could be lost to encoding.** `network.sentinel('om subject')` minted a value
containing a space, which percent-encoding rewrites — so the URL check could have missed the one
thing it exists to catch, silently. Labels are folded to `[A-Za-z0-9-]` now, so a minted value
survives any encoding unchanged. Worth noting how this was found: the test that supposedly proved
the decoding step passed whether or not decoding happened, because every sentinel it used was
already encoding-stable. A test that cannot fail is not evidence.

**5. `/utils/portals` announced a repeat copy to nobody.** That page has ONE live region shared by
every row, unlike `TermRow.tsx` where each row owns its own — so copying portal A and then portal B
wrote the same sentence to the same region twice, and a live region whose text does not change
announces nothing the second time. The inner span is keyed on a counter now, so each announcement is
a real DOM insertion. The regression test asserts **node identity**, not text: asserting the text
passes against the broken version, the same shape as the `elementFromPoint` hit-test in
`tests/e2e/pay.spec.ts` that CLAUDE.md already records.

**6. `/learn/review` was swept by neither sweep.** The Trainer's actual review card — a radiogroup
of options, four grade buttons, a report dialog, the most-used screen in the module — was in
neither `a11y.spec.ts`'s `ROUTES` nor `offline.spec.ts`'s `EVERY_ROUTE`; `/onboarding`,
`/learn/mock` and `/learn/review-queue` were missing from the offline one. Every route around them
was covered, which is exactly why nobody noticed. `docs/TESTING.md` told the next person to add new
routes to both arrays, and a convention with nothing enforcing it lasts until the session that is in
a hurry. `tests/route-coverage.test.ts` now derives the route set from the routers themselves and
fails on any route in neither sweep, with an `EXEMPT` map that must carry a reason. All five routes
passed once swept — the gap was in the coverage, not in the pages.

**7. The e2e harness guard could be defeated by whitespace.** `import{expect,test}from
'@playwright/test'` is valid TypeScript and the guard's regex required `\s+`. Prettier would never
produce it, but a guard whose whole purpose is to be un-bypassable must not depend on the formatter
having run.

### Two suspicions investigated and cleared

**`blob:` and `data:` URLs do not reach the gate.** The concern was that the four blob downloads
(`.ics`, `.docx`, the backup, the Trainer CSV) would be reported as cross-origin, since
`new URL('data:…').origin` is the string `"null"`. Driven in Chromium: neither a blob download nor a
`data:` image emits a `request` event at all, so the case is unreachable. The hardening in (3) stays
anyway, because it costs nothing and the gate must never be the thing that crashes — but it is
hardening, not a fix.

**`/draft/office-memorandum` does not rewrite its own URL on a bare visit.** The offline sweep
asserts the URL after a reload, and the editor writes a `?d=` draft id once a draft exists — so the
assertion looked like a latent flake. Measured: a bare visit leaves the URL clean, and the id
appears only after the form is touched. The assertion is correct as written.

### The gate is now provable without a browser

The four cases that matter were confirmed in Chromium first — a spec that fetched
`https://example.com`, one that put a sentinel in a query string, one that put it in a POST body,
and one that typed a sentinel and never sent it. `evaluateGate()` is that decision split out as a
pure function so all four run in `pnpm test`, on every commit, with no browser. The fourth is as
load-bearing as the other three: a gate that fires on clean input gets weakened until it stops
firing at all.

Two properties of the gate that only a browser can show were driven the same way and are recorded at
the listener in `tests/e2e/fixtures.ts` rather than left to reasoning: a request from a **second page**
in the same context is caught (which is what listening on the context rather than the page buys), and
a leak on the **first** of five navigations is still caught after the other four — the record lives in
a Node closure, so navigation cannot wipe it the way it wipes an `addInitScript` global.

---

## ADR-032 — The drafting agent: a policy with three code-owned stages, a refusal that runs before the provider exists, and a blank the checklist accepts

**Status:** accepted (Session 21)
**Supersedes:** ADR-021 point 3 (the AI seam's "Tier 0 first" condition), and amends its point 5.

### Context

The AI layer has been built and dormant since Session 3A: three tiers, a consent
gate, an encrypted key vault, a kill switch, a hand-written agent loop with a
step cap and a grounding rule, twenty-two registered tools — and no agent, and
no surface. Session 21 builds the first of each, in the Drafting Studio, which
is the module where a model has the most to offer and the most to break: a
document produced here is signed, sent, and filed.

Nothing about "call a model with the drafting tools" was in doubt. Six decisions
were, and each is one that would have been improvised badly under time pressure
in a session that treated this as plumbing.

### 1. The agent produces field values, not a document — and three of its five stages are code

A model asked to write an Office Memorandum writes something that looks like
one. What makes a document the _right_ document is not prose quality. It is that
the third-person rule holds, that the first paragraph is unnumbered and the rest
run 2, 3, 4 without a gap, that an enclosure mentioned in the body is listed at
the foot, that the subject line exists, and that no blank was filled in with a
plausible file number. Every one of those was already decided by
`data/drafting/templates/*.json` in Session 8 and is already evaluable by
`src/lib/drafting/checklist.ts` against the _rendered_ document.

So the agent's job is narrow. It returns **field values**; the engine lays them
out and marks them. `runDraftingAgent` is five stages and the model owns two:

| #   | Stage        | Whose | What                                                                   |
| --- | ------------ | ----- | ---------------------------------------------------------------------- |
| 1   | `screening`  | code  | `screenBrief()`, before any provider call                              |
| 2   | `planning`   | model | choose the form, explain it in a line, ask ≤3 questions, return values |
| 3   | `checking`   | code  | `render_draft`, then `check_draft` over what came back                 |
| 4   | `revising`   | model | one pass, given the failures and their `why`                           |
| 5   | `rechecking` | code  | stage 3 again                                                          |

**Stage 3 is the decision.** The brief said "call renderDraft then runChecklist;
if any item fails, revise once", and the obvious reading is to instruct the
model to do it — the tools are registered and it has them. That was rejected: a
model that reports its own checklist as passing is reporting an _intention_.
What the panel shows is an evaluation of the values actually being returned,
performed by this file, through the same registry the model uses, with the same
zod schemas applied. The model is still told to run `check_draft` (both the
persona and the revise turn say so), because a model that has seen its own
failures produces a better correction — but nothing it says about the result is
believed.

Two consequences worth stating because they were not free:

- **A revision is kept only if `mustFailing` did not get worse.** A model asked
  to fix three items and returning a draft that fails four has not improved
  anything, and taking it silently would hand the officer a worse document than
  the one it replaced with no way to tell. When a revision is refused, the
  reason is in `problems[]` and on screen. There is a test for the refusal, and
  it asserts that the returned checklist still reports the _first_ draft's
  failure honestly rather than the better one that never arrived.
- **One revision, ever, and `provider.turnsTaken` is asserted at 6.** `runAgent`
  has a step cap; this is the agent's own, and it exists because a loop that
  keeps buying another attempt is a loop for which nobody set a budget.

### 2. A blank is `____`, and it is `____` because of CSMOP's own checklist

The rule "never invent a file number, a date or a name — leave a placeholder"
collides with a rule this app already had. `checklist.ts`'s `noPlaceholders`
kind matches `/\{\{[a-zA-Z]/` and is a `must` on ten of the fourteen forms: a
`{{fileNumber}}` in the body **fails the document**. A model told to leave brace
placeholders and then shown a failing checklist has one obvious way to make the
checklist pass, and it is to invent a file number.

So the blank is four underscores. `BLANK`, exported from the agent, matched by
`/_{3,}/`, reported per field in `blanks[]`, and named in the panel with the
field labels so the officer knows what to fill. It satisfies `allRequired` (the
value is non-empty), it survives `noPlaceholders`, and it reads on paper as what
it is. `prompts/drafting.md` says all of this to the model in both languages,
including _why_ — a rule with its reason attached is followed further from its
examples than one without.

### 3. The refusal screen is code, runs first, and is biased the opposite way to `heuristics.ts`

`screenBrief()` is pure, unit-tested and called before the provider is touched.
A brief naming a classification marking or departmental record material returns
a refusal and **no request is made** — asserted by counting `MockProvider.calls`,
in the agent test and again in the panel test, because "we told the model to
refuse" and "nothing was sent" are different claims and only the second is worth
anything.

The bias is deliberately inverted relative to `src/ai/heuristics.ts`, and the
inversion is the point. There, a false positive costs a cache hit, so
`isPersonalQuery` is written loosely on purpose. Here a false negative sends an
officer's classified brief to a model endpoint, so a brief that merely
_mentions_ a marking is refused — "draft a note about the confidential report
procedure" is an innocent sentence and is refused anyway. What makes that
tolerable rather than obstructive is that the refusal says which word matched
and offers the same document from a brief without it.

`\bsecret\b` is word-bounded, and that is not incidental: "Secretary" and
"Secretariat" appear in almost every document this app drafts, and a screen that
refused them would be a screen someone disabled within a week. There is a test
for exactly that sentence.

The model is told the same rule in the persona. The code is what makes it true.

### 4. ADR-021's "Tier 0 first" is superseded, and what replaces it is narrower rather than weaker

`src/modules/drafting/ai-seam.ts` was written in Session 8 with
`DRAFTING_AI_ENABLED = false` and five conditions. Point 3 said a drafting
suggestion would be **Tier 0 (on-device WebLLM) first**, because a draft is the
most sensitive thing this app holds and the default assistant should be one that
cannot make a request.

Tier 0 does not exist in this build. `LocalProvider` is a stub that throws
`not_installed`, and Session 24 owns it (`docs/DATA-GAPS.md` #13-#15). Honouring
point 3 literally would have meant shipping no drafting assistant at all — which
is a legitimate answer, and it is not the one this session's brief asked for. So
the condition is superseded, explicitly, in an ADR, rather than quietly
satisfied by a redefinition.

What stands in its place is three controls that are each narrower than "use a
local model", and together are what the reader is actually owed:

1. **The deterministic refusal screen above**, which runs on the officer's own
   words before anything is constructed.
2. **A per-draft acknowledgement**, which is amended point 5 — see below.
3. **No tool in this app can reach the `drafts` table**, unchanged since Session
   8 and asserted by `src/ai/tools/drafting.test.ts`. The agent is handed the
   values it works on as an argument from what is on screen, and
   `improveWording` sends exactly one field's text — the text the diff will
   show. Adding a `list_my_drafts` tool would convert every agent in the app
   into one that reads an officer's unfinished work, and it still cannot be
   done without a review noticing.

The other four of Session 8's conditions hold unchanged, and the seam file now
records where each one stands rather than describing a feature that no longer
does not exist. `DRAFTING_AI_ENABLED` stays a literal wired to no flag and no
setting, and `EditorPage` asks `draftingAiAvailable(ai.enabled)` — so the lever
is real rather than decorative.

### 5. The acknowledgement is an inline gate, not a modal (amending ADR-021 point 5)

Point 5 called for a modal before the first use, per draft. It is an inline gate
inside the panel instead, and the panel's `key` is the draft id so switching
drafts asks again.

A modal over the editor is dismissible with Escape, and a dialog an officer
meets every time they open a panel is a dialog they learn to dismiss without
reading — which is the failure mode the whole control exists to avoid. The gate
as built cannot be dismissed at all: the brief textarea, the rewrite controls
and the "Explain" buttons **do not exist in the DOM** until it is pressed, which
is a stronger statement than "a dialog was shown". `AiDraftPanel.test.tsx`
asserts the absence, including for the Explain button, whose run also sends the
draft's values.

`<AiBanner/>` is still permanent above it. The two say different things and both
are needed: the banner says what leaves the device, always; the gate is an
assertion the officer makes about _this document_.

### 6. `SuggestionDiff` now diffs exactly, and that was a real defect

`diffWords` folds case and punctuation before comparing, and re-attaches the
**before** token on an `equal` run. That is right for the Law Converter — a
danda is not what a Sanhita changed, and Session 4 added the fold precisely
because every Hindi heading pair was otherwise reported as changed.

It is wrong for a diff the reader _accepts_. A rewrite whose only change to a
word was a capital letter, or the full stop the sentence was missing, rendered
as "No change is suggested"; and where such a word sat inside a larger change,
pressing Apply produced the officer's original casing while telling them they
had taken the suggestion. Found by a test asserting the applied subject line and
getting `Grant of Children Education allowance` back from a suggestion that said
`Allowance`.

`diffWords` takes `{ exact?: boolean }` now, defaulting to today's behaviour, and
`SuggestionDiff` passes `exact: true` **unconditionally** rather than exposing a
prop. Nothing else renders that component, and the invariant it needs — _what
you accept is what you get_ — is not something a caller should be able to switch
off. `src/lib/diff.test.ts` pins both behaviours, and `docs/COVERAGE.md` was
regenerated with the change.

### 7. Smaller decisions, recorded because each was a fork

- **The interview is one pass, not two.** The model returns questions and
  partial values together; the agent returns `status: 'questions'` only when the
  officer has not answered anything yet. A second round would be an
  interrogation, and the brief's cap of three is a cap on the exchange rather
  than on each turn of it. The cap is enforced in code (`MAX_QUESTIONS`), not
  requested in the prompt, and the overflow is reported in `problems[]`.
- **A bilingual draft is checked twice.** The rules are about text and the two
  issues are different text: an English body that satisfies the third-person
  rule says nothing about the Hindi one. Each item is reported once per
  language, and a progress line is emitted per language too — a "checking" line
  that appeared once while two ran would be a progress line that lies about how
  long it takes.
- **A new tool, `lookup_glossary_term`, scope `utils`.** `lookup_admin_term`
  answers "what does CSMOP call this part of a document?" over 78 structural
  terms; this answers "what is the standard Rajbhasha rendering of this ordinary
  administrative word?" over 1,891. They are deliberately disjoint —
  `glossary_seed.py` drops any term the two would both answer (ADR-024) — and
  the consequence for an agent is that it needs BOTH: `Under Secretary` is a
  structural term and is **not** in `data/glossary.json`, so a drafting run with
  only the glossary would find no Hindi for the designation that signs almost
  every document this app drafts. There is a test asserting that absence, for
  exactly that reason. The 970 KB dataset is loaded only when the tool is called,
  which for a drafting run means only when the draft has a Hindi issue.
- **The system prompt is a `.md` file in the cached prefix.** `buildSystem` gains
  an `instructions` block between the persona and the profile, `cache: true`. It
  is a file rather than a string literal because it is prose an officer could be
  asked to read, and it is bilingual because the reader is. `PROMPT_VERSIONS
['draft-assist']` went to 2, which is what stops the answer cache serving
  anything the old wording produced.
- **Progress events carry the tool NAME, not a sentence.** `DraftingStep` is
  `{ phase, tool? }`; the panel maps a tool to `draft.ai.step.<name>` through a
  literal map, so a tool whose label nobody wrote is a compile error rather than
  a raw key on screen. A sentence built in the agent would be a user-visible
  string outside the i18n catalogues, existing in one language.
- **The panel is `React.lazy`, and the agent is imported at RUN time.**
  `useDraftingAi` dynamic-imports `agents/drafting`, `tools/registry` and
  `tools/index` when the officer presses the button — not when the panel
  appears. Opening the panel to read what it says therefore downloads nothing
  that could reach a network. The initial route is unchanged at 138.6 KB gzip
  against a 250 KB budget.
- **No effect fires a paid request.** The ✨ button on a field hands the field up
  to `EditorPage`, which opens the panel; the panel then _offers_ the four
  rewrites and waits. The first shape of this ran the rewrite from a
  `useEffect` watching the prop — which `react-hooks/set-state-in-effect`
  rejected, and rightly: a request that costs the reader money should be
  attached to a press, not to a render.

### Consequences

- The Drafting Studio has an AI surface, and it is the only one in the app. The
  other three modules' tools are registered and unused, as before.
- With AI off — every device's default — `tests/e2e/draft.spec.ts` asserts the
  panel, the ✨ controls and any chunk matching `AiDraftPanel|anthropic` are all
  absent. `tests/e2e/ai-draft.spec.ts` turns AI on, opens the panel, runs axe
  over it gated and open, and — declaring no `allowCrossOrigin`, unlike
  `ai-byok.spec.ts` — proves that turning AI on and reading the panel sends
  nothing. Both run on both Playwright projects.
- A live smoke test exists and does not run: `src/ai/agents/drafting.live.test.ts`
  is skipped unless `AI_LIVE=1` **and** `ANTHROPIC_API_KEY` are both set. Its
  assertions are about shape, never wording — a test that asserted a model's
  prose would fail on the next model and everyone would learn to ignore it. The
  one assertion worth having is that a brief which withholds the file number
  comes back with a blank rather than a number.
- `docs/DATA-GAPS.md` #60 records the one thing this session could not settle:
  the `validateCitations` interaction that can fail a run whose document text
  legitimately names a rule the brief did not.

### Addendum — the edge-case pass (same session, after `1d066dc`)

Seven defects, each confirmed to fail against the committed code before its fix.
`src/ai/agents/drafting.edge.test.ts` and `src/modules/drafting/aiPanel.edge.test.tsx`
are the regression files, in the shape `src/lib/srs/edge.test.ts` established.

Four of the seven are one theme: **the screen, the abort and the error path each
covered the model's half of the run and not this file's own half.** That is the
predictable failure mode of an agent whose whole design is "three of five stages
are code" — the stages the model owns were written defensively because a model
is obviously untrusted, and the stages the code owns were written as if code
cannot fail.

1. **The refusal screen read the brief and not the draft.** `currentValues` is
   sent — that is the point, so the agent completes the officer's work rather
   than replacing it — and it is by far the likelier of the two to carry a
   classification marking. A clean brief over a body naming a classified
   annexure went to the model. `screenOutbound()` now screens everything a run
   would put on the wire, as one string; `screenBrief()` remains the primitive.
   The values are serialised rather than walked, because a marking can sit in
   any field and a screen that has to be told which fields to read is a screen
   that misses the fifteenth.

2. **A failing tool rejected the promise instead of returning `status: 'error'`.**
   Stages 3 and 5 call `render_draft` and `check_draft` outside `runAgent`'s own
   try/catch, so a missing registration or a dataset chunk that would not load
   escaped the documented union. The hook happened to catch it; a second agent,
   a test, or any future surface would not have.

3. **A run cancelled between stages still returned a complete draft.**
   `runAgent` checks the signal at the top of each of its loops; the agent's own
   stages sit between two of those. Cancel landed, the plan finished, and the
   local render and check ran on regardless. The hook discarded the result
   because it re-checks `signal.aborted`; nothing else would have.

4. **`improveWording` on an empty field asked a model to rewrite nothing.**
   Four provider calls to invent content for a field the officer had not filled
   in — which is the one thing this agent exists not to do.

5. **A phrase id the model named twice was rendered twice**, with the id as its
   React key.

The other two are UI, and both were invisible to Playwright for the same reason:

6. **`answer()` started the run inside a `setState` updater**, purely to read the
   pending brief out of the current state. React invokes an updater TWICE in
   StrictMode and `src/main.tsx` renders the whole app inside one, so answering
   the interview's questions started two runs against the reader's own key. Only
   `start()`'s abort-the-previous behaviour kept the second off the wire — an
   accident, not a design, and one that holds only while nothing synchronous
   happens before `run`'s first `await`. **Counting provider calls could not see
   it**: the aborted run makes none. The test counts runs STARTED, through
   `onSpent`, which fires in the `finally` of every run including an aborted
   one. This is the third StrictMode defect this project has shipped (ADR-021
   has the other two) and the second time the lesson has been that `pnpm
test:e2e` runs a production build where StrictMode is inert.

7. **Applying a field made its own row disappear.** `changed` was computed from
   the live `values`, so the moment a suggestion was applied its `after`
   equalled its `before` and the row was filtered out — taking the "Applied"
   confirmation with it, which no reader could therefore ever see. The officer's
   own action looked like the panel losing their place. The list is now a
   snapshot: the hook carries `baseValues`, the values the run was GIVEN, and
   the diff is computed against those. Applying no longer re-diffs every other
   field either.

**One further fix that is not a defect in the agent at all.** The panel's `key`
was `parsed.draftId ?? 'new'`, and a draft row is created on the first change
rather than on arrival — so applying the first field of a suggestion is itself
what creates the row, writes `?d=` into the URL, changes the key and remounts
the panel a debounce later. The rest of the suggestion, and the acknowledgement,
went with it. `editorSessionKey(draftId, createdHere)` in
`src/modules/drafting/url.ts` is the distinction that was missing: the row this
editor created is the same document it already had; a draft it was asked to
resume is not. `createdHere` is STATE and not a ref, because it is read during
render to compute a key, and a ref read during render can tear —
`react-hooks/refs` caught that, correctly, on the first attempt.

## ADR-033 — Rules bank expansion: curated Hindi law headings at full coverage, a real fix to an unreachable duplicate check, and genuinely blind verification via fresh subagents

**Status:** accepted (Session 20)

### Context

Session 20's brief was content, not code: author Hindi headings for the four
rule books still missing them (`ccs-pension`, `gfr`, `fr-sr`, `csmop`), review
the 529 cloze cards that unlocks, run ~150-180 questions through the four-stage
pipeline for six more acts plus a scenario batch for three already-served ones,
extend the Law Converter's curated Hindi from 94 BNS sections to full coverage
of BNS/BNSS/BSA, confirm BNS classification coverage, and pass a Hindi-quality
review over the app's existing i18n and data. Four things happened along the
way that were not anticipated in the brief and are worth recording.

### 1. Content authoring at this scale is an orchestration problem, not a writing one

Translating 582 rule headings, hand-reviewing 529 generated cloze cards against
their full rule text, and running ~275 new questions through generate → critic
→ blind-verify → dedup is not one long session of typing — it is dozens of
independent, well-scoped units of work with clear inputs and outputs. Each was
delegated to a fresh subagent with only the files it needed (the act's rule
text, its terms file, one worked example for format/register, and — critically,
for Stage C — _never_ the file holding the answer key). Large single acts
(GFR's 240 cloze cards, its 307 rule headings) were partitioned by a
deterministic, collision-free split (even/odd list position after a stable
sort) into independent halves reviewed in parallel and merged by script
afterward, the same shape `ccs-conduct`'s original authoring already used for
its single-agent batches. This is what made the scope tractable in one
session; it is also why Stage C's blind verification is, for the first time,
genuinely blind rather than merely separate-in-time — docs/AUTHORING.md's own
"What the blind pass does and does not guarantee" section says the same
session writing and verifying a question is one of the two gaps compensating
mechanisms exist for. A subagent with a fresh context and no access to
`authored/<act>.json` closes exactly that gap, and Session 20's blind-verify
agents were instructed accordingly and never opened the file holding the key.

### 2. `make_cards.py`'s duplicate/emptied-rule check had a blind spot for two whole rule books

`_unanswerable()` decided whether a rule card was answerable by reading only
`rule["heading"]["en"]`. FR/SR prints no heading at all for any of its 77
rules (`heading.en` is `""` throughout — confirmed against the source), and
CSMOP is the same. An empty-string check on an always-empty field can never
fire, so neither book's rule cards were ever screened for "Deleted"/"Cancelled"
emptied rules or for a prompt that reads the same as another rule's — the
defect was invisible for as long as those two books had `needs-hindi` on every
rule card and were never actually served. It surfaced the moment this
session's Hindi headings unlocked them: eight FR/SR rules headed "Deleted" or
"- Cancelled." in the source all rendered as byte-identical served cards
("Deleted — which rule of the FR & SR?"), caught by `tests/rules-data.test.ts`'s
duplicate-front check (found via a peer session's report, not by this session
reading the data first).

The fix (`scripts/authoring/make_cards.py`) reads the same _effective prompt_
`rule_cards()` actually renders — heading, or the rule's own opening sentence
where there is no heading — rather than the raw heading field alone, widens
the emptied-heading pattern to catch "cancelled" and "not printed" (both used
in FR/SR) and a leading `-`/`[`, and replaces the old exact-string duplicate
check with the same `rapidfuzz token_set_ratio >= 92` the test itself uses, so
the two converge by construction instead of by coincidence. Running the fixed
check over the whole corpus found more genuinely ambiguous rules than the old
one ever could — not a regression, the check working for the first time on
data it had never been able to see. `docs/DATA-GAPS.md` #62 records which acts
this leaves short of literal 100% rule-card coverage and why closing the rest
is deliberately not attempted in one more pass.

### 3. BNS classification coverage is already complete — for every section that can carry one

The session brief described this as extending "from 80 to all BNS sections."
Measuring first: of the 70 BNS sections with no First Schedule classification,
all 70 have an empty `punishment` field — they are definitional or general
provisions (Chapter I-III's `1`-`48`, definition sections like `63` "Rape" and
`100`/`101` "Culpable homicide"/"Murder" whose punishment lives in a separate
numbered section, and the closing `358` "Repeal and savings") that the First
Schedule correctly does not classify, because cognizable/bailable/compoundable
are properties of a punishment, and these sections impose none. All 288
sections that DO carry a punishment are classified. Nothing was added here;
`docs/DATA-GAPS.md` does not carry a new row for it because there is no gap to
carry a row.

### 4. Extending curated Hindi past BNS was a bounded choice, not a full-text one

`data/law/overlays/bns-hindi-curated.json` covered 94 BNS sections; BNSS and
BSA had none. This session re-attempted every previously-recorded avenue for
an official Hindi Sanhita (`docs/DATA-GAPS.md` #16) and confirmed the gap
again rather than assuming it — `indiacode.nic.in/handle/...` still 403s,
`egazette.gov.in`'s own PDF fails certificate verification the way several
Government of India hosts already do for the Python pipeline, and
`mha.gov.in`'s own `..._english_.../..._hindi_...` filename pair for the BNS
gazette 403s on the Hindi half too. With no official source, the fix was
**headings only, not statutory text**: all 1,059 BNS/BNSS/BSA section headings
now have a curated Hindi rendering (`verify: true`, the existing marigold
"Verify" banner and `hindiIsCurated` flag apply unchanged — the mechanism
needed no code change, only more data), plus Hindi punishment text for the 201
BNS sections that had a heading and a classification but no punishment
translation, closing a gap `tests/law-data.test.ts` was already positioned to
catch once headings existed to expose it. Full section TEXT in Hindi remains
untranslated and is not proposed here — translating a short heading and
translating ~1,059 full statutory sections carry different orders of risk for
a legal reference tool, and the brief's own instruction was explicit that
translation is the fallback only "if official Hindi is unavailable," scoped to
headings.

### Consequences

- Rule cards served: 571 → 1,595 (rule 693, cloze 563, mcq 195, trueFalse 66,
  scenario 78). Reviewed cloze cards: 340 → 869. Reviewed authored questions:
  141 → 351. All twelve rule books now have served rule/cloze/question content
  where the source material allows it.
- Every BNS/BNSS/BSA section has a Hindi heading; BNS additionally has Hindi
  punishment text everywhere it has a classification. `tests/law-search.test.ts`'s
  `जमानत`/`jamanat` fixture was updated from `BNSS 492` to `BNSS 478` — the
  latter's new curated heading contains the query term directly, and a heading
  match correctly outranks the lexicon match that used to carry 492 to the top
  when no bail heading contained the word at all.
- `docs/DATA-GAPS.md` #62-#64 record what this session did not finish: full
  literal rule-card coverage for seven acts (a data-quality fix surfaced this,
  closing it is real work, not a quick pass), and a Hindi-quality review of
  `src/i18n/hi.json` and the rest of `data/` that a session rate limit cut off
  before it could report a single finding.

## ADR-034 — Data maintenance goes hands-off: four ingest workflows, a watch-and-file-an-issue shape for sources with no fetchable text, and an automatic update check that changes what "no analytics" has to mean

**Date:** 2026-08-29 · **Status:** Accepted

### Context

This session's brief: make data maintenance hands-off except for pull-request review. `ingest-law.yml`
already existed (weekly NCRB refresh, ADR-012/013); the brief asked for three more workflows
(`ingest-pay.yml` monthly, `ingest-holidays.yml` yearly, `ingest-glossary.yml` dispatch-only), a
per-code diff summary added to `ingest-law.yml`'s pull request body, an in-app automatic "check for
data updates" on startup, and `docs/MAINTENANCE.md`. Two decisions in it needed more than a routine
build: what a Dearness Allowance watch can honestly promise when its own source is usually unreadable,
and whether an automatic network call belongs on by default in an app whose master context states "no
analytics, by default and always."

### Decision

**1. `pay_orders.py` does not trust its own parse, because the source mostly cannot be parsed.** The
Department of Expenditure keeps only the CURRENT Dearness Allowance order at one fixed path and
overwrites it on every revision — there is no archive, so "a new order" is that URL's content hash
changing (`data/_meta/seen-orders.json`), not a new URL appearing. And most of what DoE actually serves
there is a scanned image: two real orders fetched to build this session's test fixtures — the ones
`data/pay/da-history.json` already cites for 01.07.2025 and 01.01.2026 — extract to **zero characters**
through `pdfplumber`. CLAUDE.md already says this about DoE orders generally ("every DoE order is a
scan, read by rendering and recognising and then checking by eye"); this session measured it directly
for Dearness Allowance specifically rather than assuming it. So `find_rate_change` returning `None` is
the expected common case, not a failure, and the script reports it as exactly that — a "Manual review:
`<order>`" issue naming the order and why — rather than guess or stay silent. Only when an order DOES
carry parseable text, and it matches the one sentence shape every notified order this dataset's own
citations use ("...rate of Dearness Allowance...enhanced from the existing rate of X% to Y%...with
effect from `<date>`"), does the script write the change into `data/pay/da-history.json` itself,
schema-validated, for a human to review in a pull request — never auto-merged. HRA/Transport/Children
Education Allowance orders are watched the same way on the one DoE page found to link them, and NEVER
propose a data edit — only ever a manual-review issue — because that dataset has 32 allowances, each
with its own rate structure and conditions, and no single predictable sentence a Dearness Allowance
order has. `scripts/ingest/fixtures/pay-orders/` holds five REAL fixtures (extracted text only, never
the PDF itself) proving no false positive on real, confusing government-document noise — one fetched
document discusses "Daily Allowance (DA)" and a garbled percentage in a sentence with nothing to do
with Dearness Allowance — plus one clearly-labelled SYNTHETIC fixture proving the regex can still find
a true positive shaped like the real thing. Five real fixtures that never match would not distinguish a
working regex from a dead one; the synthetic one is what does.

**2. The holiday and glossary workflows are honest about having no fetch to run.** `holidays.py` reaches
no host at all — a year's list is hand-typed from a DoPT circular, the same way `pay_matrix.py`'s
`ANCHORS` are. So `ingest-holidays.yml` cannot itself produce a new year; what it does, once a year, is
notice that next year has no `YEARS` entry yet and open an issue asking a human to add one, with the
exact command to run afterwards — and only opens a pull request in the "a hand-edit was made but never
run locally" case, the same `--check`-style contract every other script here already gives a developer.
`ingest-glossary.yml` is dispatch-only, with no schedule at all: `glossary_seed.py` also reaches no
host, so a weekly poll of nothing would rebuild identical output from identical input and — per
`write_json` — write nothing, silently, forever. It exists so a reviewer who has hand-edited
`scripts/ingest/glossary_sources/*.json` can get the same schema-validated rebuild and pull request
`pnpm check` would give them locally, without a local Python environment.

**3. Every ingest workflow routes through a pull request, even for pure bookkeeping, and never commits
to `main` directly.** `data/_meta/seen-orders.json` changing on its own (nothing else found) is a
one-line diff nobody strictly needs to review — but `.github/workflows/deploy.yml` triggers a
production deploy on ANY successful CI run on `main`, so a direct commit would rebuild and redeploy the
whole unchanged app as a side effect of updating a bookkeeping file no reader-facing code ever reads.
`pay_orders.py` itself is also written so a genuinely quiet run writes NOTHING at all — the seen-entry
for the Dearness Allowance watch is only rewritten on a real content change (or an explicit `--force`
dispatch), never on every run just to refresh a timestamp — the same "a run that changes nothing must
write nothing" rule `ingest_common.write_if_content_changed` already states for every other dataset
here, extended to a file this session added.

**4. `ingest-law.yml`'s pull request body now names which sections changed, not just how many bytes
did.** `git diff --stat` cannot tell a reviewer whether a run touched one section fifty times (a
heading reflow) or fifty sections once each — and CLAUDE.md is explicit that this is section-level
criminal law, where a wrong mapping is worse than a stale one. `law_diff_summary.py` compares the
working tree the ingest just wrote against `HEAD` (still the previous commit at that point in the
workflow) and lists, per code, exactly which section numbers were added, changed or deleted — with a
fresh `fetchedAt` alone not counting as a change, the same `strip_volatile` rule that already decides
whether to write the file at all.

**5. The automatic data-update check defaults ON, and that changes what the onboarding privacy promise
has to say.** `useAutoDataUpdateCheck` runs `CheckForUpdates.tsx`'s own comparison automatically, at
most once a UTC calendar day, only while online, through the SAME `fetchLatestVersions` in
`src/lib/dataUpdates.ts` that already holds the app's second (of two) `fetch` exemption (ADR-028) — the
hook itself never calls `fetch`, so the exemption stays at two files, not three. The real question was
not whether this is CSP-safe or same-origin (it is; `connect-src 'self'` already covers it) but what it
COSTS: this app precaches everything, so an installed device could until now be opened with **zero**
network requests at all — `tests/e2e/offline.spec.ts` proves every route renders with the network fully
cut. Turning a daily automatic check on means the origin's access log now learns, once a day, that a
device opened the app, by IP — not analytics anyone built, but a side effect of the request's mere
EXISTENCE that its same-origin, no-user-data CONTENTS do nothing to change. Weighed against that: this
app shows Dearness Allowance and pay figures a reader may act on directly, a stale rate is a concrete
harm, and the reader least likely to ever find the manual button in Settings is also the reader most
likely to be hurt by staleness. The default is ON, with a Settings toggle beside the existing manual
button (`pages.settings.updates.autoCheck`, itself on by default) for anyone who would rather opt out —
and `onboarding.step3.noAnalytics`, in both languages, now says what actually happens: no analytics,
full stop, and a named exception for what leaves the device, how often, and where to turn it off,
rather than the flat "and always" the old wording could no longer support. The day boundary is UTC, not
`Date`'s local getters and not `src/lib/srs/day.ts`'s or `src/lib/istDay.ts`'s fixed +05:30 IST offset
— those exist for spaced-repetition and streak correctness a reader actually sees; this is a network-
call throttle, and a boundary that depends on the test runner's own timezone is a boundary that makes
the same input produce a different answer on a different machine, which is exactly the class of bug
this project's own conventions (`compareStrings`, the fixed IST offset) already exist to rule out
everywhere else.

### Consequences

- Four ingest workflows now exist (`ingest-law.yml` unchanged in shape, `ingest-pay.yml`,
  `ingest-holidays.yml`, `ingest-glossary.yml` new) plus `lint-workflows.yml`, a small standalone
  `actionlint` gate scoped to `.github/workflows/**` rather than folded into `ci.yml` — several
  sessions can be editing workflow files concurrently, and it verifies the CI configuration itself, not
  the app `ci.yml` verifies.
- `scripts/ingest/pay_orders.py`, `scripts/ingest/pay_orders_pr_body.py`, `scripts/ingest/
law_diff_summary.py`, their tests (`test_pay_orders.py`, 24 cases; `test_law_diff_summary.py`, 8
  cases) and `scripts/ingest/fixtures/pay-orders/` (five real fixtures, one synthetic, `SOURCES.md`
  naming each) are new. `data/_meta/seen-orders.json` is a new, seeded, schema-exempt (`NO_SCHEMA` in
  `validate_data.py`) bookkeeping file.
- `src/lib/dataUpdates.ts` gains `isCheckDue` (pure, UTC-boundary, tested independently of the network
  call around it); `src/app/useAutoDataUpdateCheck.ts` is new; `src/app/pwa.tsx`'s existing toast
  container gains a third notice reusing `PwaToast` (extended with an optional `details` list) rather
  than a second fixed-position container, which would have overlapped it — the exact defect
  `docs/DATA-GAPS.md` #59 already named for the offline-ready toast on a phone. `src/db/index.ts` gains
  two `SETTING_KEYS`: `dataUpdateAutoCheck` (the toggle) and `dataUpdateLastChecked` (not user-facing).
- `onboarding.step3.noAnalytics` and `pages.settings.updates.autoCheck`/`.autoCheckHint` are reworded
  or new in both `en.json` and `hi.json`.
- `docs/MAINTENANCE.md` is new: the monthly review routine, what each cron does, how to add a dataset,
  and how to hotfix a wrong number by hand without waiting for any of this.

## ADR-035 — The law research agent: two passes because the citation validator says so, labelled snippets that keep a heading from answering a bail question, and a date rule the app states rather than asks for

**Date:** 2026-08-30 · **Status:** Accepted
**Builds on:** ADR-011 (the grounding rule), ADR-032 (the drafting agent, the worked example for every agent after it).

### Context

Session 21 shipped the first agent, in the Drafting Studio. This session ships the
second, in the Law Converter, and it is a different kind of thing: the drafting
agent fills a form and lets an engine mark it, while this one **answers a question
in prose**. Prose is where the grounding machinery this app built in Session 3A
actually bites, and building over it surfaced one structural constraint that
decided the whole architecture before any judgment came into it.

Five decisions were live. Four of them are judgment; the first is not.

### 1. Two model passes, because `validateCitations` makes one pass impossible

`src/ai/context.ts#validateCitations` rejects any section, rule or paragraph
number in a final answer that does not appear in a **cited PLATFORM CONTEXT
snippet**. Tool results are not context snippets — they come back on the wire as
`tool_result` blocks and carry the handles `T1`, `T2`, which the function does not
read. So a single `runAgent` pass that calls `get_section` and then writes
"Section 103 of the BNS" fails its own citation check _every time_: the number is
in a tool result, and in no snippet.

That is not a bug to route around and it is not a reason to weaken the rule. It is
the reason the brief's own description — "tool results are fed as numbered,
type-labelled snippets" — is the only shape that works. `runLawAgent` is five
stages and the model owns two:

| #   | Stage         | Whose | What                                                                     |
| --- | ------------- | ----- | ------------------------------------------------------------------------ |
| 1   | `screening`   | code  | `screenLawQuestion()`, before any provider call                          |
| 2   | `researching` | model | calls the law tools; finishes with the handles it used and nothing else  |
| 3   | `reading`     | code  | every successful tool result becomes a numbered, type-labelled `Snippet` |
| 4   | `answering`   | model | **no tools**; writes the structured answer from those snippets alone     |
| 5   | `verifying`   | code  | `validateCitations`, then every citation re-derived from the evidence    |

Two consequences that were not free, and both are asserted in both directions in
`src/ai/agents/law.test.ts`:

- **The research pass's closing sentence is discarded, so two of `runAgent`'s
  failures are not failures of this run.** `ungrounded` and `invalid_citation`
  there are judgments about a sentence nobody will read, and the second one _can
  never be satisfied_ at that stage for the reason above. When either fires and
  at least one tool result exists, the run continues and says so in `problems[]`.
  Every other failure — the provider, the budget, cancellation, the step cap —
  really did stop the run and is returned as one. The pass is asked to end with
  literally `Gathered [T1] [T2]`, so the tolerated path is the exception rather
  than the norm; a test drives both branches.
- **The answer pass runs with `groundedRequired: false`, and `docs/AI.md` §11
  requires an ADR for that.** This is it. That pass has no tools, so `runAgent`'s
  rule — "cite at least one tool result" — is unsatisfiable by construction and
  would fail every answer. What replaces it is stricter, not looser: stage 5 calls
  `validateCitations` **itself**, over `answer.en + answer.hi` and with
  `requireCitation: true` on, which is the check `runAgent` would have skipped;
  then every provision number named in the answer must appear in `citations[]`;
  then every citation must be backed by a tool result that actually contains it;
  then `format_citation` must confirm the section exists in the dataset at all.
  Four gates where the loop would have applied one.

### 2. A First Schedule row is labelled as one, and that is the substance of stage 3

`SnippetType` gained two members, `classification` and `mapping`, so a
`get_classification` result is labelled

> `(classification, BNSS First Schedule: BNS 318)`

and a `compare_old_new` result is labelled `(old→new mapping: IPC 420, from NCRB
table)`. Under the pre-existing `section` label they would have read alike, and
the failure mode is specific rather than theoretical: BNS 103's heading is
"Punishment for murder", which _reads like_ an answer to a question about
punishment and cannot settle cognizability or bail. Those are properties of a
First Schedule entry, they differ between sub-sections of one section, and the
label is what tells a model which of the two snippets it is holding. The persona
in `src/ai/prompts/law.md` names both labels verbatim.

The same stage writes each provision inside the snippet text as `Section 318(4)
of the BNS` rather than `BNS 318(4)`, and that is load-bearing rather than
stylistic: `validateCitations` extracts a full sub-section reference only where a
snippet spells it after the word "section", and its fallback scan for a bare
numeral matches `318` and `4` separately. Written the other way, a perfectly
correct answer saying "Section 318(4)" would have been rejected as unsupported.

### 3. The date rule and the disclaimer are stated by the app, never asked of the model

Which code applies is decided by the date of the **offence**, not by today's date
(BNSS s.531(2)), and it is the most consequential rule in this module. The
converter already has that date in a field, so the app _knows_ it — and a fact the
app knows is worth more than an instruction the model was given. `dateRuleCaveat()`
is pure, bilingual, and always the first caveat: it names the era for a date that
was given, and says plainly that it does not know which code applies for one that
was not. `LAW_DISCLAIMER` is always the last. `src/ai/prompts/law.md` tells the
model **not** to write either, so the reader never gets two versions of the same
rule in one answer.

This is the same principle as ADR-032 §1 — anything the agent asserts about its own
output is re-derived in code — applied one step further out: anything the app
already knows, the app says.

### 4. The screen here is NARROWER than the drafting agent's, deliberately

`screenBrief()` refuses a drafting brief that so much as mentions "classified",
"secret" or "confidential", and that is right for a brief: it describes a document
this app must not help carry. It would be **wrong** here. "Which BNS section covers
communicating secret information to a foreign agent" is a question about published
statute, and a law-research surface that refuses it has refused the Official
Secrets Act.

`screenLawQuestion()` refuses something different: a reference to a particular
departmental **record** — an FIR number, a case or diary number, a charge-sheet
number, a crime number, in both scripts. Every pattern requires a digit after the
word, which is what keeps "an FIR was filed on 20 June 2024 — which code applies"
— one of this session's own acceptance cases — answerable. It runs before the
provider is constructed and the test that matters counts `MockProvider.calls`.

Advice about a person's case is handled as a **steer rather than a refusal**, and
that distinction is the decision. "Will my brother get bail under 420" has a real,
answerable, general core — whether the corresponding offence is bailable under the
First Schedule — and an officer asking it deserves that answer. What they must not
get is a prediction about their brother. So `caseAdviceSteer()` detects it, both
model turns are told to answer the rule and nothing beyond it, and the caveat
saying so is added by code whether or not the model remembered. It deliberately
does **not** reuse `heuristics.ts#isPersonalQuery`: that matches "can I" and
"should I", which open a large share of perfectly general questions here, and its
bias — a false positive costs only a cache hit — is the wrong bias for a control
that changes the answer.

### 5. No per-question acknowledgement gate, unlike the Drafting Studio

ADR-032 §5 put an inline acknowledgement in front of the drafting brief box,
asked once per draft. It is not repeated here, and the reason is what that gate
asserts: a fact about a **document**, true or false once, and stable while the
officer works on it. A question is typed fresh every time, so the same gate would
be a dialog before every question — which is a dialog nobody reads, and the
argument ADR-032 itself made against the modal ADR-021 imagined.

What stands in its place is three things that do not depend on the reader having
read anything: `<AiBanner/>` permanently above the input, `screenLawQuestion()`
before the provider exists, and `caseAdviceSteer()`. `src/modules/law/ai-seam.ts`
records this so the difference between the two surfaces is a decision on the
record rather than an inconsistency somebody later "fixes".

### 6. Tier 0 gets a smaller run rather than the same run on a smaller model

`policyForTier('local')` is `{ researchSteps: 2, maxToolResults: 1, maxSearchHits: 2,
answerSentences: 2 }`. `researchSteps: 2` is what _enforces_ the single tool-calling
turn — one turn to call, one to finish — rather than an instruction a small model
may ignore, and `maxToolResults: 1` is the second half of it, since a model can
still emit three parallel calls inside its one turn. Both are asserted. Tier 0 does
not exist in this build (`LocalProvider` throws `not_installed`), so this is a
policy waiting for Session 24 rather than a shipped path — but it is a policy the
agent reads at run time, not a branch somebody will have to add later.

### Consequences

- `src/ai/agents/law.ts`, `src/ai/prompts/law.md`, `src/ai/fixtures/law-scripts.ts`
  and `src/ai/agents/law.test.ts` (41 tests) are new. `PROMPT_VERSIONS['law-explain']`
  is bumped 1 → 2 in the same commit as the prompt file, per the rule in `docs/AI.md` §9.
- `src/ai/context.ts` gains two `SnippetType` members. Purely additive; nothing
  existing changed.
- `src/modules/law/ai-seam.ts`, `useLawAsk.ts`, `components/AskPanel.tsx` and
  `askPanel.test.tsx` (11 tests) are new; `ConverterPage.tsx` mounts the panel behind
  `React.lazy` **and** `lawAiAvailable(useAi().enabled)`, and gains `openCitation`.
- A citation chip that names a REPEALED provision sets no `chosenId`: there is no
  document for "IPC 420" to open — the converter's answer to it _is_ BNS 318 — so
  the search opens its own best hit. A doc id built from the old number would have
  opened BNS 420, a different offence entirely. The query it writes names the Act,
  for the reason ADR-029 point 4 records.
- `law.ask.*` (37 keys × 2) is new. Concurrent sessions added their own blocks in the same
  window, so trust `pnpm i18n:check`'s own output for the catalogue total rather than a number
  written here.
- `tests/e2e/ai-law.spec.ts` is new: AI off → no Ask input; AI on → the panel, axe-swept,
  with no `allowCrossOrigin` declared so the automatic gate proves nothing is sent.
- `partialAnswerText()` reads the answer out of a half-arrived JSON document, so a
  structured-output pass can still stream to the reader. It is best-effort by
  construction — the rendered value always comes from `JSON.parse` — and a wrong
  guess costs a flicker.
- `docs/DATA-GAPS.md` #66 records the one known false-failure mode of the citation check
  (the same one #60 names for drafting) and #67 records the Tier 0 policy that has no
  provider to run it yet. The deployed site's `connect-src 'self'` will refuse this
  agent's requests exactly as #61 already says it will refuse the drafting agent's — one
  line in `public/_headers`, and #57 has the WebLLM half.

### Addendum — the edge-case pass, and the eight defects it found

Run after the commit, the way ADR-032's own addendum was, and it found the same
SHAPE of defect that one did: **the model's half of the run was written
defensively and the agent's own half was not.** The model is obviously
untrusted, so every value it returns is validated, re-derived against the
evidence, and dropped when unsupported — while the code around it quietly
assumed that a tool which succeeded had found something, that a question had
words in it, that a cancelled run had already stopped, and that the clipboard
works. Every test in `src/ai/agents/law.edge.test.ts` (16) and
`src/modules/law/askPanel.edge.test.tsx` (4) was confirmed to fail against the
committed code before its fix was written.

1. **A tool that succeeded and found nothing counted as having read something.**
   `get_section` for a section that does not exist returns `{ found: false }`
   rather than throwing, and a search that matches nothing returns an empty
   list. Both are successful tool results carrying no statute, so a run that had
   read NOTHING still paid for a second model pass — over a context whose only
   content was the reader's own question. The wasted tokens are the smaller
   half: the only numbers such a context can support are the ones the reader
   typed, so the likeliest answer it can produce is one assembled out of the
   question, which is precisely what grounding exists to prevent. The guard now
   runs on snippets produced, not on tools that returned.

2. **A blank question ran both passes.** The panel disables its own button, but
   the agent is a module anything may call and the agent is what spends the
   money. `improveWording` had this guard already; this did not.

3. **A year after an Act abbreviation was read as a section number.** "The BNS
   2023 replaced the IPC 1860" named two provisions that appeared in no
   citation, and a completely correct answer was discarded. The guard is
   data-backed rather than a heuristic: the longest of the six Acts is the BNSS
   at 531 sections, so a four-digit section does not exist and refusing to read
   one cannot lose a real citation. Counted on the digits, so `124A` is still a
   section.

4. **`124` and `124A` were the same key.** Both the support index and the
   mention scan reduced a reference to its DIGITS. IPC 124A is sedition; IPC 124
   is assaulting the President — so a citation of `124` looked supported by a
   tool result that had only read `124A`, and a repealed-Act citation takes the
   `oldActCitation` path, which does no dataset lookup, so nothing downstream
   could catch it. The reader would have got a chip reading "Section 124 IPC"
   under an answer about sedition, opening a real section about a different
   crime — worse than an obviously broken link. `refKey()` keeps the letter
   suffix now. 65B/65 and 376AB/376 collided the same way.

5. **A run cancelled while verifying still returned a complete answer.** Stage 5
   awaits `format_citation` twice per citation and sits after the last of
   `runAgent`'s own signal checks. `useLawAsk` happens to drop the result of an
   aborted run before it reaches the screen, which is exactly why this needed a
   test at the agent: the defect is invisible from the UI, and the agent is what
   the next caller will use. Identical to the one ADR-032's addendum records.

6. **Hand-authored Hindi was presented as statutory.** All 1,059 records in
   `data/law` carry `verify: true` because the source publishes no Hindi
   (`docs/DATA-GAPS.md` #18); `SectionResultCard.tsx` marks that with a marigold
   banner and CLAUDE.md states the rule — it is the one place a reader could
   mistake hand-authored text for the Act, so both halves are kept together. The
   Ask panel was the second half and had nothing. Two things had to change: the
   tools now report `hindiIsCurated` on `compare_old_new` and
   `get_classification` as well as on `describe()` (a result that carried the
   heading but not the flag was the actual gap), and the agent derives the mark
   in code rather than trusting the model to repeat it.

   It is carried on the result as TEXT (`curatedHindiNote`) rather than pushed
   into `caveats`, and both halves of that are deliberate. Not in `caveats`,
   because `caveats` is fixed when the run ends while the language toggle is on
   every screen — ask in English, switch to Hindi to read the Hindi phrasing,
   and a frozen caveat leaves the hand-authored Hindi unmarked on the one
   surface whose whole job is to say where a number came from. As text rather
   than a boolean, because the panel must not `import` this module for a string:
   `useLawAsk` dynamic-imports the agent on the button press so that reading the
   panel downloads none of it, and a static constant import would have pulled
   the agent, `runAgent` and the tool registry into the panel's chunk and
   quietly undone that.

7. **The copy button had no failure path.** Every other copy affordance in this
   app — `SectionActions.tsx`, `TermRow.tsx`, `PortalsPage.tsx`, the pay slip,
   the drafting export — wraps `navigator.clipboard.writeText` in a try/catch
   and announces a failure. This one produced an unhandled promise rejection and
   a button that silently did nothing, so a reader on an insecure origin or a
   locked-down managed device would paste whatever was on the clipboard before.

8. **Ask was pressable before the provider existed.** `useAi().ready` is
   computed synchronously from the settings row; `provider` is a dynamic import
   that lands a tick later. In that window, pressing Ask threw "The AI provider
   is not ready" into a red alert — an error for a condition that resolves on
   its own, which is how a working feature comes to look flaky.

One test in that file found nothing and is kept anyway: `compare_old_new`'s
`status: 'dropped'` branch — the answer to "what is the BNS equivalent of 377",
where the correct answer is that there is none — was already right and had no
coverage at all. An untested branch that happens to work is one edit away from
not working.

## ADR-036 — The pay-explain and trainer-coach agents: reads happen in code before the model runs, and two figures the prompt alone cannot police

**Date:** 2026-08-30 · **Status:** Accepted
**Builds on:** ADR-011 (the grounding rule), ADR-032 (the drafting agent — code owns what can be re-derived), ADR-035 (the law research agent — where the citation-validator trap this ADR avoids differently was first named).

### Context

This session ships the third and fourth agents: `src/ai/agents/pay.ts`
("Explain my payslip", "Compare these two posts for me") and
`src/ai/agents/tutor.ts` ("Explain" after a wrong answer, "Give me a scenario on
this rule", the weekly focus plan). Both are narrower than the two before them —
neither fills a form nor answers an open legal question — and both ran into the
same wall ADR-035 names from a different angle: `validateCitations` rejects a
rule or section number that appears in no CITED CONTEXT SNIPPET, and a tool
result is not a context snippet. ADR-035's law agent solves this with a second
`runAgent` pass that turns tool results into labelled context for the answer
pass. This session took a narrower way out, because these agents' reads are
simple enough not to need a second model call at all.

### 1. The model calls no tool for a read — this file already made the call

`explainAnswer`, `weeklyFocusPlan`, `explainPayslip` and `compareJobsForReader`
call their tools directly, in code, before the model runs at all — the same
`get_rule_text`/`get_card_history`/`get_user_weak_areas`/`compute_pay_for_job`/
`explain_pay_line`/`get_allowance_source`/`compare_jobs` tools a model-driven
loop would otherwise call — and hand the real result back as numbered PLATFORM
CONTEXT. The model is then run with `tools: []` and `groundedRequired: false`:
there is nothing left for it to fetch, and the numbers it may state are already
sitting in front of it, in a citable snippet. This is one call cheaper than
ADR-035's two-pass shape and available only because none of these four needs a
second round of research between "what to look up" and "how to phrase it" — the
lookup is named by the caller (an act and rule, a job id, two job ids), not
discovered by the model reading the first result.

The exception is `proposeScenario`, which runs a real `runAgent` tool loop with
`propose_card` available, because it is the one WRITE among the five entry
points: only the model can author a scenario's wording and its options. The
rule text is still fetched by this file first — both to ground the confirming
sentence and so the model has no room to invent a rule number for a rule that
does not exist.

### 2. Two things are checked in code that the persona alone cannot enforce

A persona can say "never state a figure you were not shown" and "stay neutral,
never recommend one post over the other" — and a model can still not follow
either. Both are re-checked after the run, not merely instructed before it:

- **`ungroundedFigures()`** extracts every `₹1,23,456`-shaped or `NN%`-shaped
  token from the final answer, extracts every bare number from the JSON this
  file fetched, compares the two digits-only (so `₹21,600` in prose and the
  `21600` a JSON number serialises as agree, and `60%` matches a `daRate` of
  `60`), and refuses the answer if a stated figure matches none of them. A test
  scripts a `MockProvider` turn that states a rate this app never computed and
  asserts the run comes back `status: 'refused'`, not `'ok'`.
- **`containsRecommendation()`** is a short bilingual pattern list ("you
  should", "better choice", `बेहतर विकल्प`, …) run over
  `compareJobsForReader`'s answer; a match refuses it. "Describe the
  difference, do not choose a side" is exactly the kind of instruction a model
  agrees with and still drifts from over a longer answer.

Both return a `status: 'refused'` result with a `reason` and a bilingual
message — the same vocabulary `src/ai/agents/drafting.ts#screenBrief` uses for a
deterministic, code-side rejection, kept distinct from `status: 'error'`, which
is `runAgent` itself failing (a provider error, an ungrounded plan, a budget
stop).

### 3. `propose_card`'s confirmation is read back from the tool, never trusted from the model

Consistent with ADR-032 point 1: `proposeScenario` never reports "a card was
added" because the model said so. It finds the model's own `propose_card` call
in `run.toolResults`, parses its output, and reports success only if the tool
itself returned `stored: true` and an id. A card shape `cardSchema` rejects
(the same case `src/ai/tools/rules.test.ts` already covers) comes back `stored:
false` from the tool, and that is the failure passed through. The stored card
carries `reviewState: 'unreviewed'` in `proposedCards` — a table
`get_user_weak_areas` (via `weakAreasFor`) never reads, since that function
aggregates only `reviewLog`/`srsCards`, which a freshly proposed card has none
of until a human accepts it at `/learn/review-queue`. No special case was
needed to keep an AI-authored card out of the reader's own weak-area figures;
it falls out of which tables each function already reads, and
`src/ai/agents/tutor.test.ts` seeds exactly this — a real reviewed lapse
alongside an unreviewed proposed card — and asserts the plan reflects only the
former.

### Consequences

- `src/ai/agents/pay.ts` and `src/ai/agents/tutor.ts` are new, 16 unit tests
  between them (`pay.test.ts`, `tutor.test.ts`), run against the REAL committed
  `data/pay`/`data/rules` datasets and a real (fake-indexeddb) `db` — the same
  arrangement `src/ai/agents/drafting.test.ts` and `src/ai/tools/{pay,rules}
.test.ts` already use, so a mock figure never stands in for one this app
  actually produced.
- `PROMPT_VERSIONS['pay-explain']` and `['trainer-coach']` are both bumped to 2
  (from 1), each with a comment naming what changed in the persona — the
  neutrality rule for pay-explain, the scenario/focus-plan rules for
  trainer-coach. No `prompts/*.md` file was added for either: neither persona
  grew long enough to need one, unlike `drafting.md` and `law.md`.
- `src/modules/trainer/components/CardAiActions.tsx` (mounted below `CardView`
  in `ReviewPage` once it reveals) and `FocusPlanCard.tsx` (in the weak-areas
  card on `/learn`); `src/modules/pay/components/PayExplainPanel.tsx` (beside
  the pay slip) and `PayCompareAiPanel.tsx` (on the compare tab). All four
  render nothing unless `useAi().enabled`, carry the permanent `<AiBanner/>`,
  and reach the agent only through `useTutorAi`/`usePayAi` — the same
  dynamic-import-on-press shape `useDraftingAi` established, so a reader who
  never presses a button never downloads the agent.
- `CardView.tsx` gained one prop, `onAnswered`, fired once per reveal with what
  the reader picked and what was correct — in the reader's own language, the
  text already on screen, never re-derived by the agent. It is what lets
  `ReviewPage` show "Explain" only after a genuinely wrong answer rather than on
  every card.
- `src/modules/pay/aiOverrides.ts#overridesFromScenario` reshapes a `PayScenario`
  into the pay tools' `overrides` shape, so "explain what I'm looking at"
  computes the exact scenario on screen. It does not round-trip a typed custom
  basic pay (`overrides` has no `basic` field), and `PayCompareAiPanel`
  deliberately forwards only `{ daRate }` — never a side's level/cell/city —
  because `compare_jobs` applies its one `overrides` object to BOTH posts, and
  forwarding side A's level would silently force post B onto it.
- `tests/e2e/ai-tutor.spec.ts` and `ai-pay.spec.ts` are new: AI off → no action
  renders; AI on → the actions appear and pass axe, with no `allowCrossOrigin`
  declared, so the automatic privacy gate proves nothing was sent. Neither spec
  presses the action itself — that would need a live model, not a scripted one,
  and the agent's policy is what the unit suite scripts exactly.
- Local e2e note, independent of this feature: `playwright.config.ts`'s
  `reuseExistingServer: !CI` means a `pnpm exec playwright test` run locally
  does **not** rebuild `dist/` if a `pnpm preview` from an earlier run (this
  session's or another's, in a shared working tree) is still listening. Both
  this session and a concurrent one hit it independently while testing these
  two surfaces — once as a run against a bundle simply missing the new
  components, once as a false PASS on an "AI off" absence assertion against a
  bundle that had no AI surface in it at all, which is the more dangerous of
  the two. `ls -la dist/index.html` and `lsof -nP -iTCP:4173` before trusting a
  local e2e result; CLAUDE.md's own notes carry the reminder forward.

## ADR-037 — Tier 0 and Tier 2: an emulated tool protocol because a 1.5B model has no wire format, a memory guard that admits what it cannot know, and a proxy whose four guards are pure functions

**Status:** accepted · Session 24 · supersedes part of ADR-011 point 3 and part of ADR-030 point 5

**Context.** The AI layer has had four tiers since Session 3A and has run on one.
`LocalProvider` threw `not_installed` and `ProxyProvider` had nothing to talk to.
Both were built as interfaces on purpose — ADR-011's reasoning was that a seam
with only one implementation behind it is not a seam — and this session puts
implementations behind both. Nothing above the seam changed: the four agents,
`runAgent`, the tool registry and every surface are untouched, which is the
claim the seam existed to make and is now the claim it has to survive.

### 1. Tier 0's tool calls are emulated in the prompt, and the parser is strict about exactly one thing

A quantised 1.5B model has no tool-calling wire format. What it has is the
ability to emit a JSON object when the decoder is constrained to JSON and the
instruction is unambiguous. So `src/ai/local/protocol.ts` teaches the protocol
in the system prompt — one object per turn, `{"tool": …, "input": …}` or
`{"answer": …}` — and reads it back into the same `ContentPart[]` that
`wire.ts` produces from Anthropic's SSE. `runAgent` cannot tell the difference,
and `src/ai/providers/local.test.ts` proves it by running a complete grounded
run through the real agent loop against a scripted generator.

The interesting decision is where the strictness goes. **A turn is a tool call
if and only if the object names a tool.** Everything else — whether the tool
exists, whether the arguments satisfy its zod schema — is left to `runAgent`,
which already validates both and already has a recovery path that feeds the
model the available tool list or the zod error exactly once. Validating them
here as well would mean two validators disagreeing, and the one further from
the model would win silently. The test that pins this passes
`{"tool":"get_section","input":"bns 103"}` — arguments that are not an object —
straight through, so the officer's run recovers instead of the string being
rendered as prose.

Three parsing decisions that each came from a real shape rather than from
imagination, and each has a named fixture in `src/ai/fixtures/local-turns.ts`:

- **Aliases are accepted**: `tool_call` wrappers, `name`/`function`,
  `arguments` as a JSON _string_. That is the OpenAI function-calling shape,
  which is in the instruction-tuning data of every model on the list, and a
  model half-remembering it is not a model making a mistake worth spending an
  agent step to correct.
- **`answer` is checked before `tool`**, because `{"answer": "I checked with
get_section…", "tool": "get_section"}` occurs and a name-first parser reads it
  as a call.
- **The JSON scanner counts braces outside strings only.** A Devanagari query
  containing `{धारा 303}` truncates to invalid JSON under a naive scan and
  silently becomes prose.

There is a third parse mode, `raw`, and it exists because
`src/ai/agents/law.ts`'s own answer schema has a field called `answer`. On a
schema-constrained turn nothing is unwrapped: the JSON _is_ the answer. Getting
this wrong would hand `runAgent` a bilingual object where it expected a
document, and `JSON.parse` would then fail on something perfectly valid.

**Two tool steps, not the agent's six.** `LOCAL_MAX_TOOL_STEPS = 2`, counted
from the transcript rather than from a field on the provider — the provider
outlives a run, and a counter on the object would leak one run's budget into
the next. Six steps on a device generating twenty tokens a second is six
minutes of a model re-reading the section it just read.
`src/ai/agents/law.ts#TIER_POLICIES.local` had already assumed this shape a
week earlier, which is the nicest thing that happened this session.

### 2. The memory guard says what it does not know

WebGPU exposes no video-memory figure, by design — it is a fingerprinting
surface. So `fitFor()` is a floor, not a prediction, and it is written as a
pure function in `src/ai/local/webgpu.ts` so the judgement in it can be argued
with in a test rather than buried in a component. It turns on three things a
browser will actually answer: whether there is an adapter, whether it has
`shader-f16`, and `navigator.deviceMemory`.

That third one produced the one real defect this design had, and its own test
caught it. `navigator.deviceMemory` is quantised **and capped at 8** in every
browser that ships it, so `8` means "eight or more" and a 64 GB workstation
reports exactly what an 8 GB laptop reports. The first version compared against
it unconditionally and put a "may be tight on this device" warning on both 3B
models for the large majority of readers who can run them comfortably. At the
cap the figure carries no information and is now treated as absent — which is
also what Firefox and Safari, who implement none of it, already got.

What the guard genuinely prevents is a doomed download: a q4f16 model on an
adapter without `shader-f16` is refused on the adapter's own word, not on a
heuristic. What it cannot prevent is an out-of-memory failure, and the thing
that makes that acceptable is `loadFailureMessage()`, which turns "Device lost"
into a sentence naming a smaller model. A guard that pretended to more
certainty than WebGPU offers would be the worse design.

### 3. Five models, curated, and the picker's figures are read back out of the library

`prebuiltAppConfig` lists ~165 records. Offering that list to an officer is
offering them a way to start a seven-gigabyte download on a work laptop, so
`src/ai/local/catalogue.ts` is a shortlist of five spanning 0.9–2.5 GB, with a
q4f32 build included specifically so "your graphics card cannot run any of
these" is not the answer an ordinary office machine gets.

The curation is policy; the enforcement is elsewhere. `ensureLocalEngine`
narrows the engine's own `model_list` to those five, so a settings row naming
`Qwen3-8B` — hand-edited, or written by a build that offered more — cannot start
a download, because the engine has never heard of the id. Same split
`parseAiSettings` uses for the tier.

`src/ai/local/catalogue.test.ts` reads every id, every `vramMB` and every
context window back out of `prebuiltAppConfig` and fails if they disagree — the
arrangement `tests/law-data.test.ts` has with `data/law`. A web-llm upgrade that
renames a model or re-measures its memory cannot ship a picker quoting a number
nobody can reproduce. It also asserts that all five resolve to the two hosts the
CSP permits and no other.

**The Hindi note is per model and it is honest.** `hindi: 'poor' | 'limited' |
'usable'`. A tool whose hard rule is equal bilingual footing owes a reader
choosing a 1B model the information that its Devanagari will be rough, before
they spend a gigabyte finding out.

### 4. `CONSENT_VERSION` 1 → 2, because "nothing leaves the device" acquired a footnote

Nothing the reader **types** leaves the device on Tier 0 — there is no `fetch`
in the provider, the engine or the protocol. But the model itself arrives over
the network once, and version 1's notice described Tier 0 as an option that did
not exist. `flags.ts`'s own rule is to bump when the substance of what leaves
the device changes, and a device that makes no request at all and a device that
fetches a gigabyte once are not the same device. Every device reads the notice
again; the Tier 0 line now names the download.

Three smaller consequences of the tier being real:

- **`estimateCost()` returns 0 for any id in the catalogue.** `resolveModel()`
  prices an unknown id at the DEFAULT model's rate, which is right for a
  mistyped settings row and very wrong here: it would show a dollar figure for
  tokens nobody was billed for, on the one tier whose entire promise is that
  nothing was sent.
- **`runAgent` skips the monthly ceiling when `tier === 'local'`.** That ceiling
  is a _spending_ cap — it sits under "what this costs you" in Settings — and
  refusing an on-device answer in the last week of the month because of a number
  about somebody else's bill would be absurd. There is a test on the negative
  side too: a paid tier at the same exhausted budget still stops. Without it,
  "skipped for local" and "never enforced" are the same passing test.
- **`tierReady('local')` is `settings.localModelInstalled`**, mirrored from the
  Cache API and reconciled on every render of the section, exactly as `hasKey`
  is reconciled against the vault. A surface must be able to decide whether to
  render without awaiting a Cache API round trip, and a reader pressing "Ask"
  must never be the thing that starts a gigabyte of download.

### 5. Tier 2's row is hidden; Tier 0's refusals are not. ADR-030's rule is narrowed, not dropped

ADR-011 and ADR-030 said: show a disabled option with a reason, never a hidden
one — a hidden option reads as a missing feature. That was right when both
unbuilt tiers were coming and the reader deserved to know.

With Tier 0 shipped, a build with no `VITE_AI_PROXY_URL` has two tiers that
work, and a permanently disabled third that says "not configured in this build".
What survives the rule is **who can act**. Tier 0's refusals name the reader's
own device — "this graphics card cannot run the 16-bit version, choose the
32-bit one" — and they can act on every one of them, so those stay visible and
disabled. "Not configured in this build" is about somebody the reader has never
met. `tierPickable()` is that question, `tierAvailable()` is the other one, and
they are separate functions because they are separate questions. The consent
modal filters on the same predicate: a notice describing a tier the app will
not offer is a notice about a different app.

### 6. The Worker's four guards are pure functions, and miniflare proves the wiring

`worker/` is a standalone package: its own `package.json`, its own tsconfig, its
own lockfile, its own CI job, and deliberately not part of the app's install.
Pulling workerd (~90 MB) into the app's dependency tree to test a Worker the app
does not import would be the wrong trade; leaving it untested because
`pnpm check` cannot reach it would be worse, which is why it has a job rather
than a promise in a README.

The split inside it is the same one `src/lib/**` has from the components.
`policy.ts` holds every decision — CORS, model allowlist, fixed-window rate
limit, daily token budget — as pure functions over plain values, and
`test/policy.test.ts` proves them by calling them. A limit that is off by one is
invisible to an integration test that sends one request. `test/worker.test.ts`
then runs the same Worker in **miniflare**, with the upstream stubbed by
`outboundService`, and proves the two things only a runtime can settle: that the
outbound request carries the operator's key and **none** of the caller's headers
(asserted with sentinels in a cookie, a referer, an `authorization` and a
caller-supplied `x-api-key`), and that an SSE body is streamed through rather
than buffered.

Three decisions worth recording:

- **A missing var falls back to the default; an explicit `0` does not.** Zero is
  meaningful here — "refuse everything" — so `Number(undefined)` quietly
  producing it would turn a typo in `wrangler.toml` into a Worker that looks
  deployed and answers nothing.
- **The rate-limit counter is written before the request is forwarded.** Counted
  after, a caller who reliably triggers an upstream error is never counted at
  all and can hold the limiter open indefinitely.
- **The budget is checked before and written after**, so the ceiling is crossed
  by at most one request rather than enforced to the token — the same shape
  `runAgent`'s own monthly stop has, and `test/worker.test.ts` asserts exactly
  that behaviour so it cannot drift into something looser without a failure.

KV's eventual consistency and its one-write-per-second-per-key limit mean a
burst inside one second can undercount. That is stated in the code, in the
README and in `docs/DATA-GAPS.md` #14 rather than worked around: these limits
exist to stop one caller draining an operator's credit over minutes, and a fixed
window in KV does that on the free tier. A Durable Object would count exactly and
is the named upgrade path.

`.github/workflows/deploy-worker.yml` is `workflow_dispatch` only, with a typed
confirmation input, and it never touches `ANTHROPIC_API_KEY` — a workflow that
could write the key would be a workflow that could read it back out of a log.
Publishing a static site is free and reversible, which is why `deploy.yml` is
automatic; publishing a Worker that spends money on every request it forwards is
neither.

### 7. What the build had to learn about a 6 MB dependency

`@mlc-ai/web-llm` is ~6 MB raw, 2.1 MB gzip — by a wide margin the largest thing
in this build. Three mechanisms keep it from costing anyone who does not want it,
and all three need to be able to **name the file**, which is why
`vite.config.ts` gives it a fixed chunk name via `manualChunks`:

1. **`globIgnores`** keeps it out of the service worker's precache. Precaching it
   would charge every installed device — including every device that will never
   turn AI on — 2.1 MB for a library only a Tier 0 reader loads. Same rule
   `og.png` gets, at more than a hundred times the size. The `NetworkFirst`
   runtime rule still caches it once fetched, so a reader who _has_ chosen
   Tier 0 keeps working offline.
2. **`scripts/size-budget.json#chunkExemptions`** records why it is past the
   256 KB per-chunk budget, in the one file both the CI gate and the unit test
   read.
3. **`tests/no-external-urls.test.ts`** permits `huggingface.co`,
   `raw.githubusercontent.com` and `webgpureport.org` — the first URLs on that
   allowlist that the app really does fetch — and then confines all three to that
   one chunk, exactly as the OOXML namespaces are confined to `docx`. An
   application module that started naming `huggingface.co` fails there. A second
   assertion proves the chunk is on neither `index.html` nor `sw.js`.

The CSP moved too, and that closes `docs/DATA-GAPS.md` #57 and #61.
`script-src` gains `'wasm-unsafe-eval'` — WebAssembly _compilation_, which Tier 0
needs, is a different capability from string _evaluation_, which nothing here has
ever needed. `connect-src` gains the Tier 1 endpoint and Tier 0's two model
hosts. `tests/e2e/csp.spec.ts` now compares both directives as **token lists**
rather than with `toContain`, because `toContain("script-src 'self'")` is
satisfied by any wider value beginning that way — including one that had quietly
grown `'unsafe-eval'`, which `toContain("'unsafe-eval'")` would then have matched
as a substring of `'wasm-unsafe-eval'` and reported as present when it was not.
Substring matching on a security policy is how a policy gets wider without
anyone noticing.

Tier 2's origin is not in `public/_headers` at all: it is known only at build
time, so `vite.config.ts` appends `VITE_AI_PROXY_URL`'s origin to `connect-src`
in `dist/_headers` when a build sets one, and fails the build loudly if the
directive it is supposed to extend has moved. The policy and the feature ship
together or not at all. `tests/no-external-urls.test.ts` reads the same variable
so an operator's own build passes their own sweep.

### 8. What the Playwright spec can and cannot prove, and what it does instead

Headless Chromium has no WebGPU adapter, and a test that really downloaded a
gigabyte of weights would be a test of Hugging Face's uptime. So
`tests/e2e/ai-local.spec.ts` proves the things that are actually about this app:
choosing the tier and reading the whole model list **contacts nothing** (no
`allowCrossOrigin` is declared, so the automatic gate fails the test on any
cross-origin request); a device that cannot run a model is told so, in its own
words, and the Download button is disabled rather than offering a wasted
gigabyte; the section passes axe; and with AI off none of it renders.

The domain assertion is the one that needed care. With `navigator.gpu` stubbed
and every cross-origin request answered `404`, the spec records where the
download went and asserts every host is one of the two. Its first version waited
for a `role="status"` element before reading the list — and the progress region
says "0% downloaded" the instant the button is pressed, so it read an empty list
and failed with "the download reached no host at all", which is indistinguishable
from a real defect. It polls the list itself now. A test whose failure message
describes something other than what went wrong is worse than no test.

### Addendum — one defect, found after the commit, in somebody else's agents

`toolProtocolInstruction`'s answer-only form ended with "cite the result you
took it from by its handle, in square brackets, like `[T1]`", and it was used
for **every** turn that could not call a tool — including a run that never had
tools at all.

`src/ai/agents/{pay,tutor}.ts` are exactly that shape (§7B of `docs/AI.md`):
they fetch in code before the model runs and pass `tools: []`, so their model
sees numbered PLATFORM CONTEXT cited as `[1]`, `[2]` and no tool results at
all. `context.ts#CITATION_PATTERN` is `/\[(\d{1,3})\]/` and does not match
`[T1]`. So a model that did as it was told cited nothing that
`validateCitations` could see, every provision number in the answer landed in
`unsupported` — and those problems are pushed **regardless of
`requireCitation`**, which is the part that made it fatal rather than merely
untidy. A tutor "Explain" correctly saying "Rule 3 of the CCS (Conduct) Rules"
would have ended with `invalid_citation` on Tier 0 and on no other tier, and
the cause would have been this instruction rather than anything wrong with the
answer.

The toolless form now describes only the JSON envelope — the one thing this
block knows that the persona does not — and defers the citation rule to the
persona and the context block, which are identical on every tier and were
already right. Two regressions cover it, in `protocol.test.ts` and through the
real `runAgent` in `local.test.ts`, and both were confirmed to fail against the
committed code first.

The general lesson is narrower than "test it": **a prompt fragment that names a
citation format is making a claim about a validator it cannot see.** This one
was appended by the provider, which is the layer furthest from the agent that
decides what a citation means — so it could contradict four agents at once
without any of their tests noticing, because none of them runs on Tier 0. Any
future per-tier prompt addition belongs beside the rule it is restating, or it
should say nothing about citations at all.

`src/ai/prompts/law.md`'s "The run has two halves and you are told which one you
are in" is the worked example, and it was already in the repository when this
was written: `[T1]` for the research pass, where tool results exist, and `[1]`
for the answering pass, which is given "no tools at all". That agent was never
affected — its answering pass passes a `jsonSchema`, so `LocalProvider` takes
the `raw` path and appends no protocol block at all — and `prompts/drafting.md`
names no citation format. Pay and tutor were the whole blast radius, precisely
because their personas did not restate the rule and so had nothing to
contradict the provider's copy of it. Read that section of `law.md` before
adding a citation instruction anywhere.

### Addendum 2 — an edge-case pass, five defects

Each was confirmed to fail against the committed code before its fix, the rule
`src/lib/srs/edge.test.ts` and `src/ai/agents/drafting.edge.test.ts` already
follow. Four of the five are the same shape as the `[T1]` defect above: **the
provider made a decision on behalf of callers it cannot see.**

1. **An envelope whose answer is empty showed the reader the envelope.**
   `firstString` demanded a non-empty trimmed string, so `{"answer": ""}` found
   no answer, found no tool name, and fell through to the "this is prose"
   branch — putting the literal characters `{"answer": ""}` on screen under a
   heading that says Answer. `null`, a number and an array did the same. A model
   constrained to emit that envelope and having nothing to say produces exactly
   this shape, and on a 1.5B model it is not rare. The key is now checked for
   PRESENCE, and `runAgent` reports `empty`, which is what happened.

2. **Token events were suppressed on a structured turn, and no other provider
   does that.** `wire.ts` emits one for every text delta, schema turn included.
   The single consumer of those events is `src/ai/agents/law.ts`'s answering
   pass — which passes a `jsonSchema` and reads the half-arrived JSON with
   `partialAnswerText()`, a function that exists for precisely this. So the
   suppression protected nobody and silenced the only streaming surface in the
   app, on the slowest tier, where a run is half a minute rather than three
   seconds. Worth noting how it survived review: the original commit shipped a
   test asserting the suppression, so the defect had a test defending it.

3. **Two engines could initialise on one WebGPU device.** `ensureLocalEngine`
   returned the in-flight promise only when the model ids matched and otherwise
   called `load()` immediately; `load()` unloads the current engine first, but
   during another load there is no current engine yet. The comment there claimed
   callers of a different model "have to wait", which nothing enforced —
   an invariant described rather than implemented. Loads are serialised through
   one queue now, and in-flight loads are joined by id. Reachable: a reader with
   a run streaming on `/law` walks to Settings and presses Download.

4. **An unload during a load was silently undone**, because the finishing load
   just reassigned `engine`. A monotonic `epoch`, bumped before `unloadLocalEngine`
   awaits anything, lets the load see that it is obsolete, release the engine it
   just built, and fail as `aborted`. The same epoch fixes a wrong diagnosis:
   a generation whose engine is unloaded mid-stream fails with a lost WebGPU
   device, which `loadFailureMessage` maps — correctly for a load, wrongly here —
   to "ran out of graphics memory, choose a smaller model". Acting on that means
   downloading a smaller model to fix something that was never about memory.

5. **The Worker forwarded `max_tokens: NaN`** — `typeof NaN === 'number'`, and
   `Math.floor`/`Math.min`/`Math.max` all propagate it, so `JSON.stringify`
   wrote `null` and the operator's key was spent on a request Anthropic answers
   with a 400. And **a trailing slash in `ALLOWED_ORIGINS` 403'd everything**:
   an operator writes an origin the way they write a URL, a browser never sends
   one that way, and `README.md` documenting "no trailing slash" described the
   footgun instead of removing it. Configured origins are normalised; a REQUEST
   Origin carrying a slash is still refused, because no browser sends that.

**One thing this pass could not test, and one it nearly got wrong.**
`vi.mock` is not stable under **concurrent** dynamic import of the same
specifier — a second overlapping `import()` resolves to the real package, which
here failed with `caches is not defined` and looks exactly like an application
defect. The first concurrency probe was therefore worthless, and was discarded
rather than acted on. What made `engine.ts` testable at all was hoisting the
library behind ONE memoised `webllm()` promise, which is a real improvement
independently (four call sites, several megabytes of parsing). Its
reset-on-failure branch remains uncovered and says so in the source: reaching it
needs a mid-file mock swap, and `vi.doMock` reports its own wrapper error rather
than the thrown one, so the only available assertion would have been about
vitest.

### Consequences

- Tiers 0 and 1 ship in every build; Tier 2 ships the moment somebody deploys
  `worker/` and rebuilds with `VITE_AI_PROXY_URL`. `docs/AI.md` §12 is the order.
- `AiSettings` gains `localModel` and `localModelInstalled`. `flags.ts` gains one
  runtime import — `src/ai/local/catalogue.ts`, five object literals and two
  `Array.find` wrappers with no URL and no import of its own — because a parser
  that cannot check a value is not a parser. Nothing else may be added there.
- The initial route is unchanged at 144.2 KB gzip against a 250 KB budget.
- Three unit files and one spec are new for Tier 0 (78 tests); `worker/` adds 42
  of its own, in its own runner.
- `docs/DATA-GAPS.md` #57, #61 and #67 close. #13 and #14 are rewritten to what
  is actually left — the honest quality of a 1.5B model's Hindi, and the fact
  that nobody has run the Worker against a real key. #68 and #69 are new.

---

## ADR-038 — The Library: a reading module that points at the corpus instead of copying it, a table of contents that admits where it has none, and a Hindi gap stated in both directions

**Status:** Accepted (Session 26)
**Context:** The app already ships 5.5 MB of statute — 818 rules across twelve books and 1,059
sections across three Sanhitas — and until now every one of those bytes was reachable only through a
question. The Law Converter answers "what replaced IPC 302"; the Trainer asks "which rule is this";
the Drafting Studio quotes CSMOP at you while you write. Nobody could sit down and READ the CCS
(Conduct) Rules from Rule 1 to Rule 24, which is what an officer preparing for a departmental
examination actually wants to do. This session builds that surface. No statutory text was fetched.

### 1. A work is a POINTER, never a copy

`data/library/works/*.json` carries an id, a title, a category, a table of contents, a reading order,
an estimate, a citation — and `corpus: { kind, file }`, which names
`data/rules/text/<act>.json` or `data/law/<code>.json`. It carries no provision text at all.
`test_library_seed.py` asserts the absence of a `text` key in a built work, because the alternative
is the failure mode this project has spent five sessions avoiding: a second copy of a statute that a
dataset refresh cannot correct. The weekly NCRB ingest can rewrite `data/law/bns.json` and the
Library is corrected with it.

The cost of that decision is a promise: every unit id in a work file has to resolve. `tests/library-data.test.ts`
is where that is enforced, in both directions — every id in the reading order exists in the pointed-at
corpus, AND every record in the corpus is reachable from the reading order. A work that lost a rule
would otherwise be a rule nobody could navigate to, and nothing else in the suite would have noticed.

`src/lib/library/data.test.ts` covers the other half: it loads all fifteen works and all fifteen
corpora through the real `?raw` specifiers. Those thirty import paths are written out one per file
because a bundler can only chunk a specifier it can see, and a hand-written list of thirty paths is
thirty chances to typo one — a mistake that `tests/library-data.test.ts` cannot see, because it reads
the same files with `node:fs`.

**The corpus specifiers are deliberately the same strings the Law Converter and the Rules Trainer
already use.** Rollup gives one chunk per resolved specifier, so a reader who has opened `/law` and
then opens the BNS here downloads nothing new.

### 2. Three loaders, three costs

The shelf (`data/library/index.json`, ~11 KB) draws fifteen cards. A work (8–220 KB) draws one table
of contents and carries no statutory text, so `/library/:workId` renders a 531-row contents list for
the BNSS without touching the 1.9 MB corpus. Only the reader pays for the corpus — and on the work
page, only once the reader has typed a search worth running. Same lever `useLawEngine(enabled)`
pulls.

`practiseCounts` exists for this reason. "How many Trainer cards cite this rule" is a genuinely
useful thing to show beside a rule, and answering it at read time would mean downloading
`data/rules/cards/gfr.json` — 1.1 MB — to find out whether there is anything to practise. It is
counted at build time instead, from `reviewState === 'approved'` only (an unapproved card is never
served, and sending a reader to an empty review is worse than saying nothing), and
`tests/library-data.test.ts` re-derives it in TypeScript from the same card files. That seam — a
Python script writing a number a TypeScript surface reads — is exactly where a `reviewState` spelling
would drift with nobody seeing a wrong figure.

### 3. Where the corpus has no structure, the app says so

The session brief was explicit: produce a flat table of contents rather than inventing structure, and
record it. `tocSource` is that record, with three values.

- `chapters` — `data/law/*.json` records a chapter per section, so the three Sanhitas get a nested
  contents list with NCRB's own chapter titles.
- `numbering` — CSMOP numbers its paragraphs `4.7`, so grouping on the part before the dot reads
  structure the manual itself prints. The chapter TITLES are in no dataset here, so each node is
  labelled by its number alone (`अध्याय 4`) rather than by a heading nobody published.
- `flat` — the other eleven rule books, one node per rule, 307 of them for the GFR.

The work page states which of the three it is showing, in both languages. `docs/DATA-GAPS.md` #70 has
what closing the gap would take, and it is a change to `extract_rules.py` rather than to this module —
a chapter heading is a line that parser currently walks past, and writing it onto each rule would
improve the Trainer's Browse screen at the same time.

### 4. The Hindi gap runs in BOTH directions, and this is the surface that made that visible

The known half was: no Ministry publishes a Hindi issue of any of these fifteen documents with a
readable text layer (ADR-023), so `text.hi` is empty for all 1,877 units. A reading module cannot
paper over that. `mode: 'hi'` renders the English text under a bilingual notice that says so and says
nothing here is machine-translated — an announced fallback, which the master context permits, rather
than the silent one it forbids.

The half nobody had seen: **221 units have no ENGLISH heading and do have a Hindi one.** Four rule
books print no heading `extract_rules.py` could read — the whole of FR/SR and CSMOP among them — and
Session 20 authored Hindi headings for all of them. So those units read better in Hindi than in
English, which is the equal-footing rule failing in the direction nobody looks. Nothing was invented
to fix it: `library_seed.py` quotes the unit's opening ~96 characters as an `excerpt`, which is the
same fallback `make_cards.py` already puts on a rule-card front, and it is emitted ONLY where a
heading is missing. `unitLabel()` in `src/lib/library/label.ts` is the one place that decides what to
show, and it reports which language it actually returned so the markup can set `lang` correctly and
italicise a quotation. `docs/DATA-GAPS.md` #71 has all three sub-gaps and what closing each costs.

### 5. Splitting a statute for reading is safe only because joining it back is asserted

The twelve rule books store a rule as one unbroken string — CCS (Conduct) Rule 3 is 4,000 characters
on one line — which renders as a wall. `paragraphs()` breaks before a numbered sub-clause, a proviso,
an explanation and an illustration, which are the four places a printed rule book itself breaks.

That is doing something presentational to a statute, so the guarantee is explicit and tested:
`paragraphs(text).join(' ')` is `text` with its whitespace collapsed, asserted over **every unit of
every one of the fifteen works**. Without it a regex that ate a character would be invisible on
screen and wrong in a way somebody would act on.

Two things that pass came out of writing it. `/परन्तु\b/` matches nothing, ever — JavaScript defines a
word boundary over `[A-Za-z0-9_]`, so the Devanagari half of a symmetric-looking pattern silently
covered one language. That is the same trap `src/ai/agents/law.ts#SECTION_MENTION` records (ADR-035),
hit again in a completely different file, and the Devanagari test in `library.test.ts` is what caught
it.

### 6. `unit.parts` is a re-segmentation, and rendering it beside the body prints the rule twice

`data/rules/text/*.json` stores `subRules[]` as verbatim slices of the same `text` — all 219 rules
that have them, which `library.test.ts` now asserts. The first version of the reader rendered the
body AND the parts list, so every rule with sub-rules appeared twice on the page. Each half was
individually correct, jsdom would never have shown it, and it was found by reading a Playwright
failure's page snapshot for a different bug.

The same mistake had a second face. `hindiTextMissing` was
`body.hi.length === 0 && parts.length === 0` — and `parts` counts records regardless of language, so
for those same 219 rules the "Hindi is not available" notice never rendered and the English text
appeared silently under a Hindi setting. That is precisely the silent fallback the master context
forbids, shipped by a condition that was one clause too clever. It is `body.hi.length === 0` now.

`parts` is kept on `LibraryUnit`, documented as what it is, and rendered by nothing: a sub-rule
number is a real citation, and Session 27's highlights and notes will want an anchor finer than a
whole rule.

### 7. Reading state is per unit, in IndexedDB, and progress is written on arrival

Dexie version 11 adds four tables. `libraryProgress` and `libraryBookmarks` are keyed
`"<workId>:<unitId>"` — the shape `holidayPicks` uses, and necessary here rather than decorative,
because a law unit id is a bare section number that is unique only within its own code.
`libraryHighlights` and `libraryNotes` are declared and written by nothing until Session 27, the
arrangement version 2 made for the AI tables: a dormant table costs nothing and means the kill
switch, the backup and `clearAllData` all know about it on day one.

Progress is written on ARRIVAL and then every 30 seconds of dwell. Arrival carries zero seconds, so
StrictMode's double mount writes the same row twice rather than two rows, and `secondsRead`
accumulates only from the timer, which StrictMode's cleanup cancels. "Continue reading" therefore
points at the unit the reader stopped IN, not the last one they finished — which is the whole point
of the row.

### 8. The nav gains a sixth destination and loses none

`src/lib/nav.ts` is still the one list. The Library is deliberately not `flagship`: the four visible
bottom-bar tabs are the four modules an officer opens on a phone between one thing and the next, and
reading a rule book end to end is not one of them. `shell.edge.test.tsx` now asserts the four
flagship ids BY NAME rather than by count, because a swap keeps the count at four and a reader who
loses a tab they use every day would find out from the phone in their hand.

Two Playwright specs failed on this and both were hard-coded counts of six destinations. Both now
derive: `nav.spec.ts` reads the expected count from the widest viewport, where the sidebar shows
everything there is, and reads the More sheet's tab order from the sheet itself. A literal there is a
second copy of `src/lib/nav.ts`'s length that goes stale the next time a module is added — and when
it did, the failure said nothing about breakpoints, which is what that test is for.

### 9. The serif is the system serif

The reader offers four size steps, two typefaces and two line spacings. The serif is `--font-reading`,
a stack of faces already on the machine with the bundled Noto Sans Devanagari catching the fall — not
a fourth self-hosted family. ADR-018 refused ~25 KB of woff2 for the pay slip's numerals; a reading
PREFERENCE does not get to spend more than a pay slip did.

Relaxed spacing is FORCED whenever Devanagari is on screen, per the master context's ≥ 1.75 rule. The
control is disabled with the reason stated rather than hidden — ADR-030's line, applied again.

### Consequences

- 15 works, 1,877 units, ~57 hours of reading, 824 KB of structure over 5.5 MB this repo already had.
- Initial route unchanged apart from a nav label and one `versions.json` entry; 145.0 KB gzip against
  a 250 KB budget.
- `docs/DATA-GAPS.md` #70 and #71 are what is left open, and neither is a defect in this module.
- `src/schemas/` is a new directory. The Library's shape is read by two places that are not the
  module — `src/lib/library`, which is pure and must not import a module, and the tests that read the
  committed bytes off disk — which is why it does not live at `src/modules/library/schema.ts` the way
  the four schemas before it do.

### ADR-038 addendum — an edge-case pass, twelve defects, and where every one of them was

A requested pass over the Library after the commit. Twelve real defects, each confirmed to fail
against the committed code before its fix was written — `src/lib/library/library.edge.test.ts` (14)
and `src/modules/library/library.edge.test.tsx` (22) are the regression files, plus one in
`tests/e2e/library.spec.ts` that no test renderer can hold (defect 12).

**All twelve were in the code around the data, and none in the data.** That is the pattern ADR-032's
addendum named for the drafting agent and ADR-035's repeated for the law agent, arriving a third time
in a session with no model in it at all. The dataset was obviously untrusted, so it is schema-validated
twice, its pointers are checked in both directions, and its structure is asserted over every unit of
every work. The pages, the loaders and the store were written as though code cannot fail.

1. **`isWorkId` said yes to `constructor`, `toString`, `hasOwnProperty`, `valueOf` and `__proto__`.**
   `WORK_LOADERS` is an object literal and `in` walks the prototype chain, so a work id out of the
   address bar could name a function on `Object.prototype`, be called as though it were a dynamic
   import, and fail inside `JSON.parse` with a message naming neither the work nor the problem.
   `Object.hasOwn` throughout, via one `loaderFor()`. Nothing was exploitable — no secret to reach,
   no network to reach it over. It was a guard saying yes to what it was written to say no to.

2. **`recordProgress` rejected on a device whose storage is refused.** It is called from an effect on
   arrival at every unit and from a 30-second interval after that, so a private window or a managed
   device with site data blocked produced an unhandled rejection every half minute. It returns
   `false` now rather than throwing — and there is a test on the positive side too, because without
   one "reports false when it fails" and "never writes anything" are the same passing test.

3. **All three screens blocked their whole render on a Dexie read they only decorate themselves
   with.** Read ticks, the progress ring and the bookmark state are conveniences; on a device where
   `useLiveQuery` never produces a value, the hub, the work page and the reader each sat on a
   skeleton for ever — with the library the reader wanted sitting in a precached chunk that needs no
   database at all.

4. **"Continue reading" was offered only on the work last opened.** The brief asks for two separate
   things and the committed hub answered both with one variable, so a reader half way through the CCS
   (Leave) Rules who then opened the BNS lost their place in the Leave Rules entirely: the ring said
   40% and there was nothing to press. `shelfProgress()` answers both questions in one pass now, and
   the file tab still marks exactly one card — asserted on its own, so the fix cannot drift into
   fifteen tabs.

5. **"Nearby in this work" was empty for eleven of the fifteen works.** `tocPath` returns a single
   node for a flat table of contents, so `path.at(-2) ?? path.at(-1)` resolved to the LEAF, whose
   `unitIds` is the one unit the reader is already on. Every rule book except the three Sanhitas and
   CSMOP — which is where an officer actually reads — rendered nothing there. The fallback has to be
   the whole work, not the leaf.

6. **Search results were labelled by a hand-rolled fallback instead of `unitLabel`.** FR/SR and CSMOP
   publish no heading this repository could extract, which is the entire reason `unitLabel` exists —
   and every hit in either of them rendered a section number beside an empty string. Worth noting how
   nearly this was missed: the first version of its test read the whole row, which also carries a
   snippet of the body, and passed against the broken code. It asserts on the row's own two elements
   now.

7. **The progress ring told a reader who had started that they had not.** One section of the BNSS is
   0.19%, which `Math.round` makes zero, which read as "Not started". The arc being invisible at that
   width is honest; the words were not. Anything above zero reads `<1%` at worst and draws a minimum
   visible tick.

8. **An id naming no work rendered a red failure card instead of going back to the shelf.** A wrong
   URL and a failed load are different questions with different answers — and
   `tests/route-coverage.test.ts` had been exempting `/library/:workId` on the stated grounds that it
   "renders the not-found redirect", which was simply not true. An exemption whose reason is untrue
   excuses nothing while looking as though it does.

9. **`j`, `k` and Home fired underneath an open dialog.** ADR-029's addendum, defect six, in a new
   file: a bare-key shortcut fired under an open sheet navigates away and leaves the sheet showing
   over a page it was never opened on. `useGlobalShortcuts` guards on a live `[role="dialog"]` query
   and this handler shipped without one.

10. **The dwell timer accumulated in a background tab.** A unit left open overnight recorded eight
    hours into a field called `secondsRead`, which Session 27 is going to surface. The arrival write
    stays unconditional — arriving is what "continue reading" reads back.

11. **`useReaderPrefs.update` lost a rapid second change**, computing its patch from the last
    render's `prefs` while `useLiveQuery` was still a tick behind. It reads the stored row inside the
    write now, and it no longer rejects: a device that cannot keep a preference must lose the
    preference, not throw out of an onClick.

12. **`j` then `k` went forward one and back two — and the fix for a lint error is what put it
    there.** `react-hooks/refs` correctly refused a ref assigned during render, so the reader's key
    handler became a mount-only listener reading a "latest ref" updated in an effect: the shape
    `useGlobalShortcuts` uses. That shape's precondition does not hold here. It exists for a handler
    carrying state ACROSS keypresses — a pending `g` chord and its timer — which a re-subscription
    would destroy; this handler is stateless, and its target depends entirely on where the reader
    currently is. A ref updated in a passive effect lands after paint, so a `k` arriving between
    React Router committing the navigation and that effect running read the PREVIOUS unit's
    neighbours: from Rule 3 to Rule 1.

    Re-subscribing the listener per unit was the obvious repair and it is also wrong, for the same
    reason one level down: the new listener is attached in a passive effect too, so the window only
    narrows. It went from failing every time to failing about one run in six, **which is worse** — a
    deterministic failure is a bug report and a flake is an argument.

    What is actually correct is not to consult a per-render snapshot at all. `unitIdFromPath(
window.location.pathname, workId)` is authoritative because the navigation updates the URL
    synchronously, before any of that; the rendered `unitId` stays as the fallback for `MemoryRouter`,
    which does not touch `window.location`. Twelve consecutive passes on the project that was flaky.

    **The jsdom test for this passes against every broken version**, because React flushes passive
    effects between two `userEvent` interactions and the window never opens under a test renderer.
    It is kept — the sequence is worth asserting — with a comment saying plainly which layer holds
    the guarantee, so nobody reads it as the thing that covers this. `tests/e2e/library.spec.ts` is.
    That is the same lesson `network.sentinel()` taught in ADR-031: break the code and watch the new
    assertion go red before believing it.

Two smaller things the pass settled rather than fixed. `estimateReadTime`'s trailing
`|| words.length / WPM[lang]` could not fire — `minutes` is zero only when there are no words, which
the guard above has already returned for — and with it gone the `lang` parameter provably carried no
information, so **the brief's own signature was narrowed to `estimateReadTime(text)`**. The rate is
picked per word by the script that word is written in, which is strictly better than a
reader-language rate and is what the corpus needs; a parameter that does nothing and a branch nothing
can reach are the same lie told twice. And the unit-change effect's `scrollIntoView` is now optional-
called: every browser this app targets has it, jsdom does not, and an effect that throws takes the
whole route down through `App.tsx`'s ErrorBoundary. That one is why the reader could not be driven in
a component test at all — it crashed on the first `j` press, which is how the pass found it.

## ADR-039 — The Library's annotation layer: an anchor that can admit it is lost, one grammar generated twice, and a warm surface that is not cream paper

**Status:** Accepted (Session 27)

**Context:** Session 26 built a reading module over a corpus this repository already ships (ADR-038).
An officer could read the CCS (Conduct) Rules end to end and could not mark a single line of them.
This session adds what turns reading into study: highlights, margin notes, bookmarks with labels, a
place to see all of it, defined terms, inline cross-references, a side-by-side comparison,
quick-reference tables, amendment notices, read-aloud, and documents the reader adds themselves.
Everything device-only, offline, bilingual.

### 1. A highlight is two offsets AND the text it covered, and it is never dropped

The obvious storage for a highlight is a pair of character offsets. It is also wrong on its own,
because the thing it indexes into is not stable: `data/law/*.json` is rewritten weekly by the NCRB
ingest, and a word inserted ahead of a highlight moves every offset after it. Offsets alone would
silently mark the wrong words — worse than losing the highlight, because nothing would look wrong.

So the row carries `quote`, and `resolveAnchor` (`src/lib/library/anchor.ts`) answers in three
states: `exact` (the offsets still hold), `reanchored` (they did not, and the quote was found —
nearest to where it used to be, which is the only defensible rule when a rule repeats a phrase), and
`lost`. **A lost highlight is listed, never deleted.** It appears in My Study under "needs attention"
with the words the officer marked and a sentence saying what happened. An officer's own mark is not
this app's to expire.

Two more things make the offsets mean anything at all:

- **They index into ONE normalised string per unit per language.** `anchorText()` is NFC-composed,
  whitespace-collapsed, and is exactly what the reader renders — `AnnotatedBody` slices it and each
  paragraph carries its own `data-para-start`. That works only because ADR-038 §5 already asserts
  that `paragraphs(text).join(' ')` reproduces the text with whitespace collapsed; this session's
  `anchor.test.ts` asserts the dependency rather than assuming it.
- **`lang` is on the row.** The English and Hindi renderings are different strings of different
  lengths. A highlight made in English never renders on the Hindi pane, and `resolveHighlights`
  drops the other language's rows rather than resolving them — otherwise "re-anchor by quote" would
  cheerfully find an English phrase inside the English fallback shown under a Hindi setting.

The whole scheme has one precondition, stated at `src/modules/library/selection.ts`: **nothing inside
a paragraph may render text the provision does not contain.** `Range.toString().length` is what
counts characters, and it counts an `sr-only` label too. Decoration goes on attributes; controls go
outside the paragraph.

### 2. A highlight nests INSIDE a citation, never the other way round

Three layers are drawn over the same words: the reader's highlights, the terms the document defines,
and the citations it makes. Highlights genuinely overlap each other and are split by
`segmentParagraph`; a citation or a defined term is ONE clickable thing and is the outer element.
Reversing that cuts a link in half at a highlight boundary and hands a screen reader two controls
where the document has one.

That leaves one real cost. Clicking a highlight to recolour it needs a `<button>`, and a button
inside a button is invalid markup — so a highlight sitting under a citation is painted and not
clickable. It is reachable regardless: the annotations panel under the text lists every highlight as
a real control, which it has to do anyway for the ones the corpus moved out from under.

### 3. A margin note is parsed to an AST, never to HTML

`src/lib/library/markdown.ts` implements five things — bold, italic, links, wiki-links and lists —
and returns nodes. `NoteBody` walks them, so React escapes every leaf. Nothing in this app calls
`dangerouslySetInnerHTML`, and a note is the one place where text a person typed is rendered with
structure; handing a renderer markup rather than nodes is how that becomes an injection surface. The
one thing React does not escape is a URL in an attribute, so `safeHref` refuses anything that is not
http(s) or a route inside this app — and a refused link renders as its own text, visibly, rather than
as a control that does nothing.

Two tabs on one unit is a real case (it is how an officer compares two rules) and both autosave.
Last write wins, which is the only resolution available without a merge interface nobody asked for —
but `isStale` compares the stored row against the one this tab last wrote, so the tab that lost is
TOLD, and offered the stored version. And "Saved" is set from the write resolving, never from the
debounce firing: reporting an intention as an outcome is how an officer closes a tab on a note that
was never stored.

### 4. The definitions and quick-reference datasets are generated by running the app's own parsers

`data/library/definitions/*.json` and `data/library/quickref/*.json` are the first datasets in this
repository written by a **Node** script rather than a Python one, and the reason is a rule this
project already holds: two implementations of one grammar is one implementation that drifts.

These parsers must run in the BROWSER, over a document the reader added themselves — the session
brief asks for exactly that. A Python copy for the fifteen bundled works and a TypeScript copy for
everything else would be two grammars, and only one of them exercised by `pnpm test`. So
`scripts/library-extracts.mjs` loads `src/lib/library/definitions.ts` and `quickref.ts` through
**Vite's own SSR module runner** — which resolves this project's `@/` aliases and compiles its
TypeScript exactly as the build does — and runs them over the committed corpora. No new dependency;
Vite is already here. Hand-run and on no cron, for the reason `pay_matrix.py` and `drafting_seed.py`
are not on one.

Both datasets carry CONFIDENCE, because both read a drafting convention rather than a
machine-readable field, and the convention is not kept perfectly. The CCS (Leave) Rules lost their
quotation marks in extraction; a period with no "within" is as likely to be a term of office as a
deadline. Anything below full confidence carries `verify: true` and the surface shows a badge. One
work is worse than that and is recorded rather than tolerated: CCS (Pension) rule 3 arrives with its
clause letters and quoted terms gone outright, and `UNPARSEABLE` in the generator names it with a
pointer to `docs/DATA-GAPS.md` #72 — so a NEW work that stops parsing still fails the run.

### 5. An amendment is a banner on the structure, never an edit to the text

An officer reading the RTI Act's section 8 in this app gets the clause Parliament substituted in
November 2025 — the old one. Editing the base text to fix that would make `data/library` a second,
divergent copy of a statute the ingest owns, which is precisely what ADR-038 §1 refuses; saying
nothing would leave the reader to find out elsewhere.

So `amendments` is a slot on the WORK, keyed by unit id, carrying a date, a bilingual note and a
source. Four are populated, each hand-sourced: the DPDP Act 2023 s.44(3) substitution of RTI
s.8(1)(j) (in force 13 November 2025, G.S.R. 843(E)), and the 1 July 2024 commencement of the three
Sanhitas — including that BNS s.106(2) was expressly NOT brought into force, which is the kind of
thing an officer needs and no dataset here would otherwise say. `library_seed.py`'s `self_check`
refuses a note keyed to a unit the work does not have, so a renumbered corpus fails the build rather
than silently dropping the one thing on the page that says the text is out of date.

### 6. Read aloud refuses a voice that is not on the device

`speechSynthesis` does not promise local synthesis. Chrome ships "Google" voices that synthesise on a
server, and choosing one would post the statute an officer is reading to a third party — against
this project's hardest rule. `SpeechSynthesisVoice.localService` says which is which, so
`usableVoices()` keeps only local voices and `noLocalVoiceReason()` distinguishes three cases (no
voices at all, only remote ones for this language, none for this language) so the notice can say
which. A remote voice is not ranked last; it is not offered, because a picker that lists one is a
picker somebody chooses from.

The controller (`ReadAloudController`) speaks one SENTENCE at a time, which is what makes the
reading position highlightable at all — `onboundary` is not implemented consistently enough to build
on, and one utterance per unit fires `onend` once, at the end. The generation counter exists because
`synth.cancel()` fires `onend` for the utterance it cancelled in most browsers, and without it
pressing Stop starts the next sentence.

### 7. "Sepia" is an 8% marigold wash, not cream paper

The brief asked for a sepia reading theme. `.claude/skills/frontend-design/SKILL.md` lists "cream
paper + serif + terracotta" under NEVER — it was this project's own superseded direction
(ADR-003/006) — and the reader already offers a serif, so a cream card would rebuild two thirds of it
as a preference. The request is answered inside the palette instead: `color-mix(in srgb, var(--marigold) 8%, var(--card))`,
no new token, nothing cream, text tokens untouched. It is composited `in srgb` deliberately, because
that is the arithmetic `src/styles/tokens.test.ts#tint` re-does when it asserts every text token
still clears AA on the result, in both themes.

### 8. A personal work widens the READER's type, not the dataset's schema

`libraryWorkSchema` requires a publisher, an official URL and a source. That requirement is load-bearing:
it is what stops a committed work shipping without a citation. A document the reader added has none of
the three.

So the reader takes `ReaderWork` — `LibraryWork` with `source` and `officialUrl` nullable and an
`origin` discriminator — and `fromDataset`/`fromPersonal` are the only two places that produce one.
Every surface that renders a citation, a source chip or a dataset version has to handle the null,
which is the point of making it nullable rather than filling it with something plausible. Three pure
helpers narrowed to structural subtypes for the same reason (`CorpusWork`, `OrderedWork`, `TocWork`):
a personal document must be navigable without being a dataset.

A personal work never leaves the device, is never presented as a source, and cannot collide with a
bundled id (`my-` prefix, asserted against the real `WORK_IDS`). Deleting one takes every highlight,
note, bookmark and progress row with it — the opposite of `deleteHighlight`, which detaches its note
rather than deleting it, and deliberately: a note whose highlight is gone is still about a rule that
exists; a note on a document that no longer exists can never be opened again.

### 9. "Add to trainer" reuses the one queue there is

A highlighted passage becomes a `proposedCards` row with `reviewState: 'unreviewed'` — exactly what
the AI `propose_card` tool writes — and `/learn/review-queue` is where a human accepts it, after
which `effectiveCatalogue` folds the approval over the dataset (ADR-027). No second path, nothing
that can reach the FSRS schedule, and no mutation of `data/rules`. The card is parsed through
`cardSchema` before the write and a shape it rejects is reported as a failure rather than as a card
the reader will go looking for — ADR-032's lesson about reading a confirmation back from the write.

It is offered only for a rule book this app ships. A card citing "my-office-order-abc rule 3" would
sit in the queue for ever with nothing to check it against, so the dialog says so rather than hiding.

### Consequences

- Dexie **v12**: `libraryPersonalWorks` is new; `libraryHighlights` and `libraryNotes` — declared
  dormant in v11 — get their real shapes and a `workId` index for My Study's filters. No `upgrade()`
  block: nothing had written either table, and the three added fields on existing tables are absent
  on every row written before this release, which every reader of them already treats as "not set".
- Five new routes, all in both sweeps. `tests/route-coverage.test.ts` refused the commit until they
  were, which is what it is for.
- Initial route **unchanged at 145.3 KB gzip**. pdf.js, mammoth and pdf.js's worker (~630 KB gzip
  together) are excluded from the service worker's precache like `web-llm`, and
  `tests/bundle-budget.test.ts` asserts their absence from the built manifest.
- `docs/DATA-GAPS.md` #72, #73 and #74 are what this session leaves open.

### Addendum — five things that were wrong first, and what caught each

1. **`नियमों?` does not mean "नियम, optionally plural".** `?` quantifies one code point and the
   Devanagari plural suffix is two, so that pattern reads as "नियमो followed by an optional
   anusvara" — it does not match the singular at all. `src/lib/library/refs.ts` had it on five unit
   words, and the effect was that `उप-नियम` matched NOTHING, so every Hindi sub-rule fixture came
   back with an empty path. This is the ADR-035 `\b` trap in a different costume and it is nastier:
   `\b` fails to match anything, which is loud once the Devanagari case is tested, whereas this
   matches a REAL but wrong string, so a test written against the plural passes and only the
   singular silently vanishes. Caught by the thirty-fixture table, which is why the table has Hindi
   halves at all. `isDefinitionsUnit` had the plain `\b` version too.
2. **A `manualChunks` entry that only NAMES a chunk changed what the entry loads.** Naming pdf.js so
   that `globIgnores` could refer to it put 125 KB gzip of PDF parser on the initial route — 269.8 KB
   against a 250 KB budget. `pnpm size` caught it. mammoth does not do this, so it keeps its name;
   pdf.js is matched by the name the chunker chose, and `tests/bundle-budget.test.ts` asserts the
   three chunks are absent from the precache so that a rename fails a test rather than quietly
   re-adding 630 KB to every install.
3. **A recursive parser sharing module-level sticky regexes walked its cursor BACKWARDS.**
   `parseInline` reads `STRONG.lastIndex` after recursing into the bold's own contents — and the
   inner call had reassigned it. It does not throw; it allocates until the process dies, which is how
   it presented: a Vitest worker killed by the heap limit with no failing assertion to point at.
   Every match now reads `lastIndex` before it recurses.
4. **A test that installs fake timers and then times out never restores the clock.** One leaked fake
   clock made the six tests after it hang for thirty seconds each, which reads as six broken
   components. A 500 ms debounce is cheap enough to wait out; the test uses real timers.
5. **A URL written to satisfy a type is still a URL in the bundle.** `AddToTrainerDialog` invented a
   source for the card it writes, and `tests/no-external-urls.test.ts` refused the citation host —
   correctly. The work already carries the citation that card should quote, so it is passed in. The
   same test caught `https://example.gov.in` in the note editor's help copy; the copy no longer names
   a URL at all.

### Second addendum — an edge-case pass, nine defects, and one pattern worth naming

Requested after the commit and run the way ADR-032, ADR-035 and ADR-037 ran theirs: every test below
was confirmed to FAIL against the committed code before its fix was written. `src/lib/library/edge.test.ts`,
the `useReadAloud` / `useStudyContext` blocks in `src/modules/library/annotations.test.tsx`,
`src/lib/library/trainerCard.test.ts` and three new cases in `src/lib/library/annotations.test.ts`
are the regression files.

**The pattern is not the one the previous three passes found, and that is the point.** ADR-032 and
ADR-035 both concluded: the model's half was guarded and the code's half was not. There is no model
here, and the untrusted halves WERE guarded — a stored offset is re-anchored, a quote that cannot be
found is kept and reported, a chosen file is refused by kind and by size, a card is parsed before it
is written, a personal work's id can never collide. What failed instead was subtler and, in three
cases, worse:

> **A feature the brief named, wired up end to end, that could never actually happen.**

Auto-continue navigated and fell silent. The compare page could not be given a second unit. My Study's
"needs attention" — the promise that makes "a highlight is never dropped" mean anything — had no way
to know which highlights were lost. Each was reachable, looked implemented, had its i18n keys, its
control and its route, and did nothing. None of them throws; none of them logs; a screenshot of each
looks correct.

1. **Auto-continue navigated to the next unit and stopped speaking.** `useReadAloud` calls
   `controller.load()` whenever the text changes, and `load` stops whatever is in flight — right when
   the READER navigates, and exactly wrong when read-aloud navigated on its own. The fix records that
   the move was its own doing (`continuing`, a ref written in a callback and read in an effect) and
   plays once the new unit has loaded. The other half matters as much: a flag set unconditionally
   would read the whole book aloud to somebody who pressed nothing, so there is a test for the
   silence too. Note where the first test went: a controller-level test CANNOT fail against this, and
   `src/lib/library/edge.test.ts` says so rather than reading as coverage it is not.

2. **`parseCompareRef` refused `?a=bns:`, which is what the compare page writes first.** A work is
   chosen before a unit — it has to be, because the unit list comes from that work's corpus — so the
   page writes the work with an empty unit and fills it in. Refusing that as malformed meant the work
   never loaded, so the unit picker stayed disabled, so nothing could ever be compared. A deadlock
   reachable by the first click on the page.

3. **My Study's "needs attention" could not fire.** That screen deliberately loads no corpus, so the
   first version guessed from the row alone and flagged an empty quote — a state `createHighlight`
   refuses to produce. `useStudyContext` now loads the corpora of the works the reader has ACTUALLY
   annotated (one or two books for almost anybody, every one precached) and answers two questions in
   one pass: which highlights are lost, and how each annotated unit cites itself.

4. **…and its first version reported `checked: true` before it had opened anything.** The initial
   state and the settled-and-empty state were the same constant. So the screen said "0 need
   attention" while it was still working — and, worse, the hook's own test passed against a hook that
   did nothing at all, because it waited for `checked` and got it immediately. `NOT_YET` and
   `NOTHING_TO_CHECK` are separate constants now. This is the "a test that cannot fail is not
   evidence" trap (ADR-031) arriving through a shared constant rather than a weak assertion.

5. **"Split at the cursor" split at the midpoint.** A label that lies, about the one operation on the
   review screen where the reader has a precise intention. The textarea reports its own caret;
   nothing else can, which is why the first version reached for a number it could compute.

6. **A cloze card whose stem was the blank alone.** `cloze.text` was the literal `"____"`, so the card
   showed a citation and a gap and asked nothing — answerable only by somebody who already had the
   rule in front of them. It would have looked right in the dialog, looked right in the review queue,
   and been discovered by whoever tried to review it. `src/lib/library/trainerCard.ts` builds the stem
   from the SENTENCE the passage came from, is pure, and is tested — which is the real fix: what a
   card asks is a property worth asserting, and it was previously buried in a dialog.

7. **The Markdown export's "citation" was an internal unit id.** `ccs-conduct-3` is not a citation,
   and the export is the one artefact of this session that leaves the app. It now carries
   `unit.citation` — from the same corpus pass as (3), which is why the two are one hook.

8. **`deleteHighlight` read every note in the database.** `where('id').notEqual('')` to find the one
   or two attached to the highlight being removed — correct, and linear in everything the reader has
   ever written. It reads the highlight's own row first and then queries the `[workId+unitId]` index
   that exists for exactly that question. The honest consequence, which has a test: a note keyed to
   this highlight from a DIFFERENT unit is no longer detached. Nothing in the UI can produce one.

9. **`resolveUnitId` walked the whole reading order per citation.** A BNSS section with ten of them
   cost thousands of map lookups on every render, and the reader re-renders on every selection
   change. It is a `Map` built once per corpus. Neither this nor (8) was visible — which is the
   reason to say what a query is linear in, rather than whether it returns the right answer.

## ADR-040 — Precomputed first, a model last: 223 hand-written study aids, two decks that share an engine and not a table, retrieval that the plain search box uses too, and a fourth tier the reader points wherever they like

**Date:** 2026-09-03 · **Status:** Accepted · **Supersedes:** nothing · **Amends:** ADR-030 (`connect-src`), ADR-036 (when the one-pass agent shape applies)

### Context

Session 28's brief opened with an ordering instruction rather than a feature
list: _"Order matters: precomputed aids (zero cost, the default), then active
recall and planning (no AI), then retrieval, then the AI paths."_ Everything
below follows from taking that literally.

### 1. A study aid is authored, reviewed and shipped — never generated at read time

`data/library/aids/<act>.json` is 225 rows, **223 approved**, written act by act
with the unit's own text open and put through the four stages
`docs/AUTHORING.md` prescribes: generate, critic, verify from the text alone,
dedup. Each carries `explanation`, `example`, `connects`, and optionally
`misconception`, `examRelevance` and `mnemonic`, all `{ en, hi }`; each carries
`generationMeta` recording what each stage said, `groundingUnitIds` naming the
units it rests on, and `verify: true` unconditionally.

Two rows are `rejected` with a reason and are never served — `ccs-cca-32`
(Omitted) and `osa-16` (repealed). They stay in the file, which is the same rule
`data/rules/cards` follows: a card is never deleted for being wrong, it is
rejected with a reason, and the reason is the audit trail.

**An aid that cannot be grounded in the unit's own text was not written.** That
is why seven acts are covered and eight are not: CCS Conduct (32), CCS CCA (34),
RTI (31), OSA (14), PoSH (30), CCS Leave (40) and CSMOP (40). `docs/DATA-GAPS.md`
#76 records what is left and what a second reader over the set would involve.

`tests/library-aids.test.ts` (36) checks the loader map against the file set, the
schema per file, the ≥220 floor, uniqueness, one aid per unit, and the POINTER in
both directions — every `unitId`, every `connects` entry and every
`groundingUnitIds` entry resolving into the pointed-at corpus. That last is the
half that is easy to skip and the half that catches an aid nobody can reach.

**`groundingUnitIds` is restricted to the aid's own work.** The first version of
the CCA aids named `ccs-conduct-4` and `ccs-conduct-14` — a real and useful
comparison — and it made the pointer test a cross-corpus claim, which is a
different and much weaker thing to assert. The comparison lives in the aid's
`verify.note` prose instead.

### 2. The chapter deck reuses the engine and refuses to share its table

The brief said "reuse `src/lib/srs` with a deck id — do not fork the engine",
and the trap that creates is the opposite of forking. `src/lib/study/chapters.ts`
imports `createCard` and `gradeCard` wholesale — they are pure and take a row —
but a chapter goes into `chapterCards`, not `srsCards`.

The reason is concrete: a chapter has no `qId` in `data/rules/cards`, so every
catalogue-taking function in `src/lib/srs` would look one up and find nothing,
and "12 due" on `/learn` would silently mean twelve of two different things.
`toSrs`/`fromSrs` are the whole of the translation and the two shapes differ by
one field, the identifier. `src/lib/study/independence.test.ts` grades one deck
and asserts the other did not move, in both directions, and does it for the SAME
underlying rule so the claim cannot be true by accident.

**`src/lib/study/` is a new directory rather than a file in `src/lib/srs/`**,
because `src/lib/srs/purity.test.ts` enumerates its files BY NAME and polices
what each may do. Adding one there would have meant editing the guard in the
same commit as the thing it guards.

**A flat work is grouped into runs of twelve.** Eleven of the fifteen works are
`tocSource: 'flat'` (`docs/DATA-GAPS.md` #70) — one node per rule — and a
revision deck with one card per rule is the card deck again with worse
questions. `groupFlat` keys each group on its FIRST unit id, never on a
position, so inserting a rule at the top of a book does not renumber every card
the reader has built a schedule on. Same rule `docs/AUTHORING.md` states for a
cloze card's id.

**`dueChapters` puts never-rated chapters LAST**, which is the opposite of the
card queue. A card the reader has never seen is the point of a study session; a
chapter they have never rated is not something they are behind on, and offering
two thousand of them as "due" would make the list useless on day one.
`includeNew: false` is what both hubs pass.

### 3. Retrieval is pure, and the plain search box uses it

`src/lib/retrieval.ts` runs with AI off and is what the study agent's `retrieve`
tool calls. That is deliberate: retrieval quality is visible to every reader, so
it is under constant pressure to be good, rather than being an invisible
sub-component of a feature most readers never turn on.

Three things it does that a plain fuse.js index does not:

- **A number pass before fuse, scored 1.0.** `numbersIn` keeps both the full
  sub-section and its base, so "Rule 18(2)" finds 18(2) and then 18. fuse's
  `minMatchCharLength` refuses a two-character query outright (the trap
  ADR-038 already hit), and a provision number is the most obvious thing a
  reader types.
- **An exact-heading pass, scored 0.98, between the number pass and fuse.**
  Without it a glossary entry whose citation is literally `"Suspension /
निलंबन"` out-ranked CCA Rule 10, whose citation never contains the word —
  because citation is the highest-weighted field and a glossary citation IS the
  term. The fix is not to re-weight heading above citation: a citation is still
  the only unambiguous field, and "Definitions" is a heading four rule books
  share. `KIND_ORDER` breaks an exact tie in favour of the source over
  commentary over vocabulary over the reader's own writing.
- **`alsoSearch`, indexed and never rendered.** Only one language's citation and
  heading were indexed at first, so `आचरण` found nothing over an
  English-built index. The other language now rides along in a field the
  results never show.

`tests/fixtures/retrieval.ts` is 40 cases, each with a written `why`, and it is
the specification the way `tests/fixtures/law-search.ts` is for the converter.
**Four of the fixtures were my own over-claims and were corrected with reasons
rather than by loosening the code** — a bare `18` across seven works has no right
answer, which is ADR-029 point 4's ambiguity in a second place, so those cases
assert `topKind` plus an `expectId`/`rejectId` rather than a `topId`.

### 4. Everything the reader typed stays on the device, including in the analytics

`src/lib/study/{sessions,analytics}.ts` are pure and every figure is arithmetic
over rows this device already holds. Three decisions worth recording:

- **A session's minutes are computed from `startedAt` and the wall clock, never
  accumulated.** A backgrounded tab, a sleeping laptop and a tick React skipped
  under load all give the right answer, because nothing was being counted.
  `MAX_SESSION_MINUTES = 240` caps a forgotten timer: a session left running
  overnight is not a night of study, and letting it into the weekly total would
  make every other number on that screen meaningless.
- **A session worth under a minute is DISCARDED, not stored as zero**, and
  `endSession` tells the caller so it can say so rather than appearing to have
  saved something.
- **`goalProgress` averages only the targets that were SET.** A goal of "180
  minutes a week" with no unit target must not read as half done because a
  target nobody asked for is empty.
- **Coverage is three independent flags, not a score.** Read, annotated and
  quizzed collapse into `depth` for the heat-map's colour, but
  `summariseCoverage` reports `readNotQuizzed` separately, because that is the
  figure an officer preparing for a departmental examination actually wants and
  a single "progress" percentage would hide it.

The five new tables are in the backup automatically: `buildBackup` excludes by
NAME (`secrets`, `aiAnswers`, `aiUsage`) rather than including by name, so a
table a later session adds is backed up by default. `independence.test.ts`
asserts it anyway, because "included by default" is a convention that lasts
until somebody switches it to an allowlist for a good-sounding reason.

### 5. Tier 3: an OpenAI-compatible endpoint the reader points wherever they like

`src/ai/providers/openaiCompatible.ts` speaks `/chat/completions` with
streaming, tool calling and JSON mode. It exists so the free tiers are a real
option — Google AI Studio, Groq, an OpenRouter free model, or a local Ollama
that reaches no network at all — because "bring your own Anthropic key" is not
free and this project's first rule is that it is free for users.

Four decisions:

- **The transport lives in `src/ai/providers/wire.ts`**, which is still the only
  module in the app permitted to call `fetch` (a file-scoped exception in
  `eslint.config.js`). Putting it in the new provider would have made the audit
  question — "what can reach the network?" — answerable from two files instead
  of one.
- **The API key is OPTIONAL and `tierReady` asks only for a URL and a model.**
  Ollama wants no key. A tier that refused to start without one would have made
  the only genuinely offline model option unreachable.
- **`maxContext` is 0, not a guess.** This provider cannot know it, and
  inventing a number the reader would rely on is worse than admitting it.
- **`capabilityNote()` is honest about tool calling.** An endpoint without it
  falls back to JSON mode and the UI says which of the three states it is in
  (`tools` / `jsonFallback` / `textOnly`), rather than silently degrading.

`CONSENT_VERSION` is **3**. A reader who consented to Tier 1 and Tier 2 did not
consent to a request going to a host they had not been told about, and a
consent version is how this app asks again.

**This amends ADR-030's `connect-src 'self' https://api.anthropic.com`.** It now
also names `https://generativelanguage.googleapis.com`, `https://api.groq.com`,
`https://openrouter.ai` and loopback — the three providers the consent notice
itself names, plus a local Ollama. `connect-src https:` was considered and
rejected: it would let any script in the bundle reach any host, which is the one
thing `default-src 'self'` exists to prevent. The residual limit is real and is
written down as `docs/DATA-GAPS.md` #75.

### 6. The study agent is ADR-035's two-pass shape, and it is last in the rail

`src/ai/agents/study.ts` with `groundedRequired: true`, six `library`-scope
tools, and a bilingual cached prompt file. It is two passes rather than
ADR-036's single pass for the reason ADR-035 gives — `validateCitations()`
rejects a number that appears in no cited snippet, and a tool result is not one
— and specifically because the lookup here genuinely needs research first: "the
difference between Rule 3 and Rule 11" cannot name what to fetch until something
has been fetched. ADR-036's cheaper shape stays right where the caller already
knows what to read.

**`get_my_notes` is the first tool in this app that reads the officer's own
writing.** Three things constrain it: `includeNotes` is a checkbox that is off
until it is ticked, with a hint saying what ticking it does; every snippet it
produces is `personal: true` and is labelled as the reader's on the way in and
rendered as theirs on the way out; and `misattributesPersonal()` fails the run in
code when the answer treats one as law. A persona instruction is not a check —
ADR-036's lesson, applied to a different failure.

**The screen is the Law Converter's, narrowed differently.**
`screenStudyQuestion()` refuses a departmental RECORD (every pattern requiring a
digit) and does NOT refuse "secret" or "classified": the Official Secrets Act is
one of the fifteen works in this library, and a question about what it says is a
question about published statute. `screenBrief()`'s opposite bias is right for a
DOCUMENT and wrong for a question.

**The rail's order is the whole argument.** Aid → Feynman → test-me → Ask →
related. Four of the five reach no network, need no key and cost nothing;
`src/modules/library/ai-seam.ts` states the test that keeps it honest — flipping
`STUDY_AI_ENABLED` to `false` must cost the module one affordance out of five,
not make it useless. `docs/AI.md` §13 is the general policy, including why
fine-tuning is rejected: grounding is retrieval, not weights, and a fine-tuned
model has no snippets to cite.

### Consequences

- `data/library/aids/` is a new dataset family and a new `verify: true` surface;
  `StudyAidCard` says on every render that it is this project's writing and that
  the provision above is what governs.
- Dexie is at **v13** with five new tables and no `upgrade()` block, because all
  five are new and empty.
- `src/lib/study/` is a second pure library beside `src/lib/srs/`, with its own
  `purity.test.ts` that enumerates its files by name. That test needed a `code()`
  helper stripping comments, because `analytics.ts` type-imports `@/db` (erased,
  reaches no database) and `quiz.ts` names `Math.random()` in a comment
  explaining why it does not use it — the sibling guard in `src/lib/srs` avoided
  both only by choosing a pattern its own prose happened not to match.
- Three new routes (`/library/study`, `/library/:workId/quiz/:nodeId`,
  `/library/:workId/sheet/:nodeId`), all three in the axe and offline sweeps —
  the two parameterised ones exempted in `tests/route-coverage.test.ts` with a
  real instance named, the way `/library/:workId/:unitId` already was.
- `CONSENT_VERSION` is 3, so every reader who had AI on is asked again.

### Addendum — an edge-case pass over this session, after the commit

Fourteen defects, each confirmed to FAIL against the committed code before its
fix was written. The regression files are `src/lib/retrieval.edge.test.ts` (9),
`src/lib/study/edge.test.ts` (5), `src/modules/library/study.edge.test.tsx` (12)
and `src/ai/tools/library.edge.test.ts` (5).

**The pattern is ADR-039's second addendum, not ADR-032's.** There is a model in
this session and its half was guarded — citations are re-derived, a personal
snippet cannot be presented as law, the screen runs before the provider is
constructed. What failed was almost entirely the code around it, and in two
recognisable families.

#### 1. A key that threw away structure, and so threw away identity

`numberKey` folded `18(2)` to `182` by stripping the parentheses. `182` is not a
fold of `18(2)` — it is a different provision, and in this corpus a real one:
`1(1)` collides with Rule 11 in every one of the nine rule books that has eleven
rules, and **256 of GFR's 307 rule numbers** are reachable that way. Because the
exact-number pass scores 1.0, this did not rank a stranger highly — it placed
one level with the provision the reader asked for, ahead of every relevant fuse
hit.

That is **ADR-035's `refKey()` lesson one level of resolution further down**:
there a digits-only key could not tell 124 from 124A, here it could not tell
18(2) from 182. The file that contains this even has a test named "keeps 124 and
124A apart" citing that ADR, two blocks above the assertion that encoded the new
collision.

`PROVISION` separately missed `s 65B` — one of the four number forms **the
session brief names verbatim** — because the alternation carried `s\.` and
required the full stop; and `F.R. 17(1)`, which is what this repository's own
`citation()` prints for every FR & SR provision. The English unit words also had
no plurals while the Devanagari half had always carried them, so `नियमों 18`
matched and `Rules 18` did not — the two-language-halves asymmetry of ADR-035 and
ADR-039 in its mildest form, and still worth closing.

#### 2. Features that were wired end to end and could never fire

Four of them, and this is the third session in a row to produce this shape:

- **The coverage heat-map's third dimension.** `WorkPage` mounted
  `<CoverageMap … cards={null} />`, so `quizzed` was false for every unit: the
  badge read 0 for ever and `readNotQuizzed` — the figure the whole summary
  exists to produce — was `read` under a second name. It now loads ONE act
  (`loadCardsForAct`, newly exported), not the Trainer's 1.1 MB catalogue.
- **The Pomodoro lengths.** The brief asked for "free or Pomodoro 25/5,
  configurable". `clampPomodoro` was written, bounded 5-90 / 1-30 and tested,
  and `SessionTimer` held its config in a `useState` with no setter — the only
  caller that could vary it was its own test file.
- **Ask, on a document the reader added.** Every tool in
  `src/ai/tools/library.ts` guards on `isWorkId`, which a `my-`-prefixed id
  fails by construction, so on a personal work the panel could only ever produce
  "it could not answer". It is not offered there now.
- **`get_related_cards` loading twelve rule books** to answer about one — the
  same waste `practiseCounts` exists to prevent (ADR-038 §2).

#### 3. State that outlived the unit it was about

Three components in the reader's rail kept their state across a unit change,
because `j`/`k` and the prev/next links navigate without unmounting the rail and
none of them was keyed. One of the three corrupts data:

**A reader who starts writing their own words about Rule 3, moves to Rule 4 and
presses Save has their prose stored against Rule 4.** `saveAttempt` reads
`unit.id` from the props it has now; the textarea still holds what was typed for
the unit before. Nothing throws, nothing logs, and a screenshot of either screen
looks correct.

The other two are confirmations rather than data — a stale "Rated. Back on …"
for a chapter never rated, and an AI answer about the previous provision sitting
under this one. All three are fixed with a `key`, not with an effect that
clears the state: the rule CLAUDE.md already records for `ReviewPage`'s
`wrongAnswer` is derive or remount, never resynchronise one render late.

#### 4. One button that quietly punished the reader twice

"Add the ones I got wrong to my review deck" called `reviewCard` with `Again` a
second time for cards the quiz had graded `Again` seconds earlier. On a card the
officer had matured into `review`, the first `Again` is the lapse they earned;
the second cut FSRS stability from **4.72 days to 1.51** and wrote a `reviewLog`
row for a review that never happened — and `reviewLog` is what the weekly review
counts and what retention is measured from, so the damage outlives the schedule.

The button was redundant as a grading action from the moment answers were wired
into the Trainer's own history: the wrong ones are already at the front of the
queue. The screen says so now and offers the deck instead. **Anything that
writes to a schedule twice for one event is worth looking for wherever a surface
both records as it goes and offers a "save" at the end.**

#### 5. Three smaller ones, each a rule this repository already had

- `useDueChaptersEverywhere` used `Promise.all`, so ONE work file that failed to
  load made the revise list vanish from both hubs, permanently and silently. A
  due list that disappears is worse than a short one: the reader concludes they
  are up to date. `Promise.allSettled` now.
- `StudyAskPanel`'s tool and phase labels were built by interpolating into `t()`
  behind an `as` cast — exactly what the drafting panel's own comment warns
  against, and with `fallbackLng: false` a missing key IS its own name. They are
  a literal map now, asserted against the registry's actual `library` scope,
  which is the mechanism `src/ai/tools/registry.test.ts` already uses.
- `get_my_notes` — the one tool in this app that reads what the officer wrote —
  was the only one of the six without an `isWorkId` guard, so an unknown work
  returned a confident, empty `{ personal: true, notes: [], highlights: [] }`.

#### Two committed tests were asserting the defects

`src/lib/retrieval.test.ts` asserted `numberKey('318 (4)') === '3184'` and
`src/lib/study/analytics.test.ts` asserted the streak was 0 for a reader who had
studied yesterday and not yet today. Both were corrected with the reason written
at the assertion. This is the Tier 0 `token`-suppression lesson from ADR-037's
second addendum arriving again: **when an edge-case pass contradicts a committed
assertion, decide which of the two is describing the app** — and here neither
was.

#### One candidate dismissed by a test rather than by argument

The revision sheet's mode toggle builds ``to={`?${''}`}`` — a bare `"?"` —
for the link back to the full sheet, which looked wrong. It works: React Router
resolves it against the current path and clears the query. The test is kept as a
regression guard rather than deleted, because the next reader of that line will
have the same doubt.

#### And one test that could not fail

The first version of the personal-document test asserted the Ask panel was
absent, and passed against the bug: `StudyAskPanel` is behind `React.lazy`, so it
is absent for a tick on a fresh module registry whatever the gate says. The test
now renders a dataset work first to resolve and cache the lazy module, so
"not in the document" means the gate kept it out. `network.sentinel`'s own story
(ADR-031) in a second place — break the code and watch the assertion go red
before believing it.

---

## ADR-041 — Tiptap 3 over Lexical, a document model whose body is editor JSON, and one renderer that still emits the blocks the checklist reads

**Date:** 2026-09-03 · **Status:** Accepted · **Supersedes:** nothing · **Amends:** ADR-020 (the drafting engine gains a second front door), ADR-021 (the editor is no longer a form)

### Context

Sessions 8 and 21 built the Drafting Studio as a **guided form beside a live A4
preview**: fifteen labelled boxes, one of them a textarea whose lines became the
document's paragraphs. That shape is right for a leave application and wrong for
a note on a file, a set of minutes or a speaking order — anything with a heading,
a table, a quoted provision or a sub-paragraph. This session replaces the form
with a real document editor and, because Sessions 30 and 31 build print, `.docx`
and a register on top of it, the model is the deliverable rather than the
toolbar.

### 1. The editor: Tiptap 3, on the evidence of a spike

The brief asked for a throwaway spike of **Tiptap 3** (open-source core and the
free extensions only — no Tiptap Pro package is used or installed) against this
project's own toolchain, and for Lexical only if that failed. It did not fail.

The spike lives nowhere in the repository — it was a separate npm project pinned
to this app's exact versions: React 19.2.8, react-dom 19.2.8, Vite 8.2.2,
`typescript-native` 7.0.2, `@types/react` 19.2.18, `strict` and
`noUncheckedIndexedAccess` both on. It exercised the four things this session
actually needs and nothing else:

| What                                                                      | Result                     |
| ------------------------------------------------------------------------- | -------------------------- |
| `tsc` 7.0.2 `--noEmit`, strict + `noUncheckedIndexedAccess`               | exit 0, no errors          |
| `vite build` 8.2.2                                                        | exit 0                     |
| A custom **block** node with a typed attribute (the `numberedPara` shape) | compiles, round-trips JSON |
| A custom **inline atom** with a React `NodeView` (the placeholder chip)   | compiles, renders          |
| `@tiptap/extension-table`, `@tiptap/extension-placeholder`                | compile, render            |
| Headless `new Editor(...)` under **jsdom**, `getJSON()`/`getText()`       | passes                     |
| `useEditor` + `EditorContent` mounted with `@testing-library/react`       | passes                     |

The last two rows are why the decision was not close. The pure layer this
session builds — model, skeleton instantiation, renderer, lint, migration — is
tested without an editor at all, but `bodySkeleton` fixtures for forty templates
have to be parsed and normalised by _something_, and a library that needs a real
browser to construct a document would have pushed all forty into Playwright.
Tiptap's `Editor` constructs headlessly under jsdom, so `pnpm test` can build a
document, ask for its JSON, and assert on it.

Two numbers, measured rather than estimated. The spike's production bundle is
**200.73 KB gzip**; the same project with the editor replaced by
`createRoot(...).render(<div>hi</div>)` is **59.91 KB gzip**. Tiptap 3 plus
ProseMirror plus the table and placeholder extensions is therefore
**≈ 140.8 KB gzip**. That is under the 256 KB `largestChunk` figure in
`scripts/size-budget.json`, so it needs no exemption, and it is behind the
`/draft` route's lazy import, so it is not on the initial route at all. Licence
is MIT on every package used; the React 19 peer range is declared upstream
(`^17 || ^18 || ^19`), not forced.

Lexical was not evaluated, deliberately. The brief made it the fallback and
there was nothing to fall back from; evaluating it anyway would have been a
second spike whose result could not change the answer.

### 2. The body is editor JSON, and `docModelVersion` is the reason that is safe

`OfficialDoc.body` is a ProseMirror/Tiptap document — `{ type: 'doc', content:
[...] }` — and `bodyHi` is its Hindi counterpart when `lang` is `bilingual`.
Storing a vendor's document JSON in IndexedDB is a real commitment, so three
things bound it:

- **`docModelVersion` is on every stored document**, and `src/lib/drafting/model.ts`
  is the only file that knows what the current one is. A document at an older
  version is upgraded on read by `upgradeDoc`, never in place on disk; a document
  at a _newer_ version than this build understands is refused rather than
  half-read, for the reason `asDraft` gives about a half-restored form.
- **The node vocabulary is ours, not the vendor's.** `BODY_NODES` in `model.ts`
  enumerates the eleven node types a stored body may contain — `doc`,
  `paragraph`, `numberedPara`, `heading`, `bulletList`, `orderedList`,
  `listItem`, `table`/`tableRow`/`tableCell`/`tableHeader`, `blockquote`,
  `pageBreak`, `placeholder`, `text` — and `bodySchema` rejects anything else.
  A Tiptap upgrade that starts emitting a new node type fails a test rather than
  landing unreadable rows on a device.
- **Nothing downstream of the editor imports Tiptap.** `renderOfficialDoc`,
  `lintDocument`, `migrateDraft` and the checklist all read the JSON as plain
  data. `src/lib/drafting/purity.test.ts` asserts it by reading the files: no
  file under `src/lib/drafting/` may import `@tiptap/*`, React, Dexie or call
  `fetch`, and only `model.ts` may name `DOC_MODEL_VERSION`.

### 3. One renderer, and it still produces `RenderedBlock[]`

The brief asks for one renderer from `OfficialDoc` → `RenderedDoc` → three
targets. The temptation was a new block shape. It was refused: the existing
`RenderedBlock`/`DocumentModel` is already what `evaluateChecklist`, `serialise`
and `docx.ts` read, and a second shape would have meant a second checklist
evaluator — which is exactly the "two implementations of one grammar" that
ADR-039 §4 spent a Node script avoiding.

So `renderOfficialDoc(doc, template, lang, options)` returns the **same
`RenderResult`** `renderDocument` returns, and `RenderedBlock` gains one
optional member:

```ts
nodes?: RenderedNode[]   // the rich projection: headings, tables, quotes, markers
lines: string[]          // the plain-text projection — unchanged, still the contract
```

`lines` is generated _from_ `nodes`, so the two cannot disagree. Everything that
reads `lines` — the checklist's `textOf`, `serialise`, `docx.ts`, every one of
the fourteen committed `.txt` snapshots — keeps working untouched, and that is
the claim: **`pnpm test` passes with the old engine and the new one both live.**
The A4 preview draws `nodes` when they are there and `lines` when they are not,
which is what lets the legacy form-rendered path and the editor-rendered path
share one component.

### 4. `vars` is a sibling of `meta`, not a member of it

The brief enumerates `meta`'s keys, and every one of them is document _chrome_ —
the number, the date, the subject, who it is from and to, the enclosures, the
signature, the reference lines. A template's typed variables are a different
thing: they are the bindings its `bodySkeleton` interpolates, and a form with a
`sanctionAmount` or a `leaveKind` has no business widening the meta of every
other form.

`OfficialDoc.vars: Record<string, VarValue>` is therefore a sibling.
`bindings(doc, lang)` in `model.ts` is the single function that merges the two
into the flat `Record<string, string | string[]>` that placeholders,
`{{#if}}` conditions, `{{#each}}` repeaters, the legacy layout renderer and the
checklist's `resolved` all read. One resolution function, so "what is `subject`
worth here" has exactly one answer.

### 5. A profile change never rewrites a document

`meta.from` and `meta.signature` are **snapshots** taken when the document is
created, not references into the profile row. An officer who is promoted in
March does not want February's minutes re-signed with the new designation, and a
document already issued must render tomorrow exactly as it rendered the day it
went out. The same rule governs the address book: deleting an addressee leaves
every document that named them intact, because `meta.to` holds a copy rather
than an id. `linkedAddresseeId` is carried alongside so a live row can still be
_offered_ — it is a convenience, never the source of what prints.

### 6. Terminology lint asks the glossary, and is a hint

`lintDocument` takes the glossary terms as an argument for the same reason the
pay engine takes its tables as one: `data/glossary.json` is 970 KB and belongs
behind a lazy import, and a pure function that reaches for a dataset puts the
dataset in whatever chunk imports the function. With no terms supplied, the
terminology check reports nothing rather than passing falsely — an absent
dataset is not evidence of consistent vocabulary.

Every terminology finding is `severity: 'hint'` and names the standard term
without changing anything. `data/glossary.json` carries `verify: true` on all
1,891 entries (ADR-024), and a lint that silently rewrote an officer's Hindi
against an unverified term list would be putting a compiled glossary above the
officer's own judgement.

### Addendum — what the first browser run found

`tests/e2e/draft-editor.spec.ts` was written before it was run, and its first
execution against a real build found four defects nothing else in the suite
could have. Three are patterns CLAUDE.md already records for other modules,
which is worth saying plainly: **the value of a new browser sweep is mostly that
it re-finds your own known traps in a place you were not looking for them.**

1. **A `•` inside a tab's accessible name.** The Review tab gained a dot when
   something must be fixed, and the dot was ordinary text — so a screen reader
   heard "Review bullet", and `getByRole('tab', { name: 'Review' })` matched
   "Preview" as well, because Playwright's string `name` is a case-insensitive
   SUBSTRING. It is `aria-hidden` now with an `sr-only` sentence beside it, and
   the spec anchors its regex at the start. CLAUDE.md already recorded the
   substring trap costing half an hour on `{ name: 'Post' }` matching "Place of
   posting".
2. **Three hints nested inside their own `<label>`.** The accessible name of the
   pattern box read "Pattern Tokens: {FILE} {SEQ} {YEAR} {YY} {SECTION} {TYPE}",
   which made the field unfindable by its own name and reads badly out loud. A
   name says what a control IS; a description says what to put in it. They are
   siblings linked with `aria-describedby` now — `MetaPanel`'s `Row` does it with
   one `cloneElement` so all sixteen call sites stayed ordinary JSX.
3. **`bg-destructive/10` with `text-destructive-foreground` failed
   `color-contrast` on fourteen elements.** `--destructive-foreground` is white
   on light and navy on dark: it is the colour for text on SOLID destructive.
   Marigold, tulsi and coral are the three that carry a `-foreground` paired
   with their own `/15` tint, so an error row is coral. `--muted-foreground`
   fails on those tints too, so the CSMOP reference line inside a failing row
   inherits the row's colour instead of setting its own. CLAUDE.md recorded the
   same thing about `EraseSection`'s `bg-destructive/5` in Session 14 — twice is
   a hint that this wants a token rather than a rule everyone rediscovers.
4. **An `h1` → `h3` jump** in the review panel, `moderate heading-order`.

And two findings from the unit suite that are worth recording because both were
caught by a test written to check something else:

- **The version diff rippled.** Paragraph markers are generated by POSITION, so
  inserting a paragraph renumbers every line below it, and `diffDocuments`
  reported one insertion as a change to the whole rest of the document — exactly
  the failure the block-then-word design exists to avoid. `linesOf` in
  `versions.ts` strips the marker from a `para` and keeps it on a `listItem`,
  because a bullet is something the officer wrote and a paragraph number is
  something the renderer counted.
- **`paraNumberingHolds` could not see a heading.** An editor body may contain a
  heading, a list item, a quotation or a table row, and over `lines` alone none
  of those is distinguishable from a paragraph that lost its number — so an
  appeal with a "Grounds of appeal" heading failed a rule it satisfies. It reads
  `nodes` when they are there and behaves exactly as before when they are not,
  which is every draft of the fourteen original forms.

One test was **deleted for being false**, and that is the finding worth carrying
forward. The obvious jsdom assertion that the editor does not re-seed itself on
every keystroke — the paragraph's DOM node is the same object after a re-render —
was written, passed, and then passed again against a version with the guard
deleted: ProseMirror diffs the document it is given and reuses the nodes, so a
re-seed of identical content is invisible in the DOM. The only thing the guard
protects is the SELECTION, and jsdom implements no layout at all. Stubbing
`Range.getClientRects` was tried and made ProseMirror place typed characters
_worse_ than the absence does. The claim is in the browser spec now, and a
comment sits where the jsdom test would have been saying why. A test that cannot
fail is not evidence; one that looks like evidence is worse than none.

### Second addendum — the edge-case pass

A pass over Session 29 after the commit found **eleven** defects. Every fix
below has a test that was confirmed to fail against the committed code first;
`src/lib/drafting/edge.test.ts`, `purity.test.ts` and
`src/modules/drafting/useOfficialDoc.test.tsx` are the regression files.

The shape is ADR-039's second addendum, not ADR-032's. There is no model here
and the untrusted halves were guarded — a document written by a newer build is
refused, a version that will not parse is skipped, a personal template that
would produce an invalid form falls back to the official one. **What failed
instead was a set of controls that were wired up, labelled in both languages,
and could not do anything.** Seven of the eleven are that; the mechanical check
that found them was sweeping the i18n catalogue for keys no source file
references, which took a minute and is worth doing at the end of any session
that adds a screen.

**Could never fire.**

1. **The terminology lint.** The brief asked for it, `lintTerminology` implements
   it, `lint.test.ts` covers it five ways — and its only caller passed no
   glossary, so it returned `[]` every time. ADR-041 §6 made the glossary an
   argument (970 KB behind a lazy import) and nobody was left to hand it over.
   `DocEditorPage` now loads it through `useGlossary(language === 'hi')`, so an
   English document still downloads none of it.
2. **"Save as my template."** `personalFromDocument` shipped tested sixteen ways
   with nine i18n strings and no dialog. The brief's item 6.
3. **The Ctrl+/ shortcuts sheet.** Ctrl+S, Ctrl+P and Ctrl+F worked; the one
   shortcut whose entire job is to tell you the others exist did nothing, and
   its ten strings were dead.
4. **`meta.from.letterhead`, `meta.signature.showSd` and `meta.signature.layout`.**
   Four bilingual letterhead inputs, a "print -Sd/- above the name" checkbox and
   a signature-position select — all stored on every document, none of them
   rendered. `applyStationery` in `renderDoc.ts` applies all three, to the
   `header` and `signature` blocks only; it does not touch the body block, so
   `nodes` and `projectBody` are unaffected (Session 30 builds on those).
5. **`profile.defaultCopyTo`.** `createDocument` had always read it and copied
   the named entries into every new document. Nothing set it, so it was always
   empty.
6. **The profile nudge and the numeral-conversion confirmation.**
   `profileIsSet` had no caller; converting every numeral in a document — a
   whole-document edit whose extent an officer cannot see — announced nothing.
7. **`profile.dateFormat`** was the one dead control REMOVED rather than
   implemented. There is nothing for it to decide: CSMOP's specimens print
   dd.mm.yyyy, `formatDate` produces exactly that, and the one real variation is
   already a global setting. A second control for the same thing is a second
   answer. `draft.review.terminologyApply` went the same way — ADR-041 §6 says a
   terminology finding names the standard term and changes nothing, so a
   control to apply it would have been building the thing the ADR forbids.

**Genuinely wrong.**

8. **The first Hindi keystroke could wipe the English.** The editor asked which
   body slot a language edits TWICE — the read said `bodyHi ? bodyHi : body`,
   the write said `lang === 'bilingual' ? bodyHi : body` — and for a bilingual
   document whose `bodyHi` was absent (a shape the schema permits, since
   `bodyHi` is optional) the two disagreed. The officer saw the English text,
   typed one character, and the English vanished: the keystroke landed in
   `bodyHi`, which then became the slot the read preferred.
   `src/lib/drafting/docLang.ts#bodySlotForLanguage` is the one answer now, and
   `separateHindiBody` is the affordance that was missing — a control to make a
   Hindi body, seeded from the English, the way `values.ts#splitField` already
   worked for a field.
9. **`$2` in a find-and-replace inserted the whole paragraph.**
   `String.replace` calls back with `(match, p1…pn, offset, string)`, and with a
   pattern that has no capture groups there are no `pn` — so `args[2]` is the
   entire input. `$1` escaped only by luck: `args[1]` was the offset, a number,
   which the `typeof` guard rejected by accident rather than by design. The
   groups are sliced out of the tail now.
10. **A reference number issued on a migrated document used the year 28.**
    `Number(date.slice(0, 4))` reads `28` out of `28.09.2026`, and 28 is truthy,
    so it did not even reach the fallback — a yearly-reset pattern restarted its
    series and stamped `seqYear: 28`. Every document migrated from the Session 8
    editor carries a dd.mm.yyyy date, because that is what CSMOP prints.
    `parseDate` already read both shapes in either script; it was not asked.
    The same omission made the date input render EMPTY for those documents,
    telling an officer their document had no date when it had one —
    `format.ts#isoDateValue` is the line that was missing between the two.
11. **"Take the other tab's version" could be undone 700 ms later.** The editor
    stays editable under the conflict banner — it has to, or an officer cannot
    copy their own paragraph out of it — so a keystroke typed while deciding
    left a debounced write in flight, which landed after the banner had gone and
    wrote their text back over the version they had just chosen.
    `resolveConflict` cancels the pending write first, for both answers.

**And one claim that was not true.** ADR-041 §2 said
"`src/lib/drafting/purity.test.ts` asserts it by reading the files" and named
the rules it enforced. The file did not exist. That is exactly the shape
ADR-037's addendum says to distrust — an invariant described rather than
implemented — and an ADR is where the next session goes to find out what is
guaranteed. It exists now, and writing it immediately found `versions.ts#prune`
ordering ISO instants with `localeCompare`: not a demonstrable misordering
(ICU and code-unit order agree on ASCII timestamps), but `prune` does not
display a list, it slices one and its caller deletes what fell off, and
CLAUDE.md's rule for anything that decides bytes is the rule for a reason.

The purity test departs from `src/lib/srs`'s and `src/lib/study`'s shape in one
way worth copying back: the per-file rules run over the DIRECTORY and the
hand-written list is a separate assertion. Those two loop over the list, so a
file added and not listed is a file no rule applies to until somebody notices.
Reading the directory means a new file is guarded from the moment it lands, and
the ledger still catches "added without being looked at" — it just is not what
decides whether the file is guarded. This mattered immediately: Session 30 is
building the import/export layer in the same directory in the same working
tree, and its eight files were covered by every rule before either session had
committed.

---

## ADR-042 — Import and export: a mapping layer that never converts silently, a ZIP with no dependency, and print instead of a PDF writer

**Date:** 2026-09-04 · **Status:** Accepted · **Supersedes:** nothing · **Amends:** ADR-020 (the `.docx` writer gains a second projection), ADR-041 (`RenderedBlock.nodes` acquires its first consumer outside the preview)

### Context

Session 29 built the document editor and the model under it. This session gives
that model its two open sides: a document an officer already has, on their
disk, in Word or as a PDF; and a document leaving this app for a word processor,
a printer or somebody's inbox. Both are where a drafting tool either fits into
an office or does not — an officer with two hundred documents in a folder will
not retype them, and one who cannot hand a colleague a `.docx` has a very
private notepad.

### 1. Every lossy step produces a notice, and the notices come BEFORE the save

A conversion between two document models is lossy and there is no version of
this that is not. `.docx` has merged cells, footnotes, images, tracked changes,
headers, footers, section columns and a dozen numbering schemes; the editor's
model has fifteen node types on purpose (ADR-041 §2). The decision is not
whether to lose things — it is whether the officer is told.

`ImportNotice` is the answer, and the shape matters: a code, a count and up to
twelve named examples, produced by the mapping layer itself rather than by the
screen. The import review screen lists every one of them under **"What was not
imported"**, and it does so **before the document is created** — an officer who
sees "3 images were left out" before pressing Create can go back to Word. A
toast afterwards would be an apology.

This is `resolveAnchor`'s rule from the Library (ADR-039 §1) in a new place: a
conversion that cannot be exact must be able to say so. An importer that
quietly drops an image is worse than one that refuses the file, because the
officer signs what came out.

### 2. `mammoth` cannot see four things, and each is recovered from the OOXML

The brief's split — "mammoth → HTML → editor JSON via a mapping layer" — is what
was built, and it is right: `src/lib/drafting/importDocx.ts` is pure, so every
mapping decision is testable against a string with no zip, no browser and no
`File`. But mammoth's HTML is lossy in four ways that matter here, and all four
are read out of the archive directly by `src/modules/drafting/import/readFile.ts`:

- **Tracked changes.** mammoth accepts every insertion and drops every deletion,
  silently. That is the right answer — it is what "accept all" means — but the
  document the officer is now editing is not the document they were sent.
  `scanDocumentXml` counts `w:ins`/`w:del`.
- **Merged cells.** mammoth emits `colspan`/`rowspan`; the editor's table model
  has neither, deliberately (a merge has no meaning in the plain-text projection
  every checklist rule reads). The table is flattened into a rectangle — the
  content stays in the cell it was in and the span is filled with empty cells —
  and the flattening is reported.
- **Headers and footers.** mammoth does not read them at all, and they are
  exactly the part this app has a field for. They are read out of
  `word/header*.xml`, offered for review, and **never applied**: a header may be
  a page number, a confidentiality stamp or a letterhead, and only the officer
  knows which. A line that is only a `PAGE`/`NUMPAGES` field result is dropped.
- **Page breaks.** Reachable only through a style-map entry
  (`br[type='page'] => hr`), which is why the reader supplies one; `<hr>` is the
  single void element that survives mammoth's own empty-element pruning.

### 3. The ZIP is 120 lines here rather than a dependency

Two things need one and they pull in opposite directions: batch export WRITES a
`.zip` of `.docx` files, and `.docx` import READS a zip. `fflate` would have
done it and was not added, for three reasons in order of weight.

1. **`CompressionStream` and `DecompressionStream` are native**, in every
   browser this app supports and in Node 18 and later. A DEFLATE implementation
   is the only genuinely hard part of a ZIP, and the platform already has one.
2. **A `.docx` is already compressed**, so the outer archive in a batch export
   compresses almost nothing — which makes `STORE` a perfectly good fallback
   where `CompressionStream` is absent rather than a compromise.
3. A dependency costs a lockfile entry, a size-budget line, a licence check and
   a supply-chain surface, for about a hundred lines of container format.

`src/lib/drafting/zip.ts` is pure and takes its clock as an ARGUMENT — the
directory forbids a clock of its own (`purity.test.ts`) and an archive that is a
function of its inputs is one a test can byte-compare. `zip.test.ts` checks the
writer against **Node's own `zlib`** rather than against the reader, which is
the same rule `docx.test.ts` already states about not using a zip library to
check a zip library, and reads a real `.docx` written by the `docx` package —
because the importer opens files Word wrote, not files this file wrote.

The reader walks the **central directory**, never local headers from the front:
a local header may declare its sizes as zero and defer them to a data descriptor
after the payload, and Word writes `.docx` files both ways.

### 4. The `.docx` writer gains a second projection, and `lines` is still the fallback

`RenderedBlock` carries `lines` always and `nodes` only when the block came from
the document editor (ADR-041 §3). `docx.ts` now reads `nodes` when they are
there and `lines` when they are not, and that single rule closes
`docs/DATA-GAPS.md` #78: before it, a table an officer built in the editor
exported as one paragraph of tab-separated text, because `linesOfNodes` is the
plain-text projection and tabs are what a plain-text table is.

The fallback is not a legacy path to be removed. Every block of CHROME — the
file number, the Government of India block, the subject, the salutation, the
signature, the copy-to list — is rendered from a template layout and has no
`nodes`, in a document written in the new editor as much as in one migrated from
the old form. Both halves are live in every export, and the whole of the
pre-existing `docx.test.ts` is untouched and green, which is the claim.

**One rule from ADR-020 is deliberately relaxed.** "The engine has already made
every decision" is still true of every block without `nodes`; it is not true of
paragraph numbers in the body any more. The brief asks for true Word numbering
"so Word renumbers on edit", and an officer who deletes paragraph 3 in Word and
gets 1, 2, 4, 5 has been handed a document that is wrong in a way they will not
notice. Fidelity survives because the numbering's `start` is taken from the
marker the engine generated — CSMOP leaves the opening paragraph of an O.M.
unnumbered and numbers from 2, so the export starts at 2 — and `wordNumbering:
false` puts the marker back as literal text. The round-trip test asserts BOTH
behaviours, because the trade is real: with Word numbering on, the number is not
text any more and a re-import sees a plain paragraph.

### 5. There is no PDF writer, and that is a decision about Devanagari

The brief asks for a print route and for "Export PDF" to be `window.print()`
with an instruction sheet. That is what was built, and the reason is worth
stating because the obvious objection is that a PDF library would be tidier.

**A JavaScript PDF library cannot shape Devanagari.** jsPDF and pdf-lib both
draw a string by mapping code points to glyph ids one at a time. Devanagari
needs reordering (the `ि` matra is typed after its consonant and printed before
it), conjunct substitution (`क` + `्` + `ष` → `क्ष`) and mark positioning — a
HarfBuzz job, and neither library carries a shaper. The output is not slightly
wrong; it is `काय्रालय` where the document says `कार्यालय`, in a file an officer
signs. Embedding a WASM shaper would be several hundred kilobytes on a route
whose whole point is that the browser already does this correctly, with the
fonts this app already ships.

So the print route is a real screen with real controls — paper, which language,
whether the letterhead prints, whether page numbers do — and a bilingual
instruction sheet saying to choose "Save as PDF". Two consequences:

- **The `@page` rule is GENERATED**, by `print.ts#pageRuleCss`, and injected as
  literal text. `@page { size: var(--x) }` is invalid CSS in every browser and
  falls back to the printer's default, which is Letter in some locales — so a
  paper size the officer CHOSE cannot travel through a custom property. The rule
  is NAMED, for the reason `draft-a4` and `library-a4` are named: a margin asked
  for here must not move the pay slip or the law card.
- **The running header and footer are `position: fixed` inside `@media print`**,
  which is how CSS 2.1 makes a running header, and `counter(page)` /
  `counter(pages)` supply "Page 1 of 3" where the engine implements them. The
  word "of" is a real text node rather than generated content, so the sentence
  still reads where `counter(pages)` is unimplemented.

`.a4-page` is the right surface for the document itself — it paints fixed white
paper in both themes because it is a FACSIMILE of a Government letter — and
everything around it on that screen keeps the theme tokens.

### 6. The app supplies no emblem

`src/lib/drafting/letterhead.ts` accepts an image the OFFICER supplies, and the
card says so in both languages before it offers the control. There is no
Government of India emblem, no ministry crest and no seal anywhere in this
repository and there will not be: reproducing the State Emblem is governed by
the State Emblem of India (Prohibition of Improper Use) Act 2005, and an app
that shipped one would be handing every reader a ready-made letterhead for an
office they may not hold.

An SVG gets a check a raster does not. A PNG is inert; an SVG is a document that
can carry script, an external reference and a stylesheet, and it is rendered by
the browser. It is never rendered inline — it goes in an `<img src="blob:…">`,
where scripts do not run and external references are blocked by the CSP — and
`svgIsInert` is the second belt, so a file that would be blocked at render time
is refused at upload time where the officer can be told why.

The image goes in the RUNNING HEADER only, and the letterhead LINES do not: they
are already on the page, because `renderOfficialDoc`'s `applyStationery`
prepends them to the first `header` block. Putting them in both printed the
officer's letterhead twice on page one, which is what the first version did.

### 7. `meta.signature` gained two controls it never had

The export gate refuses a document failing a `must` checklist item, and
`checklist.ts`'s `signature-block` rule wants the designation, the telephone and
the e-mail under the signature (CSMOP 9.2(x)). `meta.signature` is a SNAPSHOT
taken at creation (ADR-041 §5) and `MetaPanel` offered a name and a designation
and nothing else — so a document created before the profile was filled, or one
made by the importer, carried a required item **the officer could not satisfy
anywhere in the app**. Two `<input>`s in the signature fieldset. Found by
putting an export gate in front of an imported document, which is the only
sequence that reaches it.

### 8. The fixtures are generated from source, and CI checks them

`tests/fixtures/drafting/` holds eleven files — five `.docx`, four `.pdf`
(a letter, two columns, a scan and a password-protected one), a zero-byte file
and an OLE2 compound file wearing a `.docx` name. Every one is
built by `scripts/drafting-fixtures.mjs` from source that says what it is for,
because a binary is opaque in a diff and a fixture nobody can read is a fixture
nobody can correct. The `.docx` files are written **by the app's own zip
writer**, loaded through Vite's SSR module runner — the arrangement
`scripts/library-extracts.mjs` established (ADR-039 §4) — which exercises that
writer against mammoth as a side effect. `node scripts/drafting-fixtures.mjs
--check` rebuilds all eleven and compares, and CI runs it.

### Addendum — what the tests found

Four defects, and the pattern is worth naming because it is not the one the last
several passes found. There is no model here at all; the untrusted input is a
FILE, and every one of these was in code that reads it.

1. **`extract.ts` threw away half the file numbers in this corpus.** The guard
   asked "does a date appear in this candidate" rather than "is this candidate
   entirely a date" — so `12/2/2023-JCA`, which is how a great many of the
   orders this app cites are numbered, was rejected as a date. `12/05/2026` is a
   date; `12/2/2023-JCA` contains one. `isOnlyADate` is the whole fix, and the
   test that caught it was written to check something else.
2. **Two-column detection ran over LINES, which is exactly the wrong input.**
   Two columns share their baselines, so `linesOf` — which groups by baseline,
   as it must — merges "left column line one" and "right column line one" into
   one line spanning the page. A gutter search over lines therefore finds
   nothing on precisely the pages it exists for, and the first version reported
   every two-column document as one column. It reads the ITEMS now, with a
   `SPANNING_ALLOWANCE` of 2 so a title across the top does not defeat it.
3. **The export refusal pointed at a control that was not there.** The blocked
   card said "open the checklist to see which" and offered no way to open it —
   the same "wired up and cannot fire" family ADR-039's addendum names, in a
   surface that had been written that hour. The browser run is what caught it,
   because the export button was simply disabled with nowhere to go.
4. **`extensionOf` returned the last CHARACTER of a name with no dot in it.**
   `name.slice(name.lastIndexOf('.'))` slices from -1, so `README` had extension
   `"E"`. The refusal was right by accident and the message was not. Found
   because Playwright saves a download to a temporary path with no extension —
   a browser run finding a bug in string handling, which is not where anyone
   would have looked for one.

And one **inherited** defect fixed rather than reported: `/draft/profile` failed
axe's `link-in-text-block` on `serious`, because a `text-primary` link inside a
sentence was distinguishable by colour alone. Every other `text-primary` link in
this app is the whole content of its own element, where colour is enough; this
one is in a paragraph, which is the case the rule is about. It arrived in the
concurrent session's commit and its author's session had ended, so it is fixed
here — the sweep it fails is one this session added the route to.

### Second addendum — the edge-case pass, and twelve defects

The pass over this session's own work found eleven, each confirmed to fail
against the committed code before its fix was written
(`src/lib/drafting/io.edge.test.ts`, `src/modules/drafting/io.edge.test.tsx`).

**The pattern is one sentence: the FILE was distrusted and the CONVERSION was
not.** Every way an officer can hand this app the wrong thing — a `.doc` under a
`.docx` name, a scan, an encrypted PDF, a garbled text layer, a 400 MB file, a
zero-byte one — already had its own refusal and a message saying what to do
next, because a file is obviously untrusted and guarding it is the obvious part.
What failed was everything downstream of "the file is fine": an off-by-one in a
level, three controls that could not reach the thing they were labelled for, and
a strip list that quietly took three characters out of a Government document.
That is the same shape ADR-032 and ADR-035 named for an agent, one layer along:
**whatever you obviously distrust gets guarded, and whatever you write yourself
gets written as though it cannot fail.**

Four of the eleven were **a control that is on screen, is labelled, is wired to
state, and cannot reach what it names** — ADR-039's second addendum, four more
times.

1. **Every numbered paragraph exported one level too deep.** `'2. '.split('.')`
   is `['2', ' ']` — length TWO, because a marker ends in a full stop and a
   space — so `length - 1` put an ordinary paragraph at Word level 1 and a
   sub-paragraph at level 2. Nothing throws and the numbers still appear: Word
   draws level 1 with the `%1.%2` format at a 425-twip indent, so an O.M. whose
   paragraphs should read `2.` `3.` `4.` down the left margin opened indented
   and numbered `2.1` `2.2` `2.3`. The test that shipped asserted `<w:numPr>`
   was present and the marker text was gone, and both were true of the broken
   version.
2. **The export panel's language selector chose between two identical files.**
   `DocEditorPage` renders `single` in the APP language and `bilingual` in both;
   `documentsFor` answered `'hi'` with `single`. So an officer working in
   English who picked हिंदी and pressed Export got the English document under a
   file name ending `(HI)`. The bilingual pair is authoritative now, and `single`
   is the fallback for a caller that has only one render.
3. **The print route's paper control could not change the page.** `A4Preview`
   renders `.a4-print-root`, which `src/styles/index.css` pins to
   `page: draft-a4` — a fixed A4. The print route wraps that element, so the
   generated rule was on the ANCESTOR and the inner named page won for
   everything inside it: choosing Letter rewrote a stylesheet nothing applied.
   The e2e test asserted that the CSS TEXT changed, which was true and was a
   proxy for the assertion it meant to make.
4. **The running header and footer printed on top of the document.**
   `position: fixed` in paged media is positioned against the page's CONTENT
   area, not the sheet, so `top: 0` is the top of the text column — the
   letterhead landed on the first block and the page number on the last. Both
   bands sit in the page margin now, and `LETTERHEAD_MAX_HEIGHT_MM` is 16mm
   rather than 30mm because that is what a 25.4mm margin holds.
5. **`©`, `®` and `™` were stripped out of every export.**
   `\p{Extended_Pictographic}` includes all three — they are emoji by default
   presentation rules and they are also ordinary characters a Government
   document uses — so `© 2026 Government of India` exported as
   ` 2026 Government of India`. `\p{Emoji_Presentation}` is the property that
   actually predicts a black box on an office laser, and none of the three has
   it. `✓` survives; `✓️` loses only its variation selector.
6. **The subject swallowed the body's opening paragraph.** The continuation loop
   stopped when a CONTINUATION line ended a sentence and never asked whether the
   subject line already had — and `reconstructPdf` joins paragraphs with a
   single newline, so **every** subject read out of a PDF took the first
   paragraph with it, into `meta.subject` and into the document's title. The
   test that shipped used `toContain`, which passed. A real Government subject
   that wraps carries no full stop halfway through it, which is what makes the
   terminator check safe as well as necessary — and the first version of the
   regression test invented one that did, which would have made the fix
   impossible (ADR-040's rule about a fixture that encodes a wrong expectation).
7. **The letterhead preview showed an already-revoked `blob:` URL, in every
   `pnpm dev` session.** The hook created the URL during render and revoked it in
   the effect's cleanup; StrictMode mounts, runs the effect, DESTROYS it and runs
   it again, so the destroy revoked the URL while it was still in state and still
   on screen and the recreated effect had nothing to do. Measured:
   `created: 1, src: "blob:u1", revoked: ["blob:u1"]`. **No browser run in this
   project could have found it** — `pnpm test:e2e` builds for production, where
   StrictMode is inert, which is exactly the trap CLAUDE.md records costing
   Session 8 two defects in `useDraft`. The hook writes the `src` on to the
   element in an effect now and takes it off in the same effect's cleanup: the
   DOM is an external system, which is the one thing an effect is for.
8. **A share the browser refused did nothing at all.** `navigator.share` needs
   the transient activation of the gesture that started it, and the batch builds
   its archive first — so a real browser rejects with `NotAllowedError` on a
   perfectly ordinary press. Every rejection was swallowed on the grounds that
   "a cancelled share is not a failure". A cancellation is `AbortError`;
   everything else meant no file, no message and no error.
9. **A footer that is only a telephone number was dropped as a page number.**
   The test was subtractive — take away the words a page number is made of and
   the digits, and if nothing is left that is all it was — and `011-23092345`
   subtracts to nothing too. A line with no page WORD in it has to be short.
10. **The export said nothing about an SVG letterhead it could not embed.**
    §6 above claims that nothing silently produces a Word file with no
    letterhead; that was true only on the profile screen, which an officer
    exporting a document need never have visited.
11. **A dead `AbortSignal`.** `buildBatchEntries` checked one between documents
    and no caller could pass one, because the bar disables every control while a
    batch is building. Removed rather than left as a feature that cannot fire.
12. **The number/date table printed the raw stored date beside a formatted one.**
    A document created by the IMPORTER stores `2026-09-03`, because that is what
    an `<input type="date">` needs; one typed in the Session 8 editor stores
    `03.09.2026`, because that is what CSMOP prints. The engine formats whatever
    it is given, so the body of the page read `, the 03.09.2026` while the table
    this session adds at its head read `2026-09-03` — two renderings of one date
    on one sheet, and an ISO storage form in a signed Government document, which
    no CSMOP specimen uses. It goes through `formatDate` now, which is the
    engine's own function, so the two cannot disagree again; a date the officer
    typed in words survives as they typed it, because `formatDate` returns its
    input unchanged when it cannot parse it.

    **This one was found by a warning from the concurrent session**, which had
    just hit the same hazard from the other side: a register holding an intake's
    `2026-08-12` next to a document's `12.08.2026` sorts a September reply above
    the August letter it answers, because `'04.09.2026' < '2026-08-12'` as
    strings. Two dates from two sources in one place is the shape; sorting and
    printing are two of its faces.

Two things worth carrying forward beyond the list. **A proxy assertion is not an
assertion**: three of these had tests that passed against the broken code because
they checked something adjacent — that a stylesheet changed rather than that it
applied, that numbering existed rather than at what level, that a subject
contained a phrase rather than that it ended. And **the one defect a browser
could not find was the one in a browser API**: StrictMode is a development-only
behaviour, so the suite that runs a real browser is the suite that cannot see it.

One thing was found and deliberately **not** fixed. The importer maps a `To`
block on to `name`/`designation`/`organisation`/`address` by POSITION, so "The
Under Secretary" lands in the name field. It renders identically —
`addresseeLines` prints the members in that order and filters the empty ones —
and every rule for improving it is a guess that is wrong in the other language or
on the other form ("The Under Secretary" is a designation; "Shri A.B. Sharma" is
a name; `अवर सचिव` is a designation and looks like neither). `docs/DATA-GAPS.md`
#88 records it rather than trading one wrong guess for another.

---

## ADR-043 — Instruction builders derived from the dataset, a reply flow whose first pass is deterministic, a modify agent that returns a proposal rather than a document, and a register that is arithmetic

**Status.** Accepted (Session 31).

**Context.** Sessions 29 and 30 gave the Drafting Studio a document model, a real
editor, forty-three forms, import and export. What an officer spends their day
on is still not in it: most of what they write is a REPLY to something that
arrived, and most of the rest is a change to something they have already
written. This session builds those two, plus the register that ties them
together and a home screen that shows what is waiting.

The brief also asked for `instructionBuilder(values, context?)` on every
template, generation progress, and a draft library — each of which is a small
decision with one non-obvious answer.

---

### 1. One instruction builder, derived from the template, not forty-three

`data/drafting/templates/*.json` is JSON and a function is not JSON, so "add
`instructionBuilder` to every template" is a choice between forty-three
hand-written builders in TypeScript beside a dataset that already states the
same facts, and one builder that DERIVES the instruction from the template it is
handed.

`src/lib/drafting/instructions.ts` is the second. `person`, `salutation`,
`subscription`, `urgencyAllowed`, `csmopRef.paras`, the layout's block order and
the checklist's `must` items are already in the dataset, already validated by
two schemas (`schemas/drafting-*.schema.json` and `src/modules/drafting/
schema.ts`), and already what `renderOfficialDoc` and `evaluateChecklist` read.
A second, prose copy of them would be the "two implementations of one grammar"
ADR-039 §4 spent a Node script avoiding, and it would go stale the first time
`drafting_seed.py` changed a form.

It is forty-three builders in the only sense that matters: it produces a
different, form-specific instruction for each, and
`tests/drafting-instructions.test.ts` commits all forty-three as snapshots, so a
change to any one of them shows up in a diff somebody reads. 189 assertions
beside them check what the derivation may never lose — the person rule, the
salutation rule, the urgency rule, every CSMOP paragraph, the Hindi register
note, the four-underscore blank rule and every `must` checklist item.

`TEMPLATE_NOTES` holds fourteen per-form lines the dataset cannot state (an O.M.
never goes to a constitutional authority; an endorsement adds no matter of its
own; an RTI reply must always name the First Appellate Authority). It is
deliberately small and every entry cites CSMOP or the Act — a note there is an
assertion about the Manual, and one with no paragraph behind it is the thing
`verify: true` exists to mark.

**Sanitisation lives in the builder rather than at the call site**, so there is
no path from a field value into a prompt that skips it: control characters and
bidi overrides removed, whitespace normalised, and a 5,000-character cap per
FIELD (not per instruction — capping the whole thing would let one long field
push the CSMOP rules off the end) with the truncation reported rather than
silent.

The instruction is **not** cached prompt prefix. It varies per document, per
language and per field value, so it goes in the volatile part of a request; a
`buildSystem({ instructions })` block must be the same bytes on every request.

---

### 2. The reply flow's first pass is deterministic, and it is the feature

`src/lib/drafting/intake.ts` reads a letter with no model in the room: its
reference number, its date, its RECEIPT date, its subject, its urgency grading,
its enclosure count, the provisions it cites and the sentences that ask for
something. It runs on every device with AI off, which is every device's default,
and "Draft the reply" works from those chips alone. `docs/AI.md` §13's ordering —
precomputed first, retrieval always, a model last — is what put the analysis
panel at the BOTTOM of that screen.

It is built ON Session 30's `extract.ts` rather than beside it. That file said in
its own header that this session would reuse it, "because two extractors that
disagree about what 'the number' is would make a thread that never joins up" —
which is exactly what would have gone wrong, since the register threads on the
number.

Four decisions inside it:

**Two dates, and the second is never inferred.** A letter has a date on it and a
date it was received, and a follow-up is counted from the second. `receiptDate`
is read only from an explicit diary or receipt stamp and is otherwise empty for
the officer to fill. `stripReceiptStamp` blanks those lines before `extractMeta`
sees them, because a diary stamp carries a LABELLED date and `extractMeta`
correctly prefers a labelled one — so on a stamped letter it was reading the day
the paper arrived as the day the letter was written. That fix is here rather
than in `extract.ts`: a `.docx` of the office's own document has no receipt
stamp, so changing its date rule would be paying for this case everywhere.

**A request is a FORMULA, not a verb.** "furnish" alone matches "the information
furnished by your office", which is a statement about the past. `ASK_PATTERNS`
matches "may kindly", "it is requested", "you are requested", "कृपया" — the
forms in which an office actually asks. A period ("within 15 days") is reported
as a number of days and is never turned into a date: the letter date and the
receipt date are different starting points and the office knows which it counts
from.

**Provisions are FOUND here and RESOLVED elsewhere.** `findProvisions` is a pure
scan; `src/modules/drafting/intake/resolveProvisions.ts` is where they meet
`data/law`'s 3.9 MB, behind the route's own lazy import. The offence-date rule is
stated by the APP, in both languages, and is never asked of a model —
`dateRuleCaveat()` makes the same decision for the law agent (ADR-035). An
inbound letter almost never gives an offence date, so the note usually says it
does not know which Sanhita governs, which is the honest answer and the one that
stops an officer citing the wrong one in something they sign.

**Nothing is stored until the officer chooses to keep it.** A letter pasted to
read the chips and then abandoned leaves no row at all — the analysis lives in
component state and dies with the tab. `tests/e2e/draft-reply.spec.ts` counts
`intakes` through the real IndexedDB to prove it, because a privacy claim nobody
tests is a privacy claim.

**The AI pass** (`src/ai/agents/intake.ts`, agent id `intake-analyse`) adds what
extraction cannot: a bilingual summary, a reading of what is being asked, the
risks and the next steps. One rule fails it closed — **a cited provision must be
backed by a snippet it was shown**, and a snippet id it was not given ends the
run rather than being dropped and reported. That is stricter than the drafting
agent's posture, and the difference is what the output IS: there an unknown
field is a value nobody asked for and the rest of the draft is usable; here the
whole output is one claim about what the letter says.

---

### 3. Modify by instruction returns a PROPOSAL, and the scope is the app's

`src/ai/agents/modify.ts` (agent id `doc-modify`) is handed the officer's
document and an instruction and returns a whole new body. **That body never
reaches anybody.** It is parsed against `bodySchema`'s closed node list, read
back through `readDoc`, diffed against what the officer has
(`src/lib/drafting/proposal.ts`), marked against the checklist, and returned as
a list of decisions with accept and reject on each. Nothing is applied until the
officer accepts, and an accepted set creates one version — so the state before
the change is recoverable even after they say yes.

That is a stronger guarantee than the drafting agent's, and it is the right one
for the difference between the two: `runDraftingAgent` completes a form the
officer is still filling in; this changes writing they have finished.

**Scope is enforced in code, never trusted from the prompt.** "Rewrite this
paragraph" tells the model which block, and `restrictToBlocks` then discards
every change outside it and REPORTS what it discarded. A persona instruction is
not a check (ADR-036's lesson, in a new place), and the test that matters hands
a mock a document with an out-of-scope block changed and asserts the change is
gone and a sentence says so.

**The proposal's unit is a body BLOCK, not a rendered line.** `versions.ts#
diffDocuments` diffs rendered lines, which is right for showing what changed
between two saved versions and wrong here: a rendered line cannot be turned back
into a body node, so accepting one would leave nothing to store. The two share
the matching algorithm and the reason for it.

**A partially accepted block loses its marks, and says so.** Accepting a changed
block whole takes the model's node unchanged; accepting some of its words
assembles text from two different nodes, and there is no honest way to decide
which set of bold runs survives. `applyProposal` reports it in `flattened`. The
alternative — keeping the before-node's marks over after-text — would apply
emphasis to words the officer never saw emphasised.

**The rationale may not name a paragraph number**, for two independent reasons.
The real one is that a paragraph number here is generated by POSITION, so
accepting an insertion renumbers everything below it and a rationale saying
"paragraph 3 has been made firmer" is then talking about a paragraph the officer
never touched. The second is that it would fail the run anyway:
`context.ts#NUMBERED_PROVISION_PATTERN` reads `paragraph N` as a claim about a
provision, so an answer citing no snippet containing an N is rejected as an
invented citation — `docs/DATA-GAPS.md` #60's wall, hit from a new direction.
`modify.test.ts` asserts that failure rather than leaving it to be discovered.

**Eight quick actions, and one of them is not AI.** Seven expand to a
`QUICK_ACTIONS` sentence the officer could have typed — a preset that took its
own code path would be a second feature to test and the officer could not see
what it was asking for. "Check consistency" calls `lintDocument`, Session 29's
eight deterministic format checks, and runs offline at no cost. It is on the same
row as the paid ones because it answers the same question, and it is the caller
CLAUDE.md said `lintDocument`'s glossary argument was owed.

---

### 4. `groundedRequired` is off on both new passes, and four checks replace it

Both agents make one toolless pass — everything they may use is numbered
PLATFORM CONTEXT — so "cite a tool result" is unsatisfiable by construction.
ADR-035 §1 established the shape and `pay.ts`, `tutor.ts`, `law.ts` and
`study.ts` all take it: `groundedRequired: false` at the CALL SITE, with
`TASK_DEFAULTS` left true so a second, tool-calling pass added later is grounded
by default rather than inheriting an exemption nobody chose.

What replaces it is in code, in both files: for the intake, a cited provision
must be one of the snippets it was shown (and fails the run if not), the
citation an officer sees is re-derived from that snippet, a suggested form must
be one of the forty-three, and the extractor's deadline beats the model's. For
modify, the officer accepts each change one at a time, the scope is enforced,
the body is parsed against a closed node list and read back, and the checklist is
evaluated over the result. `validateCitations` still runs over both answers with
`requireCitation` off.

---

### 5. The register is a fact about paper, and it is arithmetic

`src/lib/drafting/register.ts` is pure — the row shape, the thread walk, the
follow-up state, the duplicate check and the two exports. Nothing on
`/draft/register` asks a model anything, and that is not an omission: a register
is exactly the surface `docs/AI.md` §13 says should be a deterministic function
over the reader's own rows.

Three rules:

1. **An entry POINTS at a document or an intake and never copies one.** Deleting
   the document leaves the entry, which is the whole point of a register — an
   office that could lose the record of a letter by deleting its draft has no
   register at all.
2. **A thread is a chain of `inReplyTo`, walked, never a stored tree.** A stored
   `children[]` is a second copy of the same relation and the two go out of step
   the first time an entry is deleted. The walk is cycle-safe, because an officer
   editing two entries into each other's `inReplyTo` is a thing that will happen.
3. **Overdue is computed from a date the caller supplies.** No clock here
   (`purity.test.ts`), which is what makes "overdue tomorrow" a test that fails
   rather than one that passes until tomorrow.

**Every date is stored ISO, and that was found rather than designed.** An
intake's date is `2026-08-12`, read off a letter; a document's `meta.date` is
`12.08.2026`, which is what CSMOP's specimens print. Stored as they arrive and
compared as strings, `04.09.2026` sorts BEFORE `2026-08-12` — so a September
reply appeared above the August letter it answered, in the list, in the thread
view and in the CSV. `normaliseDates` runs every write through
`format.ts#isoDateValue`. This is CLAUDE.md's own `Number(date.slice(0, 4))`
trap in a new place.

**The automatic entry is wired at the CALLER, not inside `issueNumber`.**
Issuing a number is a fact about the numbering series and the register is a
different ledger; wiring one into the other would mean a build with the register
turned off could no longer issue a number. It is idempotent on the document id,
so renumbering updates the entry rather than filing the same communication
twice.

**The duplicate check has two halves.** `numberingStore.ts` knows what this app
ISSUED (`numberIssues`); the register also knows what the officer recorded by
hand for a communication issued before they had the app. Both feed one warning,
and it is a warning rather than a bar for the reason `validatePattern`'s `no-seq`
case gives — an office's numbering is the office's.

---

### 6. `/draft` is the draft library, and the template grid stays on it

The brief asked for a home with continue-editing, recents, pending follow-ups,
"reply to a letter", "new from template", search across drafts, filters,
duplicate, rename, delete-with-undo and bulk export. `DraftHome` is all of that
and sits ABOVE the forty-three template cards on the same screen, because most
visits are to carry on with something and only some are to start a form — and
because nothing that linked to `/draft` for a form then had to change.

Search reads the body, which costs a parse of every row, so it is done only once
something has been typed. `bodyText` reuses `proposal.ts#textOf`, so "what the
search sees" and "what a diff compares" are the same reading of a document.

---

### Addendum — four things this session got wrong first

Each was found by a test or by a build, and each is the kind that looks correct
on a screenshot.

**`recordIssuedNumber` was written, tested and called by nothing.** The register
would have shown inbound letters and never a single outbound communication. This
is the fourth session in a row to land on "wired end to end and unable to fire"
(ADR-039's addendum, ADR-040's, ADR-041's second). The mechanical check that
catches it is the one ADR-041 already records — sweep for i18n keys nothing
references — but it does not catch this one, because the keys WERE referenced by
a store function nobody called. The generalisation: ask what would have to
happen for each exported function to run, and find the line that makes it
happen.

**A static import of one constant cancelled a dynamic import of the whole
agent.** `ModifyPanel` imported `QUICK_ACTIONS` from `@/ai/agents/modify`, and
rolldown said so in as many words — `INEFFECTIVE_DYNAMIC_IMPORT` — which is a
line in a build log nobody reads. It would have put the agent, the renderer, the
checklist evaluator, the proposal diff and zod into the editor's chunk for every
reader with AI off, and `docs/AI.md` is explicit that laziness in `src/ai` is a
PRIVACY property. `src/ai/agents/modify-actions.ts` is the values-only module
that fixes it. Types are erased and may still be imported from the agent; values
may not.

**Three of the first six browser assertions matched the textarea holding the
letter.** Every value on the "what was read" card also exists on the page
verbatim, because the letter is still in the box above it — so an unscoped
`getByText('A-11011/4/2026-Estt.(Allowances)')` matched twice and failed on
strict mode. The fix is a NAMED region, which is also the a11y fix: a screen
reader hearing the same file number twice with nothing between them cannot tell
which is what the app read and which is the paper. The register's list needed
the same treatment for the same reason — its filter `<select>`s carry the words
"Received", "Sent" and "Pending" as hidden options. CLAUDE.md records the same
class of trap for a study aid quoting the provision it explains.

**`?? []` on a `useLiveQuery` defeats every `useMemo` below it.** A fresh array
literal per render is a new reference, so the draft library's body search would
have re-walked every document on each keystroke anywhere in the tree. One frozen
constant makes "still loading" and "loaded and empty" the same stable value.

**And the trap this ADR names in its own first addendum item was in this
session's own code, twice.** `recordIssuedNumber` was the first. The second was
worse, because it was the feature §3 is about: `ModifyPanel` took the scoped
selection as a PROP, `DocEditorPage` never passed one, and the checkbox that
turned scoping on was guarded by `selection && selection.size > 0` — so
`restrictToBlocks`, enforced in code and tested five ways, could never fire from
the screen. It was found by working down the brief's own list at the end of the
session and asking, for each item, which control makes it happen.

The fix is also better than what was planned. The scope is now a `<select>` of
the document's own paragraphs, by their opening words, rather than the editor's
caret — which keeps this panel from knowing about Tiptap (the line
`purity.test.ts` guards one level down), stops the scope changing under the
officer every time they click in the text while composing the instruction, and
makes what a run will be given something they can read before spending
anything. `numberedBlocks` moved from the agent into `proposal.ts` so the panel
can have it without a static import of the agent — the same
`INEFFECTIVE_DYNAMIC_IMPORT` hazard as `QUICK_ACTIONS`, met a second time in one
session, which is what makes it worth writing down as a rule rather than as an
incident: **a panel may import TYPES from a lazily loaded agent and never
values.**

---

### Second addendum — the edge-case pass, and the shape it found

Seven defects over the two new screens and the extractor, each confirmed to
fail against the committed code before its fix was written
(`src/modules/drafting/{edge.test.tsx,hooks.edge.test.tsx}`,
`src/lib/drafting/intake.test.ts`).

**The pattern was not the one the first addendum found.** That one was "wired
end to end and unable to fire", twice. This pass found that shape once more —
and the other six split into two families that are worth naming separately,
because the mechanical check for each is different.

**Family one: state that is not keyed on what it is about.** Three of the
seven, and the worst defect in the set is here. `EntryForm` in the register
held its draft in `useState(entry)`, which runs on MOUNT — so pressing Edit on
a second row while the form was open kept the FIRST row's values, and Save
wrote them to the second row's id. Nothing throws, nothing looks wrong, and the
officer's correction lands on a communication they were not looking at. That is
CLAUDE.md's `FeynmanBox` lesson exactly ("a rail component that is not keyed on
the unit will save one provision's writing against another"), in a module that
had not existed when it was written.

`IntakeAiPanel` was the same family and worse in one respect: its own header
said "the `key` on this component in `ReplyPage` is the letter's text, so
pasting a second letter asks again", and there was no key. The confirmation
that letter A may be sent silently covered letter B. **An invariant described
rather than implemented is what ADR-037's addendum says to distrust on sight,
and ADR-041 §2 had already been caught by it once** — this is the third time in
four sessions, which makes it worth a habit rather than a note: when a comment
asserts that something elsewhere is true, open that place.

**Family two: a fallback that quietly answers a question nobody asked.** Two
of the seven, both in `ReplyPage`. `activeText` was `text || stored?.text || ''`,
so emptying the box fell straight back to the stored letter and refilled it —
Clear did nothing at all on any letter the officer had kept, which is every
letter they come back to. An empty string is a VALUE here and `||` cannot tell
it from an absence; `text` is `string | null` now, which is the same
distinction `useLiveQuery`'s `undefined` needed in the Library one type down.
And the form select opened on an empty "Suggested" placeholder whose fallback
was `index.data.templates[0]?.id` — the first of forty-three in sorted order,
which is `acknowledgement`. Every officer taking the default got an
Acknowledgement. The select's value is always a real form now, named on screen;
there is no fallback computed anywhere else.

**The extractor's two were both about the other language and the other
extreme.** `ACT_TAIL` looked only AFTER a citation for its Act name, because
that is where English puts it — so "भारतीय दंड संहिता की धारा 420", which is
where Hindi puts it, came back with no Act and could never be resolved. The
Devanagari-fixture rule (ADR-035, ADR-039) in a third place: the English half
working is not evidence. And `findAsks` had no cap while the letter body has
one, so a long circular could push a far larger context than the letter it came
from — `MAX_ASKS` is 12, and a dropped ask that carries a DEADLINE displaces a
kept one that does not, because a cap that silently dropped the one sentence a
follow-up can be set from would be worse than no cap. Writing that test found a
third thing: "The reply may be sent by 30.09.2026" was not an ask at all,
because it uses no request formula. A sentence that sets a time limit is a
request, and it is one now.

**Two of the pass's own tests could not fail, and were rewritten before they
were believed.** One asserted `expect(vi.fn()).not.toHaveBeenCalled()` on a
mock nothing could ever call — it passes against a hook with no cleanup at all.
It watches the `AbortSignal` the provider was handed now, which is what
`wire.ts` gives `fetch` and therefore what decides whether the officer goes on
paying. The other polled a fixed `setTimeout(0)` for a run that needs tens of
milliseconds to dynamic-import its agent, and reported an empty `seen` — which
looks exactly like a hook that never calls its provider. Poll the thing being
asserted about, not a proxy for it; `ai-local.spec.ts` records the same lesson
from the other end.

**And one duplication, found by asking who calls what.** `acceptAll` and
`rejectAll` were exported from `proposal.ts`, covered by `proposal.test.ts`,
and called by nothing but tests — while `DocSuggestion` reimplemented both
inline. The version with tests behind it was not the version that ran.
`DocSuggestion` calls them now. The check that finds this is the same one the
first addendum names: for each function a session exports, name the line that
makes it run.

---

## ADR-044 — Departmental exam mode: a profile is public syllabus structure over public law, a readiness figure that says what it is measuring, and three exams that were deliberately not shipped

**Status.** Accepted (Session 32).

**Context.** The Trainer schedules cards over twelve rule books and the Library reads them, and
neither knows what the reader is preparing FOR. An officer sitting a departmental examination has a
syllabus: particular acts, in particular proportions, in particular papers. This session adds a
generic mode for that — profiles, a plan, weighted mock papers and a readiness figure — and ships
three profiles.

The brief set a boundary before it set a feature, and the boundary is the whole of this ADR:

> an exam profile encodes only PUBLIC syllabus structure over PUBLIC law — which acts, what weight,
> what pattern, from a public recruitment rule or notification. No internal question papers, no
> departmental manuals, no internally circulated material, nothing about any organisation's
> operations.

### 1. One fetched notification, three profiles — and three that were not written

The brief named six examinations. Research produced exactly one document that carries a scheme:

> Section Officers' / Stenographers' (Grade 'B' / Grade I) Limited Departmental Competitive
> Examination, 2016 & 2017 — Notification of Rules, No. 6/1/2020-CS.I(P) dated 15 September 2021,
> Gazette of India, Extraordinary, Part II, Section 3, Sub-section (i).

Fetched from `documents.doptcirculars.nic.in` — a host `scripts/authoring/authoring_common.py`
already knows how to reach and one already on `CITATION_HOSTS` — and its sha256 is recorded in
`patternSource`. It is a COMBINED examination, so its Appendix carries one scheme (three written
papers, 500 marks, plus a 100-mark evaluation of record of service) and its Schedule carries a
per-CATEGORY reference list. Three of its nine categories are cadres this app can serve, so there
are three profiles: `css-so-ldce` (Category I), `ib-so-ldce` (Category VIII) and `railway-so-ldce`
(Category III). Each one's Paper II units are that category's own reference list, in the
notification's order.

The other three were **not written**. `upsc.gov.in` redirects every PDF to its homepage;
`incometaxindia.gov.in` returns 403 to `WebFetch` and to `curl` with a browser User-Agent alike;
no CBI or CAPF departmental scheme was found on any Ministry host at all. `docs/DATA-GAPS.md` #91
records what was tried for each. **A profile with an invented paper list is the exact failure the
boundary exists to prevent**, and one transcribed from a search engine's summary of a document this
repository never read is a claim with no artefact behind it. Three sourced profiles is a better
outcome than six, half of them fiction.

### 2. `external: true` is a first-class state, and it is COUNTED

A syllabus head this app holds nothing for — the Delegation of Financial Powers Rules, the Indian
Railway Establishment Code, ISTM's own notes, the Intelligence Bureau's standing orders — is
`{ external: true }` with a note saying what to study instead. It is named, weighted, and left empty.

The alternative was to leave it out, and that is the failure mode this whole module has to avoid: a
readiness figure over the topics an app happens to cover is a figure about a smaller examination
than the one the reader is sitting. `coverage.ts#mappedMarksShare` is the caveat as a NUMBER, and
`ExamHubPage` renders it on the same card as the figure — for `css-so-ldce` it is exactly 0.3, which
`tests/exam-data.test.ts` asserts to ten places rather than bounding, because the exact figure is
the honest headline.

`railway-so-ldce` is the worked example of the boundary being expensive: two mapped units against
eleven external ones, because the Railway Board's own Manual of Office Procedure, the Indian Railway
Establishment Code, the Railway Services (Conduct) Rules 1966 and the Railway Servants (Discipline
and Appeal) Rules 1968 are none of them in `data/rules`. The picker shows both counts on the card so
a reader sees the ratio BEFORE choosing. And the last two are deliberately NOT mapped on to the CCS
rules of the same shape: they are close in shape and different in text, and mapping one on to the
other would send a candidate to the wrong rule book with the app telling them it was the right one.

**The Intelligence Bureau's standing orders are the case that matters most.** They are on the
Schedule's list for Category VIII, so a candidate who does not know they are examinable is worse
off — the unit is NAMED. This app holds no departmental manual or internally circulated material,
so it is EMPTY. Both halves are asserted in `tests/exam-data.test.ts`.

### 3. The plan is rebuilt, never stored

`examChoices` (Dexie v17) holds the profile id, the target date and a minute budget. That is all it
holds. `plan.ts#buildPlan` is a pure function of those, the catalogue and the live schedule, and the
plan screen recomputes it on every render.

A stored plan is out of date the moment a card is graded. A reader who has raced ahead on the Leave
Rules should not be sent back to them on Thursday because a plan written on Monday said so. The cost
is that the plan must be deterministic — the same inputs must give the same plan on two devices and
on two visits, or it is a plan nobody follows — which is why `src/lib/exam/purity.test.ts` bans
`Math.random()` and `Date.now()` in the directory, exactly as `src/lib/srs` and `src/lib/study` do.

Ordering is `marks × (1 − ready)`: the marks still to be won. Not accuracy — a unit worth thirty
marks the reader is half-ready on is worth more of a limited evening than one worth eight they have
not started. Time remaining decides how much FITS, not what matters, which is the honest place for
it. The last 15% is a revision sprint that introduces nothing; a one-day window is a revision day,
because the day before an examination is not the day to meet a new rule. Session 28's study goals
are honoured through `dailyBudget`, which takes the largest weekly goal the reader set on a work
this examination draws on — a goal is a promise the reader made about their own week, and a plan
that ignores it argues with them every evening.

### 4. Three numbers per unit, because they answer three questions

`mastery` is about the reader: of the cards this app CAN ask, how far through them are they.
`coverage` is about the app: of the cards that exist, how many are approved to ask. `ready` is the
product.

Collapsing them is the tempting simplification and the one that makes the module dishonest.
`mastery` alone reaches 1.0 on a unit the app has four cards for. `coverage` alone says nothing
about the reader. Only the product moves for the right reason in both directions, and the screen
shows all three so a reader can see which half is short — the difference between "study more" and
"this app cannot help you here".

`cardScore` is non-decreasing in a card's progress, and `relearning` scores exactly as `learning`
rather than above it: scoring a lapsed card higher would let a reader raise their readiness by
forgetting things. Monotonicity is asserted over the REAL committed catalogue in
`tests/exam-data.test.ts`, walking every served card up a four-rung ladder in chunks — over the real
catalogue rather than a fixture, because a fixture cannot catch the thing that would actually break
it, which is two units whose coverage overlaps.

### 5. Weights are this app's apportionment, and every screen says so

No notification found apportions a paper between its topics. So each head the Schedule names for a
paper takes an equal share, `weightBasis` is a REQUIRED field stating that in both languages, and
`ExamBanner` renders it unconditionally beneath the mandatory banner. `verify` is therefore about
the PATTERN — papers, marks, duration, negative marking — which for all three profiles was read from
a fetched, hashed document, so all three are `verify: false` and the flag still carries information.

`docs/DATA-GAPS.md` #93 records why the split must not be "improved": weighting reference books
against each other would be this project's guess presented as a marks table, which is worse than an
even split that admits what it is.

### 6. A generated paper is labelled generated, and reports what it could not draw

Every question in a mock is one of this app's own cards. No question paper of any examination is in
this repository. `drawPaper` apportions by largest remainder (`Math.round(count × weight)` per unit
overshoots — ten units at 0.1 with a count of 25 asks 30 questions on a 25-question paper), draws
distinct cards only, shuffles deterministically within each unit by `hash(seed:cardId)` rather than
slicing the catalogue's own rule order, and refuses a subjective paper outright rather than
inventing a marking scheme for it.

What it could not fill is REPORTED: `shortfall` per unit, `skippedPapers` for the papers with no
key. The marking is the notification's own arithmetic — a wrong answer costs `negativeMarking` × the
question's marks, **a blank costs nothing**, and the total floors at zero. That middle rule is the
one an implementation is most likely to get wrong by treating "not correct" as "wrong", and it is
the rule a candidate's whole guess-or-leave-it decision turns on, so it is on the exam-day checklist
in its own right.

### 7. The exam-day checklist says only what the notification says

Eleven items, each traceable to a clause: the prohibited-articles item is clause 7(xii), the medium
item is Appendix paragraph 5 and its Notes, the numerals item is paragraph 12, the handwriting
deduction is paragraph 10, "appearance in all three papers is a must" is paragraph 8. Items are
conditional on the profile where the notification makes them so. Nothing here is general examination
advice: a checklist a candidate follows on the morning of an examination is the worst place in this
app to be confidently wrong.

The items are ids and parameters in `checklist.ts` and sentences in `src/i18n`. That is not a style
rule — this library is pure and has no `useT`, so any sentence written into it would be
single-language by construction. `purity.test.ts` fails on a Devanagari code point anywhere in the
directory for exactly that reason.

### 8. `actHints.ts` was not widened, and the reason is worth stating in these words

`src/modules/onboarding/actHints.ts` switches CCS (Conduct) and OSA cards on for a reader whose post
is in an intelligence or enforcement organisation. The session brief suggested OSA as a unit of the
Intelligence Bureau profile. It is **not** in the notification's reference list for Category VIII,
so it is not a unit, and `scripts/ingest/test_exams_seed.py` asserts that no profile maps `osa` at
all.

**Enabling a rule book because of somebody's job is a guess about their work; putting it on a
syllabus is a claim about an examination.** Only the second one needed a source. Onboarding's own
offer follows the same line: it decides where "Understood" lands and writes nothing, because a
profile is a claim about which examination somebody is eligible to sit and this app cannot make that
claim from a job title — the weaker version of which `actHints.ts` already refuses.

### Addendum — the cadre correction, made mid-session by a real reader

An officer about to join the Intelligence Bureau as an ACIO said so during this session, and read
`ib-so-ldce` as their examination. It is not. The notification's eligibility column for Category VIII
names _"Assistant / Stenographers Grade-II (Personal Assistants)"_ — the **ministerial** cadre; the
executive line (ACIO and above) is a different progression the notification says nothing about.

The profile's name now carries "(ministerial cadre)" and its `eligibilityNote` says in terms that it
is not the executive line's examination. `docs/DATA-GAPS.md` #92 records that no public notification
of a pattern for that line could be found on `mha.gov.in`, `ncs.gov.in`, `egazette.gov.in` or
`dopt.gov.in` — what is published is ACIO-II direct-recruitment advertising, never a departmental
promotion syllabus — and that the syllabus for that line is issued by the organisation to its own
officers, which puts it outside this app's boundary permanently.

The general lesson: **a profile's NAME is the part a reader acts on, and it has to carry the cadre.**
An eligibility note three taps down is not where somebody checks whether an examination is theirs.
Nothing but a real reader would have found this, and the same trap is waiting on any future profile
whose organisation runs more than one cadre.

### ADR-044 addendum — the edge-case pass: thirteen defects, and eleven of them were the app not trusting its own storage or its own call sites

An edge-case pass over this session's own work, run after the commit. Every regression test in
`src/lib/exam/edge.test.ts` and `src/modules/trainer/exam/edge.test.tsx` was confirmed to FAIL against
the committed code before its fix was written.

**The pattern is not the one ADR-032 and ADR-035 found**, and it is worth naming because there is no
model anywhere in this module. Those two concluded "the model's half was guarded and the code's half
was not". Here the DATA was guarded — a profile is schema-parsed, every coverage entry resolves in
both directions, a card is checked for a key before it is marked — while two things the app writes
itself were trusted completely: **rows out of IndexedDB, and its own call sites.**

_Untrusted storage, read as though this app had written it that minute (4)._ `daysUntil` walked
`addIstDays` to a five-year limit and returned the limit, so a date ten years out reported 1,830 days
and so did a string that is not a date — a corrupt row and a real long window were the same number.
`cardScore` let a non-finite stability through as NaN, which the mean carried to `overall` and the
screen rendered as "NaN% ready"; a NEGATIVE stability scored 0.50, more than a card the reader has
actually met. `buildPlan` drew a full four-hundred-day plan for a target date that is not a date,
because `'not-a-day' < '2026-09-04'` is false as a string comparison. And a stored profile id this
build no longer has — a backup from a later release, a withdrawn notification, a rename — left every
exam screen on a skeleton for ever, because `useAsync` was DISABLED for an unknown id and a disabled
`useAsync` never leaves `loading`. That last one is `normaliseScenario`'s stale `jobId` in a new
module, and worse: the Pay module's version rendered an empty box, this rendered nothing at all.

_A branch reachable in the library and dead from the only place that calls it (3)._ `take-mock` had
its kind, its i18n key and its slot in the composition — and `ExamHubPage` passed
`elapsedFraction: null` on every render, so it could never fire. `dailyBudget` reads the reader's
Session 28 study goals, and the plan screen never passed any, **while the card underneath still read
"Taken from your weekly Library goal"** — worse than a hidden branch, because it is a false sentence
on the screen. And `plan.truncated` did not exist at all: a date ten years out silently produced 400
days ending in 2027 while `to` still read 2036.

_A control that says one thing and does another (2)._ Settings rendered `active.id` — "Preparing for
css-so-ldce." — a slug shown to a human, produced by the correct decision not to import
`@/lib/exam` there. And "Stop preparing" called `clearActiveExam`, which clears a flag and leaves a
row recording which departmental examination this officer was preparing for; it calls `forgetExam`
now, and the hub's "Change examination" is the other affordance, which deliberately keeps the date.

_Three found by the caller sweep and the key sweep rather than by thinking (4)._ `checklist.ts` had
its own `reduce` over `durationMinutes` beside `totalDurationMinutes`. Two store accessors and a hook
had no reader at all. Seven i18n keys named features this session did not build. `bookmarkMany`'s
rejection was swallowed entirely, so a device with no storage left got a button that silently did
nothing — the omission CLAUDE.md already records for onboarding's `finish()`.

**The two mechanical checks that found nine of the thirteen take a minute each**, and both are in
CLAUDE.md already: sweep the i18n catalogue for keys the session added that no source file
references, and for each function the session exports, name the line that makes it run. The second
one has to exclude tests to be worth anything — every export in this module had a caller until the
sweep was narrowed to production callers, and four of the five it then found were real.

### ADR-044 second addendum — the act hint fires when a profile is chosen, applies only to the default, and says so

`docs/DATA-GAPS.md` #56 asked for the Trainer's act hints to come from the reader's chosen exam
profile rather than from their job title, and §8 above is why that is the better signal: a profile's
units are read off a gazette-notified reference list whose sha256 is in its own `patternSource`,
where `trainerActHintsForJob` infers from an organisation name.

**Where it fires was the real question.** `trainerActHintsForJob` is applied in exactly one place,
`OnboardingPage#finish`, and onboarding deliberately does not choose a profile — a profile is a claim
about which examination somebody is eligible to sit, and this app cannot make that claim from a job
title. So the only honest moment is the one where the reader actually chooses one, which is
`ProfilePicker#choose` in `ExamHubPage.tsx`.

**Two constraints, and the second goes beyond what was asked for.**

It applies only when `actsEnabled` is empty. That is the default and it means _every_ rule book, so an
empty list is "this reader has not decided" and anything else is a decision they made. Overwriting a
decision because somebody tapped a card on a different screen is a change they would never connect to
the action.

And it is **announced in the same view, never applied silently** — which matters even for the
default. The picker actively invites browsing: it shows three profiles side by side with their
mapped/external ratios precisely so a reader can compare them before committing. A reader who taps
the Railway profile to look would otherwise find their Trainer narrowed to two rule books and their
due count collapsed, with nothing on screen connecting the two. `ProfilePicker` hands the hint up to
`ExamHubPage`, which renders its note as a `role="status"` panel on the readiness screen that
replaces the picker — the arrangement `OnboardingPage` already uses for the job-derived version of
the same hint.

The negative test is the one that carries the weight: a reader with `actsEnabled: ['gfr']` chooses a
profile, and the setting is asserted untouched with no note shown. Without it, "applies the hint" and
"always overwrites" are the same passing test.

**Session note.** This landed across two concurrent sessions in one working tree —
`trainerActHintsForProfile` and its tests are legalhelp-ab's, the call site and its two tests are
this session's, agreed by message before either was written. It is also the session where a
`git add -A` in that shared tree swept a peer's uncommitted work into commit `9613b67`; nothing was
lost, the message was amended to list what it actually carries, and the rule is written into it:
with two sessions in one tree, `git add <paths>` is the only safe form.

---

## ADR-045 — The Hindi statute is published and unreadable, the First Schedule's continuation rows, and a performance option measured and rejected

**Status.** Accepted (Session 33).

**Context.** A gap-closing sweep over `docs/DATA-GAPS.md` rather than a feature: the Hindi statutory
text (#16, #45), the BNS sections carrying no First Schedule classification, the commutation table
(#52), Lighthouse mobile performance (#58), the service-worker toast (#59) and the Trainer act hints
(#56).

### 1. The Hindi Sanhitas were found, and the finding is that they cannot be read

Row 16 had said no official Hindi text of the three Sanhitas had been located. It had — Session 20
looked for `mha.gov.in`'s `..._english_...`/`..._hindi_...` filename convention and the Hindi files
are not named that way. MHA's own **Hindi-language** page links all three, and they were fetched.

All three are unusable, and this is measured rather than asserted. They set Hindi in `Mangal` subsets
mapped through `WinAnsiEncoding` alongside one correct `Identity-H` subset, so glyphs are dropped
wholesale: the title of the BNS extracts as `भाययायंहा, 2023`. Two further publishers were checked —
PRS India's Hindi bill text is a scan with no text layer at all, and BPRD's Hindi handbook is legacy
visual-order and is a police handbook rather than the statute. Eleven documents from five publishers;
every one fails.

The decision this forces is the one the master context already fixed: **nothing is machine-translated
and nothing is guessed.** All 1,059 section texts keep `hi: ""` and the reader's "not yet available"
notice fires. What changes is that a future session need not search again — the obstacle moved from
discovery to font mapping, and `scripts/ingest/reports/hindi-text-layers.json` is the committed
record. `sources/` is git-ignored, so without that report the measurement would have to be redone
from ~90 MB of PDFs to be believed.

### 2. `--audit-hindi` had a hole, and it was contradicting this repository's own notes

The audit asked two questions: is the text overwhelmingly Devanagari, and does it contain letters from
outside that block. A legacy font that maps Devanagari glyphs onto **real Devanagari codepoints in
visual order** answers both correctly and still produces nonsense. Two fetched Hindi rule books passed
on that basis, one of them CSMOP — which `docs/DATA-GAPS.md` #36 has recorded as unreadable since
Session 8. An audit disagreeing with a written finding is worse than no audit, because the audit is
what a future session would trust.

`authoring_common.visual_order_share()` is the third test. Unicode stores Devanagari in **logical**
order, so a dependent vowel sign always follows its consonant and **no token can begin with one**; a
legacy font stores glyphs in the order they are drawn, where the i-matra sits to the left, so `किसी`
comes out `िकसी`. It needs no word list, which is what makes it honest — no document can pass by
happening to use vocabulary the checker knows. Measured: CSMOP 3.2%, the OL Act 4.5%, DoPT's CCA rules
18.0%, this project's own authored Hindi 0.0%.

Writing the control found a false positive that was correct: `ccs-conduct.json`'s `_note` quotes the
corrupt extraction as the reason the file exists. The test skips `_`-prefixed metadata keys — the same
shape as `src/lib/study/purity.test.ts` stripping comments because `quiz.ts` names `Math.random()` in
one.

### 3. "No classification" was right; checking it found 24 dropped rows

The 70 unclassified BNS sections are definitions, general exceptions and the repeal — s.63 defines
rape and s.64 punishes it. Verified against the Schedule rather than reasoned about: it names 288
distinct BNS sections, the dataset classifies exactly those 288, and none of the 70 appears in it.

Checking it exposed a real defect. A Schedule row whose section column is **empty** continues the row
above, and `parse_first_schedule` read only numbered rows. Twenty-five such rows exist, and they are
not wrapped text: **BNS 77 (voyeurism) and 78(2) (stalking) are bailable on a first conviction and
NOT on a second**, each on a continuation row. The app was answering "is this bailable" with the wrong
half of the Schedule. BNS 264 was the one true header row — an offence named with every column blank,
its punishment on the two lettered rows beneath — and it rendered a classification card with nothing
in it.

441 → 465 rows over 21 sections; dataset version 1.2.0, because a cached AI answer must be invalidated
for it. The invariant that makes this checkable without the source is in `tests/law-data.test.ts`: an
unclassified section must carry no punishment text.

### 4. #58's option (b) was tried, measured and reverted

Folding each module's index view into its module chunk removes one hop on paper. It buys nothing,
because `routePreloadHeaders()` was **already** emitting a `Link: rel=preload` for the view chunk
beside the module chunk — the browser had been fetching both in parallel since that plugin landed, so
the hop was never on the critical path. Measured back to back on one machine: `/law` LCP 4.4s → 4.5s;
across seven routes 86/84/81/80/75/89/89 → 85/84/80/79/75/89/88. No route better, four marginally
worse, and 0.7 KB gzip added to the initial route.

Reverted. **A preload hint and a static import remove the same round trip and only one of them is
free** — which is the check to run before re-trying it.

Neither run was committed. Both sat at load average 19-25, so their absolute values are not comparable
with the quiet-machine baseline even though the A/B between them is, and `docs/lighthouse/` still
describes the committed code because the change was reverted. `docs/lighthouse/README.md` already
recorded a 23-point contention swing; this session reproduced it, and the control that identified it
is worth more than the conclusion: `/utils` and `/settings` dropped too, and route splitting cannot
plausibly move those.

### 5. The toast reserves space rather than moving

Two defects. The offset ignored `env(safe-area-inset-bottom)` while `Nav.tsx` pads the tab bar by that
inset, so on a phone reporting one the toast sat on the bar. And an overlay covers what is under it at
any offset — moving it up only relocates the collision. `--pwa-toast-space` is measured from the
rendered toast by a `ResizeObserver` and added to the main element's bottom padding; measured because
these strings are one line in English and can be three in Hindi, and via a callback ref so every path
by which the last toast disappears also gives the space back. `--tab-bar-height` is now the single
definition of the bar's height.

### 6. The commutation table parses

#52 said the PDF's content stream could not be read. `pdfplumber` finds no table on that page because
the page draws no ruling lines; the text layer is clean and PyMuPDF reads it as three age/value column
pairs. All 62 rows agree with page 36 of the Rules, so `commutation.verify` is now `false` — and
`tests/pension-data.test.ts` is `data/pension/`'s first dataset test of any kind, which is its own
finding: the engine over that data is thorough and runs entirely against a fixture, so the committed
table was read by nothing.

### ADR-045 addendum — the edge-case pass, four defects

Every test named here was confirmed to fail against commit `fffd54e` before its fix was written.
Three of the four are in code this session wrote; the fourth is code this session **broke from a
distance**, and that is the one worth carrying forward.

**1 & 2. `usable` said yes to two documents that carry no readable Hindi.** The predicate's own
docstring claimed three tests and gated on two: `devanagariRatio` was computed, reported in the
committed JSON, and never consulted. So an English PDF mislabelled `lang: "hi"` came back **usable** —
it has no letters from outside the Devanagari block for the reason that it has none inside it either,
and it is in logical order because it is not Devanagari at all. Separately there was no minimum
volume, so a scan yielding a dozen stray glyphs scored a perfect ratio against almost no denominator
and also came back usable. `MIN_LETTERS` (500) and `MIN_DEVANAGARI_RATIO` (0.20) close both; the
smallest real Hindi rule book has ~7,800 letters at 0.996, so neither threshold is near anything
genuine.

The direction matters more than the numbers. A false UNUSABLE costs somebody a hand-check; a false
USABLE is the signal that would let a future session extract garbled statutory text. This is the same
failure the session had already fixed once — an audit reporting a broken document as usable — arriving
from a second direction, which is a fair sign the predicate deserved the split below.

`measure_hindi_layer()` is now pure and `audit_hindi()` is IO plus a call to it. It was previously
reachable only by putting a PDF on disk and naming it in the manifest, and both holes were found by
calling it directly with text no real document produces. **A predicate that can only be exercised
through the filesystem is a predicate whose edges nobody has seen.**

**3. A continuation row after an unparseable section row attached to the wrong offence.**
`parse_first_schedule` carries the section forward across continuation rows; if a row's section column
holds something that is _not_ a section — a column header, or a chapter banner if NCRB adds one — the
parser skipped it and kept carrying the section from before, so anything continuing after it landed on
an offence it was never written about. `carried` is cleared on such a row now, so the continuation is
dropped exactly as it was before continuations were read at all. Latent rather than live: the
Schedule's only unparseable row today is its column header and nothing continues it. Kept because the
cost of the wrong answer here is a cognizable/bailable value on the wrong offence, which nothing
downstream can detect.

**4. The 24 recovered rows gave `ClassificationTable` duplicate React keys.** `key={row.clause}` was
correct for every build before this one, because a section's classification rows had distinct clauses.
Reading the Schedule's continuation rows made BNS 77 carry two rows both clause `77`, and React
reconciles by key — on a re-render it can carry one limb's cells onto the other's row, and the two
limbs differ on exactly the value an officer is reading. **A data change broke a consumer that was
correct when it was written, and no test in the repository failed.**

Worth the whole addendum: the first two tests written for it — that both rows render, and that they
show different bailability — **pass against the duplicate key**, because React logs the collision and
renders both rows anyway. A content assertion cannot see a key collision. The test that catches it
spies on `console.error` and asserts React reported no duplicate; it fails against `fffd54e` naming
key `77`. That is the fourth time this repository has recorded "break the code and watch the new
assertion go red before believing it", and the first where the too-weak test was written during an
edge-case pass whose entire purpose was to distrust exactly that.

**5. `library_seed.py --check` could never pass.** Found while running CI's gates by hand before
pushing. Every payload carries a `generatedAt` of today and the comparison was a bare `!=`, so all
sixteen files reported as differing on any day after they were written — which is why that run is not
a CI step, and so why the drift it exists to catch had nobody watching it. `ingest_common` already
had `strip_volatile` and `generatedAt` was already in `VOLATILE_KEYS`; this was the one caller not
using it. Verified in both directions: a real content change still fails the check, because a check
that cannot fail is no better than one that cannot pass — and this pass had already swapped one for
the other once. Pre-existing, confirmed by running `--check` in a worktree at `bb29d49`.

---

## ADR-046 — Information architecture v2: five tabs, three page levels, parent-aware back, and a redirect for every URL this app has ever had

**Status.** Accepted (Session 34).

**Context.** The app had grown to **seven top-level destinations and ~45 routes** with no page
hierarchy. Three of the seven lived behind a "More" sheet on a phone, so half the app was invisible
until you opened a menu that told you nothing about where you were. Underneath them, features were
nested behind hubs whose only content was links one level down (Utilities), or spread across sibling
routes with no relationship expressed anywhere (thirteen off the Drafting Studio's picker, four for
exam mode). There were **two document editors**. Nothing anywhere said what a page was inside of, so
there was no back control that could be right, and the browser's own back button was the only way out
of a document — which is exactly the button a reader has just spent five taps not using.

This is a UI/IA change. **No dataset changed, no feature was added or removed**, every module keeps
its own directory, and every URL the app has ever served still resolves.

### 1. The old tree

```
/                     -> /law
/law                  /law/whats-new  /law/saved
/pay
/draft                /draft/documents  /draft/new/:type  /draft/d/:id  /draft/d/:id/print
                      /draft/import  /draft/reply  /draft/reply/:id  /draft/register
                      /draft/profile  /draft/address-book  /draft/numbering
                      /draft/my-templates  /draft/:type          <- the Session 8 editor
/learn                /learn/review  /learn/mock  /learn/browse  /learn/bookmarks
                      /learn/reports  /learn/settings  /learn/review-queue
                      /learn/exam  /learn/exam/plan  /learn/exam/mock  /learn/exam/checklist
/library              /library/mine  /library/bookmarks  /library/compare  /library/search
                      /library/add  /library/study
                      /library/:workId  /library/:workId/:unitId
                      /library/:workId/quiz/:nodeId  /library/:workId/sheet/:nodeId
/utils                /utils/glossary  /utils/holidays  /utils/leave  /utils/pension  /utils/portals
/settings             (one page, eleven sections)
/onboarding
```

Four tabs on the bottom bar (`law`, `pay`, `draft`, `learn`); `library`, `utils` and `settings` in a
"More" sheet.

### 2. The new tree

```
/home                                       L1   the landing route
/study                                      ->   /study/read
  /study/read                               L1   Read
    /study/read/search                      L2
    /study/read/add                         L2
    /study/read/:workId                     L2       parent /study/read
    /study/read/:workId/:unitId             L3       parent /study/read/:workId
    /study/read/:workId/quiz/:nodeId        L3       parent /study/read/:workId
    /study/read/:workId/sheet/:nodeId       L2       parent /study/read/:workId
  /study/progress                           L2       parent /study/read
  /study/practise                           L1   Practise
    /study/practise/review                  L3       parent /study/practise
    /study/practise/mock                    L3       parent /study/practise
    /study/practise/browse                  L2
    /study/practise/bookmarks               L2
    /study/practise/reports                 L2
    /study/practise/review-queue            L2
  /study/exam                               L1   Exam   (plan + checklist are #anchors on it)
    /study/exam/mock                        L3       parent /study/exam
  /study/notes                              L1   My notes
    /study/notes/compare                    L2
/draft                                      ->   /draft/documents
  /draft/documents                          L1   Documents
    /draft/documents/import                 L2
  /draft/new                                L1   New
    /draft/new/:type                        L2
  /draft/reply                              L1   Reply
    /draft/reply/:id                        L3       parent /draft/reply
  /draft/register                           L1   Register
  /draft/templates                          L1   Templates
  /draft/d/:id                              L3       parent /draft/documents
    /draft/d/:id/print                      L3       parent /draft/d/:id
/law                                        L1   Convert   (the section root IS the converter)
  /law/whats-new                            L1   What's new
  /law/saved                                L1   Saved
/tools                                      ->   /tools/salary
  /tools/salary /tools/leave /tools/pension /tools/holidays /tools/glossary /tools/portals   L1
/settings                                   L2   the sections list
  /settings/profile  /settings/address-book  /settings/numbering  /settings/trainer
  /settings/ai  /settings/data  /settings/backup  /settings/about                            L2
/onboarding                                 L3   (rendered without a FocusBar)
```

Five tabs — **Home · Study · Draft · Law · Tools** — and they fit the bottom bar at every width this
app supports, so `OVERFLOW_NAV_ITEMS` and the "More" sheet are gone rather than hidden.

### 3. Why these five, and why Settings is not one of them

**Study is the section that was three.** The Library, the Rules Trainer and exam mode were three
top-level destinations (two of them behind the sheet) doing one thing: getting a rule from the book
into an officer's head. Reading a provision, drilling a card about it and checking where that leaves
you for a departmental examination are three views of one activity, and moving between them meant
crossing the whole navigation.

**Tools absorbed the Pay calculator and dissolved a hub.** `UtilsHubPage` was a grid of five cards
whose only content was links to its own children — a tap an officer paid on every visit, replaced by
the sub-tab strip, which says the same thing and costs nothing. Salary is the first of the six.

**Settings is the top-right gear**, which is where everyone looks for it, and putting a screen an
officer opens a handful of times a year in the same rank as the four they open every day is what cost
the bottom bar a slot it needed. It is a section of its own — eight pages, from one page that was
eleven sections long — and three of those pages came from the Drafting Studio (profile, address book,
numbering), because "set once, read by every new document" is what this section is for.

**Home is new and is the only genuinely new screen.** `/` went to the Law Converter, so "carry on
with the O.M. I was writing" meant remembering which of seven tabs it was under. Every card on it is
a link into a section and none of them is a feature of its own; every figure comes from IndexedDB
plus two small index files (the Library's 11 KB shelf, the exam picker's 2 KB index). It reads no
corpus, no card catalogue, no pay table.

### 4. Three page levels, decided from the route registry rather than reported upwards

`APP_ROUTES` in `src/lib/nav.ts` gives every route a `level` and — for every `detail` and `focus`
route — a **required `parent`**.

- **`tab` (L1)** — `TabLayout`: chrome, one `<h1>` naming the section, the sub-tab strip, the page.
  Every sub-tab page's own masthead is therefore an `<h2>` (`PageHeader` gained an `as` prop), because
  four pages each claiming to be the top of the same section is the flatness this was for.
- **`detail` (L2)** — `DetailLayout`: chrome, a breadcrumb trail from 1024px, a back chevron below it.
  Both are built from the same declared parents, so they cannot point at different places.
- **`focus` (L3)** — `FocusLayout`: no sidebar, no bottom bar, no app top bar. One `FocusBar` with
  back-to-parent, a title, a status slot, a ⋯ menu and a panel-toggle slot. Escape leaves, with the
  same two exclusions `useGlobalShortcuts` makes (typing, or a dialog open).

**`App.tsx` asks `levelOf(pathname)` synchronously and hides the chrome itself.** The obvious
alternative — `FocusLayout` setting a flag in an effect — paints one frame with the sidebar and the
tab bar still on it, on every navigation into the reader or the editor. `levelOf` is a pure function
over the pathname, so the first frame is already right.

The ⋯ menu carries the language and theme toggles **because the app's top bar is hidden at this
level**. A reader who cannot switch to Hindi in the middle of reading a rule has lost the one control
this app promises everywhere.

### 5. Back has two branches, and the difference is not cosmetic

`useBackTo` asks one question: _did we arrive here from inside this section?_ `AppLink` is what makes
it answerable, by stamping the current section into `location.state`.

- **Yes** → `navigate(-1)`. A reader who reached the document editor by pressing a row in the register
  wants the register _as they left it_: the same filters, the same scroll position, the same expanded
  thread. A pushed parent route gives them none of that.
- **No** → push the declared parent. A reader who arrived from a shared link, a bookmark, the command
  palette or a cold start has no history to pop, and popping would take them out of the app — the
  classic broken back chevron.

There is no third case, because the parent is required on every detail and focus route
(`src/lib/nav.test.ts` asserts it, that every parent is itself a registered route, and that following
parents from any page reaches a tab).

### 6. Sub-tab strips are links, not `role="tab"`

`SegmentedTabs` is a labelled `<nav>` of `NavLink`s carrying `aria-current="page"`, with Left/Right/
Home/End moving focus between them. The ARIA tab pattern promises a tabpanel swapped in place and a
widget that owns its own focus; neither is true of a router, and claiming both is how
`aria-required-children` and "where did my back button go" arrive together. The keyboard behaviour a
reader actually wants is implemented on the links, where it costs nothing and lies about nothing.

The **badge slot** exists on every sub-tab and exactly one is wired: the Register's follow-up count,
which is an exact figure from a small Dexie table. Study's "due reviews" badge is deliberately NOT
wired — the exact filtered figure needs the 4 MB card catalogue, and an approximate count that
disagrees with the Practise page a tap later is worse than no count. The value is supplied by the
section's own lazily-loaded router, never by a hook in the shell: a count computed in the shell is a
count every reader downloads the machinery for.

### 7. What was removed, and what was merged

- **The Session 8 form-and-preview editor (`/draft/:type`, `EditorPage.tsx`) is deleted.** Its route
  redirects to `/draft/new/:type` — create a document of that type and open it in the editor that
  replaced it, which is what the link was for. The `drafts` table is untouched: `RecentDrafts` now
  migrates the row it is asked to open (`migrateOneDraft`, a copy, idempotent) and opens the document
  that comes out. Letting the redirect alone handle an old draft link would have created a blank
  document and silently discarded the officer's afternoon — a redirect that appears to work and throws
  the work away is worse than a dead link.
- **`UtilsHubPage` is deleted** — see §3.
- **Exam mode's plan and checklist became sections of `/study/exam`** under `#plan` and `#checklist`,
  with jump links. They were views of one decision — which examination, by when, and what to do about
  it — and a reader comparing "62% ready" against "nineteen days left" had to hold two screens in
  their head. The mock stays a route because sitting a paper is the one thing here an officer is
  _inside_.
- **My notes is the old My Study, the Library's bookmarks list and the compare entry point in one
  page.** All three were lists of the reader's own work and the only thing separating them was which
  table the row came from — which is what that screen's Kind filter already was. A fourth kind
  (own-words attempts) joined it. `?type=`, `?work=` and `?colour=` are in the URL, which is what
  makes `/library/bookmarks` → `/study/notes?type=bookmark` a redirect that lands somewhere useful.
- **The Practise tab has one "Today" card** (due, streak, goal, Start review) and five secondary
  destinations as rows underneath, always rendered. The mock used to be a large button beside Start
  review that went _disabled_ when no eligible card existed, which put a dead control in the most
  prominent place on the screen; the reason it cannot run is now a sentence in its row.
- **The Documents tab is `DraftHome` plus the profile nudge, the migration banner, the older drafts
  and an Import button.** Import is a page _under_ Documents rather than a sibling of it: importing is
  one way of getting a document into the list, not a place in the navigation.

### 8. Redirects are kept for ever

`LEGACY_REDIRECTS` is 38 rows, each turned into a `<Route>` rendering `<Navigate replace>`. Query
strings, fragments and route parameters all travel; where the target has its own query (
`/library/bookmarks` MEANS `?type=bookmark`) that wins. `tests/redirects.test.tsx` visits all of them
through a harness that reproduces the app's own mounting, and a second test fails if a row is missing
from the hand-written table.

**The Drafting Studio's redirects are mounted inside `DraftPage`, not in the app router.**
`/draft/:type` matches every single-segment path under `/draft`, and React Router ranks a dynamic
segment above a splat — so mounted beside `/draft/*` it would claim `/draft/documents` and send an
officer's document list to a template called "documents". Inside the section's own router it is
simply last, after every real route, which is where it was before.

`/law` is deliberately NOT a redirect. The converter's whole view lives in the query string
(ADR-013), so `/law?q=302&code=bns` — in a bookmark, in a shared message, in the palette's own results
— stays canonical. That is why one sub-tab's path is allowed to equal its section's root.

### 9. What this cost, and one thing it did not buy

Two mechanical passes over the tree caused most of the work: `PageHeader` demoted to `<h2>` on
seventeen sub-tab pages, and every hard-coded internal path rewritten. A path-rewriting script run
over `src/` with a lookahead of `["'`?#$]`also matched the closing quote of **module specifiers** —`@/lib/utils`became`@/lib/tools`, `@/lib/library`became`@/lib/study/read`— across 117 files. It
was caught by`pnpm typecheck`in under a minute and repaired by restoring every changed import line
from`HEAD`, but the lesson is worth the sentence: **a route literal and a module specifier are the
same string in the same quotes, and a regex cannot tell them apart.** Rewrite paths through the
`url.ts` helpers that already centralise them, and read the diff of any bulk substitution before
running the tests.

What it did not buy: **nothing here changes what the app can do.** No data, no feature, no dataset
version. The measurable win is structural — five reachable tabs instead of four plus a sheet, one back
control that is right in both cases instead of none, and a URL tree in which every page can say what
it is inside of.

---

## ADR-047 — Focus mode: the reader and the document editor at level 3

**Status.** Accepted (Session 35).

**Context.** ADR-046 made `/study/read/:workId/:unitId` and `/draft/d/:id` **focus** routes — no
sidebar, no bottom tab bar, no app top bar, one `FocusBar` above them. It did not change either page,
so both were still built for a screen with chrome around it: the reader put five permanent control
groups, a read-aloud card and a progress header between the officer and the provision, and the editor
put eight tabs across the top of a document nobody could see while using any of them. The bar's own
slots — `title`, `status`, `panel` — were declared by that session and used by nothing.

**No capability was added or removed** except where §7 says so. Every control that existed is still
reachable; several that were unreachable are reachable again.

### 1. A page's controls reach the bar by PORTAL, never by storing a node in state

`focusSlots.tsx` keeps `title` and `status` as strings in state, because a string is a stable
dependency and `useFocusTitle` cannot loop. Everything richer — the reader's unit switcher, its "Aa"
and headphones buttons, both pages' ⋯ entries — is a portal into one of three hosts (`title`,
`actions`, `menu`) that `FocusBar` renders.

Storing a React element in state is the loop that rules out: an element is a new object every render,
so an effect depending on one sets state and fires again. A portal has no such problem and buys two
more things — the controls stay in the PAGE's tree (its state, its handlers, no stale closures) while
appearing in the BAR's DOM in reading order, so the tab order is right.

**There is ONE ⋯ menu.** A page's entries are portalled to the top of the shell's, above the language
toggle, the theme toggle and Settings. A second ⋯ beside the first would be asking the reader which
of two identical glyphs they wanted.

### 2. `data-focus-overlay`, because stopping propagation is not enough and looks as though it is

`FocusLayout` leaves the screen on Escape. Its listener is on `window` in the capture phase, so it
runs **before** any listener a page's popover puts on `document` — capture walks from the window
down. The reader's "Aa" tray and its study sheet both called `stopPropagation()` and both were still
thrown out of the provision they were open over, because by the time their handler ran the layout had
already navigated.

So an overlay marks itself in the DOM — `data-focus-overlay` while it is open — and `FocusLayout`
asks, next to the `[role="dialog"]` check it already made. That is order-independent, which is the
property a registration-order guarantee is not: the ⋯ menu's own comment in that file says exactly
that about two capture-phase `window` listeners, and this is the same argument one layer out. Fourth
time this project has hit "two Escape handlers on one press" (ADR-029's addendum, ADR-041 §9, the
editor's shortcuts sheet, this).

**In the editor, Escape does two things in order.** `FocusLayout` will not leave a screen while the
caret is in an editable element — right, and in a document editor the caret almost always is, so the
way out would have been unreachable from the keyboard exactly where it is most wanted. The first
Escape takes the caret out of the document (an ordinary editor idiom, nothing changed); the second
leaves.

### 3. The reader: one tray, one bar, one column, one rail

- **"Aa" is one popover** holding what were five permanent control groups — reading language, size,
  typeface, spacing, surface. They are set once, and a control that is set once does not earn a fifth
  of the screen on every unit for ever. `TypeControls` is unchanged apart from its layout and a live
  sample line, which is what a popover has to add in exchange: with the controls on the page, the text
  itself was the preview.
- **The bar's centre is a unit switcher** — number, heading, and a popover with a plain substring
  filter over the reading order. Not the table of contents (`TocTree` is that, on the work page) and
  not a search index: fuse.js is gated behind `isSearchable` on the work page for a corpus that
  reaches 531 sections, and a switcher opened to jump two rules forward must not pay for one.
- **The text column is 68ch and the unit's identity is stated once.** The `SectionNumber` chip beside
  the heading was the same fact the bar now carries, on the same row; it prints instead.
- **The rail is four tabs — Understand · Practise · Related · Ask —** and these ARE `role="tab"`,
  which ADR-046 §6 refuses for the sub-tab strips. Both halves of that objection are false here: one
  panel is swapped in place, in the same document, with no navigation and no URL change, and the
  widget owns arrow-key focus. The order is `docs/AI.md` §13's order and Ask is present only when AI
  is on, so turning it off costs the rail one tab out of four.
- **One rail, styled two ways.** The first version rendered a desktop column and a phone sheet as two
  subtrees and let `hidden lg:block` choose — correct on screen and wrong everywhere else: both are
  in the DOM at every width, so a screen reader met the aid twice and the tablist existed twice with
  two different tabs selected. The overrides that make one element do both are pure CSS, because a
  viewport branch in React disagrees with the rendered layout for a frame after every resize.
- **The footer is one line and a disclosure.** Citation visible (it is what an officer copies), source
  and dataset version behind "Source & version" and forced open in print. The standing disclaimer is
  a full banner on the session's FIRST provision and the same sentence as a muted note thereafter —
  a decision about emphasis, not presence, and `firstUnitOfSession` is a module variable holding an
  id rather than a boolean, because a boolean has to be flipped back and StrictMode double-invokes
  the effect that would do it.
- **Three first-run coach marks, one at a time** ("Aa", highlight-by-selecting, the rail), dismissed
  individually into the same Dexie row as every other reading preference. Three at once is a tour,
  and a tour is what a reader dismisses without reading.

`ReaderPrefs.focus` is **gone**. It hid the type controls and the rail; the reader IS a focus route
now, the type controls are behind "Aa", and the rail has its own remembered `railOpen`. Three
controls doing one job is how they come to disagree.

### 4. The editor: a workspace, not a tab strip

Outline · document · panel, and two URL parameters rather than one.

- `view` is what the MIDDLE shows (`write` / `preview` / `panel` / `export`) and `panel` is what the
  RIGHT shows (`check` / `assist` / `versions` / `comments`). On a desktop both are on screen at
  once, so one parameter could not describe the screen. `view=panel` is the phone's way of saying
  "the panel instead of the document", and on a desktop it reads as `write`.
- **The outline is headings and numbered paragraphs**, indented by level, each a button that takes
  the caret there and a pair that moves it. `src/lib/drafting/outline.ts` is the pure half; an entry's
  `index` is a position in `body.content`, which is what makes a heading step over the paragraphs
  under the heading above rather than burying itself inside them. **It prints no paragraph numbers**:
  markers are generated by position (ADR-041 §7), so a number here would be wrong the moment anything
  above it moved — on the one screen whose purpose is moving things.
- **Reordering is buttons first and drag second.** A move-up/move-down pair is reachable from a
  keyboard, announced, and works on a phone; native drag is none of the three. `draggable` is a
  convenience over the same `onMove`, so the two paths cannot disagree.
- **The details are a `<details>` card at the head of the surface**, shut by default, rendered in
  place in the preview — not a page of its own. An officer opening a document is opening it to write.
- **The editing surface is a sheet**: `.draft-editor-page` is 210mm wide with the manual's own one-inch
  margins, so the line an officer writes is the line the document prints. Page breaks already drew a
  rule.
- **The toolbar is four named `role="group"` bands** — Text · Paragraph · Insert · Language — with
  find, undo and redo in none of them, because those are about the editing session rather than the
  document and a fifth caption invented for symmetry is a worse label than none.
- **Its `<h1>` is `sr-only`.** The visible name is the editable title box in the bar; a heading and an
  input saying the same thing twice is what the bar was for. But a screen with no `<h1>` is a screen a
  reader tabbing in cannot place, which is the defect CLAUDE.md records all four exam routes shipping
  with.
- **Keyboard:** Ctrl+S a version, Ctrl+P the PRINT ROUTE (not the preview — `/draft/d/:id/print` is
  where paper, language and the generated `@page` rule are chosen, ADR-042 §5), Ctrl+E export,
  Ctrl+Shift+F find, Ctrl+/ help, Escape out of the text and then out of the screen.

### 5. `AppLink` had no callers, so ADR-046 §5's history branch could not fire

`useBackTo` has two branches and the register → editor journey is the worked example ADR-046 §5 gives
for the first one. Every link into the editor and the reader was a plain `<Link>`, and `AppLink` was
used on the Home page and nowhere else — so the branch this app built for exactly that journey took
the parent path from everywhere. The register's two row controls, the draft list's rows, the work
page's "Start reading" and its search hits, and the table of contents are `AppLink` now.

`AppLinkState` also gained `fromPath`, read **only** to name the control: a chevron that pops back to
the register must not be labelled "Documents". `usesHistory` is still the only condition that selects
the branch and `resolveParent` is still the only source of `to`.

### 6. `useOfficialDoc.discard()`, because deleting a document un-deleted it

The editor flushes its debounced write on unmount. Deleting from the ⋯ menu navigated to the document
list, the page unmounted, the flush landed, and Dexie put the row straight back — a deleted document
that reappears, silently, on the list the officer is now looking at. `discard()` cancels the queued
write and clears `dirty`; `resolveConflict` cancels the same timer for the same reason one line
further on. Found by a test asserting the ROW was gone rather than that the screen had changed.

### 7. What changed beyond layout, and it is three things

1. **"Move to thread"** is new behaviour. `threadId` has been on `OfficialDoc` since Session 29 and
   was written only by `newReply`; nothing let an officer set or clear it. The brief named it, so the
   ⋯ menu offers a select over the threads their own documents are already on. Absence is the key
   being absent, never `''` — a stored empty string would group every threadless document into one
   thread called nothing.
2. **The glossary sheet and the phrase library are reachable again** — `docs/DATA-GAPS.md` #94, two of
   its three. `DocumentEditor` hands its caller an `insert(text)` over the ProseMirror selection, the
   same arrangement as `onJumpReady` and for the same reason: neither sheet may know Tiptap exists.
   Before this the two toolbar buttons opened the Details tab, which is a control doing something
   other than what it says. "Draft with AI" is still orphaned and #94 still records it.
3. **The Status control moved to the bar and its duplicate in `MetaPanel` is deleted.** It is visible
   at every width, and the alternative was keeping a second copy in the details card — which is the
   "a control that duplicates one now in the bar" this session set out to remove.

### 8. What it cost

Three specs needed a shared vocabulary rather than patching (`tests/e2e/editor-helpers.ts`,
`src/test/rail.ts`), and one of those helpers ASSERTS the tab it opened is selected — because the
rail's tab is remembered in IndexedDB, and a test that then checks something is ABSENT would pass
because the panel was off screen rather than because state was reset. Two of the reader's edge tests
exist precisely to catch state carried between units; both would have gone green against the bug they
were written for.

The one self-inflicted trap worth recording: the "Aa" tray's sample line was first set in CCS
(Conduct) Rule 3's own words, which read beautifully and put a hidden, `aria-hidden` copy of "absolute
integrity" on the page — the exact phrase four committed specs use to check that the RULE is on
screen. A sample is about itself now.

### Addendum — the edge-case pass (Session 35)

**Ten defects.** Every regression below was confirmed to FAIL against `a68db9c`
before its fix was written, and two of the confirmations were thrown away and
redone because the first attempt failed for the wrong reason.

The family is one sentence: **an overlay is something the officer is INSIDE, and
this session added five of them without asking what happens at their edges.**

1. **The one a reader reported: the selection toolbar was off the screen.**
   `anchor()` clamped `top` at both ends and never touched `left`, and the row
   is centred on the selection with `translateX(-50%)` — so marking the first
   words of a provision, at the column's left margin, put it at x = -91 with the
   first colour entirely unreachable. Highlighting "did not work" because the
   control could not be pressed. The width is MEASURED (`offsetWidth`, which the
   transform does not affect, so the clamp converges in one pass) rather than
   assumed, because this row is four swatches plus three labelled controls and
   the Hindi strings are longer.

2. **A selection survived a jump to another provision.** The DOM range outlives
   a navigation, because React reuses the paragraph nodes — so after `j` the
   browser still reports a selection, mapped on to whatever words now occupy
   them. Both the floating toolbar and the action row offered to highlight it,
   and what got stored was words the officer never marked, in a provision they
   had just left. `rawSelection` carries its unit and the live one is DERIVED;
   the browser's own selection is cleared when the unit changes, because keying
   the state stops a stale range being used and only clearing the DOM stops it
   being re-read by the next `mouseup`.

3. **`Popover` handled Escape only when the event target was inside it**, so
   with focus anywhere else the press did nothing at all: `FocusLayout` stood
   down because of `data-focus-overlay` and the popover stood down because of
   the target, and the tray was stuck open on a screen that could no longer be
   left. **An overlay that suppresses a global control has to replace it
   unconditionally** — that is the other half of §2 of this ADR, and shipping
   the first half without it made Escape worse than it had been.

4. **The unit switcher never closed on an outside press.** It had Escape and
   nothing else, so the list stayed open over the provision and, being an
   overlay, swallowed the press meant for the text beneath.

5. **Three fixed things were fighting for the phone's bottom edge**, measured on
   a Pixel 7: prev/next at y 728-799, the action row at 786-839 and a floating
   "Understand" button at 779-823, overlapping each other and the "Next" link.
   Two of the three opened the same panel. The floating button is gone — the
   action row's rail control carries the label instead — and prev/next now
   stacks above the action row on `--reader-actions-space`, measured through the
   hook the PWA toast already used. That hook moved to
   `src/app/useReservedSpace.ts` so there is one of it.

   The rail control is **two buttons, one per width**, and that is not the
   duplication this session spent a day removing: below `lg` the panel is a
   sheet and above it a column, they are separately remembered, and a single
   control cannot carry a state that is "hidden" on one and "showing" on the
   other. Only one is ever in the accessibility tree. The first attempt OR-ed
   the two states into one button and its own test caught the incoherence.

6. **Two labels were promises the controls did not keep.** The highlighter's
   accessible name was "Select some words in the provision first, then choose a
   colour" — a description used as a name, which is the mistake CLAUDE.md
   records on three of the numbering fields. And the trainer icon was
   `library.trainer.add`, the same string as the dialog's own Save button: one
   name, two jobs.

7. **"Add to trainer" would have made a card out of nothing.** The dialog builds
   a cloze whose ANSWER is the selected words; offered from the action row with
   no selection it stored one whose answer is the empty string. It is disabled
   with a description now, like the swatches one button to its left.

8. **"Save as my template" opened from the ⋯ menu with an empty Name.** The
   dialog seeds its fields in Radix's `onOpenChange`, which fires when the
   DIALOG asks to change state and never when a controlled `open` is simply
   true. It is mounted only while open now, so a lazy `useState` initialiser is
   the right shape — no effect, nothing to resynchronise. Its `Dialog.Trigger`
   and the `hideTrigger` prop went with it: nothing had used them since the
   action moved into the menu.

9. **"Move to thread" could not fire on a device with no threads.** The select
   was built from the threads the officer's OTHER documents are on, and
   `newReply` is the only thing that has ever set one — so the menu opened a
   card whose single option was the state the document was already in. "Start a
   thread on this document" uses the document's own id, which is what
   `threadIdFor` already does for the first communication on a thread.

10. **The outline accepted any drag.** `onDrop` read `text/plain` as a row
    index, and `text/plain` is what every drag in the world carries — dragging
    the character "1" out of the document, or in from another application,
    silently reordered an officer's paragraphs. The payload is a private MIME
    type now.

**Two confirmations were worthless and were redone.** The jsdom test for #10
failed with `ReferenceError: DataTransfer is not defined` — red against the
defect AND against the fix, which is evidence of neither; the claim moved to a
browser. And the first fix for #2 was a `python` string replacement whose anchor
no longer existed: it printed "ok", changed nothing, and the regression stayed
red until the effect was actually inserted. **A test that fails for a reason
other than the defect is not a confirmation, and an edit that reports success is
not a change.**
