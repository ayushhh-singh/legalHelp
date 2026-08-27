# End-to-end tests (Playwright)

Installed. Both tests build and serve `dist/` (`playwright.config.ts` `webServer`, since the service worker
only exists in a production build):

- `offline.spec.ts` checks that the offline chip appears when the network drops and that the shell still
  renders after a hard reload with no network — the actual proof that `vite-plugin-pwa` + the precached
  shell (`vite.config.ts`, `src/app/pwa.tsx`) work.
- `zero-third-party-requests.spec.ts` watches real `page.on('request')` traffic across every route plus a
  language toggle and fails on any cross-origin request — the runtime half of the master context's named
  enforcement mechanism. It does not yet assert that no *user-entered* value leaves the page: no form
  captures one yet (`docs/DATA-GAPS.md` #4).

The suite still owes these checks, each currently recorded in `docs/DATA-GAPS.md` because jsdom cannot
perform them:

1. **Colour contrast** — axe with `color-contrast` enabled, in both themes and both languages.
   jsdom has no layout, so the rule cannot run there.
2. **Devanagari rendering** — `document.fonts.check()` for Tiro Devanagari Hindi, plus a screenshot of a
   Hindi heading.
3. **Theme and language persistence across a real page reload**, not just a fresh Dexie connection.
4. **Responsive navigation** — bottom tabs below 1024px, sidebar at or above it.
