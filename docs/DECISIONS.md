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
