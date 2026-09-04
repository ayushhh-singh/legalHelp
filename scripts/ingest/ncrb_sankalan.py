#!/usr/bin/env python3
"""Build ``data/law/{bns,bnss,bsa}.json`` and ``data/law/index.json`` from NCRB Sankalan.

The Sankalan portal is the National Crime Records Bureau's official companion to
the three 2023 criminal laws. Five documents per run carry everything this
module needs:

  SectionTable<CODE>.html   the new-to-old correspondence table, both directions
  Chapters<CODE>.html       the full text of every section, with its heading
  ScheduleBNSS.html         the BNSS First Schedule - cognizable / bailable / triable
  ChaptersBNSS.html         (again) section 359, whose two tables are the
                            compoundable-offence lists
  DownloadPDF/<CODE>2023.pdf  the fallback, used only if the tables ever stop
                            being inline HTML

What this script does *not* do is invent Hindi. NCRB publishes these tables in
English only, and a machine translation of a section heading is a liability in a
tool officers may rely on. Hindi arrives one of two ways: an official Hindi
source (none located yet - ``docs/DATA-GAPS.md``), or a hand-authored overlay
under ``data/law/overlays/`` that says so in its own provenance field. Every
section therefore carries ``{ en, hi }`` with ``hi`` possibly empty, and the run
reports exactly how many are empty.

Usage
    python scripts/ingest/ncrb_sankalan.py [--offline] [--code bns] [--no-write]

``--offline`` reparses the newest archived copy in ``raw/`` instead of fetching,
which is what you want when iterating on the parser.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import (  # noqa: E402
    DATA_DIR,
    LAW_DIR,
    OVERLAY_DIR,
    REPORT_DIR,
    VERSIONS_FILE,
    FetchError,
    SectionRef,
    archive_raw,
    clean_text,
    fetch,
    log,
    normalise_section,
    parse_section_ref,
    read_json,
    section_sort_key,
    tidy_parens,
    update_versions,
    utc_now,
    write_if_content_changed,
    validate,
)

# Bump this whenever a change to the DATA a reader could see moves — not just
# whenever the scraper runs. `sha256`/`fetchedAt` change on every run and say
# nothing about content; this is what src/lib/dataVersion.ts's `DATA_VERSION`
# fingerprint actually keys off, and its own stated job is "an answer grounded
# in one release must not be replayed after that release's data changes."
# 1.0.0 -> 1.1.0: Session 20 extended data/law/overlays/ from 94 curated BNS
# Hindi headings to full coverage of all 1,059 BNS/BNSS/BSA headings, plus
# 1.2.0: the BNSS First Schedule's continuation rows. 24 classification rows
# were being dropped, including the "Second or subsequent conviction" limbs of
# BNS 77 and 78(2), which are NON-bailable where the first conviction is
# bailable — a reader-visible change, and the kind a cached AI answer must be
# invalidated for, which is the only thing this number does.
DATASET_VERSION = "1.2.0"

PRIMARY = "https://www.ncrb.gov.in/uploads/SankalanPortal"
# Documented mirror. It has answered 404 for these paths on every attempt so far
# (see docs/DATA-GAPS.md); it is kept in the list so a future run picks it up
# automatically if NCRB ever publishes there, and so the failure is recorded
# rather than rediscovered.
MIRROR = "https://cytrain.ncrb.gov.in/uploads/SankalanPortal"


def urls_for(document: str) -> list[str]:
    return [f"{PRIMARY}/{document}", f"{MIRROR}/{document}"]


# --------------------------------------------------------------------------
# What each of the three codes is
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class CodeSpec:
    key: str  # "bns"
    new_id: str  # "BNS"
    old_id: str  # "IPC"
    new_year: int
    old_year: int
    max_section: int
    new_name_en: str
    new_name_hi: str
    old_name_en: str
    old_name_hi: str
    table_doc: str
    chapters_doc: str
    pdf_doc: str


CODES: dict[str, CodeSpec] = {
    "bns": CodeSpec(
        key="bns",
        new_id="BNS",
        old_id="IPC",
        new_year=2023,
        old_year=1860,
        max_section=358,
        new_name_en="Bharatiya Nyaya Sanhita, 2023",
        new_name_hi="भारतीय न्याय संहिता, 2023",
        old_name_en="Indian Penal Code, 1860",
        old_name_hi="भारतीय दण्ड संहिता, 1860",
        table_doc="SectionTableBNS.html",
        chapters_doc="ChaptersBNS.html",
        pdf_doc="DownloadPDF/BNS2023.pdf",
    ),
    "bnss": CodeSpec(
        key="bnss",
        new_id="BNSS",
        old_id="CrPC",
        new_year=2023,
        old_year=1973,
        max_section=531,
        new_name_en="Bharatiya Nagarik Suraksha Sanhita, 2023",
        new_name_hi="भारतीय नागरिक सुरक्षा संहिता, 2023",
        old_name_en="Code of Criminal Procedure, 1973",
        old_name_hi="दण्ड प्रक्रिया संहिता, 1973",
        table_doc="SectionTableBNSS.html",
        chapters_doc="ChaptersBNSS.html",
        pdf_doc="DownloadPDF/BNSS2023.pdf",
    ),
    "bsa": CodeSpec(
        key="bsa",
        new_id="BSA",
        old_id="IEA",
        new_year=2023,
        old_year=1872,
        max_section=170,
        new_name_en="Bharatiya Sakshya Adhiniyam, 2023",
        new_name_hi="भारतीय साक्ष्य अधिनियम, 2023",
        old_name_en="Indian Evidence Act, 1872",
        old_name_hi="भारतीय साक्ष्य अधिनियम, 1872",
        table_doc="SectionTableBSA.html",
        chapters_doc="ChaptersBSA.html",
        pdf_doc="DownloadPDF/BSA2023.pdf",
    ),
}

COMMENCEMENT = {
    "date": "2024-07-01",
    "note": {
        "en": (
            "All three Sanhitas came into force on 1 July 2024. An offence committed before that date is "
            "investigated, tried and punished under the repealed Act - see BNSS section 531(2)(a). Always "
            "check the date of the offence before choosing a code."
        ),
        "hi": (
            "तीनों संहिताएँ 1 जुलाई 2024 से प्रवृत्त हुईं। उस तारीख से पहले किए गए अपराध का अन्वेषण, विचारण और "
            "दण्ड निरसित अधिनियम के अधीन ही होगा - देखें बीएनएसएस की धारा 531(2)(क)। संहिता चुनने से पहले "
            "अपराध की तारीख अवश्य देखें।"
        ),
    },
    "source": {
        "name": {
            "en": "MHA notifications S.O. 850(E), 851(E) and 852(E) dated 24 February 2024",
            "hi": "गृह मंत्रालय अधिसूचना एस.ओ. 850(अ), 851(अ) एवं 852(अ), दिनांक 24 फरवरी 2024",
        },
        "url": f"{PRIMARY}/DownloadPDF/GazetteNotificationOfBNS,BNSS,BSA.pdf",
    },
}

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।",
}

# Markers the correspondence table uses in place of a section reference.
NEW_MARKERS = re.compile(r"^new\s+(sub-?)?section$", re.I)
DELETED_MARKER = re.compile(r"^deleted$", re.I)
CHANGE_MARKER = re.compile(r"\(\s*change\s*\)", re.I)
CHAPTER_ROW = re.compile(r"^chapter\b", re.I)
CHAPTER_HEAD = re.compile(r"^CHAPTER\s+([IVXLC]+)\s*$")


# --------------------------------------------------------------------------
# Parsing: the correspondence table
# --------------------------------------------------------------------------


@dataclass
class RawRow:
    """One row of ``SectionTable<CODE>.html``, both cells parsed."""

    new_text: str
    old_texts: list[str]
    new_ref: Any = None
    old_refs: list[Any] = field(default_factory=list)
    is_new_provision: bool = False
    is_deleted: bool = False
    changed: bool = False


def cell_paragraphs(cell: Tag) -> list[str]:
    """The visible lines of a table cell, in order, blanks dropped."""
    paragraphs = [clean_text(p.get_text(" ", strip=True)) for p in cell.find_all("p")]
    if not paragraphs:
        paragraphs = [clean_text(cell.get_text(" ", strip=True))]
    return [p for p in paragraphs if p]


def rows_are_inline(soup: BeautifulSoup) -> bool:
    """Is the mapping actually in the HTML, or injected later by script?

    The portal serves DataTables-driven pages. Today the ``<tbody>`` is rendered
    server-side and DataTables only paginates it, but that is an implementation
    detail of theirs, not a promise. If it ever flips to a JSON/JS payload this
    returns False and the caller falls back to the PDF.
    """
    table = soup.find("table", id="example")
    if not isinstance(table, Tag):
        return False
    body = table.find("tbody")
    return isinstance(body, Tag) and len(body.find_all("tr", recursive=False)) >= 20


def parse_correspondence(soup: BeautifulSoup) -> list[RawRow]:
    table = soup.find("table", id="example")
    if not isinstance(table, Tag):
        raise ValueError("no #example table in the correspondence page")
    body = table.find("tbody")
    if not isinstance(body, Tag):
        raise ValueError("#example has no tbody")

    rows: list[RawRow] = []
    for tr in body.find_all("tr", recursive=False):
        cells = tr.find_all("td", recursive=False)
        if len(cells) != 2:
            continue
        new_lines = cell_paragraphs(cells[0])
        old_lines = cell_paragraphs(cells[1])
        if not new_lines and not old_lines:
            continue
        # Chapter banner rows carry no mapping.
        if new_lines and CHAPTER_ROW.match(new_lines[0]):
            continue

        new_text = " ".join(new_lines)
        row = RawRow(new_text=new_text, old_texts=old_lines)
        row.changed = bool(CHANGE_MARKER.search(new_text))
        row.is_deleted = bool(new_lines) and bool(DELETED_MARKER.match(new_lines[0]))

        if not row.is_deleted:
            # The heading, when present, is the first line; the reference may be
            # on the first line or on the second ("1. Short title..." / "1(1)").
            for line in new_lines:
                candidate = parse_section_ref(strip_markers(line))
                if candidate:
                    row.new_ref = merge_ref(row.new_ref, candidate)
            row.new_ref = row.new_ref

        for line in old_lines:
            if NEW_MARKERS.match(line):
                row.is_new_provision = True
                continue
            ref = parse_section_ref(strip_markers(line))
            if ref:
                row.old_refs.append(ref)

        rows.append(row)
    return rows


def strip_markers(text: str) -> str:
    return CHANGE_MARKER.sub("", text).strip()


def merge_ref(existing: Any, candidate: Any) -> Any:
    """Prefer the most specific reference in a cell, keeping the heading found.

    A first row for a section reads "103. Punishment for murder." then "103(1)";
    the reference we want is the sub-section, the heading we want is from the
    first line.
    """
    if existing is None:
        return candidate
    if existing.base != candidate.base:
        return existing
    # Same base: take the longer (more specific) reference, keep any heading.
    better = candidate if len(candidate.section) > len(existing.section) else existing
    heading = existing.heading or candidate.heading
    return type(better)(raw=better.raw, section=better.section, base=better.base, heading=heading)


# --------------------------------------------------------------------------
# Parsing: full section text and headings
# --------------------------------------------------------------------------


@dataclass
class SectionText:
    heading: str
    text: str
    chapter_number: str
    chapter_title: str
    changed: bool
    is_new: bool


INLINE_HEADING = re.compile(r"^(?P<heading>.{3,160}?)\s*\.\s*[-]\s*(?P<body>\S.*)$", re.S)


def split_heading(span_id: str, paragraphs: list[str]) -> tuple[str, list[str]]:
    """Separate a section's heading from its text.

    Most sections put the heading in its own paragraph and the text in the ones
    that follow. A handful (BSA 25, BNSS 454) run the whole section together in
    a single paragraph that opens with the section number, sometimes as
    "25. Heading. - Text" and sometimes with no heading at all. Treating that
    first paragraph as a heading would put an entire section into the heading
    field, which is what the reader sees first in a search result.
    """
    if not paragraphs:
        return "", []

    numbered = re.match(rf"^{re.escape(span_id)}\s*\.\s*(?P<rest>.*)$", paragraphs[0], re.S)
    if numbered:
        rest = numbered.group("rest").strip()
        inline = INLINE_HEADING.match(rest)
        if inline:
            return inline.group("heading").strip() + ".", [inline.group("body").strip(), *paragraphs[1:]]
        # No heading to find: the whole paragraph is section text.
        return "", [rest, *paragraphs[1:]] if rest else paragraphs[1:]

    body = paragraphs[1:]
    # The first body line usually repeats the section number ("103." alone, or
    # "103." glued to the opening words).
    if body and re.fullmatch(rf"{re.escape(span_id)}\s*\.?", body[0]):
        body = body[1:]
    elif body:
        body[0] = re.sub(rf"^{re.escape(span_id)}\s*\.\s*", "", body[0])
    return paragraphs[0], body


def parse_chapters(soup: BeautifulSoup, max_section: int) -> dict[str, SectionText]:
    """Read ``Chapters<CODE>.html``: one ``<span id="N">`` per section."""
    spans = [
        span
        for span in soup.find_all("span", id=True)
        if re.fullmatch(r"\d{1,4}[A-Z]?", str(span.get("id") or ""))
    ]
    if not spans:
        raise ValueError("no section spans in the chapters page")

    # Chapter banners are plain <p> siblings ahead of the spans, so the walk below
    # goes through one shared parent in document order. That every section span
    # hangs off that parent is an assumption about NCRB's markup, and if it ever
    # stops holding the sections would simply not appear -- the quietest possible
    # failure. Check it instead.
    reachable = {
        str(node.get("id"))
        for node in spans[0].parent.find_all("span", id=True)
        if re.fullmatch(r"\d{1,4}[A-Z]?", str(node.get("id") or ""))
    }
    orphans = sorted({str(span.get("id")) for span in spans} - reachable, key=section_sort_key)
    if orphans:
        raise ValueError(
            f"{len(orphans)} section spans sit outside the container this parser walks "
            f"(first: {orphans[:5]}). The chapters page has changed shape; fix parse_chapters "
            "rather than shipping a dataset with sections missing."
        )

    # Walk the shared parent once and remember the last chapter banner seen.
    chapter_number = ""
    chapter_title = ""
    out: dict[str, SectionText] = {}
    parent = spans[0].parent
    pending_number = ""

    for node in parent.find_all(["p", "span"], recursive=True):
        if node.name == "p":
            text = clean_text(node.get_text(" ", strip=True))
            head = CHAPTER_HEAD.match(text)
            if head:
                pending_number = head.group(1)
                chapter_number, chapter_title = pending_number, ""
                continue
            if pending_number and text and text.isupper() and len(text) < 160:
                chapter_title = text
                pending_number = ""
            continue

        span_id = str(node.get("id") or "")
        if not re.fullmatch(r"\d{1,4}[A-Z]?", span_id) or span_id in out:
            continue
        if not span_id.isdigit() or not (1 <= int(span_id) <= max_section):
            continue

        paragraphs = [clean_text(p.get_text(" ", strip=True)) for p in node.find_all("p")]
        paragraphs = [p for p in paragraphs if p]
        if not paragraphs:
            continue

        raw_heading, body = split_heading(span_id, paragraphs)
        changed = bool(CHANGE_MARKER.search(raw_heading))
        is_new = bool(re.search(r"\(\s*new\b[^)]*\)", raw_heading, re.I))
        heading = re.sub(r"\(\s*(change|new[^)]*)\s*\)", "", raw_heading, flags=re.I).strip()

        out[span_id] = SectionText(
            heading=heading,
            text="\n".join(body).strip(),
            chapter_number=chapter_number,
            chapter_title=chapter_title,
            changed=changed,
            is_new=is_new,
        )

    return out


# --------------------------------------------------------------------------
# Parsing: BNSS First Schedule and the section 359 compounding tables
# --------------------------------------------------------------------------

COGNIZABLE = re.compile(r"\bnon[- ]?cognizable\b", re.I)
BAILABLE = re.compile(r"\bnon[- ]?bailable\b", re.I)


def classify_word(value: str, negative: re.Pattern[str], positive: str, negative_label: str) -> str:
    text = clean_text(value)
    if not text:
        return "unspecified"
    if negative.search(text):
        return negative_label
    if positive in text.lower():
        return positive
    return "depends"


@dataclass
class ScheduleEntry:
    section: str
    base: str
    offence: str
    punishment: str
    cognizable: str
    bailable: str
    triable_by: str


def parse_first_schedule(soup: BeautifulSoup) -> list[ScheduleEntry]:
    """The BNSS First Schedule, part I - offences under the Bharatiya Nyaya Sanhita.

    A row whose section column is EMPTY continues the section above it. The
    Schedule uses that shape for two different things and both are real rows,
    not wrapped text:

      * an aggravated or repeat limb of the same offence - BNS 77 (voyeurism)
        and 78(2) (stalking) each carry a "Second or subsequent conviction"
        row that is **non-bailable** where the first conviction is bailable;
      * a header naming the offence, followed by lettered circumstances that
        carry the punishment - BNS 264 is the only one, and its own row has no
        punishment, cognizable or bailable value at all.

    Reading only the rows that carry a section number dropped 25 classification
    rows, and answered "is this bailable" for a second conviction with the
    first conviction's answer. So the section is carried forward, and a header
    row - recognised by having no punishment AND no cognizable AND no bailable
    value, with a continuation directly beneath it - is not emitted on its own;
    its text becomes the prefix of each circumstance below it, which is the
    only place the offence is actually named.
    """
    tables = soup.find_all("table")
    if not tables:
        raise ValueError("no tables in the schedule page")
    body = tables[0].find("tbody") or tables[0]

    rows: list[list[str]] = []
    for tr in body.find_all("tr", recursive=False):
        cells = [clean_text(td.get_text(" ", strip=True)) for td in tr.find_all("td", recursive=False)]
        if len(cells) >= 6:
            rows.append(cells)

    def is_continuation(cells: list[str]) -> bool:
        return not tidy_parens(cells[0]).strip() and bool(cells[1])

    entries: list[ScheduleEntry] = []
    carried: SectionRef | None = None
    prefix = ""
    for position, cells in enumerate(rows):
        section = tidy_parens(cells[0]).strip()

        if is_continuation(cells):
            # Belongs to the section above. Without one there is nothing to
            # attach it to, so it is dropped exactly as it was before.
            if carried is None:
                continue
            ref, offence = carried, f"{prefix}{cells[1]}" if prefix else cells[1]
        else:
            if not section or section in {"1", "2", "3", "4", "5", "6"} and cells[1] in {"2", "Offence"}:
                continue
            parsed = parse_section_ref(section)
            if not parsed or not cells[1]:
                continue
            carried = parsed
            header = not cells[2].strip() and not cells[3].strip() and not cells[4].strip()
            following = rows[position + 1] if position + 1 < len(rows) else None
            if header and following is not None and is_continuation(following):
                # Names the offence and states nothing about it. Emitting it
                # would put a row on the section's card with every column
                # blank; its text belongs on the circumstances instead.
                prefix = f"{cells[1]} "
                continue
            prefix = ""
            ref, offence = parsed, cells[1]

        entries.append(
            ScheduleEntry(
                section=ref.section,
                base=ref.base,
                offence=offence,
                punishment=cells[2],
                cognizable=classify_word(cells[3], COGNIZABLE, "cognizable", "non-cognizable"),
                bailable=classify_word(cells[4], BAILABLE, "bailable", "non-bailable"),
                triable_by=cells[5],
            )
        )
    return entries


def parse_compounding(soup: BeautifulSoup) -> dict[str, dict[str, Any]]:
    """BNSS section 359: table 1 compoundable freely, table 2 only with the court's leave."""
    anchor = soup.find("span", id="359")
    if not isinstance(anchor, Tag):
        raise ValueError("BNSS section 359 not found")

    tables: list[Tag] = []
    node = anchor
    while len(tables) < 2:
        node = node.find_next_sibling()
        if node is None:
            break
        if isinstance(node, Tag) and node.name == "table":
            tables.append(node)
        if isinstance(node, Tag) and node.get("id"):
            break

    out: dict[str, dict[str, Any]] = {}
    for index, table in enumerate(tables):
        status = "compoundable" if index == 0 else "compoundable-with-court-permission"
        body = table.find("tbody") or table
        for tr in body.find_all("tr", recursive=False):
            cells = [clean_text(td.get_text(" ", strip=True)) for td in tr.find_all("td", recursive=False)]
            if len(cells) < 3:
                continue
            ref = parse_section_ref(tidy_parens(cells[1]))
            if not ref or not cells[0] or cells[0] in {"1", "Offence"}:
                continue
            out[ref.section] = {
                "status": status,
                "offence": cells[0],
                "by": cells[2],
                "source": "BNSS s.359",
            }
    return out


# --------------------------------------------------------------------------
# Keywords
# --------------------------------------------------------------------------

STOPWORDS = {
    "the", "of", "to", "for", "and", "or", "in", "by", "on", "a", "an", "with", "as", "at", "be",
    "is", "any", "such", "etc", "which", "when", "who", "whoever", "shall", "may", "not", "other",
    "case", "cases", "under", "certain", "from", "into", "its", "it", "his", "her", "their", "this",
    "that", "these", "those", "than", "then", "so", "if", "no", "nor", "but", "up", "out", "off",
}


OPENING_CHARS = 320


def keyword_set(heading: str, text: str, lexicon: list[dict[str, Any]]) -> dict[str, list[str]]:
    """English keywords from the heading, plus every lexicon term the section hits.

    Matching is on the heading first and the section text second, so a section
    whose heading says nothing useful ("Punishment for such offences") still
    picks up the vocabulary a reader would actually search for.
    """
    heading_l = heading.lower()
    # Only the opening of the section joins the heading in the match window.
    # Matching the whole text turns a long section - BNS 2, "Definitions", or
    # any section with illustrations - into a magnet for every term in the
    # lexicon, and a keyword list that matches everything ranks nothing.
    haystack = f"{heading_l}\n{text[:OPENING_CHARS].lower()}"

    english = {
        word
        for word in re.findall(r"[a-z][a-z\-']{2,}", heading_l)
        if word not in STOPWORDS and len(word) > 2
    }
    hindi: set[str] = set()
    roman: set[str] = set()

    for term in lexicon:
        needles = term.get("match") or []
        if not any(needle in haystack for needle in needles):
            continue
        english.update(term.get("en", []))
        hindi.update(term.get("hi", []))
        roman.update(term.get("roman", []))

    return {
        "en": sorted(english),
        "hi": sorted(hindi),
        "roman": sorted(roman),
    }


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def bilingual(en: str, hi: str = "") -> dict[str, str]:
    return {"en": en, "hi": hi}


def sentence_case(value: str) -> str:
    """"OF OFFENCES AFFECTING THE HUMAN BODY" -> "Of offences affecting the human body".

    The source shouts its chapter titles. `str.title()` was worse than the
    shouting: it produced "Of Contempts Of The Lawful Authority Of Public
    Servants", capitalising every preposition in a legal heading.
    """
    if not value or not value.isupper():
        return value
    return value[0] + value[1:].lower()


def derive_status(*, has_old: bool, marked_new: bool, changed: bool, new_base: str, old_bases: list[str]) -> str:
    if marked_new or not has_old:
        return "new"
    if changed:
        return "changed"
    if old_bases and all(base == new_base for base in old_bases):
        return "unchanged"
    return "renumbered"


def build_code(
    spec: CodeSpec,
    *,
    rows: list[RawRow],
    texts: dict[str, SectionText],
    schedule: list[ScheduleEntry],
    compounding: dict[str, dict[str, Any]],
    lexicon: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    fetched_at: str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Return (code dataset, reverse-index entries for this code's old Act)."""

    by_section: dict[str, dict[str, Any]] = {}
    reverse: dict[str, dict[str, Any]] = {}

    def ensure(base: str) -> dict[str, Any]:
        if base in by_section:
            return by_section[base]
        info = texts.get(base)
        heading_en = info.heading if info else ""
        record: dict[str, Any] = {
            "section": base,
            "act": spec.new_id,
            "heading": bilingual(heading_en),
            "status": "unchanged",
            "chapter": {
                "number": info.chapter_number if info else "",
                "title": bilingual(sentence_case(info.chapter_title) if info else ""),
            },
            "mappings": [],
            "repeals": [],
            "text": bilingual(info.text if info else ""),
            "classification": [],
            "punishment": bilingual(""),
            "keywords": {"en": [], "hi": [], "roman": []},
            "notes": [],
            "sources": ["ncrb-sankalan-table", "ncrb-sankalan-chapters"],
            "verify": info is None,
        }
        by_section[base] = record
        return record

    # Every section of the new Act exists, whether or not the table names it.
    for number in range(1, spec.max_section + 1):
        ensure(str(number))

    has_counterpart: set[str] = set()
    changed: set[str] = set()
    # old base section -> the exact references NCRB marks "Deleted"
    deleted_refs: dict[str, list[str]] = {}

    for row in rows:
        old_refs = [
            {
                "act": spec.old_id,
                "section": ref.section,
                "base": ref.base,
                "heading": bilingual(ref.heading.rstrip(".") + "." if ref.heading else ""),
            }
            for ref in row.old_refs
        ]

        if row.is_deleted:
            # Record *which reference* was deleted and decide what it means
            # later. Deciding here was wrong: a "Deleted" row for a sub-clause
            # (IEA 65B(3)(a), CrPC 2(t)) would stamp "no corresponding
            # provision" onto the whole section, and IEA 65B both maps to BSA 63
            # and carried a note saying it maps to nothing. Whether a section is
            # gone is only knowable once every row has been read.
            for old in old_refs:
                deleted_refs.setdefault(old["base"], []).append(old["section"])
                entry = reverse.setdefault(
                    old["base"],
                    {"oldAct": spec.old_id, "newAct": spec.new_id, "newSections": [], "status": "omitted",
                     "heading": old["heading"], "note": None},
                )
                if not entry["heading"]["en"] and old["heading"]["en"]:
                    entry["heading"] = old["heading"]
                if old["section"] != old["base"]:
                    reverse.setdefault(
                        old["section"],
                        {"oldAct": spec.old_id, "newAct": spec.new_id, "newSections": [],
                         "status": "omitted", "heading": old["heading"], "note": None},
                    )
            continue

        if row.new_ref is None:
            continue

        record = ensure(row.new_ref.base)
        if row.new_ref.heading and not record["heading"]["en"]:
            record["heading"]["en"] = strip_markers(row.new_ref.heading)
        if row.changed:
            changed.add(row.new_ref.base)
        if old_refs:
            has_counterpart.add(row.new_ref.base)

        mapping = {
            "clause": row.new_ref.section,
            "old": old_refs,
            "isNewProvision": row.is_new_provision and not old_refs,
            "changed": row.changed,
        }
        if mapping not in record["mappings"]:
            record["mappings"].append(mapping)

        for old in old_refs:
            entry = reverse.setdefault(
                old["base"],
                {"oldAct": spec.old_id, "newAct": spec.new_id, "newSections": [], "status": "mapped",
                 "heading": old["heading"], "note": None},
            )
            if not entry["heading"]["en"] and old["heading"]["en"]:
                entry["heading"] = old["heading"]
            if row.new_ref.base not in entry["newSections"]:
                entry["newSections"].append(row.new_ref.base)
            entry["status"] = "mapped"
            if old["section"] != old["base"]:
                exact = reverse.setdefault(
                    old["section"],
                    {"oldAct": spec.old_id, "newAct": spec.new_id, "newSections": [], "status": "mapped",
                     "heading": old["heading"], "note": None},
                )
                if row.new_ref.section not in exact["newSections"]:
                    exact["newSections"].append(row.new_ref.section)
                exact["status"] = "mapped"

    # Now that every row has been read, decide what each "Deleted" row meant.
    for base, refs in deleted_refs.items():
        entry = reverse.get(base)
        if entry is None:
            continue
        whole_section_gone = not entry["newSections"]
        # A deleted row whose reference is the bare section number, on a section
        # that *does* map, is the source writing a sub-clause sloppily -- NCRB
        # spells one of them "65B 5 (b)" rather than "65B(5)(b)", so it parses
        # as plain "65B". Listing it among the dropped parts would have the note
        # say 65B both maps to BSA 63 and is deleted.
        exact = sorted(set(refs), key=section_sort_key)
        specific = [ref for ref in exact if ref != base]

        if whole_section_gone:
            entry["status"] = "omitted"
            entry["note"] = {
                "en": (
                    f"{spec.old_id} section {base} has no corresponding provision in the "
                    f"{spec.new_id}. NCRB's correspondence table marks it \"Deleted\"."
                ),
                "hi": (
                    f"{spec.old_id} की धारा {base} का {spec.new_id} में कोई तत्संगत उपबंध नहीं है। "
                    f"एनसीआरबी की तालिका इसे \"Deleted\" दर्शाती है।"
                ),
            }
        else:
            # The section survives; only parts of it were dropped. Saying so is
            # more useful than either silence or a false "no counterpart".
            targets = ", ".join(entry["newSections"])
            entry["status"] = "mapped"
            if specific:
                dropped = ", ".join(specific)
                entry["note"] = {
                    "en": (
                        f"{spec.old_id} section {base} corresponds to {spec.new_id} {targets}, but NCRB "
                        f"marks {'these parts' if len(specific) > 1 else 'this part'} \"Deleted\", with no "
                        f"counterpart: {dropped}."
                    ),
                    "hi": (
                        f"{spec.old_id} की धारा {base} {spec.new_id} {targets} के तत्संगत है, किंतु एनसीआरबी "
                        f"{'इन भागों' if len(specific) > 1 else 'इस भाग'} को \"Deleted\" दर्शाती है, जिनका "
                        f"कोई तत्संगत उपबंध नहीं है: {dropped}।"
                    ),
                }
            else:
                entry["note"] = {
                    "en": (
                        f"{spec.old_id} section {base} corresponds to {spec.new_id} {targets}. NCRB also "
                        f"marks part of the repealed section \"Deleted\", with no counterpart."
                    ),
                    "hi": (
                        f"{spec.old_id} की धारा {base} {spec.new_id} {targets} के तत्संगत है। एनसीआरबी "
                        f"निरसित धारा के एक भाग को \"Deleted\" भी दर्शाती है, जिसका कोई तत्संगत उपबंध नहीं है।"
                    ),
                }

        for ref in specific:
            sub = reverse.get(ref)
            if sub is None or sub["newSections"]:
                continue
            sub["status"] = "omitted"
            sub["note"] = {
                "en": (
                    f"{spec.old_id} {ref} has no corresponding provision in the {spec.new_id}. "
                    f"NCRB's correspondence table marks it \"Deleted\"."
                ),
                "hi": (
                    f"{spec.old_id} {ref} का {spec.new_id} में कोई तत्संगत उपबंध नहीं है। "
                    f"एनसीआरबी की तालिका इसे \"Deleted\" दर्शाती है।"
                ),
            }

    # Classification and punishment, from the BNSS First Schedule (BNS only).
    for entry in schedule:
        record = by_section.get(entry.base)
        if record is None:
            continue
        compound = compounding.get(entry.section) or compounding.get(entry.base)
        record["classification"].append(
            {
                "clause": entry.section,
                "offence": bilingual(entry.offence),
                "punishment": bilingual(entry.punishment),
                "cognizable": entry.cognizable,
                "bailable": entry.bailable,
                "triableBy": bilingual(entry.triable_by),
                "compoundable": compound["status"] if compound else "non-compoundable",
                "compoundableBy": bilingual(compound["by"]) if compound else bilingual(""),
                "source": "bnss-first-schedule",
            }
        )
        if not record["punishment"]["en"]:
            record["punishment"]["en"] = entry.punishment
        if "bnss-first-schedule" not in record["sources"]:
            record["sources"].append("bnss-first-schedule")

    # Status, keywords, ordering.
    for base, record in by_section.items():
        info = texts.get(base)
        old_bases = [old["base"] for mapping in record["mappings"] for old in mapping["old"]]
        record["repeals"] = sorted(set(old_bases), key=section_sort_key)
        record["status"] = derive_status(
            has_old=base in has_counterpart,
            marked_new=bool(info and info.is_new) and base not in has_counterpart,
            changed=base in changed or bool(info and info.changed),
            new_base=base,
            old_bases=old_bases,
        )
        record["keywords"] = keyword_set(record["heading"]["en"], record["text"]["en"], lexicon)
        record["mappings"].sort(key=lambda m: section_sort_key(m["clause"]))
        record["classification"].sort(key=lambda c: section_sort_key(c["clause"]))

    ordered = {key: by_section[key] for key in sorted(by_section, key=section_sort_key)}

    dataset = {
        "$schema": "../../schemas/law-mapping.schema.json",
        "id": spec.key,
        "version": DATASET_VERSION,
        "fetchedAt": fetched_at,
        "newAct": {
            "id": spec.new_id,
            "year": spec.new_year,
            "name": bilingual(spec.new_name_en, spec.new_name_hi),
        },
        "oldAct": {
            "id": spec.old_id,
            "year": spec.old_year,
            "name": bilingual(spec.old_name_en, spec.old_name_hi),
        },
        "commencement": COMMENCEMENT,
        "disclaimer": DISCLAIMER,
        "sources": sources,
        "counts": {},
        "sections": ordered,
    }
    return dataset, reverse


# --------------------------------------------------------------------------
# Overlays
# --------------------------------------------------------------------------


def apply_overlays(dataset: dict[str, Any], overlays: list[dict[str, Any]]) -> dict[str, int]:
    """Merge hand-curated overlay files over the scraped dataset.

    Overlays are additive and win on conflict, because a human looked at them
    and the scraper did not. The cron never writes to ``data/law/overlays/`` -
    that is the whole point of the split.
    """
    applied: dict[str, Any] = {"sections": 0, "notes": 0, "fields": 0, "missing": []}
    sections = dataset["sections"]

    act = dataset["newAct"]["id"]
    for overlay in overlays:
        if overlay.get("act") and overlay["act"] != act:
            continue
        provenance = overlay.get("provenance", {})
        # An overlay either targets one Act (`act` plus `sections`) or several
        # at once (`actSections`, keyed by Act id). The trap warnings need the
        # second form: the CrPC 438/482 swap is a BNSS fact and the IPC 302
        # swap is a BNS one, but they are one editorial idea and belong in one
        # reviewable file.
        patches: dict[str, Any] = dict(overlay.get("sections") or {})
        patches.update((overlay.get("actSections") or {}).get(act) or {})
        for number, patch in patches.items():
            record = sections.get(normalise_section(number))
            if record is None:
                # A hand-curated patch that matches no section is a typo in the
                # overlay, and silently skipping it means shipping curation the
                # author believes is live. The caller turns this into a failure.
                applied.setdefault("missing", []).append(f"{overlay.get('id', '?')}:{act} {number}")
                continue
            applied["sections"] += 1

            for field_name in ("heading", "text", "punishment"):
                value = patch.get(field_name)
                if not value:
                    continue
                for lang in ("en", "hi"):
                    if value.get(lang):
                        record[field_name][lang] = value[lang]
                        applied["fields"] += 1
                record.setdefault("provenance", {})[field_name] = provenance

            for note in patch.get("notes") or []:
                note = {**note, "source": note.get("source") or overlay.get("source")}
                if note not in record["notes"]:
                    record["notes"].append(note)
                    applied["notes"] += 1

            for extra in patch.get("classification") or []:
                clause = normalise_section(extra.get("clause", record["section"]))
                existing = next((c for c in record["classification"] if c["clause"] == clause), None)
                if existing is None:
                    record["classification"].append({**extra, "clause": clause, "source": "overlay"})
                else:
                    for key, value in extra.items():
                        if key == "clause":
                            continue
                        if isinstance(value, dict) and isinstance(existing.get(key), dict):
                            existing[key] = {**existing[key], **{k: v for k, v in value.items() if v}}
                        elif value:
                            existing[key] = value
                applied["fields"] += 1

            for lang in ("en", "hi", "roman"):
                extra_keywords = (patch.get("keywords") or {}).get(lang) or []
                if extra_keywords:
                    record["keywords"][lang] = sorted(set(record["keywords"][lang]) | set(extra_keywords))

            if patch.get("verify") is not None:
                record["verify"] = bool(patch["verify"])
            if overlay.get("sourceRef") and overlay["sourceRef"] not in record["sources"]:
                record["sources"].append(overlay["sourceRef"])

        if overlay.get("sourceDefinition"):
            if overlay["sourceDefinition"] not in dataset["sources"]:
                dataset["sources"].append(overlay["sourceDefinition"])

    return applied


def load_overlays() -> list[dict[str, Any]]:
    if not OVERLAY_DIR.exists():
        return []
    return [read_json(path) for path in sorted(OVERLAY_DIR.glob("*.json"))]


def apply_index_overlays(index: dict[str, Any], overlays: list[dict[str, Any]]) -> tuple[int, list[str]]:
    applied = 0
    skipped: list[str] = []
    for overlay in overlays:
        for act, entries in (overlay.get("index") or {}).items():
            bucket = index["acts"].get(act)
            if bucket is None:
                # A partial run (--code bns) has no CrPC bucket to patch. Making
                # one would write `newAct: ""` and fail validation with a message
                # that says nothing about the real cause.
                skipped.append(f"{act} ({len(entries)} entries)")
                continue
            for old_section, patch in entries.items():
                entry = bucket["entries"].setdefault(
                    normalise_section(old_section),
                    {"oldAct": act, "newAct": bucket.get("newAct", ""), "newSections": [],
                     "status": "omitted", "heading": {"en": "", "hi": ""}, "note": None},
                )
                for key, value in patch.items():
                    if key == "warnings":
                        entry.setdefault("warnings", [])
                        for warning in value:
                            if warning not in entry["warnings"]:
                                entry["warnings"].append(warning)
                    elif value not in (None, "", [], {}):
                        entry[key] = value
                applied += 1
    for bucket in index["acts"].values():
        bucket["entries"] = {
            key: bucket["entries"][key] for key in sorted(bucket["entries"], key=section_sort_key)
        }
    return applied, skipped


# --------------------------------------------------------------------------
# Gap reporting
# --------------------------------------------------------------------------


def gap_report(datasets: dict[str, dict[str, Any]], index: dict[str, Any]) -> dict[str, Any]:
    report: dict[str, Any] = {"generatedAt": utc_now(), "codes": {}, "totals": {}}
    totals = {"sections": 0, "hindiHeading": 0, "hindiText": 0, "englishText": 0,
              "classification": 0, "punishmentHi": 0, "unmapped": 0}

    for key, dataset in datasets.items():
        sections = dataset["sections"]
        missing_hi_heading = [s for s, r in sections.items() if not r["heading"]["hi"].strip()]
        missing_hi_text = [s for s, r in sections.items() if not r["text"]["hi"].strip()]
        missing_en_text = [s for s, r in sections.items() if not r["text"]["en"].strip()]
        missing_class = [s for s, r in sections.items() if not r["classification"]]
        # Counted at section level: the curated Hindi covers a section's
        # punishment in one string (BNS 318 names all four sub-sections in it),
        # which is what the reader is shown. Per-clause Hindi would be a second,
        # finer gap and is not what this row is claiming to measure.
        missing_pun_hi = [
            s for s, r in sections.items() if r["classification"] and not r["punishment"]["hi"].strip()
        ]
        unmapped = [s for s, r in sections.items() if not r["mappings"]]

        report["codes"][key] = {
            "act": dataset["newAct"]["id"],
            "sections": len(sections),
            "parsePath": dataset["counts"].get("parsePath", "unknown"),
            "classifiedSections": len(sections) - len(missing_class),
            "missingHindiHeading": {"count": len(missing_hi_heading), "sections": missing_hi_heading},
            "missingHindiText": {"count": len(missing_hi_text), "sections": missing_hi_text},
            "missingEnglishText": {"count": len(missing_en_text), "sections": missing_en_text},
            "missingClassification": {"count": len(missing_class), "sections": missing_class},
            "missingHindiPunishment": {"count": len(missing_pun_hi), "sections": missing_pun_hi},
            "noOldCounterpart": {"count": len(unmapped), "sections": unmapped},
        }
        totals["sections"] += len(sections)
        totals["hindiHeading"] += len(missing_hi_heading)
        totals["hindiText"] += len(missing_hi_text)
        totals["englishText"] += len(missing_en_text)
        # Only codes that carry classification at all contribute to these two.
        # Adding the 701 procedural sections that can never be classified would
        # turn a real 70-section gap into a meaningless 771.
        if len(missing_class) < len(sections):
            totals["classification"] += len(missing_class)
            totals["punishmentHi"] += len(missing_pun_hi)
        totals["unmapped"] += len(unmapped)

    omitted = sorted(
        (
            (entry["oldAct"], section)
            for act in index["acts"].values()
            for section, entry in act["entries"].items()
            if entry["status"] == "omitted"
        ),
        key=lambda pair: (pair[0], section_sort_key(pair[1])),
    )
    report["totals"] = totals
    report["omittedOldSections"] = {
        "count": len(omitted),
        "sections": [f"{act} {section}" for act, section in omitted],
    }
    return report


def recount_totals(codes: dict[str, Any]) -> dict[str, int]:
    """Re-derive the totals row after a partial run has been merged with the last one."""
    totals = {"sections": 0, "hindiHeading": 0, "hindiText": 0, "englishText": 0,
              "classification": 0, "punishmentHi": 0, "unmapped": 0}
    for code in codes.values():
        totals["sections"] += code["sections"]
        totals["hindiHeading"] += code["missingHindiHeading"]["count"]
        totals["hindiText"] += code["missingHindiText"]["count"]
        totals["englishText"] += code["missingEnglishText"]["count"]
        totals["unmapped"] += code["noOldCounterpart"]["count"]
        if code["classifiedSections"]:
            totals["classification"] += code["missingClassification"]["count"]
            totals["punishmentHi"] += code["missingHindiPunishment"]["count"]
    return totals


DOC_MARKER_START = "<!-- law-ingest:begin -->"
DOC_MARKER_END = "<!-- law-ingest:end -->"


def render_table(header: list[str], rows: list[list[str]], aligns: list[str]) -> list[str]:
    """Render a Markdown table padded the way Prettier would pad it.

    ``docs/DATA-GAPS.md`` is Prettier-formatted like every other document here,
    and this block is rewritten on every ingest run. Emitting an unpadded table
    would mean `pnpm format` and the ingest script permanently disagreeing, and
    a diff on the file every single week that says nothing about the data.
    """
    widths = [max(len(header[i]), *(len(row[i]) for row in rows)) for i in range(len(header))]

    def line(cells: list[str]) -> str:
        out = []
        for i, cell in enumerate(cells):
            out.append(cell.rjust(widths[i]) if aligns[i] == "right" else cell.ljust(widths[i]))
        return "| " + " | ".join(out) + " |"

    separator = "| " + " | ".join(
        ("-" * (widths[i] - 1) + ":") if aligns[i] == "right" else ("-" * widths[i])
        for i in range(len(header))
    ) + " |"
    return [line(header), separator, *(line(row) for row in rows)]


def render_gap_markdown(report: dict[str, Any]) -> str:
    header = [
        "Code",
        "Sections",
        "Missing Hindi heading",
        "Missing Hindi text",
        "Missing English text",
        "No classification",
        "No Hindi punishment",
        "No counterpart in the old Act",
    ]
    aligns = ["left"] + ["right"] * 7

    rows: list[list[str]] = []
    for key, code in report["codes"].items():
        # The BNSS and the BSA are procedural: no offence in them is classified
        # cognizable or bailable, so "0 missing" would read as "complete" when
        # the right answer is that the column does not apply.
        classified = code["classifiedSections"]
        rows.append(
            [
                f"{code['act']} (`{key}`)",
                str(code["sections"]),
                str(code["missingHindiHeading"]["count"]),
                str(code["missingHindiText"]["count"]),
                str(code["missingEnglishText"]["count"]),
                str(code["missingClassification"]["count"]) if classified else "n/a",
                str(code["missingHindiPunishment"]["count"]) if classified else "n/a",
                str(code["noOldCounterpart"]["count"]),
            ]
        )

    totals = report["totals"]
    rows.append(
        [
            "**All three**",
            f"**{totals['sections']}**",
            f"**{totals['hindiHeading']}**",
            f"**{totals['hindiText']}**",
            f"**{totals['englishText']}**",
            f"**{totals['classification']}**",
            f"**{totals['punishmentHi']}**",
            f"**{totals['unmapped']}**",
        ]
    )

    omitted = report["omittedOldSections"]
    preview = ", ".join(omitted["sections"][:24]) + (", ..." if omitted["count"] > 24 else "")
    paths = ", ".join(f"{code['act']} `{code['parsePath']}`" for code in report["codes"].values())

    return "\n".join(
        [
            DOC_MARKER_START,
            "",
            "### Law dataset coverage - generated by `scripts/ingest/ncrb_sankalan.py`",
            "",
            f"Counted on {report['generatedAt'][:10]} from the run that produced `data/law/*.json`. Do not edit by",
            "hand: the ingest script rewrites everything between the two markers, and it formats this table the",
            "way Prettier would so `pnpm format` and the weekly cron do not fight over it.",
            "",
            *render_table(header, rows, aligns),
            "",
            "The classification columns count only the BNS: cognizable, bailable and compoundable are properties",
            "of offences, and the BNSS and the BSA are procedural.",
            "",
            f"Repealed-Act sections with no counterpart at all (NCRB marks them \"Deleted\"): **{omitted['count']}** -",
            f"{preview}.",
            "",
            f"Parse path taken this run (see `scripts/ingest/README.md`): {paths}. `inline-html` means the",
            "correspondence table's rows were in the HTML, as they have been on every run so far; `pdf` means they",
            "were not, and `pdfplumber` read the bare-act PDF instead.",
            "",
            "The full per-section lists are in `scripts/ingest/reports/law-gaps.json`, which is committed so a",
            "reviewer can diff coverage between runs without re-running the ingest.",
            "",
            DOC_MARKER_END,
        ]
    )


def splice_gaps_doc(markdown: str) -> bool:
    path = DATA_DIR.parent / "docs" / "DATA-GAPS.md"
    text = path.read_text(encoding="utf-8")
    if DOC_MARKER_START in text and DOC_MARKER_END in text:
        head = text[: text.index(DOC_MARKER_START)]
        tail = text[text.index(DOC_MARKER_END) + len(DOC_MARKER_END) :]
        updated = head + markdown + tail
    else:
        updated = text.rstrip() + "\n\n" + markdown + "\n"
    if updated == text:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


# --------------------------------------------------------------------------
# Document acquisition
# --------------------------------------------------------------------------


def newest_raw(name: str) -> Path | None:
    from ingest_common import RAW_DIR

    candidates = sorted(RAW_DIR.glob(f"*__{name}"))
    return candidates[-1] if candidates else None


def acquire(document: str, *, stamp: str, offline: bool) -> tuple[BeautifulSoup, dict[str, Any]]:
    """Fetch (or reload) one HTML document and return it parsed, plus provenance."""
    name = document.replace("/", "_")
    if offline:
        path = newest_raw(name)
        if path is None:
            raise FetchError(f"--offline but nothing archived for {document}")
        meta = read_json(path.with_suffix(path.suffix + ".meta.json"), default={})
        log(f"  offline: {path.name}")
        return BeautifulSoup(path.read_bytes().decode("utf-8-sig", "replace"), "lxml"), meta

    fetched = fetch(urls_for(document))
    archive_raw(name, fetched, stamp=stamp)
    log(f"  fetched {fetched.url} ({len(fetched.content):,} bytes)")
    return BeautifulSoup(fetched.text, "lxml"), {
        "url": fetched.url,
        "fetchedAt": fetched.fetched_at,
        "sha256": fetched.sha256,
        "bytes": len(fetched.content),
    }


def pdf_fallback(spec: CodeSpec, *, stamp: str) -> list[RawRow]:
    """Parse the correspondence table out of the PDF.

    Only reached when the HTML page stops carrying its rows inline. It is kept
    exercised by ``--force-pdf`` rather than left to rot until the day it is
    needed.
    """
    import pdfplumber

    fetched = fetch(urls_for(spec.pdf_doc))
    path = archive_raw(spec.pdf_doc.replace("/", "_"), fetched, stamp=stamp)
    log(f"  PDF fallback: {fetched.url} ({len(fetched.content):,} bytes)")

    rows: list[RawRow] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for cells in table:
                    if not cells or len(cells) < 2:
                        continue
                    new_cell = clean_text(cells[0] or "")
                    old_cell = clean_text(cells[1] or "")
                    if not new_cell and not old_cell:
                        continue
                    if CHAPTER_ROW.match(new_cell):
                        continue
                    row = RawRow(new_text=new_cell, old_texts=[old_cell] if old_cell else [])
                    row.changed = bool(CHANGE_MARKER.search(new_cell))
                    row.is_deleted = bool(DELETED_MARKER.match(new_cell))
                    if not row.is_deleted:
                        row.new_ref = parse_section_ref(strip_markers(new_cell))
                    if NEW_MARKERS.match(old_cell):
                        row.is_new_provision = True
                    else:
                        ref = parse_section_ref(strip_markers(old_cell))
                        if ref:
                            row.old_refs.append(ref)
                    rows.append(row)
    return rows


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def source_entry(sid: str, en: str, hi: str, meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": sid,
        "name": {"en": en, "hi": hi},
        "url": meta.get("url", ""),
        "fetchedAt": meta.get("fetchedAt", ""),
        "sha256": meta.get("sha256", ""),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--code", choices=sorted(CODES), action="append", help="limit to one code (repeatable)")
    parser.add_argument("--offline", action="store_true", help="reparse the newest archive in raw/ instead of fetching")
    parser.add_argument("--force-pdf", action="store_true", help="take the PDF path even if the HTML has inline rows")
    parser.add_argument("--no-write", action="store_true", help="parse and report, write nothing")
    args = parser.parse_args(argv)

    selected = [CODES[key] for key in (args.code or sorted(CODES))]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    fetched_at = utc_now()
    lexicon = (read_json(Path(__file__).resolve().parent / "lexicon.json") or {}).get("terms", [])
    log(f"lexicon: {len(lexicon)} terms")

    overlays = load_overlays()
    log(f"overlays: {len(overlays)} file(s)")

    # The BNSS documents are shared: the First Schedule classifies BNS offences,
    # and BNSS section 359 lists the compoundable ones. Fetch each once.
    log("BNSS First Schedule + section 359 (classification for BNS)")
    schedule_soup, schedule_meta = acquire("ScheduleBNSS.html", stamp=stamp, offline=args.offline)
    schedule = parse_first_schedule(schedule_soup)
    log(f"  first schedule: {len(schedule)} offence rows")

    bnss_chapters_soup, bnss_chapters_meta = acquire("ChaptersBNSS.html", stamp=stamp, offline=args.offline)
    compounding = parse_compounding(bnss_chapters_soup)
    log(f"  compoundable: {len(compounding)} sections")

    datasets: dict[str, dict[str, Any]] = {}
    overlay_misses: list[str] = []
    # A partial run (--code bns) must not publish a shared file built from one
    # code: index.json would lose CrPC and IEA entirely, and the DATA-GAPS table
    # would lose two of its three rows. Both start from what is already on disk
    # and only the codes that actually ran are replaced.
    previous_index = read_json(LAW_DIR / "index.json") or {}
    partial = len(selected) < len(CODES)
    index: dict[str, Any] = {
        "$schema": "../../schemas/law-index.schema.json",
        "version": DATASET_VERSION,
        "generatedAt": fetched_at,
        "disclaimer": DISCLAIMER,
        "acts": {
            act: bucket
            for act, bucket in (previous_index.get("acts") or {}).items()
            if partial and act not in {spec.old_id for spec in selected}
        },
    }
    parse_paths: dict[str, str] = {}

    for spec in selected:
        log(f"{spec.new_id}")
        table_soup, table_meta = acquire(spec.table_doc, stamp=stamp, offline=args.offline)

        inline = rows_are_inline(table_soup)
        if inline and not args.force_pdf:
            rows = parse_correspondence(table_soup)
            parse_paths[spec.key] = "inline-html"
        else:
            reason = "forced" if args.force_pdf else "rows are not inline"
            log(f"  correspondence table: {reason}; taking the PDF path")
            rows = pdf_fallback(spec, stamp=stamp)
            parse_paths[spec.key] = "pdf"
        log(f"  correspondence rows: {len(rows)} ({parse_paths[spec.key]})")

        if spec.key == "bnss":
            chapters_soup, chapters_meta = bnss_chapters_soup, bnss_chapters_meta
        else:
            chapters_soup, chapters_meta = acquire(spec.chapters_doc, stamp=stamp, offline=args.offline)
        texts = parse_chapters(chapters_soup, spec.max_section)
        log(f"  section texts: {len(texts)}")

        sources = [
            source_entry(
                "ncrb-sankalan-table",
                f"NCRB Sankalan — {spec.new_id} / {spec.old_id} correspondence table",
                f"एनसीआरबी संकलन — {spec.new_id}/{spec.old_id} तत्संगत धारा तालिका",
                table_meta,
            ),
            source_entry(
                "ncrb-sankalan-chapters",
                f"NCRB Sankalan — {spec.new_name_en}, chapters and sections",
                f"एनसीआरबी संकलन — {spec.new_name_hi}, अध्याय एवं धाराएँ",
                chapters_meta,
            ),
        ]
        if spec.key == "bns":
            sources += [
                source_entry(
                    "bnss-first-schedule",
                    "BNSS First Schedule — classification of offences under the Bharatiya Nyaya Sanhita",
                    "बीएनएसएस की पहली अनुसूची — भारतीय न्याय संहिता के अपराधों का वर्गीकरण",
                    schedule_meta,
                ),
                source_entry(
                    "bnss-s359-compounding",
                    "BNSS section 359 — compoundable offences",
                    "बीएनएसएस की धारा 359 — शमनीय अपराध",
                    bnss_chapters_meta,
                ),
            ]

        dataset, reverse = build_code(
            spec,
            rows=rows,
            texts=texts,
            schedule=schedule if spec.key == "bns" else [],
            compounding=compounding if spec.key == "bns" else {},
            lexicon=lexicon,
            sources=sources,
            fetched_at=fetched_at,
        )
        applied = apply_overlays(dataset, overlays)
        overlay_misses.extend(applied.pop("missing", []))
        log(f"  overlays applied: {applied}")

        sections = dataset["sections"]
        dataset["counts"] = {
            "sections": len(sections),
            "mappings": sum(len(r["mappings"]) for r in sections.values()),
            "withEnglishHeading": sum(1 for r in sections.values() if r["heading"]["en"]),
            "withHindiHeading": sum(1 for r in sections.values() if r["heading"]["hi"]),
            "withEnglishText": sum(1 for r in sections.values() if r["text"]["en"]),
            "withHindiText": sum(1 for r in sections.values() if r["text"]["hi"]),
            "withClassification": sum(1 for r in sections.values() if r["classification"]),
            "parsePath": parse_paths[spec.key],
        }
        datasets[spec.key] = dataset

        index["acts"][spec.old_id] = {
            "newAct": spec.new_id,
            "oldActName": dataset["oldAct"]["name"],
            "newActName": dataset["newAct"]["name"],
            "entries": {
                key: {**reverse[key], "newSections": sorted(reverse[key]["newSections"], key=section_sort_key)}
                for key in sorted(reverse, key=section_sort_key)
            },
        }

    overlay_index_count, overlay_index_skipped = apply_index_overlays(index, overlays)
    log(f"index overlay entries: {overlay_index_count}")
    if overlay_index_skipped:
        log(f"  skipped (no dataset built this run): {', '.join(overlay_index_skipped)}")

    if overlay_misses:
        raise ValueError(
            "overlay patches matched no section (fix the overlay, or the curation is not live):\n  "
            + "\n  ".join(overlay_misses)
        )

    report = gap_report(datasets, index)
    if partial:
        # Same reasoning: keep the rows this run did not measure.
        previous = read_json(REPORT_DIR / "law-gaps.json") or {}
        merged = {k: v for k, v in (previous.get("codes") or {}).items() if k not in report["codes"]}
        if merged:
            report["codes"] = {**merged, **report["codes"]}
            report["codes"] = {k: report["codes"][k] for k in CODES if k in report["codes"]}
            report["totals"] = recount_totals(report["codes"])
            log(f"partial run: kept the recorded counts for {', '.join(merged)}")

    log(json.dumps(report["totals"], indent=None))

    if args.no_write:
        log("--no-write: nothing written")
        return 0

    digests: dict[str, str] = {}
    changed_files: list[str] = []
    for key, dataset in datasets.items():
        validate(dataset, "law-mapping.schema.json")
        changed, digest = write_if_content_changed(LAW_DIR / f"{key}.json", dataset)
        digests[key] = digest
        if changed:
            changed_files.append(f"data/law/{key}.json")

    validate(index, "law-index.schema.json")
    changed, index_digest = write_if_content_changed(LAW_DIR / "index.json", index)
    if changed:
        changed_files.append("data/law/index.json")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_if_content_changed(REPORT_DIR / "law-gaps.json", report)
    if splice_gaps_doc(render_gap_markdown(report)):
        changed_files.append("docs/DATA-GAPS.md")

    entries: dict[str, dict[str, Any]] = {}
    for key, dataset in datasets.items():
        spec = CODES[key]
        entries[f"law-{key}"] = {
            "version": DATASET_VERSION,
            "updated": fetched_at[:10],
            "label": {
                "en": f"{spec.new_id} ↔ {spec.old_id} mapping",
                "hi": f"{spec.new_id} ↔ {spec.old_id} तत्संगत तालिका",
            },
            "rows": dataset["counts"]["sections"],
            "mappings": dataset["counts"]["mappings"],
            "sha256": digests[key],
            "fetchedAt": fetched_at,
            "parsePath": dataset["counts"]["parsePath"],
            "source": {"name": "NCRB Sankalan", "url": f"{PRIMARY}/{spec.table_doc}"},
        }
    entries["law-index"] = {
        "version": DATASET_VERSION,
        "updated": fetched_at[:10],
        "label": {"en": "Repealed-Act reverse index", "hi": "निरसित अधिनियम व्युत्क्रम अनुक्रमणिका"},
        "rows": sum(len(act["entries"]) for act in index["acts"].values()),
        "sha256": index_digest,
        "fetchedAt": fetched_at,
        "source": {"name": "NCRB Sankalan", "url": f"{PRIMARY}/Index.html"},
    }
    # The same reasoning as write_if_content_changed: a versions entry whose
    # sha256 is unchanged must keep the date it was last actually refreshed on,
    # or `<DataVersion/>` claims a freshness the data does not have.
    existing_versions = (read_json(VERSIONS_FILE) or {}).get("datasets", {})
    for key, entry in entries.items():
        previous = existing_versions.get(key)
        if previous and previous.get("sha256") == entry["sha256"]:
            entries[key] = previous
    if update_versions(entries, generated_at=fetched_at):
        changed_files.append("data/_meta/versions.json")

    log("changed: " + (", ".join(changed_files) if changed_files else "nothing"))
    print("\n".join(changed_files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
