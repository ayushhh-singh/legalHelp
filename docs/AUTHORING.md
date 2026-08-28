# Authoring the Rules Trainer content

How `data/rules` is made: where the rule books come from, how they are split into
rules, how cards are generated from them, and how the questions are written and
checked. Read this before adding an act, adding a card kind, or touching anything
under `scripts/authoring/`.

Three rules govern everything here, and each is enforced by a test rather than by
this document:

1. **Nothing calls a model.** The questions were written in session by Claude
   Code and committed as data. `scripts/authoring/test_authoring.py` asserts that
   no module in this directory so much as names an inference endpoint.
2. **Nothing is on a cron.** A rule book changes when a Ministry amends it, and
   an amendment is a reading job — the same reason `pay_matrix.py` and
   `drafting_seed.py` are hand-run (ADR-016, ADR-020).
3. **Hindi is authored, never extracted or machine-translated.** No Ministry
   publishes a Hindi issue of these twelve rule books with a usable text layer.
   A card whose Hindi has not been written is in the file and is **not served**.

---

## The pipeline

```
scripts/authoring/
  authoring_common.py    the act registry, the CA bundle, PDF/HTML reading
  fetch_sources.py       →  sources/ (git-ignored) + SOURCES.md (committed)
  extract_rules.py       →  data/rules/text/<act>.json
  make_cards.py          →  data/rules/cards/<act>.json + data/rules/index.json
  qa_pipeline.py         stages C and D, and the acceptance report
  terms/<act>.json       defined terms, authored — what a cloze may blank
  hindi/<act>.json       rule number → Hindi heading, authored
  authored/<act>.json    stage A: the questions
  review/                stages B, C, D, and the cloze review
  test_authoring.py      43 unittest tests
```

Run it end to end:

```bash
cd scripts/ingest && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ../..

scripts/ingest/.venv/bin/python scripts/authoring/fetch_sources.py
scripts/ingest/.venv/bin/python scripts/authoring/extract_rules.py
scripts/ingest/.venv/bin/python scripts/authoring/qa_pipeline.py dedup
scripts/ingest/.venv/bin/python scripts/authoring/make_cards.py
scripts/ingest/.venv/bin/python scripts/authoring/qa_pipeline.py report --date $(date +%F)
scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py
scripts/ingest/.venv/bin/python -m unittest discover -s scripts/authoring -t scripts/authoring
pnpm test rules-data
```

`--check` on `extract_rules.py` and `make_cards.py` re-derives everything and
writes nothing, which is what CI runs.

---

## Adding an act

1. **Add an entry to `ACTS` in `authoring_common.py`.** One `Act`, with a
   `Document` per published file. `unit_en` / `unit_hi` is what one record is
   called in that book — Rule, Section or Paragraph — and `max_rule` is an upper
   bound the sequence walk uses to reject a stray year.

2. **Fetch it.** `fetch_sources.py --act <id>`. This rewrites `SOURCES.md`,
   which is the committed citation: URL, size and SHA-256 for every file. The
   files themselves are git-ignored — they are large published documents anyone
   can download from the Ministry that issued them, and committing 90 MB of them
   would put a copy of the rule book in the repository instead of a citation to
   it.

3. **Add a `ParseConfig` to `PARSERS` in `extract_rules.py`.** Start with
   `DOTTED` and run `extract_rules.py --act <id> --show`. Read the output: the
   numbers should be the book's numbers and the headings should be its headings.
   The knobs, in the order they are usually needed:

   | Knob                      | Use it when                                               |
   | ------------------------- | --------------------------------------------------------- |
   | `body_from`               | The rules start after a contents page or a foreword       |
   | `body_to`                 | A schedule, appendix or form follows the last rule        |
   | `drop_lines`              | A running head survives the automatic furniture detection |
   | `has_headings=False`      | The book runs straight from the number into the text      |
   | `major_jump`              | A contents block inside the body forms its own sequence   |
   | `number_format`           | The book prints two rule sets and both restart at 1       |
   | `max_rule` (on the `Act`) | A stray four-digit number ends the walk                   |

4. **Write `terms/<id>.json`** — the terms that act defines or uses as terms of
   art. This is what a cloze card is allowed to blank. Blanking an ordinary noun
   makes a card about English; blanking a defined term makes a card about the
   rule.

5. **Write `hindi/<id>.json`** — rule number to Hindi heading. Until this exists,
   every rule card for the act is emitted with `reviewState: "needs-hindi"` and
   is not served. Terminology follows the Department of Official Language's
   प्रशासनिक शब्दावली and, where the rule book has its own Hindi usage, that
   usage: the CCA rules say **शास्ति** for penalty and the Leave rules say
   **छुट्टी**, not अवकाश.

6. **Generate, review, regenerate.** `make_cards.py --act <id> --show`, then work
   through the cloze cards and write `review/cloze-<id>.json`.

   Two things about the keys. A cloze card's id is
   `<act>-cloze-<rule>-<span kind>` — keyed on the kind, never on a position,
   because every review entry is keyed on the id and a positional id renames
   half the corpus the first time a span is filtered out. And a key in
   `hindi/<id>.json` or `review/cloze-<id>.json` that matches nothing **fails
   the run**: a typo there would otherwise leave the card unserved and report
   success.

7. **Add the files to three places**, or they are validated by nothing:
   `MANIFEST` in `scripts/ingest/validate_data.py`, `schemas/rules-*.schema.json`
   (already generic), and nothing else — `tests/rules-data.test.ts` discovers
   acts by reading the directory.

---

## The authoring checklist

Before a card is served:

- [ ] **Grounded.** `ruleRef.textId` resolves into `data/rules/text/<act>.json`,
      and an authored question's `groundingRuleIds` all resolve too.
- [ ] **Bilingual.** Every string a reader sees — front, back, cloze stem, cloze
      answer, every option, the explanation — has non-empty Hindi, in Devanagari.
- [ ] **Answerable from the card alone.** No self-reference ("the second proviso
      to sub-rule (3) of ____"), no blank whose answer the same sentence repeats,
      no heading that identifies two rules of the same act.
- [ ] **Not apparatus.** The stem is the rule, not a footnote, not an amendment
      note, not a schedule's column layout, not a DoPT notification number.
- [ ] **Current.** No card states a position a later amendment replaced. Two live
      examples: the RTI Commissioners' term of office (the 2019 amendment made it
      "such term as may be prescribed", so no card says five years) and maternity
      leave (180 days since 2017; the 135 days in the PDF is an amendment note).
- [ ] **Not a duplicate.** rapidfuzz `token_set_ratio` below 92 against every
      other served card, which `tests/rules-data.test.ts` checks independently of
      the Python pipeline.
- [ ] **Not positionally gameable.** `make_cards.py` rotates a question's options
      by a hash of its id; a test asserts no answer position holds more than half.
- [ ] **The stem does not contain the answer.** A cloze that blanks "three
      months" and then says "within a period of three months from the date of the
      last incident" asks nothing. `leaks_answer` is the gate and it runs on the
      final stem, after any `edit`.
- [ ] **Its citation reads as the book prints it.** "F.R. 17", not
      "Rule F.R. 17" — a number that opens with a letter carries its own unit.

---

## The four-stage question pipeline

The brief's Neev pipeline, run as **four separate files** rather than four fields
of one — so an audit can see that the critic did not have the generation notes in
front of it and the blind verify did not have the key.

| Stage                | Artefact                   | What it does                                                                                                                                      |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Generate**     | `authored/<act>.json`      | 25–35 bilingual questions per act, each naming the rule it is grounded in and the angle it tests                                                  |
| **B · Critic**       | `review/critic-<act>.json` | A separate pass: one correct answer? distractors plausible? in scope of the public rule text? factual red flag? tone right for a serving officer? |
| **C · Blind verify** | `review/blind-<act>.json`  | Answer each MCQ and true/false from the worksheet `qa_pipeline.py blind` prints, which hides the key. A mismatch auto-rejects                     |
| **D · Dedup**        | `review/dedup-<act>.json`  | `qa_pipeline.py dedup` — rapidfuzz `token_set_ratio` ≥ 90 against every other card in the act                                                     |

`make_cards.py` merges the four into each card's `generationMeta` and serves a
question only if it survives all of them. A rejected question **stays in the card
file** with `reviewState: "rejected"` and the reason — that is the audit trail —
and is never shown to a reader.

**What the blind pass does and does not guarantee.** It is a real re-derivation:
the worksheet shows the question, the options and the rule text, and hides the
stored key. It reliably catches a key that points at the wrong option and a stem
whose options are indistinguishable. It cannot be blind in the way a second
person would be, because the same session wrote the questions. Two things
compensate, and both are mechanical: the critic pass is what catches a question
that is wrong rather than merely mis-keyed, and `tests/rules-data.test.ts`
re-derives the duplicate check without reading the Python pipeline's output at
all. Session 20 should run stage C from a fresh session, which is the version of
this that is genuinely blind.

The blind pass earned its place on its first run: it surfaced that stage A had
put the correct answer at index 0 in **91%** of its questions. That is not a
wrong key — every key was right — but it is a card set that teaches position
instead of law, and it is invisible to any per-question check.

---

## The datasets

| File                          | What it is                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/rules/text/<act>.json`  | One record per rule: number, heading, text, sub-rules. Also what the Law Converter and the Drafting Studio link to when they cite a service rule             |
| `data/rules/cards/<act>.json` | Every card, served or not. `reviewState` decides; only `approved` is served                                                                                  |
| `data/rules/index.json`       | Acts, bilingual names, counts by kind, paths. Small enough that the picker downloads nothing else — the arrangement `data/drafting/index.json` has (ADR-020) |

`reviewState` has four values and the difference matters:

- `approved` — served. Fully bilingual, reviewed, past every gate.
- `needs-hindi` — the English is right; the Hindi has not been written. Not served.
- `unreviewed` — generated, not yet hand-reviewed. Not served.
- `rejected` — reviewed and refused, with `reviewNote` saying why. Never served.

---

## Where Session 20 continues

The pipeline is complete and eight of the twelve acts have authored Hindi. What
is left is content, and it is listed rather than estimated:

1. **Hindi headings for four acts** — `ccs-pension` (86 rules), `gfr` (307),
   `fr-sr` (77) and `csmop` (112 paragraphs). Write `hindi/<act>.json` and
   `make_cards.py` serves their rule cards on the next run. This is 582 rule
   cards and it is the single largest unlock in the dataset.
   `docs/DATA-GAPS.md` #40 tracks it.
2. **Cloze review for those four acts** — 529 generated cloze cards sit at
   `unreviewed`. The review file format is `review/cloze-<act>.json`; the four
   already done are the worked examples.
3. **Authored questions for the remaining acts** — GFR, Pension, CSMOP, FR/SR,
   OSA, the OL Act and the OL Rules have rule and cloze cards but no MCQs. The
   brief's five acts are done.
4. **Stage C from a fresh session**, per the note above.
5. **`fillRuleNo` cards.** The kind is in the schema and in the zod enum and
   nothing generates one yet. It is the inverse of the rule card — a scenario in,
   a rule number out — and it wants the same authored Hindi.

The Trainer UI itself is Session 20's other half: `ts-fsrs` is still in the
deferred list, and `src/modules/trainer/` holds only the schema and the
placeholder page.
