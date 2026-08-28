---
name: frontend-design
description: The Sahayak design system — palette, the -foreground pairing rule, fonts, the file-tab signature, the nav rule, spacing and the quality floor. Read this before writing or restyling any component, before adding a colour, and before touching src/styles/tokens.css.
---

# Sahayak — frontend design

> Canonical values live in `src/styles/tokens.css`. This file explains them.
> `src/styles/tokens.test.ts` enforces them. If the two disagree, the test wins.

## Brief

Sahayak is a bilingual (Hindi ⇄ English, equal footing), offline-first PWA for Indian central
government officers. It is used at a desk, often on a poor connection, to check a figure or a
section number that someone will then act on. So it must read as **accurate, unhurried and
institutional** — never as a consumer app that gamifies a task.

Two consequences that drive everything below:

- **Hindi is not a translation layer.** Every screen must look composed, not stretched, in
  Devanagari. Line height, not font size, is what makes that work.
- **A wrong number is worse than a slow one.** Figures get tabular numerals and a source. Nothing
  is styled to look more certain than it is.

## The signature: the file tab

A **3px `--marigold` index tab**, the mark on the edge of a paper file.

It appears in exactly three places, and always means the same thing — _this is the one you are in_:

| Where               | Form                                              |
| ------------------- | ------------------------------------------------- |
| Active module card  | tab on the card's top edge (`SectionCard active`) |
| Active sidebar item | rule on the sidebar's left edge                   |
| Active bottom tab   | rule on the tab bar's top edge                    |

Plus the masthead mark beside the wordmark, which is the same gesture standing still.

Its partner is the **`SectionNumber` chip** — a law section or a pay level, set in the body face
with `tabular-nums` so a column of citations aligns.

Use it sparingly. **One tab per screen.** A page of tabbed cards is a page with no emphasis.

There is **no gauge or dial**. That is Neev's signature, not ours.

## Colour

Light is `:root`. Dark is `.dark`, applied **only** from the in-app toggle and never from
`prefers-color-scheme` — see ADR-010. Do not add a media query for it.

### The tokens

| Token                              | Light                 | Dark                  | Job                                                             |
| ---------------------------------- | --------------------- | --------------------- | --------------------------------------------------------------- |
| `--background` / `--foreground`    | `#F7F9FC` / `#0B1D3B` | `#061225` / `#E8EDF5` | the page                                                        |
| `--card` / `--card-foreground`     | `#FFFFFF` / `#0B1D3B` | `#102542` / `#E8EDF5` | anything raised off the page                                    |
| `--primary`                        | `#1E4FD9`             | `#6E9BFF`             | links, active states, tints, focus ring — **not** a button fill |
| `--action` / `--action-foreground` | `#0B1D3B` / `#FFFFFF` | `#F7C873` / `#0B1D3B` | primary buttons, active chips, progress fill                    |
| `--secondary` / `-foreground`      | `#E4EAF4` / `#0B1D3B` | `#17304F` / `#E8EDF5` | quiet surfaces                                                  |
| `--muted` / `--muted-foreground`   | `#F2F5FA` / `#667085` | `#17304F` / `#A9B7CC` | supporting text and its surface                                 |
| `--accent` / `--accent-foreground` | `#DBE4F8` / `#123086` | `#1D3A63` / `#C7DAFF` | hover and selected chrome                                       |
| `--destructive` / `-foreground`    | `#C92A1E` / `#FFFFFF` | `#FB8378` / `#0B1D3B` | irreversible actions, failures                                  |
| `--marigold` / `-foreground`       | `#F7C873` / `#6B4A05` | `#F7C873` / `#FBE0AE` | **the** accent — one gold, both themes                          |
| `--tulsi` / `-foreground`          | `#10B981` / `#06603F` | `#34D399` / `#A7F3D0` | success                                                         |
| `--coral` / `-foreground`          | `#F43F5E` / `#9F1239` | `#FB7185` / `#FECDD3` | the low band, offline, errors                                   |
| `--violet` / `-foreground`         | `#7C3AED` / `#4C1D95` | `#A78BFA` / `#DDD6FE` | a fifth chart series                                            |
| `--border`                         | `#DFE5EF`             | `#22344F`             | dividers and card edges — decorative                            |
| `--input`                          | `#7B8BA8`             | `#6B80A4`             | **control** boundaries — must clear 3:1                         |
| `--brand-navy` / `-blue` / `-gold` | same in both themes   | same in both themes   | the logo, and text on solid gold                                |

`--action` is the **only** theme-inverting token. Navy on a navy page would be invisible, so in dark
it becomes gold. Everything else keeps its slot meaning across themes.

`--border` and `--input` are deliberately different values (ADR-007). WCAG 1.4.11 covers the visual
boundary of a _control_, not a divider — so `--input` must clear 3:1 and `--border` need not.

### THE PAIRING RULE

> **`--marigold`, `--tulsi`, `--coral` and `--violet` are never a raw text or icon colour.**
> Text is always the paired `-foreground` token, sitting on that colour's `/15` tint.

```tsx
<span className="bg-marigold/15 text-marigold-foreground">…</span>   // yes
<span className="text-marigold">…</span>                             // no — 1.6:1
```

The one exception: **text on solid gold is always `--brand-navy`** (10.7:1). White on gold measures
1.6:1 and is forbidden — `tokens.test.ts` asserts both halves of that.

A bare `bg-marigold` _is_ allowed for the 3px file-tab and nav rules. Nothing has to be legible on a
3px line; its job is done by position.

### Adding or changing a colour

`src/styles/tokens.test.ts` parses `tokens.css`, resolves every value numerically — following
`var()` chains and compositing `/15` tints over their surface — and asserts, **in both themes**:

- every declared surface / `-foreground` pair ≥ 4.5:1
- `--foreground`, `--muted-foreground`, `--primary` and `--destructive` ≥ 4.5:1 as text on
  `--background`, `--card` and `--muted`
- every accent's `-foreground` on that accent's `/15` tint over the same three surfaces ≥ 4.5:1
- `--input` and `--ring` ≥ 3:1 on the same three surfaces
- every token declared in one theme is declared in the other

Contrast is computed from the token **values**, never from a computed CSS string: jsdom resolves
neither `var()` nor Tailwind's generated utilities, so a string-parsing check would assert against
something the browser never paints. The in-browser confirmation is `tests/e2e/a11y.spec.ts`, which
runs axe over every route × both languages × both themes.

## Type

Self-hosted from `@fontsource` (`src/styles/fonts.css`, imported by `main.tsx`). No third-party font
request is ever made — `tests/no-external-urls.test.ts` and two Playwright specs enforce it.

| Role                | Stack                                                          |
| ------------------- | -------------------------------------------------------------- |
| `--font-sans`, body | `Inter Variable`, `Inter`, `Noto Sans Devanagari`, `system-ui` |
| `--font-heading`    | `Poppins`, `Noto Sans Devanagari`, `system-ui`                 |
| `.font-display`     | the body face at weight 800, `tabular-nums`, `-0.02em`         |

- **Poppins is Latin only, deliberately.** It carries no Devanagari, so a Hindi heading falls through
  to Noto Sans Devanagari glyph-by-glyph rather than to a platform face. Do not add the Devanagari
  subset — that is what makes Hindi headings predictable.
- **`.font-display` is unlayered**, so it beats the `h1-h6` rule in `@layer base`. Scoreboard
  numerals stay on Inter because Poppins has no tabular figures and counting digits would jitter.
- **Devanagari line height is ≥ 1.75, always** — headings included. Every Tailwind text-size utility
  ships its own line-height and would otherwise win; `index.css` carries a `:lang(hi)` rule at
  specificity (0,2,0) that reclaims it for `text-xs` … `text-xl`. Matras sit above _and_ below the
  baseline; a Latin-calibrated leading collides them.

`tests/e2e/typography.spec.ts` reads Chromium's _used_ fonts through
`CSS.getPlatformFontsForNode` — the only way to prove which face actually rendered.

## Shape and space

- **Strict 4px grid.** Every gap, pad and size is a multiple of 4.
- **Radii:** 12px cards and inputs (`rounded-lg`), 10px buttons (`rounded-md`), 8px small chrome
  (`rounded-sm`), pill chips (`rounded-full`).
- **Tap targets ≥ 44px** (WCAG 2.5.8). Buttons default to `h-11`; nav targets are `min-h-11` /
  `min-h-14`. The single documented exception is the **36px header icon buttons**, which sit in a
  56px bar with generous surrounding space.
- **No decorative animation.** `transition-colors` on interactive chrome and `animate-pulse` on
  `Skeleton` are the whole budget, and `prefers-reduced-motion` stops both.

## Navigation

**One config array — `src/lib/nav.ts` — drives the sidebar, the bottom bar and the router.** A
destination can never appear in one and not another. Labels live there as `{ en, hi }` objects, so a
missing Hindi label is a compile error.

| Viewport     | Chrome                                            |
| ------------ | ------------------------------------------------- |
| ≥ 1024px     | left sidebar, every destination                   |
| 768 – 1023px | bottom bar, every destination inline              |
| < 768px      | bottom bar: 4 flagship modules + a **More** sheet |

Both bottom-bar states are pure CSS. Do not keep the breakpoint in React state — it would disagree
with the rendered layout for a frame after every resize.

> **Active state is never colour alone.** It is the gold rule on the chrome's own edge **plus** a
> `font-semibold` label. Never gold _text_.

## The quality floor

Before a component is done:

- [ ] Reads correctly in **light and dark**, and in **English and Hindi**.
- [ ] Every colour comes from a token. No hex, no `slate-500`, in a component.
- [ ] Accent colours follow the pairing rule.
- [ ] Interactive targets ≥ 44px; focus is visible (`focus-visible:ring-2 ring-ring`).
- [ ] State is conveyed by more than colour.
- [ ] Devanagari has room to breathe — check the longest Hindi string, not the shortest.
- [ ] Numbers are `tabular-nums`; data carries a source and a dataset version.
- [ ] `pnpm check` passes, and `pnpm test:e2e` if the change touches chrome or type.

## NEVER

- **Cream paper + serif + terracotta.** That was this project's own previous direction (the
  "government file" palette, ADR-003/006). It is superseded — do not reintroduce it piecemeal.
- **Near-black + acid green.** Reads as a terminal, not an office.
- **Newspaper hairlines.** Dividers are `--border`, not 0.5px rules.
- **Stock shadcn grays.** `slate`, `zinc`, `neutral` and friends are not in this palette; every
  neutral here is blue-tinted on purpose.
- **A gauge or dial.** Neev's signature, not ours.
- **`prefers-color-scheme` anywhere in CSS.** Dark is an explicit choice (ADR-010).
- **Raw `--marigold` / `--tulsi` / `--coral` / `--violet` as text.**
