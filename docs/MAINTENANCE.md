# Maintenance

How Sahayak's data stays current with no session sitting down to refresh it by hand — what runs on
its own, what it produces, and the one thing a maintainer still has to do: **read a pull request
before merging it.** Nothing in this repository auto-merges anything (ADR-034 and every ingest
workflow's own docstring say so in terms). This file is the runbook for the human side of that.

---

## The 10-minute monthly routine

Once a month (more often costs nothing — every workflow below is a no-op when nothing changed):

1. **Open the repository's Pull requests tab, filtered to the `automated` label.** Each one names
   what changed and what to look at first — read that before the diff, not instead of it. A pull
   request that says "No section-level changes" or "no data changed" in its own body is bookkeeping
   only (`data/_meta/seen-orders.json`, mainly) and is safe to merge on sight; anything naming a rate,
   a date or a section number is not.
2. **Open the Issues tab, filtered to the `automated` label.** These are the things the automation
   could not resolve on its own — a scanned Dearness Allowance order with no usable text layer, a new
   HRA/Transport/Children Education Allowance order, a year with no holiday calendar yet. Each names
   what to do; most end in "read the order and update the file by hand", which is real work, not a
   rubber stamp.
3. **Merge what you've read.** `pnpm check` has already run in CI on every one of these pull requests
   (each ingest workflow runs it before opening one) — a red check means don't merge regardless of how
   small the diff looks.
4. **Verify the deploy.** `.github/workflows/deploy.yml` triggers on any successful CI run on `main`,
   so merging is what ships it. Give the Cloudflare Pages deployment a minute, then spot-check the
   route the change touched (`/pay` for a Dearness Allowance merge, `/utils/holidays` for a calendar
   one) on the live site. `docs/lighthouse/README.md` has the performance-measurement routine if a
   change is large enough to warrant re-measuring; it is not part of this monthly pass.

That's the whole routine. Nothing here needs a local checkout — every step is doable from GitHub's
web UI on a phone, which is deliberate: the automation's whole point is that refreshing this app's
data must not require a development session.

---

## What each cron does

| Workflow | Runs | Reads | Produces |
| --- | --- | --- | --- |
| `ingest-law.yml` | Weekly (Mon 03:00 IST) + dispatch | NCRB Sankalan | A pull request naming, per code (BNS/BNSS/BSA), how many sections were added, changed or deleted — never just a byte count |
| `ingest-pay.yml` | Monthly (1st, 08:30 IST) + dispatch | Department of Expenditure | Either a pull request proposing a new Dearness Allowance rate (only when an order both changed AND parsed), or an issue per order it could not resolve — see below |
| `ingest-holidays.yml` | Yearly (1 Nov, 08:30 IST) + dispatch | Nothing — `holidays.py` reaches no host | An issue asking a human to add next year's calendar by hand (the common case, since DoPT's circular is read and typed in, not fetched), or a pull request if a hand-edit to the script was made but never run locally |
| `ingest-glossary.yml` | Dispatch only | Nothing — `glossary_seed.py` reaches no host | A pull request rebuilding `data/glossary.json` from the committed source files, for a reviewer who edited them and would rather not run the script locally |
| `lint-workflows.yml` | Any change under `.github/workflows/**` | Nothing | A failed check if a workflow file is not `actionlint`-clean |

None of the four data workflows commits directly to `main`. That is deliberate and costs something on
purpose: a direct push would trigger CI, and a successful CI run on `main` triggers a production
deploy (`deploy.yml`), so every one of these — even a change as small as
`data/_meta/seen-orders.json`'s own bookkeeping — goes through a pull request instead, the same
pattern `ingest-law.yml` already used before this session.

### The Dearness Allowance watch, in one paragraph

`ingest-pay.yml` runs `scripts/ingest/pay_orders.py`, which polls the ONE fixed path DoE serves its
current Dearness Allowance order at (there is no archive to list), and separately watches one DoE page
for new HRA/Transport/Children Education Allowance orders by keyword. Most of what DoE actually serves
is a scanned image with **no usable text layer** — two real orders fetched while building this
pipeline's test fixtures extract to zero characters through `pdfplumber`. That is the ordinary case,
not a bug: when the script cannot parse a rate and a date out of a changed order, it opens a
**"Manual review: `<order>`"** issue instead of guessing, naming the order and why. Only when an order
DOES parse — matching the one sentence shape every notified order this dataset cites uses — does it
write the proposed rate into `data/pay/da-history.json` itself for the pull request to carry. Full
detail: `scripts/ingest/README.md`'s "The Dearness Allowance watch".

### The holiday calendar has no fetch at all

`holidays.py` reaches no host (`dopt.gov.in` refused every attempt a past session made —
`docs/DATA-GAPS.md`). A year's list is hand-typed into the script's `YEARS` dict off DoPT's own Office
Memorandum, the same way `pay_matrix.py`'s `ANCHORS` or `indiacode_seed.py`'s overlay are. So
`ingest-holidays.yml` cannot itself produce a new year — what it does is notice, once a year, that next
year has no entry yet and file an issue asking for one, with the exact command to run once it's added.
If the OM for next year has already been read and typed in ahead of schedule, the workflow finds
nothing to ask for and opens a pull request instead, the ordinary "did a hand-edit forget to
regenerate the file" case every other `--check`-style script here handles the same way.

---

## Adding a new dataset

1. Write the JSON Schema under `schemas/`, and the zod mirror in the matching `src/modules/*/schema.ts`
   — the point of having both is that the producer (Python) and the consumer (TypeScript) cannot drift
   apart from each other. `strictObject` on the zod side, not `z.object`: a plain object silently
   strips a key a schema would have rejected.
2. Add the file to `scripts/ingest/validate_data.py`'s `MANIFEST` (schema-validated) or `NO_SCHEMA`
   (with a reason — metadata like `data/_meta/versions.json` or `data/_meta/seen-orders.json`, never a
   dataset a reader's app code reads). A file under `data/` in neither list fails `validate_data.py`,
   on purpose: a dataset nothing validates is worse than one that fails loudly.
3. Every record needs `{ source: { name, url }, fetchedAt }` and both `en`/`hi` — a missing Hindi
   string is a CI failure, not a fallback (master context, `CLAUDE.md`).
4. If a script fetches anything, use `ingest_common.fetch()` (named User-Agent, retry-with-backoff,
   403-stops-everything) and `archive_raw()` before parsing. If a number might not be official, ship it
   anyway with `verify: true` rather than leaving a gap.
5. Decide whether it belongs on a cron at all. `indiacode_seed.py` and `pay_matrix.py` are deliberately
   on none — see `scripts/ingest/README.md` for why each one earned that. A dataset that changes when a
   human reads a new circular, not when a website re-publishes, is a candidate for the
   "watch-and-file-an-issue" shape `ingest-pay.yml`/`ingest-holidays.yml` use rather than a
   fetch-and-diff one.
6. If it needs its own workflow, copy the shape of the closest existing one rather than inventing a
   new one, and run `actionlint .github/workflows/*.yml` locally before pushing —
   `lint-workflows.yml` will catch it in CI either way, but a red check on a first push is a worse
   first impression than a five-second local check.

---

## Hotfixing a wrong number

The automation is not the only way a figure gets fixed, and it should not be — a reader who spots a
stale DA rate or a wrong allowance figure should not have to wait for a monthly cron.

1. Edit the JSON directly. Every dataset under `data/` is either generated (in which case fix the
   generator, not the file — `pay_matrix.py`, `ncrb_sankalan.py` — or the next run overwrites your fix)
   or hand-authored (fix it in place: `data/pay/allowances.json`, `data/pension/pension-facts.json`,
   `data/portals.json`, and the two `data/pay/da-history.json` rates any human, not a script, actually
   typed in).
2. Bump the touched dataset's `version` field (semver — a corrected number is at least a patch bump)
   and its `updated`/`generatedAt` date. `data/_meta/versions.json` is what the in-app update check
   (`useAutoDataUpdateCheck`, ADR-034, and the "Check for data updates" button in Settings) compares
   against — a hotfix that skips this step is invisible to every installed device until they happen to
   reload past the service worker's cache.
3. Run `scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py` and `pnpm check` before
   opening the pull request yourself. Neither ingest workflow runs for a hand-edit — there is no
   "propose a hotfix" automation, on purpose: a human who already knows the correct number does not
   need a script to fetch it again.
4. Open the pull request the same way the automation's own would read: state the source for the
   correction (an order, a gazette, a DDO) in the body. `verify: true` stays on the record unless the
   correction itself came from reading the primary order — a corrected guess is still a guess.

---

## In-app: the automatic "check for data updates"

`useAutoDataUpdateCheck` (`src/app/`) runs the same comparison the "Check for data updates" button in
Settings does — is a newer `data/_meta/versions.json` on the origin than the one this build shipped
with — automatically, at most once a UTC calendar day, only while online, and only while the reader
has not turned it off (Settings, next to the manual button; on by default). See **ADR-034** for why
this is on by default despite the master context's "no analytics, by default and always" line, and for
the exact wording change that promise needed as a result. This has nothing to do with the ingest
workflows above beyond sharing `data/_meta/versions.json` as the one file both sides read — it does
not fetch a dataset, only the version manifest, and it never writes anything back to the origin.

---

## Related references

- **`scripts/ingest/README.md`** — every ingest script, what it fetches (or deliberately does not),
  and why each one is or is not on a cron.
- **`docs/AUTHORING.md`** — the separate Rules Trainer content pipeline (`scripts/authoring/`), which
  this file does not cover: rule books change when a Ministry amends them, not on any clock.
- **`docs/DATA-GAPS.md`** — every unresolved or unreachable source, what was tried, and the next step.
  An ingest workflow that opens a "Manual review" issue is this file's live counterpart for one order;
  a gap that turns out to be permanent (a source that will never have a text layer) belongs here too.
- **`docs/DECISIONS.md`** — ADR-034 for the automatic update-check's privacy tradeoff; ADR-025/026/027
  for why several datasets here (Trainer, Utilities) are deliberately NOT on any cron.
- **`docs/TESTING.md`** — how `pnpm check` and the Python `unittest` suites this file's routine relies
  on are actually run and what each one guarantees.
- **`docs/lighthouse/README.md`** — how to re-measure performance after a change large enough to
  warrant it; not part of the monthly routine above.
