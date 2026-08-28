# `scripts/ingest` — public-source data pipeline

Python, run in CI and on a developer machine. **Never in the browser.** Nothing in
this directory ships to a reader; it produces the JSON under `/data` that does.

Four scripts, and the differences between them are the point:

| Script              | Source                       | Runs                          | Writes                                                |
| ------------------- | ---------------------------- | ----------------------------- | ----------------------------------------------------- |
| `ncrb_sankalan.py`  | NCRB Sankalan portal         | Weekly cron + by hand         | `data/law/{bns,bnss,bsa}.json`, `data/law/index.json` |
| `indiacode_seed.py` | India Code                   | **By hand only, one-off**     | `data/law/overlays/indiacode-seed.json`               |
| `pay_matrix.py`     | Nothing — it reaches no host | By hand; `--check` in CI      | `data/pay/matrix.json`                                |
| `validate_data.py`  | Nothing — reads `/data`      | CI, and before every commit   | Nothing                                               |

`indiacode_seed.py` is not in `.github/workflows/ingest-law.yml` and must not be
added to it. India Code's `robots.txt` restricts crawling and CLAUDE.md says to
fetch it manually, cite it, and never put it on a cron.

`pay_matrix.py` is not on any cron either, and for a different reason: the pay
matrix changes when a Pay Commission is implemented, not when a portal is
re-published. It also fetches nothing — every input it has is in `ANCHORS` at the
top of the file, read off the scanned gazette by eye. See **The pay matrix** below.

The rest of `data/pay` is hand-authored, like `data/law/overlays/`. No script
writes it and no cron can overwrite it; `validate_data.py` is what keeps it
honest.

## Setup

```bash
cd scripts/ingest
python3 -m venv .venv                 # .venv is git-ignored
.venv/bin/pip install -r requirements.txt
```

## Running

```bash
# From the repository root, so the relative paths to /data and /docs resolve.
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py

scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py --no-write   # parse and report only
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py --offline    # reparse raw/, no network
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py --code bns   # one code
scripts/ingest/.venv/bin/python scripts/ingest/ncrb_sankalan.py --force-pdf  # exercise the PDF fallback

scripts/ingest/.venv/bin/python scripts/ingest/indiacode_seed.py --urls scripts/ingest/indiacode_urls.json

scripts/ingest/.venv/bin/python scripts/ingest/pay_matrix.py            # write data/pay/matrix.json
scripts/ingest/.venv/bin/python scripts/ingest/pay_matrix.py --check    # verify only, write nothing

scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py         # every dataset vs its JSON Schema
```

`--offline` is the one to use while changing the parser: it reparses the newest
copy in `raw/` instead of hitting NCRB again, so a parser change costs no
requests and gives byte-identical input every time.

The script prints the files it changed on stdout and its progress on stderr, so
`$(python ncrb_sankalan.py)` is a usable list of changed paths.

## What it produces

```
data/law/bns.json        BNS  ->  IPC     358 sections, keyed by BNS section number
data/law/bnss.json       BNSS ->  CrPC    531 sections
data/law/bsa.json        BSA  ->  IEA     170 sections
data/law/index.json      the reverse: IPC/CrPC/IEA section -> new section(s)
data/_meta/versions.json sha256, row count and fetchedAt per dataset
scripts/ingest/reports/  coverage reports, committed so runs are diffable
docs/DATA-GAPS.md        the generated coverage block, between two markers
```

Each dataset validates against `schemas/law-mapping.schema.json` before it is
written, and again against `src/modules/law/schema.ts` (zod) in `pnpm test`.
Two schemas for one shape is deliberate: a dataset cannot land unless the
producer and the consumer agree on it.

## Tests

```bash
scripts/ingest/.venv/bin/python -m unittest discover -s scripts/ingest -t scripts/ingest -v
```

Stdlib `unittest`, no test dependency, no network — `fetch` runs against a fake
session and a fake clock. Both `.github/workflows/ci.yml` and the refresh
workflow run it, the latter _before_ it is allowed to touch `data/`.

Most of these tests are oddly specific because the source is: a capital letter
starting a heading being read as a section suffix, a sub-clause deletion being
stamped onto its parent section, a date rollover rewriting a dataset. Each was
written against a defect that existed and was verified to fail before the fix.

## Sources, and which one answers what

Everything below is public. Nothing departmental, nothing behind a login.

| Document                             | Gives                                                     |
| ------------------------------------ | --------------------------------------------------------- |
| `SectionTable{BNS,BNSS,BSA}.html`    | the correspondence table, both directions                 |
| `Chapters{BNS,BNSS,BSA}.html`        | every section's heading and full English text             |
| `ScheduleBNSS.html`                  | the BNSS First Schedule — cognizable / bailable / triable |
| `ChaptersBNSS.html` §359             | the two compoundable-offence tables                       |
| `DownloadPDF/{BNS,BNSS,BSA}2023.pdf` | the fallback, if the tables stop being inline HTML        |

### Inline HTML or JS-injected?

The correspondence pages are DataTables-driven. Today the `<tbody>` is rendered
server-side and DataTables only paginates it — but that is an implementation
detail of NCRB's, not a promise. `rows_are_inline()` checks for a populated
`<tbody>` on every run; if it is ever empty the script falls back to
`pdfplumber` over the bare-act PDF on its own, records `parsePath: "pdf"` in
`data/_meta/versions.json`, and the weekly pull request shows the switch. Run
`--force-pdf` to exercise that path deliberately rather than discovering it is
rotten on the day it is needed.

The fallback is measured, not assumed: on the BSA it recovers 178 of the 179
mappings the HTML path finds (99.4%). The one it misses is a multi-paragraph cell
that `pdfplumber` flattens differently. Degraded but usable, which is what a
fallback needs to be.

Both paths and the result of the last run are recorded in `docs/DATA-GAPS.md`.

## Hindi

NCRB publishes all of this in English only, and no official Hindi text of the
three Sanhitas has been located — see `docs/DATA-GAPS.md`. So:

- Scraped headings and section text carry `hi: ""`. The run counts every one of
  them and writes the counts into `docs/DATA-GAPS.md`. **Nothing is machine-
  translated.**
- `data/law/overlays/bns-hindi-curated.json` supplies hand-authored Hindi for the
  sections officers cite most. Every section it touches gets `verify: true` and a
  `provenance` block saying it is a curated translation, not the statutory text,
  so the UI can label it.

## Overlays

`data/law/overlays/*.json` is hand-curated and the cron **never writes there** —
a step in the workflow fails the run if a refresh has modified one. Overlays are
merged last and win on conflict, because a human looked at them and the scraper
did not.

| File                          | Holds                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `traps-and-transitional.json` | number swaps (CrPC 438↔BNSS 482, 482↔528, IPC 420→BNS 318(4), 124A→BNS 152), dropped provisions, and the BNSS §531 transitional rule |
| `bns-hindi-curated.json`      | curated Hindi headings and punishment for the most-cited BNS sections                                                                |
| `indiacode-seed.json`         | authoritative section text seeded by hand from India Code (absent until a seed run succeeds)                                         |

An overlay targets one Act via `act` + `sections`, or several at once via
`actSections` keyed by Act id. It may also patch the reverse index through
`index`, which is how a dropped provision gets its warning.

## The lexicon

`lexicon.json` is a hand-authored bilingual offence and procedure vocabulary:
English, Hindi and Roman transliteration (`murder` / `हत्या` / `hatya`). Each term
lists the lowercase substrings to look for in a section's English heading and the
opening of its text; a hit merges all three languages into that section's
keywords, which is what makes `chori` and `धोखाधड़ी` find the right section.

Only the _opening_ of the section text joins the match window, on purpose:
matching the whole thing turns a long section — BNS 2, "Definitions", or any
section with illustrations — into a magnet for every term in the file, and a
keyword list that matches everything ranks nothing.

## The pay matrix

`pay_matrix.py` generates `data/pay/matrix.json` — 19 levels, 540 cells — rather
than transcribing it, because the only published form of the matrix is a scanned
table in the CCS (Revised Pay) Rules, 2016 gazette. The Department of Expenditure
hosts no text-layer copy and no mirror found has one. OCR of a 19-column numeric
table is precisely the kind of transcription that gets one digit wrong in one cell
and is never noticed.

The Commission's own construction rule removes the need to transcribe. The first
cell of a level is the pre-revised entry pay multiplied by that level's index of
rationalisation (7th CPC report, Table 4, para 5.1.19); every later cell is the
previous one raised by 3 per cent and rounded to the nearest hundred. Only 19
entry pays and 19 cell counts have to be right, and all 38 are in `ANCHORS`,
where a reviewer can see them all at once.

`verify_against_gazette()` is the check that makes that safe. It asserts the last
cell of every level against the figure printed in the Schedule, spot-checks
interior cells spread across the width of the table, and re-derives every entry
pay from its pre-revised pay and index. `--check` runs all of it and writes
nothing; CI runs `--check` on every push. If the 3-per-cent rule ever failed to
reproduce the notified table, this is where it would show.

One substitution is deliberate. The 2016 gazette runs Level 13 from ₹1,18,500 to
₹2,14,100 over 21 cells at an index of 2.57. The CCS (Revised Pay) (Amendment)
Rules, 2017 replaced it, with effect from 01.01.2016, by a 20-cell level from
₹1,23,100 to ₹2,15,900 at an index of 2.67, and DoE O.M. 4-6/2017-IC/E-III(A) of
28.09.2017 records the earlier level as "non-existent ab-initio". The amended
level is what ships; shipping the 2016 one would be shipping a level that legally
never existed. Pay is still fixed with the fitment factor of 2.57, not 2.67, and
the same OM says so in terms.

## Validating the datasets

`validate_data.py` walks a manifest of every file under `/data` and validates it
against the schema named beside it. It fetches nothing, writes nothing, and
treats a missing file as a failure rather than a skip — a dataset that silently
stops being validated is worse than one that was never validated.

It exists because the generated datasets validate themselves as they are written
(`ingest_common.validate` is called before anything touches disk) and the
hand-authored ones have no writer to do it for them. `data/pay` is hand-authored
apart from the matrix, so this is where it gets the same treatment. The zod half
of the same contract is `src/modules/pay/schema.ts`, run by `pnpm test`; both
must pass for a dataset to ship (ADR-016).

## `raw/`

Every fetched document is archived to `raw/<timestamp>__<name>` with a
`.meta.json` beside it recording the URL, the byte count and the sha256. It is
git-ignored apart from `.gitkeep`: a local forensic trail so a disagreement about
what a source said on a given day is settleable, not repository content.

## Adding a source

1. Fetch through `ingest_common.fetch()`, with mirrors as a list. It names the
   project in the User-Agent and stops dead on a 403 rather than trying a mirror.
2. Archive with `archive_raw()` before parsing anything.
3. Give every record `{ source: { name, url }, fetchedAt }`, and both `en` and
   `hi` keys even where `hi` is empty.
4. Write a JSON Schema under `schemas/`, validate before writing, and add the zod
   mirror on the consumer side.
5. If a number might not be official, keep it and set `verify: true`.
