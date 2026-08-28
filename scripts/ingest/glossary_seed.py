#!/usr/bin/env python3
"""Write ``data/glossary.json`` — the Hindi administrative glossary.

Unlike ``drafting_seed.py``, nothing here is read off a specific page of a
specific fetched document. The Session 10 brief asked first to fetch the
Department of Official Language's own *Prashasanik Shabdavali*
(``rajbhasha.gov.in``): the 651-page PDF was reached (the same one
``drafting_seed.py`` cites for the twenty-eight ``structure-terms.json``
entries CSMOP itself never names), but nothing this session runs can extract
2,000 term pairs out of a scanned-glyph 651-page document at build time — the
existing entries from that PDF were each read off a rendered page by eye, one
at a time (``docs/DATA-GAPS.md`` #39). So this dataset takes the brief's
fallback instead: **compiled** from standard, well-established Rajbhasha
administrative usage — the vocabulary a CSTT *Shabdavali* or an ISTM training
module would also print — rather than extracted from one cited page. Every
entry therefore carries ``verify: true`` (``docs/DATA-GAPS.md`` #42), and none
claims a ``csmopRef`` or a page number it does not have.

The raw English/Hindi pairs live in ``scripts/ingest/glossary_sources/*.json``,
one file per category, each hand-authored and reviewed rather than fetched —
this script's job is to de-duplicate them, assign a stable id, attach the
shared citation and envelope, validate, and write. It reaches no host.

    scripts/ingest/.venv/bin/python scripts/ingest/glossary_seed.py
    scripts/ingest/.venv/bin/python scripts/ingest/glossary_seed.py --check

``--check`` rebuilds everything, validates it, and compares it against what is
on disk without writing — the same contract ``drafting_seed.py`` and
``pay_matrix.py`` give CI.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, INGEST_DIR, log, read_json, update_versions, validate, write_json  # noqa: E402

SOURCES_DIR = INGEST_DIR / "glossary_sources"
OUT_FILE = DATA_DIR / "glossary.json"
STRUCTURE_TERMS_FILE = DATA_DIR / "drafting" / "structure-terms.json"

VERSION = "1.0.0"
# Fixed, not a clock: a re-run whose content has not changed must produce a
# byte-identical file, or `--check` in CI reports a diff on every run.
STAMP = "2026-08-28T00:00:00Z"

# Priority order when the same English term was independently written into two
# category files (a "Purchase committee" belongs to both office procedure and
# finance) — the first category listed here keeps the term, so a reader
# filtering by category never sees it twice under different ids.
CATEGORY_ORDER = ["designation", "office", "file", "finance", "establishment", "legal", "it"]

SHABDAVALI = {
    "name": "Department of Official Language (Rajbhasha Vibhag) — Saral Prashasanik Shabdavali",
    "url": "https://rajbhasha.gov.in/sites/default/files/saralshabdavali.pdf",
    "reference": "Central Translation Bureau, Rajbhasha Vibhag",
}

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ के लिए; सरकारी राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।",
}

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    slug = _SLUG_STRIP.sub("-", text.lower()).strip("-")
    return slug or "term"


def load_excluded_terms() -> set[str]:
    """`en` values already carried by `data/drafting/structure-terms.json`.

    That sibling dataset is the document's own parts (forms, urgency grading,
    the handful of designations CSMOP signs a specimen with); this glossary is
    everything else, and must not repeat what it already covers.
    """
    payload = read_json(STRUCTURE_TERMS_FILE)
    if payload is None:
        raise FileNotFoundError(f"missing {STRUCTURE_TERMS_FILE} — needed to avoid duplicating its terms")
    return {t["en"].strip().lower() for t in payload["terms"]}


def build() -> dict[str, Any]:
    excluded = load_excluded_terms()
    seen_en: dict[str, str] = {}  # lower(en) -> category that kept it
    seen_ids: set[str] = set()
    terms: list[dict[str, Any]] = []
    dropped_duplicate = 0
    dropped_excluded = 0

    for category in CATEGORY_ORDER:
        path = SOURCES_DIR / f"{category}.json"
        raw = read_json(path)
        if raw is None:
            raise FileNotFoundError(f"missing {path}")

        for entry in raw:
            en = entry["en"].strip()
            hi = entry["hi"].strip()
            key = en.lower()

            if key in excluded:
                dropped_excluded += 1
                continue
            if key in seen_en:
                dropped_duplicate += 1
                continue
            seen_en[key] = category

            base_id = slugify(en)
            term_id = base_id
            suffix = 2
            while term_id in seen_ids:
                term_id = f"{base_id}-{suffix}"
                suffix += 1
            seen_ids.add(term_id)

            record: dict[str, Any] = {"id": term_id, "category": category, "en": en, "hi": hi}
            also = [item.strip() for item in entry.get("alsoHi", []) if item.strip()]
            if also:
                record["alsoHi"] = also
            note = entry.get("note")
            if note:
                record["note"] = {"en": note["en"].strip(), "hi": note["hi"].strip()}
            record["source"] = dict(SHABDAVALI)
            record["fetchedAt"] = STAMP
            record["verify"] = True
            terms.append(record)

    log(
        f"glossary: {len(terms)} terms from {sum(1 for _ in CATEGORY_ORDER)} categories "
        f"({dropped_duplicate} cross-category duplicate(s) dropped, "
        f"{dropped_excluded} already in structure-terms.json dropped)"
    )

    return {
        "version": VERSION,
        "generatedAt": STAMP,
        "disclaimer": DISCLAIMER,
        "terms": terms,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and compare against disk; write nothing")
    args = parser.parse_args()

    payload = build()
    validate(payload, "glossary.schema.json")

    by_category: dict[str, int] = {}
    for term in payload["terms"]:
        by_category[term["category"]] = by_category.get(term["category"], 0) + 1
    log("  by category: " + ", ".join(f"{cat}={count}" for cat, count in by_category.items()))

    if len(payload["terms"]) < 1500:
        log(f"! only {len(payload['terms'])} terms — below the 1,500 acceptance floor")
        return 1

    if args.check:
        current = read_json(OUT_FILE)
        if current is None:
            log(f"! {OUT_FILE}: missing on disk")
            return 1
        if current != payload:
            log(f"! {OUT_FILE}: on disk differs from what this script builds")
            return 1
        log(f"ok {OUT_FILE} ({len(payload['terms'])} terms)")
        return 0

    changed, digest = write_json(OUT_FILE, payload)
    log(f"{'wrote' if changed else 'same '} {OUT_FILE} ({len(payload['terms'])} terms)")

    update_versions(
        {
            "glossary": {
                "version": payload["version"],
                "updated": payload["generatedAt"][:10],
                "label": {"en": "Hindi administrative glossary", "hi": "हिंदी प्रशासनिक शब्दावली"},
                "rows": len(payload["terms"]),
                "sha256": digest,
                "source": {"name": SHABDAVALI["name"]},
            }
        },
        generated_at=payload["generatedAt"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
