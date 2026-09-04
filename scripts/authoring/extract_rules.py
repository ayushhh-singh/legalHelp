#!/usr/bin/env python3
"""Split each fetched rule book into rule-level records.

    scripts/ingest/.venv/bin/python scripts/authoring/extract_rules.py
    scripts/authoring/extract_rules.py --act rti --show      # print what it found
    scripts/authoring/extract_rules.py --check               # re-derive, write nothing

Output is ``data/rules/text/<act>.json``: one record per rule or section, with
its number, its heading, its operative text and its sub-rules. This is the file
the Rules Trainer's cards ground themselves in, and it is also what the Law
Converter and the Drafting Studio link to when they cite a service rule.

Three things about the parse are worth stating, because each was a bug first.

**The rule sequence is walked, not pattern-matched.** ``^12. Something`` matches
the start of Rule 12 and it also matches the twelfth item of a list, a
paragraph of a Government of India decision, and a page number that landed
before a sentence. Every candidate is collected and then filtered by walking the
sequence: a candidate is a rule only if its number is greater than the last one
accepted. That one rule removes almost all of the noise, and it is why
``max_rule`` in the act registry exists — an upper bound stops a stray "1985"
from ending the walk.

**Page furniture is detected, not listed.** Every one of these documents repeats
a running head on most pages ("Central Civil Services (Conduct) Rules, 1964",
"THE GAZETTE OF INDIA : EXTRAORDINARY"). Any line that appears on more than a
third of the pages is dropped, so a new document needs no new configuration —
and the lines dropped are reported, so a rule heading that happened to repeat
cannot vanish silently.

**Hindi is never extracted from these PDFs.** Every Hindi issue fetched —
DoPT's Conduct and CCA rules, DoPT's RTI Act, rajbhasha's OL Act, DARPG's
CSMOP — is typeset from a legacy font, and its text layer is byte soup that
*looks* like Devanagari: ``ूशासन`` for ``प्रशासन``, ``ᳰकसी`` for ``किसी``,
``भनम्नानुसाय`` for ``निम्नानुसार``. CLAUDE.md already records this for CSMOP
(DATA-GAPS #36); measuring the other four found the same thing. So ``text.hi``
is empty in every record here and the trainer's Hindi is authored, not
extracted — which is what the working agreements say content authoring is.
``--audit-hindi`` prints the measurement for each Hindi document.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from authoring_common import (  # noqa: E402
    ACTS,
    REPO_ROOT,
    ACTS_BY_ID,
    DISCLAIMER,
    RULES_TEXT_DIR,
    SOURCES_DIR,
    Act,
    clean_text,
    devanagari_ratio,
    visual_order_share,
    log,
    read_html,
    read_json,
    read_pdf,
    rule_sort_key,
    normalise_rule_number,
    source_of,
    utc_now,
    validate,
    write_json,
)

VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Per-act parse configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParseConfig:
    """How one document's rules are laid out on the page.

    ``start`` must expose two named groups: ``num`` and ``rest`` (the text that
    follows the number on the same line). A document that puts the heading on
    the *next* line is handled by ``rest`` matching empty and the heading being
    taken from the following line — see ``split_heading``.
    """

    act_id: str
    file: str
    start: re.Pattern[str]
    reader: str = "pymupdf"
    kind: str = "pdf"
    # Text before this marker is a cover, a contents table or a foreword.
    body_from: re.Pattern[str] | None = None
    # Everything from here on is a schedule, an appendix or a form.
    body_to: re.Pattern[str] | None = None
    # Lines matching any of these are dropped wherever they appear.
    drop_lines: tuple[re.Pattern[str], ...] = ()
    # Where the numbering starts, for the sequence walk.
    first: str = "1"
    # How far the major number may jump between consecutive rules. CSMOP prints
    # a per-chapter contents block *inside* the body, whose entries (5.1, 7.6,
    # 10.3, 16.5) form a perfectly increasing sequence that swallows the walk
    # and blocks every real paragraph from 2.1 on. A manual does not go from
    # paragraph 1.7 to paragraph 5.1; a contents table does.
    major_jump: int | None = None
    # Some of these documents head every rule and some head none. The FR/SR
    # compilation and CSMOP both run straight from the number into the text, so
    # anything a heading matcher finds there is the first clause of a sentence
    # wearing a heading's clothes — "The Fundamental Rules apply, subject to the
    # provisions of Rule 3 to al". Better an empty heading than a false one.
    has_headings: bool = True
    # A rule book that prints two rule sets — Fundamental and Supplementary —
    # restarts at 1 for the second, so each gets its own config and its own
    # printed prefix. ``{}`` is the parsed number.
    number_format: str = "{}"
    note: str = ""


# Four digits, not three: a footnote marker sits flush against the rule number
# it precedes, so Rule 11 of the Conduct rules is printed "3911." — footnote 39,
# then the rule. ``readings()`` trims the prefix and the sequence walk picks the
# reading that fits. A hyphen is allowed before the suffix because the DoPT
# books print an inserted rule as "13-A." while the Acts print "13A.".
_NUM = r"(?P<num>\d{1,4}\s*[-\u2013]?\s?[A-Z]{0,2})"

# "11. Heading ..." or "11.\nHeading ..." — the workhorse for the DoPT rule
# books and the bare Acts. The number must be followed by a full stop, and the
# rest of the line is handed to split_heading.
# A pair of footnote references ("36/43") can precede the rule number, and a
# slash never appears inside one of these rule numbers — so a leading NN/NN is
# unambiguously footnote apparatus and is skipped rather than read.
_FOOTNOTE_PAIR = r"(?:\d{1,3}(?:/\d{1,3})+\s*)?"

DOTTED = re.compile(rf"(?m)^[ \t]*{_FOOTNOTE_PAIR}{_NUM}\s*\.\s*(?P<rest>.*)$")

# GFR prints "Rule 134 ..." with no full stop after the number.
GFR = re.compile(r"(?m)^[ \t]*Rule\s+(?P<num>\d{1,3})\s*(?:\(\d+\))?[ \t]*(?P<rest>.*)$")

# The FR/SR compilation prints "F.R. 1.", "F.R.5A." and "S.R. 2." — the spacing
# around the dots is not consistent even within a page.
FR = re.compile(r"(?m)^[ \t]*F\.?\s?R\.?\s*(?P<num>\d{1,3}\s?[A-Z]{0,2})\s*\.?\s*(?P<rest>.*)$")
SR = re.compile(r"(?m)^[ \t]*S\.?\s?R\.?\s*(?P<num>\d{1,3}\s?[A-Z]{0,2})\s*\.?\s*(?P<rest>.*)$")

# CSMOP numbers paragraphs "5.2." within a chapter.
CSMOP = re.compile(r"(?m)^[ \t]*(?P<num>\d{1,2}\.\d{1,2})\s*\.?\s*(?P<rest>.*)$")

PARSERS: tuple[ParseConfig, ...] = (
    ParseConfig(
        act_id="ccs-conduct",
        file="ccs-conduct-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short title,?\s*(?:commencement|extent)", re.I),
        drop_lines=(re.compile(r"^CENTRAL CIVIL SERVICES \(CONDUCT\) RULES, 1964$", re.I),),
    ),
    ParseConfig(
        act_id="ccs-cca",
        file="ccs-cca-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short title\s+and\s+commencement", re.I),
        drop_lines=(
            re.compile(r"^Central Civil Services \(Classification, Control and Appeal\) Rules, 1965\s*$", re.I),
        ),
    ),
    ParseConfig(
        act_id="ccs-leave",
        file="ccs-leave-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title\s+and\s+commencement", re.I),
        drop_lines=(re.compile(r"^-::\s*\d+\s*::-$"),),
    ),
    ParseConfig(
        act_id="ccs-pension",
        file="ccs-pension-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title\s+and\s+commencement", re.I),
        drop_lines=(
            re.compile(r"^THE GAZETTE OF INDIA\b.*$", re.I),
            re.compile(r"^\[?PART\s+II\b.*$", re.I),
            re.compile(r"^SEC\.\s*3\(i\)\]?$", re.I),
        ),
    ),
    ParseConfig(
        act_id="gfr",
        file="gfr-en.pdf",
        start=GFR,
        body_from=re.compile(r"Rule\s+1\s+Short\s+title\s+and\s+commencement", re.I),
    ),
    ParseConfig(
        act_id="rti",
        file="rti-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title,?\s*extent\s+and\s+commencement", re.I),
        body_to=re.compile(r"^\s*THE\s+FIRST\s+SCHEDULE\s*$", re.M | re.I),
        drop_lines=(re.compile(r"^THE RIGHT TO INFORMATION ACT, 2005\s*$", re.I),),
    ),
    ParseConfig(
        act_id="osa",
        file="osa-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title,?\s*extent\s+and\s+application", re.I),
    ),
    ParseConfig(
        act_id="posh",
        file="posh-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title,?\s*extent\s+and\s+commencement", re.I),
    ),
    ParseConfig(
        act_id="ol-act",
        file="ol-act-en.pdf",
        start=DOTTED,
        body_from=re.compile(r"1\.\s*Short\s+title\s+and\s+Commencement", re.I),
    ),
    ParseConfig(
        act_id="ol-rules",
        file="ol-rules-en.html",
        kind="html",
        start=re.compile(r"(?m)^[ \t]*(?P<num>\d{1,2})\s*\.\s*(?P<rest>.*)$"),
        body_from=re.compile(r"Short title, extent and commencement", re.I),
        # Rule 12 is the last rule; everything after it in the raw page is
        # template chrome (the "Content area" HTML comment, .body-wrapper /
        # .carousel-wrapper / .footer-wrapper markers, and a <script src=...>
        # tag for the site's own accessible-menu widget) that has no `body_to`
        # to stop it — it was reaching data/rules/text/ol-rules.json's rule 12
        # text verbatim, script tag included, and shipping to dist/ as rule
        # content rather than page furniture.
        body_to=re.compile(r"/#\s*Content area", re.I),
    ),
    ParseConfig(
        act_id="fr-sr",
        file="fr-sr-en.pdf",
        start=FR,
        body_from=re.compile(r"F\.\s?R\.\s?1\.\s*These\s+rules\s+may\s+be\s+called", re.I),
        body_to=re.compile(r"^\s*SUPPLEMENTARY\s+RULES\s*$", re.M | re.I),
        number_format="F.R. {}",
        has_headings=False,
    ),
    ParseConfig(
        act_id="fr-sr",
        file="fr-sr-en.pdf",
        start=SR,
        body_from=re.compile(r"^\s*SUPPLEMENTARY\s+RULES\s*$", re.M | re.I),
        number_format="S.R. {}",
        has_headings=False,
    ),
    ParseConfig(
        act_id="csmop",
        file="csmop-en.pdf",
        start=CSMOP,
        body_from=re.compile(r"^\s*1\.1\.?\s", re.M),
        first="1.1",
        major_jump=1,
        has_headings=False,
    ),
)

PARSERS_BY_ACT: dict[str, ParseConfig] = {p.act_id: p for p in PARSERS}


# ---------------------------------------------------------------------------
# Page furniture
# ---------------------------------------------------------------------------

FURNITURE_SHARE = 0.33
# A bare page number, deliberately WITHOUT a trailing full stop. "7" is a page
# number; "7." is how every one of these rule books prints the marker that opens
# Rule 7 on a line of its own. Matching both cost the Conduct rules fourteen of
# their twenty-five rules, silently.
_PAGE_NUMBER = re.compile(r"^[\s\-:]*\d{1,4}[\s\-:]*$")
# A line that is nothing but a marker: "12.", "3A.", "5.2.", "(i)", "(b)".
_MARKER_ONLY = re.compile(r"^(?:\d{1,3}\s?[A-Z]{0,2}\.?|\d{1,2}\.\d{1,2}\.?|\([0-9a-zA-Z]{1,5}\))$")


def is_furniture_eligible(line: str) -> bool:
    """Whether a repeated line may be treated as a running head or foot.

    Repetition alone is not enough, and assuming it was cost two documents. The
    DoPT rule books print a rule's number on a line of its own — ``1.``, ``2.``
    — and every rule book repeats ``(i)`` and ``(ii)`` on dozens of pages, so a
    plain frequency filter deleted the rule markers and the clause markers and
    then reported a clean parse of the amendment history at the back. A running
    head is prose: at least three letters and long enough to be a title.
    """
    if _MARKER_ONLY.match(line):
        return False
    return len(line) >= 8 and sum(c.isalpha() for c in line) >= 3


def strip_furniture(pages: list[str], extra: Iterable[re.Pattern[str]] = ()) -> tuple[str, list[str]]:
    """Drop running heads, running feet and bare page numbers.

    A line of prose that appears on more than a third of the pages is furniture;
    a line that is nothing but a number is a page number wherever it appears.
    What was removed is returned, so a heading that happens to repeat across a
    long rule cannot disappear without a word.
    """
    counts: Counter[str] = Counter()
    for page in pages:
        counts.update({line.strip() for line in page.splitlines() if line.strip()})

    threshold = max(3, int(len(pages) * FURNITURE_SHARE))
    repeated = {
        line
        for line, n in counts.items()
        if n >= threshold and len(line) < 120 and is_furniture_eligible(line)
    }
    patterns = tuple(extra)

    kept: list[str] = []
    for page in pages:
        for line in page.splitlines():
            stripped = line.strip()
            if not stripped:
                kept.append("")
                continue
            if stripped in repeated or _PAGE_NUMBER.match(stripped):
                continue
            if any(p.match(stripped) for p in patterns):
                continue
            kept.append(line.rstrip())
    return "\n".join(kept), sorted(repeated)


# ---------------------------------------------------------------------------
# Headings and sub-rules
# ---------------------------------------------------------------------------

# A heading ends at the first full stop that is followed by the operative text,
# at a dash, or at a colon. Capped so a rule with no heading at all (the bare
# Acts sometimes run straight into "(1) ...") does not swallow a paragraph.
MAX_HEADING = 140

_HEADING_END = re.compile(
    r"""
    (?P<heading>[^\n]{2,140}?)          # the shortest run that reaches a terminator
    (?:
        \s*[.．]\s*[-–—]\s*             # "Definitions.—"
      | \s*[-–—]{1,2}[ \t]+             # "Short title and Commencement– (1)"
      | \s*[-–—]{1,2}\s*$                # "...Commencement–" at end of line
      | \s*[:：]\s*                     # "Scrutiny of dak:"
      | \s*\.\s*(?=\(|[A-Z])            # "Definitions. In this Act"
      | \s*\.\s*$                       # "Penalties for spying."
    )
    """,
    re.X,
)


# Digits flush against the first word of a heading are a footnote marker, not
# part of the heading: the Conduct rules print "17Employment of near relatives"
# and "12Restriction regarding marriage". Only a run followed immediately by an
# upper-case letter is stripped, so a heading that genuinely opens with a number
# and a space is left alone.
_FUSED_FOOTNOTE = re.compile(r"^\d{1,3}(?=[A-Z][a-z])")


def strip_fused_footnote(heading: str) -> str:
    return _FUSED_FOOTNOTE.sub("", heading).strip()


# Words a heading does not end on. Pulling the next line in unconditionally is
# wrong far more often than it is right: the DoPT rule books print the heading
# on a line of its own and the operative text on the next, so appending turned
# "Short title and commencement" into "Short title and commencement (1) These
# rules may be called…" and left the rule with no heading at all. A heading that
# really did wrap ends mid-phrase — "Short title, extent and" — and that is what
# this looks for.
_UNFINISHED_TAIL = re.compile(
    r"(?:,|\b(?:and|or|of|in|on|to|for|with|the|a|an|by|from|under|regarding|relating)\s*)$",
    re.I,
)


def _looks_unfinished(body: str) -> bool:
    return bool(_UNFINISHED_TAIL.search(body))


def split_heading(rest: str, following: str) -> tuple[str, str]:
    """Separate a rule's heading from its operative text.

    ``rest`` is what followed the number on its own line; ``following`` is
    everything after. Documents that put the number alone on a line (the DoPT
    rule books do it constantly) hand an empty ``rest``, and the heading is then
    the first line of ``following``.
    """
    body = rest.strip()
    tail = following

    if not body:
        lines = following.split("\n", 1)
        body = lines[0].strip()
        tail = lines[1] if len(lines) > 1 else ""

    # A heading that wrapped. "1. Short title, extent and" / "application. (1)
    # This Act may be called..." is one heading printed over two lines, and
    # taking only the first gave the Official Secrets Act a Section 1 headed
    # "Short title, extent and". If the first line ends in nothing that could
    # terminate a heading, the next line is offered to the matcher too.
    if body and not _HEADING_END.match(body) and len(body) <= 90 and _looks_unfinished(body):
        lines = tail.split("\n")
        # The next line with something on it — a PDF's text layer puts one to
        # four empty lines between a wrapped heading and its continuation, and
        # looking only at ``lines[0]`` found a blank every time and gave up.
        index = next((i for i, line in enumerate(lines) if line.strip()), None)
        if index is not None:
            body = f"{body} {lines[index].strip()}"
            tail = "\n".join(lines[index + 1 :])

    # A number that opens a sub-rule has no heading of its own.
    if body.startswith("("):
        return "", clean_text(" ".join([body, tail]))

    match = _HEADING_END.match(body)
    if match:
        heading = strip_fused_footnote(clean_text(match.group("heading")))
        remainder = body[match.end() :]
        if heading and len(heading) <= MAX_HEADING:
            return heading, clean_text(" ".join([remainder, tail]))

    # No terminator: a short line on its own is a heading, a long one is text.
    if len(body) <= 90 and not body.endswith(","):
        return strip_fused_footnote(clean_text(body)), clean_text(tail)
    return "", clean_text(" ".join([body, tail]))


_SUB_RULE = re.compile(r"(?<![\w(])\((?P<label>\d{1,2}|[a-z]{1,2}|[ivx]{1,6})\)\s")


def split_sub_rules(number: str, text: str) -> list[dict[str, str]]:
    """Numbered sub-rules — ``(1)``, ``(2)`` — as records of their own.

    Only the numeric level is split. Lettered and roman clauses are left inside
    their sub-rule, because ``(a)`` under ``(1)`` and ``(a)`` under ``(2)`` are
    different things and flattening them makes ``3(a)`` ambiguous.
    """
    marks = [m for m in _SUB_RULE.finditer(text) if m.group("label").isdigit()]
    if len(marks) < 2:
        return []

    expected = 1
    accepted: list[re.Match[str]] = []
    for mark in marks:
        if int(mark.group("label")) == expected:
            accepted.append(mark)
            expected += 1
    if len(accepted) < 2:
        return []

    out: list[dict[str, str]] = []
    for index, mark in enumerate(accepted):
        end = accepted[index + 1].start() if index + 1 < len(accepted) else len(text)
        body = clean_text(text[mark.end() : end])
        if body:
            out.append({"number": f"{number}({mark.group('label')})", "text": body})
    return out


# ---------------------------------------------------------------------------
# The sequence walk
# ---------------------------------------------------------------------------


def _numeric(number: str) -> tuple[float, str]:
    """Sort key for a rule number that may be "11", "11A" or "5.2"."""
    match = re.match(r"^(\d+)(?:\.(\d+))?\s?([A-Z]*)$", number)
    if not match:
        return (float("inf"), number)
    major = int(match.group(1))
    minor = int(match.group(2)) if match.group(2) else 0
    return (major + minor / 1000, match.group(3))


@dataclass(frozen=True)
class Candidate:
    """A place in the text that might begin a rule.

    ``numbers`` is every reading of the digits found there, longest first. A
    footnote marker sits flush against the rule number it precedes in most of
    these documents, so the line that begins Rule 8 of the Conduct rules reads
    ``348.`` — footnote 34, then the rule. Rather than guess, the candidate
    offers ``348``, ``48`` and ``8``, and the sequence walk takes whichever one
    continues the rule sequence. That is the only reading that can be checked.
    """

    offset: int
    end: int
    numbers: tuple[str, ...]
    rest: str


_LEADING_FOOTNOTE = re.compile(r"^\d")


def readings(number: str, *, line_continues: bool = True) -> tuple[str, ...]:
    """Every way to read a possibly footnote-prefixed rule number, longest first.

    ``"348"`` → ``("348", "48", "8")``. ``"3A"`` → ``("3A",)``: a suffixed rule
    number has nothing to trim, because trimming it would turn Rule 3A into
    Rule A. A decimal paragraph number is likewise left alone.

    ``line_continues`` is False when the number is alone on its line, and then
    **nothing is trimmed**. A footnote marker fuses onto a rule number only
    where the two are adjacent in running text, which means the line goes on to
    say something. A number sitting by itself is a rule marker or it is
    apparatus — and the Leave rules end a sentence with the bare line "1972.",
    which trimmed to "2" and became Rule 2, carrying Rule 1's second sub-rule
    with it.
    """
    if "." in number or not number[:1].isdigit():
        return (number,)
    if not line_continues:
        return (number,)
    # Only a run of three digits or more is treated as carrying a footnote
    # prefix. Trimming two digits is where every false positive came from: the
    # RTI Act's arrangement-of-sections page lists "31. Repeal.", which trimmed
    # to "1" and became a Section 1 headed "Repeal" whose text was the table of
    # contents. A footnote marker fused to a rule number makes at least three
    # digits in every case in these twelve books.
    if len(re.match(r"^\d+", number).group(0)) < 3:  # type: ignore[union-attr]
        return (number,)
    digits = re.match(r"^(\d+)(.*)$", number)
    if not digits:
        return (number,)
    body, suffix = digits.group(1), digits.group(2)
    # The number as printed is ALWAYS offered, however it is spelled. Only the
    # *trimmed* readings skip a leading zero — "1000" must not offer "000", and
    # dropping the full reading too (which the leading-zero filter used to do
    # for "007") would leave a candidate the walk could not read at all.
    trimmed = [f"{body[i:]}{suffix}" for i in range(1, len(body)) if body[i] != "0"]
    return (f"{body}{suffix}", *trimmed)


def _walk_from(
    candidates: list[Candidate], start: int, *, max_rule: int | None, major_jump: int | None
) -> list[tuple[Candidate, str]]:
    """The increasing chain that begins at ``candidates[start]``."""
    first_number = candidates[start].numbers[-1]
    accepted: list[tuple[Candidate, str]] = [(candidates[start], first_number)]
    last = _numeric(first_number)

    for candidate in candidates[start + 1 :]:
        # Prefer the shortest reading that still advances the sequence: a
        # footnote prefix is noise, so the smallest number that works is the
        # rule. Taking the longest instead lets "348" end the walk at 348.
        options = sorted(
            (
                (_numeric(n), n)
                for n in candidate.numbers
                if _numeric(n)[0] != float("inf")
                and (max_rule is None or _numeric(n)[0] <= max_rule + 0.999)
                and _numeric(n) > last
                and (major_jump is None or int(_numeric(n)[0]) - int(last[0]) <= major_jump)
            ),
        )
        if not options:
            continue
        key, number = options[0]
        accepted.append((candidate, number))
        last = key
    return accepted


# How much text a rule must be followed by before it counts as a real rule
# rather than a line in a table. Chosen well below the shortest operative rule
# in any of these twelve books (RTI s.31, "Repeal", is 150 characters) and well
# above the longest amendment-history entry ("S.O. 2859, dated the 30th
# September, 1978" is 45).
MIN_BODY = 120


def _chain_score(chain: list[tuple[Candidate, str]], end_of_text: int) -> tuple[int, int, int]:
    """Rank a candidate chain: substantive rules first, then span, then position.

    Counting members alone is not enough, and assuming it was produced a
    complete-looking parse of the wrong thing. The Conduct rule book ends with
    its amendment history — twenty-five numbered one-line entries reading "S.O.
    2859, dated the 30th September, 1978" — which is a longer increasing
    sequence than the twenty-four rules the parser managed to chain through the
    body. So a member only counts if it is **followed by a rule's worth of
    text**. An amendment table scores zero; a rule book scores its rule count.
    """
    substantive = 0
    for index, (candidate, _) in enumerate(chain):
        stop = chain[index + 1][0].offset if index + 1 < len(chain) else end_of_text
        if stop - candidate.end >= MIN_BODY:
            substantive += 1
    span = (chain[-1][0].offset - chain[0][0].offset) if chain else 0
    return (substantive, span, -chain[0][0].offset if chain else 0)


def walk_sequence(
    candidates: list[Candidate],
    *,
    first: str,
    max_rule: int | None,
    major_jump: int | None = None,
    end_of_text: int = 0,
) -> list[tuple[Candidate, str]]:
    """Keep only the candidates that form an increasing rule sequence.

    A candidate is a rule only if one of its readings sorts after the last one
    accepted and is within ``max_rule``; everything else — list items, the
    numbered paragraphs of a Government of India decision, a page number that
    ran into a sentence — is dropped.

    The **starting point is searched, not assumed.** Taking the first candidate
    numbered ``1`` looks obvious and is wrong in two of these twelve documents:
    the DoPT Conduct rule book prints its amendment history as a numbered list
    of S.O. and G.S.R. notifications, and the Leave rule book ends with a leave
    application form whose twelve numbered boxes are a perfectly good increasing
    sequence. Both produced a plausible, complete-looking, entirely wrong parse.
    So every candidate that can be read as ``first`` is tried as a starting
    point and the **longest** chain wins, earliest position breaking a tie — the
    real rule sequence is the longest one in the document by a wide margin.
    """
    starts = [i for i, c in enumerate(candidates) if first in c.numbers]
    if not starts:
        return []
    chains = [_walk_from(candidates, i, max_rule=max_rule, major_jump=major_jump) for i in starts]
    return max(chains, key=lambda chain: _chain_score(chain, end_of_text))


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

# Nothing, or a rule marker: what may legitimately sit between the start of a
# line and a ``body_from`` anchor written against heading text.
_MARKER_PREFIX = re.compile(r"^\s*(?:\d{1,4}\s*[-\u2013]?\s?[A-Z]{0,2}\s*\.?\s*)?$")
_OPENS_MID_SUBRULE = re.compile(r"^\(\s*(?!1\s*\))\d{1,2}\s*\)")
_FOOTNOTE_RUN = re.compile(r"-{6,}")
_STAR_FOOTNOTE = re.compile(r"\s*\d+\*?\[")


def tidy_body(text: str) -> str:
    """Remove the footnote furniture the bare Acts interleave with their text."""
    text = _FOOTNOTE_RUN.sub(" ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


@dataclass
class ActExtraction:
    act: Act
    rules: list[dict[str, Any]] = field(default_factory=list)
    dropped_furniture: list[str] = field(default_factory=list)
    candidates: int = 0
    notes: list[str] = field(default_factory=list)


def extract_act(config: ParseConfig) -> ActExtraction:
    act = ACTS_BY_ID[config.act_id]
    path = SOURCES_DIR / config.file
    if not path.exists():
        raise FileNotFoundError(f"{path} — run fetch_sources.py first")

    extraction = read_html(path) if config.kind == "html" else read_pdf(path, reader=config.reader)
    text, furniture = strip_furniture(extraction.pages, config.drop_lines)

    if config.body_from:
        match = config.body_from.search(text)
        if match:
            # Cut at the start of the line the anchor is on — but only when
            # what precedes the anchor on that line is the rule marker itself.
            #
            # Two documents pull in opposite directions here. The 1976 Rules
            # print "1. Short title, extent and commencement", and an anchor
            # written against the heading swallowed the "1." in front of it, so
            # the walk started at a nested list two rules later and every rule
            # came out with the wrong number. The Official Secrets Act runs its
            # first section into the enacting formula — "It is hereby enacted as
            # follows.- 4*[1.Short title..." — where keeping the line start
            # leaves a sentence in front of the marker and the line-anchored
            # pattern cannot match it at all.
            line_start = text.rfind("\n", 0, match.start()) + 1
            prefix = text[line_start : match.start()]
            text = text[line_start:] if _MARKER_PREFIX.match(prefix) else text[match.start() :]
    if config.body_to:
        match = config.body_to.search(text)
        if match:
            text = text[: match.start()]

    candidates: list[Candidate] = []
    for match in config.start.finditer(text):
        number = normalise_rule_number(match.group("num"))
        rest = match.group("rest")
        if _OPENS_MID_SUBRULE.match(rest.strip()):
            # A rule's own sub-rules always start at "(1)". A line that begins
            # "(2)" or "(6)" is the continuation of the rule above it, and the
            # digits before it are a year or a page number, not a rule number —
            # "...Central Civil Services (Pension) Rules, 2021" wrapping onto
            # "(2) They shall come into force" read as Rule 21 and truncated
            # the Pension rules from seventy-six records to eighteen.
            continue
        candidates.append(
            Candidate(
                offset=match.start(),
                end=match.end(),
                numbers=readings(number, line_continues=bool(rest.strip())),
                rest=rest,
            )
        )

    accepted = walk_sequence(
        candidates,
        first=config.first,
        max_rule=act.max_rule,
        major_jump=config.major_jump,
        end_of_text=len(text),
    )

    out = ActExtraction(act=act, dropped_furniture=furniture, candidates=len(candidates))
    for index, (candidate, number) in enumerate(accepted):
        rest = candidate.rest
        end = accepted[index + 1][0].offset if index + 1 < len(accepted) else len(text)
        # From the END of the matched line, not from ``offset + len(rest)``.
        # ``offset`` is the start of the whole line — number, leading spaces and
        # all — so adding the length of ``rest`` landed a dozen characters short
        # and every rule's text began mid-word: "rugs A Government servant"
        # under a heading that had just said "...drinks and drugs".
        following = text[candidate.end : end]
        heading, body = split_heading(rest, following)
        if not config.has_headings:
            heading, body = "", clean_text(f"{rest} {following}")
        body = tidy_body(body)
        if not body and not heading:
            continue
        printed = config.number_format.format(number)
        slug = re.sub(r"[^a-z0-9]+", "-", printed.lower()).strip("-")
        record: dict[str, Any] = {
            "id": f"{act.id}-{slug}",
            "number": printed,
            "heading": {"en": heading, "hi": ""},
            "text": {"en": body, "hi": ""},
        }
        sub = split_sub_rules(printed, body)
        if sub:
            record["subRules"] = [{"number": s["number"], "text": {"en": s["text"], "hi": ""}} for s in sub]
        out.rules.append(record)

    # Deliberately NOT re-sorted. The sequence walk accepted these in document
    # order and that order is already correct — including for a compilation
    # whose second half restarts at 1 ("F.R. 66" then "S.R. 1"), where sorting
    # on the number would interleave two rule sets that a reader thinks of as
    # separate books. ``rule_sort_key`` is still what the trainer sorts one
    # act's rules by when it needs to.
    return out


def audit_hindi() -> list[dict[str, Any]]:
    """Measure every Hindi document's text layer and say whether it is usable.

    THREE tests, and a document has to pass all three:

    1. overwhelmingly Devanagari (``devanagariRatio``);
    2. almost no letters from outside that block (``foreignLetters``) — the
       legacy maps that reach for Latin-1, or for Vedic and Ol Chiki as the RTI
       Act's does;
    3. almost no token BEGINNING with a matra (``visualOrderShare``).

    The third test was missing and two documents passed without it. A font that
    maps Devanagari glyphs onto REAL Devanagari codepoints, in the order they
    are DRAWN rather than the order they are spoken, satisfies both of the
    first two tests and still yields `हकया` for `किया`. `csmop-hi.pdf` and
    `ol-act-hi.pdf` were both reported "usable" on that basis — and
    docs/DATA-GAPS.md #36 has recorded CSMOP's Hindi text layer as unreadable
    since Session 8, so the audit was contradicting a finding this repository
    had already written down. Measured now: CSMOP 3.2 per cent of tokens
    matra-initial, the OL Act 4.5, DoPT's CCA rules 18.0, and this project's own
    authored Hindi 0.0.
    """
    manifest = read_json(SOURCES_DIR / "_manifest.json", default={"documents": []})
    rows: list[dict[str, Any]] = []
    for entry in manifest["documents"]:
        if entry["lang"] != "hi" or entry["status"] != "ok":
            continue
        path = SOURCES_DIR / entry["file"]
        if not path.exists():
            continue
        text = (read_html(path) if entry["kind"] == "html" else read_pdf(path)).text
        letters = [c for c in text if c.isalpha()]
        foreign = Counter(c for c in letters if not c.isascii() and not ("ऀ" <= c <= "ॿ"))
        rows.append(
            {
                "file": entry["file"],
                "act": entry["act"],
                "characters": len(text),
                "devanagariRatio": round(devanagari_ratio(text), 3),
                "foreignLetters": sum(foreign.values()),
                "worstOffenders": [
                    {"char": c, "codepoint": f"U+{ord(c):04X}", "count": n} for c, n in foreign.most_common(5)
                ],
                "visualOrderShare": round(visual_order_share(text), 4),
                # All three, because each catches a different pipeline and any
                # one of them passing alone is what let a broken document
                # through. The 0.5 per cent floor on the third is generous:
                # clean text measures 0.
                "usable": (
                    len(text) > 0
                    and sum(foreign.values()) < len(letters) * 0.001
                    and visual_order_share(text) < 0.005
                ),
            }
        )
    return rows


def build_payload(extraction: ActExtraction) -> dict[str, Any]:
    act = extraction.act
    return {
        "$schema": "../../../schemas/rules-text.schema.json",
        "version": VERSION,
        "generatedAt": utc_now()[:10],
        "act": {
            "id": act.id,
            "name": {"en": act.name_en, "hi": act.name_hi},
            "short": {"en": act.short_en, "hi": act.short_hi},
            "unit": {"en": act.unit_en, "hi": act.unit_hi},
            "publisher": act.publisher,
        },
        "hindiTextExtractable": False,
        "hindiNote": {
            "en": (
                "The Ministry's Hindi issue of this rule book is typeset from a legacy font, so its "
                "text layer cannot be read. Hindi in this app is authored, not extracted, and is "
                "marked for verification."
            ),
            "hi": (
                "इस नियम पुस्तिका का मंत्रालय द्वारा प्रकाशित हिंदी संस्करण पुरानी फ़ॉन्ट प्रणाली में "
                "टंकित है, अतः उसका पाठ-स्तर पढ़ा नहीं जा सकता। इस ऐप की हिंदी लिखी गई है, निकाली "
                "नहीं गई, और सत्यापन हेतु चिह्नित है।"
            ),
        },
        "disclaimer": DISCLAIMER,
        "source": source_of(act, "en"),
        "rules": extraction.rules,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--act", action="append", help="only this act id (repeatable)")
    parser.add_argument("--check", action="store_true", help="re-derive and compare; write nothing")
    parser.add_argument("--show", action="store_true", help="print every rule number and heading")
    parser.add_argument("--audit-hindi", action="store_true", help="measure the Hindi text layers")
    args = parser.parse_args()

    if args.audit_hindi:
        rows = audit_hindi()
        for row in rows:
            verdict = "usable" if row["usable"] else "UNUSABLE"
            log(
                f"{row['file']:<22} {verdict:<9} chars={row['characters']:<8} "
                f"deva={row['devanagariRatio']:<6} foreign={row['foreignLetters']:<7} "
                f"visual-order={row['visualOrderShare']:.1%}"
            )
            for bad in row["worstOffenders"]:
                log(f"      {bad['char']!r} {bad['codepoint']} x{bad['count']}")
        # Committed, so the next session can read the answer instead of
        # re-fetching ~90 MB of PDFs to rediscover it. `sources/` itself is
        # git-ignored (it would put a copy of the rule books in the repository
        # rather than a citation to them), so this report is the only durable
        # record that the measurement was made and what it said.
        report_path = REPO_ROOT / "scripts" / "ingest" / "reports" / "hindi-text-layers.json"
        changed, _digest = write_json(
            report_path,
            {
                "generatedAt": utc_now()[:10],
                "what": (
                    "Whether each fetched Hindi source has a text layer that can be read. A document "
                    "must pass all three tests to be usable; see audit_hindi(). Scope is the RULE "
                    "BOOKS in scripts/authoring/sources/_manifest.json. The three Sanhitas are the "
                    "law pipeline's and are not fetched here — MHA publishes Hindi PDFs of all three "
                    "and all three fail the same way; the URLs and per-document figures are in "
                    "docs/DATA-GAPS.md #16."
                ),
                "documents": rows,
            },
        )
        log(f"{'wrote' if changed else 'same '} {report_path}")
        return 0

    by_act: dict[str, list[ParseConfig]] = {}
    for config in PARSERS:
        by_act.setdefault(config.act_id, []).append(config)

    wanted = set(args.act or list(by_act))
    unknown = wanted - set(by_act)
    if unknown:
        log(f"! no parser for: {', '.join(sorted(unknown))}")
        return 1

    failures = 0
    for act_id, configs in by_act.items():
        if act_id not in wanted:
            continue
        # An act may be parsed by more than one config — the FR/SR compilation
        # is two rule sets in one file — and their records concatenate in
        # document order.
        extraction = extract_act(configs[0])
        for extra in configs[1:]:
            more = extract_act(extra)
            extraction.rules.extend(more.rules)
            extraction.candidates += more.candidates
            extraction.dropped_furniture = sorted(
                set(extraction.dropped_furniture) | set(more.dropped_furniture)
            )
        payload = build_payload(extraction)
        try:
            validate(payload, "rules-text.schema.json")
        except Exception as error:  # noqa: BLE001 — the message is the report
            log(f"  ! {act_id}: {error}")
            failures += 1
            continue

        target = RULES_TEXT_DIR / f"{act_id}.json"
        sub_count = sum(len(r.get("subRules", [])) for r in extraction.rules)
        if args.check:
            existing = read_json(target)
            same = existing == payload
            log(
                f"  {'ok' if same else '!!'} {act_id}: {len(extraction.rules)} rules, "
                f"{sub_count} sub-rules ({extraction.candidates} candidates)"
            )
            failures += 0 if same else 1
        else:
            changed, _ = write_json(target, payload)
            log(
                f"  {'wrote' if changed else 'same '} data/rules/text/{act_id}.json — "
                f"{len(extraction.rules)} rules, {sub_count} sub-rules "
                f"({extraction.candidates} candidates)"
            )

        if args.show:
            for rule in extraction.rules:
                heading = rule["heading"]["en"] or "(no heading)"
                log(f"      {rule['number']:>7}  {heading[:78]}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
