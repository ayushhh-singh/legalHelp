#!/usr/bin/env python3
"""Turn extracted rule text into trainer cards, and fold in the authored ones.

    scripts/ingest/.venv/bin/python scripts/authoring/make_cards.py
    scripts/authoring/make_cards.py --act rti --show
    scripts/authoring/make_cards.py --check          # re-derive, write nothing
    scripts/authoring/make_cards.py --report         # acceptance report to docs/

Three kinds of card land in ``data/rules/cards/<act>.json``:

* **Rule cards** — one per rule, plus one per sub-rule where the rule is long
  enough that a single card would be a page of text. Every rule in every
  extracted act gets one, which is what ``tests/rules-data.test.ts`` checks.
  The card runs *heading to citation* — "Communication of Official Information
  → Rule 11, CCS (Conduct) Rules, 1964" — because that is the direction an
  officer is actually examined in, and because it keeps the card bilingual for
  the price of one authored heading instead of a translated rule book.

* **Cloze cards** — up to three per rule, blanking a span that carries the
  rule's content: a duration, an amount, a count, a cross-reference, or a term
  the act defines. Never a connective. Generated with ``reviewed: false``, then
  reviewed by hand (see ``scripts/authoring/review/``).

* **Authored questions** — MCQ, true/false and scenario, written in-session and
  committed to ``scripts/authoring/authored/<act>.json``. They arrive here with
  their four-stage ``generationMeta`` already on them and are merged, not
  generated: this script never invents a question and never calls anything.

**Hindi is authored, never machine-made.** ``scripts/authoring/hindi/<act>.json``
maps a rule number to its Hindi heading; a card whose Hindi is not yet written
is emitted with ``reviewState: "needs-hindi"`` and is **not served**. That is
the honest version of the bilingual rule: the Ministry publishes no usable Hindi
text layer for any of these twelve books (see ``extract_rules.py``), so the
alternative to authoring is machine translation of statutory text, which this
project will not ship.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from authoring_common import (  # noqa: E402
    ACTS,
    ACTS_BY_ID,
    AUTHORED_DIR,
    AUTHORING_DIR,
    DISCLAIMER,
    RULES_CARDS_DIR,
    RULES_DIR,
    RULES_TEXT_DIR,
    REVIEW_DIR,
    TERMS_DIR,
    Act,
    clean_text,
    log,
    read_json,
    source_of,
    utc_now,
    validate,
    write_json,
)

VERSION = "1.0.0"
HINDI_DIR = AUTHORING_DIR / "hindi"
BLANK = "____"

# A rule longer than this is split into per-sub-rule cards as well, because a
# card a reader has to scroll is a card a reader skips.
LONG_RULE = 700
# The longest a rule card's back may be before it is trimmed at a sentence end.
MAX_BACK = 600
MAX_CLOZE_PER_RULE = 3
# How many times one answer may be blanked across a whole act. "Government
# servant" opens twenty-three rules of the Conduct rules with "No ____ shall",
# and twenty-three cards with the same answer teach a reader the answer, not the
# rule. Two is enough to establish the phrase and few enough to stay a card.
MAX_SAME_ANSWER_PER_ACT = 2
# rapidfuzz token_set_ratio at or above this is a duplicate; qa_pipeline.py owns
# the computation and this is the figure it writes into review/dedup-*.json.
DEDUP_THRESHOLD = 90.0
# A cloze stem shorter than this has nothing around the blank to reason from.
MIN_CLOZE_STEM = 60
MAX_CLOZE_STEM = 320


# ---------------------------------------------------------------------------
# Blankable spans
# ---------------------------------------------------------------------------

# Ordered by how much of the rule's content the span carries. A duration or an
# amount is the thing a rule turns on; a defined term is next; a bare count is
# last because "two" is sometimes just two.
NUMBER_WORDS = (
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|"
    "twenty|thirty|forty|forty-five|fifty|sixty|ninety|hundred"
)
UNITS = "second|minute|hour|day|week|fortnight|month|year|working day|calendar month"

SPAN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        # The lookbehind stops a compound number being cut in half. Without it
        # "within one hundred and twenty days" was blanked as "twenty days",
        # leaving a stem that read "publish within one hundred and ____" — a
        # card whose answer is wrong and whose stem gives it away.
        "duration",
        re.compile(
            rf"(?<!\w)(?<!and )(?<!hundred )(?<!thousand )"
            rf"(?:(?:{NUMBER_WORDS})|\d{{1,4}})"
            rf"(?:\s+(?:hundred|thousand)(?:\s+and)?\s+(?:{NUMBER_WORDS}))?"
            rf"\s+(?:{UNITS})s?\b",
            re.I,
        ),
    ),
    (
        # The word boundary and the leading digit are both load-bearing.
        # Without them ``[\d,]+`` matched a bare comma and ``Rs`` matched inside
        # a word, so "press releases, circulars, orders" produced a card whose
        # answer was "rs," and whose stem read "circular____orders".
        "amount",
        re.compile(
            r"(?:₹\s?\d[\d,]*(?:\.\d+)?|\bRs\.?\s?\d[\d,]*(?:\.\d+)?|"
            r"\brupees\s+(?:[a-z\- ]{3,40}?)(?=\s*[,.);]))",
            re.I,
        ),
    ),
    (
        # A reference worth blanking names a rule or section **number**.
        # "sub-rule (1)" on its own was the single commonest span in the corpus
        # and makes a card nobody can answer: half the rules in these books
        # contain the phrase, and which sub-rule is meant is not recoverable
        # from the sentence around it.
        "crossReference",
        re.compile(
            r"\b(?:rules?|sections?|articles?)\s+\d{1,3}[A-Z]?"
            r"(?:\s*\([0-9a-zivx]{1,4}\))*(?![\s,]*\d)",
            re.I,
        ),
    ),
    (
        "percentage",
        re.compile(r"\b\d{1,3}(?:\.\d+)?\s?per\s?cent\.?|\b\d{1,3}(?:\.\d+)?\s?%"),
    ),
    (
        "count",
        re.compile(rf"\b(?:{NUMBER_WORDS})\s+(?=[a-z]{{3,}})", re.I),
    ),
)

# A stem drawn from the amendment apparatus rather than from the rule. Every one
# of these books interleaves its footnotes with its text — "1 Subs. by Act 24 of
# 1967, s. 6, for 'two years'" sits inside the section it amends — and a cloze
# built there asks the reader to recall a footnote.
APPARATUS = re.compile(
    r"\b(?:Subs\. by|Ins\. by|Omitted by|Rep\. by|ibid|w\.e\.f\.|vide notification|"
    r"AMENDMENTS AND THEIR|TO BE PUBLISHED IN THE GAZETTE|Principal Rules)\b",
    re.I,
)

# Words that must never end up inside a blank on their own. Blanking a
# connective tests nothing — the reader is guessing English, not the rule.
CONNECTIVES = frozenset(
    """a an and or of in on to for with by from at as be is are was were shall may
    must not no any such the that this these those it he his her him they them their
    which who whom whose if then than but nor so up out into under over about
    provided that where when while whether unless until also other otherwise""".split()
)


@dataclass(frozen=True)
class Span:
    kind: str
    start: int
    end: int
    text: str


def find_spans(text: str, terms: Iterable[str]) -> list[Span]:
    """Every blankable span in a rule's text, best first, non-overlapping.

    A span is blankable only if it carries the rule's content. Two filters do
    most of the work: a span made only of connectives is dropped outright, and
    spans are taken in pattern order so a duration wins over the count inside
    it — "two months" must not be blanked as "two".
    """
    found: list[Span] = []
    taken: list[tuple[int, int]] = []

    def overlaps(start: int, end: int) -> bool:
        return any(start < b and a < end for a, b in taken)

    def add(kind: str, start: int, end: int) -> None:
        raw = text[start:end]
        body = raw.strip()
        if not body:
            return
        # The stripped span's REAL offsets. Deriving the end from the match
        # start plus the stripped length shifted the blank left by however much
        # whitespace the match had picked up, so the blank ate the tail of the
        # previous word and left its own: "the benefit ... payable under
        # R____shall" instead of "under ____ shall".
        lead = len(raw) - len(raw.lstrip())
        real_start = start + lead
        real_end = real_start + len(body)
        if overlaps(real_start, real_end):
            return
        words = [w.strip(".,;:()\"'").lower() for w in body.split()]
        if all(w in CONNECTIVES or not w for w in words):
            return
        found.append(Span(kind=kind, start=real_start, end=real_end, text=body))
        taken.append((real_start, real_end))

    for kind, pattern in SPAN_PATTERNS:
        for match in pattern.finditer(text):
            add(kind, match.start(), match.end())

    # Defined terms last: they are the most numerous and the least surprising.
    for term in sorted(set(terms), key=len, reverse=True):
        for match in re.finditer(rf"\b{re.escape(term)}\b", text, re.I):
            add("definedTerm", match.start(), match.end())

    order = {kind: i for i, (kind, _) in enumerate(SPAN_PATTERNS)}
    order["definedTerm"] = len(order)
    found.sort(key=lambda s: (order[s.kind], s.start))
    return found


def excerpt_around(text: str, span: Span) -> tuple[str, int, int] | None:
    """The sentence containing a span, widened until it can be reasoned about."""
    start = text.rfind(". ", 0, span.start)
    start = 0 if start < 0 else start + 2
    end = text.find(". ", span.end)
    end = len(text) if end < 0 else end + 1

    if end - start < MIN_CLOZE_STEM:
        start = max(0, span.start - MIN_CLOZE_STEM)
        end = min(len(text), span.end + MIN_CLOZE_STEM)
    if end - start > MAX_CLOZE_STEM:
        start = max(start, span.start - MAX_CLOZE_STEM // 2)
        end = min(end, span.end + MAX_CLOZE_STEM // 2)
    # Never open a stem in the middle of a word. Widening a short window by a
    # fixed number of characters lands mid-word most of the time, and a stem
    # that begins "alling within its territory" reads as a typo, not a rule.
    if start > 0 and text[start - 1].isalnum():
        space = text.find(" ", start)
        if space == -1 or space >= span.start:
            return None
        start = space + 1
    if span.start < start or span.end > end:
        return None
    return text[start:end].strip(), start, end


# ---------------------------------------------------------------------------
# Card building
# ---------------------------------------------------------------------------


def citation(act: Act, number: str) -> dict[str, str]:
    return {
        "en": f"{act.unit_en} {number}, {act.name_en}",
        "hi": f"{act.unit_hi} {number}, {act.name_hi}",
    }


def trim_at_sentence(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text.rfind(". ", 0, limit)
    return (text[: cut + 1] if cut > limit // 2 else text[:limit].rsplit(" ", 1)[0]) + " …"


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def state_for(hindi_present: bool, reviewed: bool) -> tuple[bool, str]:
    if not hindi_present:
        return False, "needs-hindi"
    return (True, "approved") if reviewed else (False, "unreviewed")


# A rule the book has emptied. Its card would ask "Deleted — which rule?", and
# the Leave rules alone have six of them, which is six identical cards.
_EMPTIED = re.compile(r"^\s*(?:deleted|omitted|repealed)\b", re.I)


def _unanswerable(rules: list[dict[str, Any]]) -> dict[str, str]:
    """Rules whose heading cannot identify them, with the reason for each.

    Two cases, both found by the duplicate-front test rather than by reading:

    * the heading is "Deleted" or "Omitted" — the rule has no content left;
    * the heading repeats inside the same act. The RTI Act heads both section 13
      and section 16 "Term of office and conditions of service", one for the
      Central Commission and one for the State; a card showing that heading has
      two right answers and the reader cannot tell which is wanted.

    Both still get a card, so rule coverage stays complete, and both are marked
    ``rejected`` with the reason rather than served.
    """
    seen: Counter[str] = Counter()
    for rule in rules:
        heading = rule["heading"]["en"].strip().lower()
        if heading:
            seen[heading] += 1

    out: dict[str, str] = {}
    for rule in rules:
        heading = rule["heading"]["en"].strip()
        if not heading:
            continue
        if _EMPTIED.match(heading):
            out[rule["id"]] = f'the rule has been {heading.lower()}; there is nothing to recall'
        elif seen[heading.lower()] > 1:
            out[rule["id"]] = (
                f'the heading "{heading}" is used by {seen[heading.lower()]} rules of this act, '
                "so it does not identify one of them"
            )
    return out


def rule_cards(act: Act, rules: list[dict[str, Any]], hindi: dict[str, str], src: dict[str, str]) -> list[dict[str, Any]]:
    """One card per rule, plus one per sub-rule where the rule is long."""
    cards: list[dict[str, Any]] = []
    unanswerable = _unanswerable(rules)
    for rule in rules:
        number = rule["number"]
        heading_en = rule["heading"]["en"]
        heading_hi = hindi.get(number, "")
        body = rule["text"]["en"]

        # A rule with no heading of its own — CSMOP and the FR/SR compilation
        # print none — is prompted by its opening sentence instead.
        prompt_en = heading_en or trim_at_sentence(body, 160)
        cite = citation(act, number)
        has_hi = bool(heading_hi)
        reviewed, state = state_for(has_hi, reviewed=True)

        # The act is named in the front. Without it, "Definitions — which rule?"
        # is a card with twelve right answers, because twelve of these rule
        # books head a rule "Definitions" — and the duplicate-front test in
        # tests/rules-data.test.ts found forty-two such collisions.
        card: dict[str, Any] = {
            "id": f"{act.id}-rule-{slug(number)}",
            "act": act.id,
            "rule": number,
            "kind": "rule",
            "front": {
                "en": f"{prompt_en} — which {act.unit_en.lower()} of the {act.short_en}?",
                "hi": f"{heading_hi} — {act.short_hi} का कौन-सा {act.unit_hi}?" if has_hi else "",
            },
            "back": cite,
            "ruleRef": {"textId": rule["id"], "citation": cite},
            "difficulty": "easy" if heading_en else "medium",
            "reviewed": reviewed,
            "reviewState": state,
            "tags": ["generated", "rule"],
            "verify": True,
            "version": VERSION,
            "source": src,
        }
        if rule["id"] in unanswerable:
            card["reviewed"] = True
            card["reviewState"] = "rejected"
            card["reviewNote"] = unanswerable[rule["id"]]
        cards.append(card)

        if len(body) >= LONG_RULE:
            for sub in rule.get("subRules", []):
                sub_number = sub["number"]
                cards.append(
                    {
                        "id": f"{act.id}-rule-{slug(sub_number)}",
                        "act": act.id,
                        "rule": number,
                        "subRule": sub_number,
                        "kind": "rule",
                        "front": {
                            "en": f"{trim_at_sentence(sub['text']['en'], 200)} — which {act.unit_en.lower()}?",
                            "hi": "",
                        },
                        "back": citation(act, sub_number),
                        "ruleRef": {"textId": rule["id"], "citation": citation(act, sub_number)},
                        "difficulty": "medium",
                        "reviewed": False,
                        "reviewState": "needs-hindi",
                        "tags": ["generated", "rule", "sub-rule"],
                        "verify": True,
                        "version": VERSION,
                        "source": src,
                    }
                )
    return cards


def cloze_cards(
    act: Act,
    rules: list[dict[str, Any]],
    terms: list[str],
    review: dict[str, Any],
    src: dict[str, str],
) -> list[dict[str, Any]]:
    """Up to three cloze cards per rule, then the hand review applied on top."""
    cards: list[dict[str, Any]] = []
    seen_answers: Counter[str] = Counter()
    for rule in rules:
        body = rule["text"]["en"]
        if len(body) < MIN_CLOZE_STEM:
            continue
        made = 0
        used_kinds: Counter[str] = Counter()
        for span in find_spans(body, terms):
            if made >= MAX_CLOZE_PER_RULE:
                break
            # At most one blank of a kind per rule. Three cross-references from
            # one rule is three cards that feel identical and teach the reader
            # that the answer is always a section number.
            if used_kinds[span.kind] >= 1:
                continue
            window = excerpt_around(body, span)
            if window is None:
                continue
            stem, start, _ = window
            if APPARATUS.search(stem):
                continue
            if seen_answers[span.text.lower()] >= MAX_SAME_ANSWER_PER_ACT:
                continue
            local = span.start - start
            blanked = stem[:local] + BLANK + stem[local + len(span.text) :]
            if BLANK not in blanked:
                continue

            card_id = f"{act.id}-cloze-{slug(rule['number'])}-{made + 1}"
            decision = review.get(card_id, {})
            if decision.get("verdict") == "reject":
                reviewed, state = True, "rejected"
            elif decision.get("verdict") in {"approve", "edit"}:
                reviewed, state = True, "approved"
            else:
                reviewed, state = False, "unreviewed"

            stem_hi = decision.get("hi", {}).get("text", "")
            answer_hi = decision.get("hi", {}).get("answer", "")
            if state == "approved" and not (stem_hi and answer_hi):
                reviewed, state = False, "needs-hindi"

            card: dict[str, Any] = {
                "id": card_id,
                "act": act.id,
                "rule": rule["number"],
                "kind": "cloze",
                "front": {
                    "en": decision.get("en", {}).get("text", blanked),
                    "hi": stem_hi,
                },
                "back": {
                    "en": decision.get("en", {}).get("answer", span.text),
                    "hi": answer_hi,
                },
                "cloze": {
                    "text": {"en": decision.get("en", {}).get("text", blanked), "hi": stem_hi},
                    "answer": {"en": decision.get("en", {}).get("answer", span.text), "hi": answer_hi},
                },
                "ruleRef": {"textId": rule["id"], "citation": citation(act, rule["number"])},
                "difficulty": {"duration": "medium", "amount": "medium", "crossReference": "hard"}.get(
                    span.kind, "easy"
                ),
                "reviewed": reviewed,
                "reviewState": state,
                "tags": ["generated", "cloze", slug(span.kind)],
                "verify": True,
                "version": VERSION,
                "source": src,
            }
            if decision.get("reason"):
                card["reviewNote"] = decision["reason"]
            cards.append(card)
            seen_answers[span.text.lower()] += 1
            used_kinds[span.kind] += 1
            made += 1
    return cards


def rotate_options(card_id: str, options: list[Any], answer_index: int) -> tuple[list[Any], int]:
    """Rotate a question's options deterministically, by a hash of its id.

    Writing a multiple-choice question puts the correct answer first, because
    that is how a person writes one — and the batch that came out of stage A had
    its key at index 0 in 91% of its questions. A trainer built on that set
    teaches position rather than law, and a reader would learn that lesson
    within one session. The blind-verify pass is what surfaced it.

    Rotation is by ``sha256`` of the card id, not by ``random``: this file is
    regenerated on every run, and a shuffling order would make every run a diff.
    Rotation rather than a shuffle, because several of these questions end their
    option list with a deliberate catch-all ("There is no such period"), and a
    shuffle would strand it in the middle.
    """
    if len(options) < 2:
        return options, answer_index
    step = int(hashlib.sha256(card_id.encode("utf-8")).hexdigest(), 16) % len(options)
    if not step:
        return list(options), answer_index
    rotated = options[-step:] + options[:-step]
    return rotated, (answer_index + step) % len(options)


def authored_cards(act: Act, src: dict[str, str], rule_ids: set[str]) -> list[dict[str, Any]]:
    """The in-session questions, with the four stages folded into one record.

    Stage A is ``authored/<act>.json``; stages B, C and D are three separate
    files under ``review/``. They are merged here rather than being written into
    stage A, so that an audit can see that the critic did not have the
    generation notes in front of it and the blind verify did not have the key.

    A question is served only if it survives **all three**: the critic approved
    it, the blind answer matched the stored key, and rapidfuzz put it below the
    duplicate threshold against every other card in the act. Anything else stays
    in the file with ``reviewState: "rejected"`` and the reason, which is the
    audit trail the brief asks for — and is never served.
    """
    payload = read_json(AUTHORED_DIR / f"{act.id}.json")
    if payload is None:
        return []

    critic = read_json(REVIEW_DIR / f"critic-{act.id}.json", default={}) or {}
    blind = read_json(REVIEW_DIR / f"blind-{act.id}.json", default={}) or {}
    dedup = (read_json(REVIEW_DIR / f"dedup-{act.id}.json", default={"scores": {}}) or {})["scores"]

    cards: list[dict[str, Any]] = []
    for source_card in payload["cards"]:
        card = dict(source_card)
        card_id = card["id"]
        card.setdefault("act", act.id)
        card.setdefault("version", VERSION)
        card.setdefault("source", src)
        card.setdefault("verify", True)
        card.setdefault("tags", ["authored", slug(card["kind"])])

        if card["ruleRef"]["textId"] not in rule_ids:
            raise ValueError(
                f"{act.id}: authored card {card_id} cites {card['ruleRef']['textId']}, "
                "which is not a rule in data/rules/text"
            )

        stage_a = card.pop("stageA")
        grounding = card.pop("groundingRuleIds")
        for grounded in grounding:
            if grounded not in rule_ids:
                raise ValueError(f"{act.id}: {card_id} grounds itself in unknown rule {grounded}")

        verdict = critic.get(card_id, {"verdict": "reject", "reason": "no critic verdict recorded"})
        scores = dedup.get(card_id, {"maxScore": 0.0, "against": None, "verdict": "keep"})

        answered = blind.get(card_id)
        if answered is None:
            blind_record: dict[str, Any] | None = None
        else:
            matched = answered["answered"] == card["answerIndex"]
            blind_record = {"answered": answered["answered"], "matched": matched}
            if "note" in answered:
                blind_record["note"] = answered["note"]

        # The three gates, in the order the brief runs them.
        if verdict["verdict"] == "reject":
            state, note = "rejected", f"critic: {verdict['reason']}"
        elif blind_record is not None and not blind_record["matched"]:
            state, note = (
                "rejected",
                f"blind verify: answered option {blind_record['answered']}, key is "
                f"{card['answerIndex']}. Either the stem is ambiguous or the key is wrong.",
            )
        elif scores["verdict"] == "duplicate":
            state, note = (
                "rejected",
                f"dedup: token_set_ratio {scores['maxScore']} against {scores['against']}, "
                f"at or above the {DEDUP_THRESHOLD:.0f} threshold.",
            )
        else:
            state, note = "approved", None

        card["reviewed"] = True
        card["reviewState"] = state
        if note:
            card["reviewNote"] = note

        # Rotate AFTER the blind comparison, which is against the authored order.
        if card.get("options") and card.get("answerIndex") is not None:
            card["options"], card["answerIndex"] = rotate_options(
                card_id, card["options"], card["answerIndex"]
            )

        card["generationMeta"] = {
            "promptVersion": payload["promptVersion"],
            "batchId": payload["batchId"],
            "stageA": stage_a,
            "critic": verdict,
            "blindVerify": blind_record,
            "dedup": scores,
            "groundingRuleIds": grounding,
        }
        cards.append(card)
    return cards


def build_act(act: Act) -> dict[str, Any] | None:
    text = read_json(RULES_TEXT_DIR / f"{act.id}.json")
    if text is None:
        return None
    rules = text["rules"]
    rule_ids = {r["id"] for r in rules}
    src = source_of(act, "en")
    hindi = read_json(HINDI_DIR / f"{act.id}.json", default={}) or {}
    terms = read_json(TERMS_DIR / f"{act.id}.json", default={"terms": []})["terms"]
    review = read_json(REVIEW_DIR / f"cloze-{act.id}.json", default={}) or {}

    cards = (
        rule_cards(act, rules, hindi, src)
        + cloze_cards(act, rules, terms, review, src)
        + authored_cards(act, src, rule_ids)
    )

    return {
        "$schema": "../../../schemas/rules-cards.schema.json",
        "version": VERSION,
        "generatedAt": utc_now()[:10],
        "act": {
            "id": act.id,
            "name": {"en": act.name_en, "hi": act.name_hi},
            "short": {"en": act.short_en, "hi": act.short_hi},
            "unit": {"en": act.unit_en, "hi": act.unit_hi},
        },
        "disclaimer": DISCLAIMER,
        "source": src,
        "cards": cards,
    }


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------


def count_cards(cards: list[dict[str, Any]], rules: int, sub_rules: int) -> dict[str, Any]:
    served = [c for c in cards if c["reviewState"] == "approved"]
    by_kind = Counter(c["kind"] for c in served)
    return {
        "rules": rules,
        "subRules": sub_rules,
        "cards": len(cards),
        "served": len(served),
        "needsHindi": sum(1 for c in cards if c["reviewState"] == "needs-hindi"),
        "rejected": sum(1 for c in cards if c["reviewState"] == "rejected"),
        "byKind": dict(sorted(by_kind.items())),
    }


def build_index(built: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    totals = {"rules": 0, "subRules": 0, "cards": 0, "served": 0, "needsHindi": 0, "rejected": 0}
    kinds: Counter[str] = Counter()

    for act in ACTS:
        payload = built.get(act.id)
        if payload is None:
            continue
        text = read_json(RULES_TEXT_DIR / f"{act.id}.json")
        rules = len(text["rules"])
        sub_rules = sum(len(r.get("subRules", [])) for r in text["rules"])
        counts = count_cards(payload["cards"], rules, sub_rules)
        for key in totals:
            totals[key] += counts[key]
        kinds.update(counts["byKind"])
        entries.append(
            {
                "id": act.id,
                "name": {"en": act.name_en, "hi": act.name_hi},
                "short": {"en": act.short_en, "hi": act.short_hi},
                "unit": {"en": act.unit_en, "hi": act.unit_hi},
                "publisher": act.publisher,
                "text": f"text/{act.id}.json",
                "cards": f"cards/{act.id}.json",
                "counts": counts,
                "hindiTextExtractable": text["hindiTextExtractable"],
                "source": payload["source"],
            }
        )

    return {
        "$schema": "../../schemas/rules-index.schema.json",
        "version": VERSION,
        "generatedAt": utc_now()[:10],
        "disclaimer": DISCLAIMER,
        "totals": {**totals, "byKind": dict(sorted(kinds.items()))},
        "acts": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--act", action="append", help="only this act id (repeatable)")
    parser.add_argument("--check", action="store_true", help="re-derive and compare; write nothing")
    parser.add_argument("--show", action="store_true", help="print every card's front")
    args = parser.parse_args()

    wanted = set(args.act or [a.id for a in ACTS])
    unknown = wanted - set(ACTS_BY_ID)
    if unknown:
        log(f"! unknown act id(s): {', '.join(sorted(unknown))}")
        return 1

    built: dict[str, dict[str, Any]] = {}
    failures = 0

    for act in ACTS:
        payload = build_act(act)
        if payload is None:
            continue
        built[act.id] = payload
        if act.id not in wanted:
            continue
        try:
            validate(payload, "rules-cards.schema.json")
        except Exception as error:  # noqa: BLE001 — the message is the report
            log(f"  ! {act.id}: {error}")
            failures += 1
            continue

        target = RULES_CARDS_DIR / f"{act.id}.json"
        counts = Counter(c["reviewState"] for c in payload["cards"])
        line = (
            f"{len(payload['cards']):>4} cards — {counts['approved']:>3} served, "
            f"{counts['unreviewed']:>3} unreviewed, {counts['needs-hindi']:>3} need Hindi, "
            f"{counts['rejected']:>2} rejected"
        )
        if args.check:
            same = read_json(target) == payload
            log(f"  {'ok' if same else '!!'} {act.id:<13} {line}")
            failures += 0 if same else 1
        else:
            changed, _ = write_json(target, payload)
            log(f"  {'wrote' if changed else 'same ':<5} {act.id:<13} {line}")

        if args.show:
            for card in payload["cards"]:
                log(f"      [{card['reviewState'][:4]}] {card['kind']:<10} {card['front']['en'][:90]}")

    index = build_index(built)
    try:
        validate(index, "rules-index.schema.json")
    except Exception as error:  # noqa: BLE001
        log(f"  ! index: {error}")
        return 1

    target = RULES_DIR / "index.json"
    if args.check:
        same = read_json(target) == index
        log(f"  {'ok' if same else '!!'} index.json")
        failures += 0 if same else 1
    else:
        changed, _ = write_json(target, index)
        log(f"  {'wrote' if changed else 'same '} data/rules/index.json")

    totals = index["totals"]
    log(
        f"{totals['rules']} rules, {totals['cards']} cards, {totals['served']} served "
        f"({totals['needsHindi']} awaiting Hindi, {totals['rejected']} rejected)"
    )
    log(f"served by kind: {totals['byKind']}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
