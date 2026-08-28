#!/usr/bin/env python3
"""The four-stage pipeline for the authored questions, as separate passes.

    scripts/authoring/qa_pipeline.py blind ccs-conduct    # stage C worksheet
    scripts/authoring/qa_pipeline.py dedup ccs-conduct    # stage D, rapidfuzz
    scripts/authoring/qa_pipeline.py status               # what each act has

Stages A to D are deliberately **four files**, not four fields in one file:

* **A · GENERATE** — ``scripts/authoring/authored/<act>.json``. Written in
  session, one batch per act, each question grounded in a named rule record.
* **B · CRITIC** — ``scripts/authoring/review/critic-<act>.json``. A separate
  pass that judges each question on its own terms: is there exactly one correct
  answer, are the distractors plausible, is it inside the public rule text, is
  the tone right for a serving officer. Approve or reject with one line.
* **C · BLIND VERIFY** — ``scripts/authoring/review/blind-<act>.json``. The
  ``blind`` subcommand prints every MCQ and true/false question with its
  options and **without its key**, alongside the rule text it is grounded in.
  The answers go in the blind file; ``make_cards.py`` compares them with the
  stored key and a mismatch rejects the question automatically — either the
  stem is ambiguous or the key is wrong, and both are fatal.
* **D · DEDUP** — ``scripts/authoring/review/dedup-<act>.json``, written by the
  ``dedup`` subcommand. rapidfuzz ``token_set_ratio`` over every pair of English
  fronts in the act, including the generated rule and cloze cards; at 90 or
  above the later question is the duplicate and is rejected.

Nothing here reaches a network or a model. Stage A and stage B are human (well:
Claude Code, in session, in separate passes); stage D is arithmetic.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from itertools import combinations
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from authoring_common import (  # noqa: E402
    ACTS,
    ACTS_BY_ID,
    AUTHORED_DIR,
    REVIEW_DIR,
    RULES_TEXT_DIR,
    log,
    read_json,
    write_json,
)

# rapidfuzz token_set_ratio at or above this is a duplicate. The brief's figure.
DEDUP_THRESHOLD = 90.0


def load_authored(act_id: str) -> list[dict[str, Any]]:
    payload = read_json(AUTHORED_DIR / f"{act_id}.json")
    return [] if payload is None else payload["cards"]


def rule_text(act_id: str, text_id: str) -> str:
    payload = read_json(RULES_TEXT_DIR / f"{act_id}.json", default={"rules": []})
    for rule in payload["rules"]:
        if rule["id"] == text_id:
            heading = rule["heading"]["en"]
            return f"{rule['number']}. {heading}\n{rule['text']['en']}"
    return "(rule not found)"


def cmd_blind(act_id: str) -> int:
    """Print the stage-C worksheet: questions and options, no keys."""
    cards = [c for c in load_authored(act_id) if c["kind"] in {"mcq", "trueFalse", "scenario"}]
    if not cards:
        log(f"! no authored questions for {act_id}")
        return 1
    for card in cards:
        print(f"### {card['id']}  ({card['kind']})")
        print(f"GROUNDING: {rule_text(act_id, card['ruleRef']['textId'])[:900]}")
        print(f"Q: {card['front']['en']}")
        for index, option in enumerate(card.get("options", [])):
            print(f"   [{index}] {option['en']}")
        print()
    log(f"{len(cards)} questions printed for {act_id}; write answers to review/blind-{act_id}.json")
    return 0


def cmd_dedup(act_id: str) -> int:
    """Stage D. rapidfuzz over every pair of English fronts in the act."""
    from rapidfuzz import fuzz

    authored = load_authored(act_id)
    if not authored:
        log(f"! no authored questions for {act_id}")
        return 1

    # Compared against each other AND against the generated cards, so an
    # authored question that restates a cloze card is caught too.
    generated = read_json(Path("data/rules/cards") / f"{act_id}.json", default={"cards": []})["cards"]
    corpus = [(c["id"], c["front"]["en"]) for c in generated if not c["id"].startswith(f"{act_id}-q-")]

    order = {card["id"]: index for index, card in enumerate(authored)}
    results: dict[str, dict[str, Any]] = {
        card["id"]: {"maxScore": 0.0, "against": None, "verdict": "keep"} for card in authored
    }

    for left, right in combinations(authored, 2):
        score = fuzz.token_set_ratio(left["front"]["en"], right["front"]["en"])
        later = right if order[right["id"]] > order[left["id"]] else left
        earlier = left if later is right else right
        if score > results[later["id"]]["maxScore"]:
            results[later["id"]] = {
                "maxScore": round(score, 1),
                "against": earlier["id"],
                "verdict": "duplicate" if score >= DEDUP_THRESHOLD else "keep",
            }

    for card in authored:
        for other_id, other_front in corpus:
            score = fuzz.token_set_ratio(card["front"]["en"], other_front)
            if score > results[card["id"]]["maxScore"]:
                results[card["id"]] = {
                    "maxScore": round(score, 1),
                    "against": other_id,
                    "verdict": "duplicate" if score >= DEDUP_THRESHOLD else "keep",
                }

    target = REVIEW_DIR / f"dedup-{act_id}.json"
    payload = {
        "_note": (
            f"Stage D, written by scripts/authoring/qa_pipeline.py dedup {act_id}. "
            f"rapidfuzz token_set_ratio over every pair of English fronts in this act, "
            f"including the generated rule and cloze cards. At {DEDUP_THRESHOLD:.0f} or above "
            "the later question is the duplicate and make_cards.py rejects it."
        ),
        "threshold": DEDUP_THRESHOLD,
        "scores": dict(sorted(results.items())),
    }
    write_json(target, payload)

    duplicates = [i for i, r in results.items() if r["verdict"] == "duplicate"]
    highest = max(results.values(), key=lambda r: r["maxScore"])["maxScore"] if results else 0
    log(
        f"  {act_id}: {len(authored)} questions, {len(duplicates)} duplicates "
        f"(highest score {highest})"
    )
    for dup in duplicates:
        log(f"    ! {dup} vs {results[dup]['against']} — {results[dup]['maxScore']}")
    return 0


def cmd_report(stamp: str) -> int:
    """Write the acceptance report to ``docs/authoring-reports/<date>.md``.

    Generated from the committed card files rather than from a running tally,
    so the report cannot disagree with the data it describes. The date comes
    from the caller because nothing in this pipeline may read the clock — the
    same reason ``ingest_common.write_json`` keeps timestamps in one place.
    """
    from authoring_common import REPORTS_DIR, RULES_CARDS_DIR, RULES_DIR

    index = read_json(RULES_DIR / "index.json")
    if index is None:
        log("! no data/rules/index.json; run make_cards.py first")
        return 1

    lines = [
        f"# Rules authoring — acceptance report, {stamp}",
        "",
        "<!-- Generated by scripts/authoring/qa_pipeline.py report. Do not edit by hand. -->",
        "",
        "Generated from the committed `data/rules/cards/*.json`, so it cannot disagree",
        "with the data it describes. Regenerate with:",
        "",
        "```bash",
        f"scripts/ingest/.venv/bin/python scripts/authoring/qa_pipeline.py report --date {stamp}",
        "```",
        "",
        "## Authored questions — the four-stage pipeline",
        "",
        "Stage A generates, stage B criticises without the generation notes, stage C",
        "answers blind without the key, stage D deduplicates with rapidfuzz. A question",
        "is served only if it survives all four. Rejects stay in the card file with the",
        "reason and are never shown.",
        "",
        "| Act | Generated | Critic-rejected | Verify-rejected | Dedup-rejected | Approved |",
        "| --- | --------: | --------------: | --------------: | -------------: | -------: |",
    ]

    totals = Counter()
    for entry in index["acts"]:
        cards = read_json(RULES_CARDS_DIR / f"{entry['id']}.json")["cards"]
        authored = [c for c in cards if c.get("generationMeta")]
        if not authored:
            continue
        critic = sum(1 for c in authored if c["generationMeta"]["critic"]["verdict"] == "reject")
        verify = sum(
            1
            for c in authored
            if (c["generationMeta"].get("blindVerify") or {}).get("matched") is False
        )
        dedup = sum(1 for c in authored if c["generationMeta"]["dedup"]["verdict"] == "duplicate")
        approved = sum(1 for c in authored if c["reviewState"] == "approved")
        totals.update(
            generated=len(authored), critic=critic, verify=verify, dedup=dedup, approved=approved
        )
        lines.append(
            f"| {entry['name']['en']} | {len(authored)} | {critic} | {verify} | {dedup} | {approved} |"
        )
    lines.append(
        f"| **Total** | **{totals['generated']}** | **{totals['critic']}** | "
        f"**{totals['verify']}** | **{totals['dedup']}** | **{totals['approved']}** |"
    )

    lines += [
        "",
        "## Generated cards — rule and cloze",
        "",
        "Rule cards are one per rule, so their count is the act's rule count. A rule card",
        "is not served where its Hindi heading has not been authored yet, or where the",
        "heading cannot identify the rule (a repealed rule headed \"Omitted\", or a heading",
        "the act uses twice).",
        "",
        "| Act | Rules | Rule cards | Cloze generated | Cloze reviewed | Cloze approved | Served |",
        "| --- | ----: | ---------: | --------------: | -------------: | -------------: | -----: |",
    ]

    grand = Counter()
    for entry in index["acts"]:
        cards = read_json(RULES_CARDS_DIR / f"{entry['id']}.json")["cards"]
        rule_cards = [c for c in cards if c["kind"] == "rule"]
        cloze = [c for c in cards if c["kind"] == "cloze"]
        reviewed = [c for c in cloze if c["reviewed"]]
        approved = [c for c in cloze if c["reviewState"] == "approved"]
        grand.update(
            rules=entry["counts"]["rules"],
            ruleCards=len(rule_cards),
            cloze=len(cloze),
            clozeReviewed=len(reviewed),
            clozeApproved=len(approved),
            served=entry["counts"]["served"],
        )
        lines.append(
            f"| {entry['name']['en']} | {entry['counts']['rules']} | {len(rule_cards)} | "
            f"{len(cloze)} | {len(reviewed)} | {len(approved)} | {entry['counts']['served']} |"
        )
    lines.append(
        f"| **Total** | **{grand['rules']}** | **{grand['ruleCards']}** | **{grand['cloze']}** | "
        f"**{grand['clozeReviewed']}** | **{grand['clozeApproved']}** | **{grand['served']}** |"
    )

    lines += [
        "",
        "## Served, by kind",
        "",
        "| Kind | Served |",
        "| ---- | -----: |",
    ]
    for kind, count in sorted(index["totals"]["byKind"].items()):
        lines.append(f"| {kind} | {count} |")
    lines += [
        "",
        f"**{index['totals']['served']} cards are served** out of "
        f"{index['totals']['cards']} in the files: "
        f"{index['totals']['needsHindi']} are waiting for authored Hindi and "
        f"{index['totals']['rejected']} were rejected with a reason.",
        "",
        "## Why a card is not served",
        "",
        "| Reason | Cards |",
        "| ------ | ----: |",
    ]

    reasons: Counter[str] = Counter()
    for entry in index["acts"]:
        for card in read_json(RULES_CARDS_DIR / f"{entry['id']}.json")["cards"]:
            if card["reviewState"] == "approved":
                continue
            if card["reviewState"] == "needs-hindi":
                reasons["Hindi not yet authored"] += 1
            elif card["reviewState"] == "unreviewed":
                reasons["Generated, not yet hand-reviewed"] += 1
            else:
                note = card.get("reviewNote", "")
                if note.startswith("critic:"):
                    reasons["Rejected by the critic pass"] += 1
                elif note.startswith("blind verify:"):
                    reasons["Rejected by blind verify"] += 1
                elif note.startswith("dedup:"):
                    reasons["Rejected as a duplicate"] += 1
                else:
                    reasons["Rejected in the cloze review"] += 1
    for reason, count in reasons.most_common():
        lines.append(f"| {reason} | {count} |")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    target = REPORTS_DIR / f"{stamp}.md"
    target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    log(f"wrote {target}")
    return 0


def cmd_status() -> int:
    header = f"{'act':<14} {'A gen':>6} {'B critic':>9} {'C blind':>8} {'D dedup':>8}"
    log(header)
    log("-" * len(header))
    for act in ACTS:
        authored = load_authored(act.id)
        if not authored:
            continue
        critic = read_json(REVIEW_DIR / f"critic-{act.id}.json", default={}) or {}
        blind = read_json(REVIEW_DIR / f"blind-{act.id}.json", default={}) or {}
        dedup = read_json(REVIEW_DIR / f"dedup-{act.id}.json", default={"scores": {}})["scores"]
        log(
            f"{act.id:<14} {len(authored):>6} "
            f"{len([k for k in critic if not k.startswith('_')]):>9} "
            f"{len([k for k in blind if not k.startswith('_')]):>8} {len(dedup):>8}"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("blind", "dedup"):
        one = sub.add_parser(name)
        one.add_argument("act", nargs="?", help="act id; omit for every act with questions")
    sub.add_parser("status")
    report = sub.add_parser("report")
    report.add_argument("--date", required=True, help="the report date, YYYY-MM-DD")
    args = parser.parse_args()

    if args.command == "status":
        return cmd_status()
    if args.command == "report":
        return cmd_report(args.date)

    act_ids = [args.act] if args.act else [a.id for a in ACTS if load_authored(a.id)]
    unknown = set(act_ids) - set(ACTS_BY_ID)
    if unknown:
        log(f"! unknown act id(s): {', '.join(sorted(unknown))}")
        return 1

    failures = 0
    for act_id in act_ids:
        failures += cmd_blind(act_id) if args.command == "blind" else cmd_dedup(act_id)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
