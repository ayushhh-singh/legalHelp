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
4. Icon set: `src/assets/pwa-icon.svg` → `scripts/generate-icons.mjs` (`sharp`) → `public/icons/{pwa,
   maskable-icon}-{192x192,512x512}.png` + `apple-touch-icon.png` (180×180). The "any" and maskable PNGs are
   pixel-identical renders of the same safe-zone-padded source; nothing in the artwork actually differs
   between the two manifest purposes.
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

---

## TODO — rename before launch (Session 18)

The human did not supply an app name, so **"Sahayak"** is a working title, used in `package.json`
(`name: sahayak`), the Dexie database name (`sahayak`), `index.html`, and the `app.name` translation key.

Renaming touches: `package.json`, `index.html` `<title>`, `src/i18n/{en,hi}.json` → `app.name`,
`src/db/index.ts` (the Dexie database name — **needs a migration or the user's data is orphaned**),
`README.md`, `CLAUDE.md`. The database name is the one that is not cosmetic.
