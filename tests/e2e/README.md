# End-to-end tests (Playwright)

Not yet installed — Session 1 shipped the shell with Vitest and jsdom only.

The suite owes these checks, each currently recorded in `docs/DATA-GAPS.md` because jsdom cannot perform
them:

1. **Zero third-party requests** — fail the run on any cross-origin request, and assert no user-entered
   value ever leaves the page. This is the master context's named enforcement mechanism.
2. **Colour contrast** — axe with `color-contrast` enabled, in both themes and both languages.
   jsdom has no layout, so the rule cannot run there.
3. **Devanagari rendering** — `document.fonts.check()` for Tiro Devanagari Hindi, plus a screenshot of a
   Hindi heading.
4. **Theme and language persistence across a real page reload**, not just a fresh Dexie connection.
5. **Responsive navigation** — bottom tabs below 1024px, sidebar at or above it.
