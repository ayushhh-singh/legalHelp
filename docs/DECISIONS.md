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

## TODO — rename before launch (Session 18)

The human did not supply an app name, so **"Sahayak"** is a working title, used in `package.json`
(`name: sahayak`), the Dexie database name (`sahayak`), `index.html`, and the `app.name` translation key.

Renaming touches: `package.json`, `index.html` `<title>`, `src/i18n/{en,hi}.json` → `app.name`,
`src/db/index.ts` (the Dexie database name — **needs a migration or the user's data is orphaned**),
`README.md`, `CLAUDE.md`. The database name is the one that is not cosmetic.
