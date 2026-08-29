#!/usr/bin/env python3
"""Watch the Department of Expenditure for a new Dearness Allowance order, and
for HRA/TA/CEA orders worth a human's attention.

This is the one ingest script in this directory that never fully trusts its
own output. Two facts about the source make that the only honest design:

* DoE keeps only the **current** Dearness Allowance order at one fixed path
  (``DA_ORDER_URL`` below) and overwrites it on every revision — the same fact
  ``data/pay/da-history.json``'s own citations already record. There is no
  archive and no listing page to poll, so the "new order" signal here is not
  a new URL appearing; it is the CONTENT at that one URL changing, tracked by
  sha256 in ``data/_meta/seen-orders.json``.
* Most of DoE's own scanned orders carry **no usable text layer at all**.
  ``pdfplumber`` returns an empty string for the two most recent DA orders
  this session fetched to build ``fixtures/pay-orders/`` — see that
  directory's ``SOURCES.md``. CLAUDE.md already says this in terms: "every
  DoE order is a scan, read by rendering and recognising and then checking by
  eye." A CI run has no eye. So a fetched order that cannot be parsed is not
  a failure of this script; it is the expected common case, and the script's
  job is to say so precisely — "Manual review: <order>" — rather than guess
  or silently do nothing.

When a Dearness Allowance order DOES carry parseable text, and it matches the
one sentence shape every notified order in this dataset's own citations uses
("...rate of Dearness Allowance...enhanced from the existing rate of X% to
Y%...with effect from <date>"), this script proposes the update by actually
writing it into ``data/pay/da-history.json`` (schema-validated, versioned),
the same way ``ncrb_sankalan.py`` writes a law refresh for a human to review
in a pull request — never auto-merged, never applied on a date the dataset
already has recorded as notified OR frozen.

HRA, Transport and Children Education Allowance orders are watched too, on
the one DoE page this session found actually links them
(``ALLOWANCES_INDEX_URL``). They only ever produce a **manual-review** item,
never a proposed edit to ``data/pay/allowances.json`` — that dataset has no
single predictable sentence shape the way a Dearness Allowance order does
(32 allowances, each with its own rate structure and conditions), so
guessing at an automatic edit there would be worse than asking a human to
read the order.

    scripts/ingest/.venv/bin/python scripts/ingest/pay_orders.py
    scripts/ingest/.venv/bin/python scripts/ingest/pay_orders.py --check
    scripts/ingest/.venv/bin/python scripts/ingest/pay_orders.py --force

``--check`` fetches and reports but writes nothing, not even the seen-list —
the same contract every other script here gives CI. ``--force`` ignores the
seen-list for this run's reporting only (a fresh seen-list is still written
at the end) — it exists so a manual ``workflow_dispatch`` can demonstrate the
whole pipeline end-to-end without waiting for DoE to actually publish
something new; see ``docs/MAINTENANCE.md``.

The one line this script prints to **stdout** is a JSON object the workflow
parses to decide whether to open a pull request, an issue, or several of
each. Everything else is progress, on stderr, for a human reading the run.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import (  # noqa: E402
    DATA_DIR,
    clean_text,
    fetch,
    log,
    read_json,
    update_versions,
    validate,
    write_json,
)

import pdfplumber  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

SEEN_FILE = DATA_DIR / "_meta" / "seen-orders.json"
DA_HISTORY_FILE = DATA_DIR / "pay" / "da-history.json"

DA_ORDER_URL = "https://doe.gov.in/files/circulars_document/DAorder7cpc.pdf"
DA_ORDER_LABEL = "Dearness Allowance order (current)"

# Fetched and read by hand this session (2026-08-29): the page
# order-central-pay-commission/16 that data/pay/da-history.json already cites
# for its pre-2025 entries turns out to list HRA and Travelling/Transport
# Allowance circulars too, not only Dearness Allowance ones. No dedicated
# "Allowances" index was found on doe.gov.in — the site's own search page
# (/orders-circulars) is a filterable database with no stable listing URL
# this script could poll. If DoE ever publishes one, point this at it instead.
ALLOWANCES_INDEX_URL = "https://doe.gov.in/order-central-pay-commission/16"

KEYWORD_GROUPS: dict[str, tuple[str, ...]] = {
    "hra": ("house rent allowance",),
    "ta": ("travelling allowance", "transport allowance", "daily allowance"),
    "cea": ("children education allowance", "education allowance"),
}


# --------------------------------------------------------------------------
# The Dearness Allowance sentence
# --------------------------------------------------------------------------

_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

# Every notified Dearness Allowance order this project has read cites follows
# one shape: "...rate of Dearness Allowance...enhanced from the existing rate
# of X% to Y%...". Matched loosely — free whitespace, a wide gap between the
# name and the verb — because a DoE scan that carries any text layer at all
# comes back through an OCR pass with ragged spacing and the odd swapped
# character (real, fetched examples read "lndia" for "India", "otficials" for
# "officials"; see fixtures/pay-orders/SOURCES.md).
#
# The anchor is "Dearness Allowance" BY NAME, not the letters "DA" alone.
# "Daily Allowance" is a different, real DoE allowance, also abbreviated
# "DA", also the subject of its own percentage-bearing orders (Travelling
# Allowance Rules) — fixtures/pay-orders/ta-rules-om-2018.txt is a real,
# fetched example that mentions "25o/o oI DA" in a sentence with nothing to
# do with Dearness Allowance. A regex keyed on "DA" would propose a Dearness
# Allowance rate change out of a Travelling Allowance order.
_RATE_RE = re.compile(
    r"dearness\s+allowance[\s\S]{0,600}?"
    r"enhanc\w*\s+from\s+the\s+existing\s+rate\s+of\s+(?P<old>\d{1,3})\s*%\s*to\s*(?P<new>\d{1,3})\s*%",
    re.IGNORECASE,
)

_DATE_PROSE_RE = re.compile(
    r"with\s+effect\s+from\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?\.?,?\s+"
    r"(?P<month>" + "|".join(_MONTHS) + r")\.?,?\s+(?P<year>\d{4})",
    re.IGNORECASE,
)
_DATE_NUMERIC_RE = re.compile(
    r"with\s+effect\s+from\s+(?P<day>\d{1,2})[.\-/](?P<month>\d{1,2})[.\-/](?P<year>\d{4})",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RateChange:
    old_rate: int
    new_rate: int
    effective_from: str  # ISO date
    snippet: str  # ~280 chars around the match, for a human reading the PR/issue


def _parse_effective_date(text: str, search_from: int) -> str | None:
    """Look for "with effect from <date>" shortly after the rate sentence.

    Both shapes DoE actually uses are tried: the prose form ("1st July,
    2027") every order this dataset cites so far uses, and the numeric form
    (DD.MM.YYYY) some departments' covering letters use instead. A date that
    does not parse as a real calendar date (OCR turning "2027" into "2O27")
    is treated as no match, not a crash.
    """
    window = text[search_from : search_from + 400]
    match = _DATE_PROSE_RE.search(window)
    if match:
        month = _MONTHS[match.group("month").lower()]
        day, year = int(match.group("day")), int(match.group("year"))
    else:
        match = _DATE_NUMERIC_RE.search(window)
        if not match:
            return None
        day, month, year = int(match.group("day")), int(match.group("month")), int(match.group("year"))

    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


# Dearness Allowance has gone from 0% to 60% over ten years (2016-2026),
# roughly 6 points a year. `\d{1,3}` in `_RATE_RE` accepts up to 999, but
# `data/pay/da-history.json`'s own schema caps a rate at 300 — and an OCR
# pass that turns "60%" into "600%" or "960%" (a stray digit inserted or an
# adjacent number bleeding in) produces exactly a 3-digit reading that still
# satisfies the regex. Left unchecked, that reaches `apply_da_rate_change`,
# which validates against the schema and raises a plain `ValueError` that
# nothing in `main()` catches — confirmed to crash the whole run rather than
# degrade to a manual-review item, the one failure mode this script exists
# to avoid (see `check_da_order`'s PDF-parse guard for the same principle
# applied to a different cause). 100 is a conservative ceiling with a lot of
# headroom over any real rate this dataset has ever recorded; it exists to
# catch OCR noise, not to anticipate an actual DA rate anywhere near it.
_MAX_PLAUSIBLE_RATE = 100


def find_rate_change(text: str) -> RateChange | None:
    """The parsed rate change, or ``None`` if the text does not contain one.

    ``None`` covers four real cases identically, on purpose: no text layer
    at all (a scan), a text layer that has nothing to do with Dearness
    Allowance, a Dearness Allowance sentence with no effective date this
    function recognises, and a matched percentage too implausible to trust
    (`_MAX_PLAUSIBLE_RATE`). All four mean the same thing to a caller — read
    this order by hand.
    """
    match = _RATE_RE.search(text)
    if not match:
        return None
    old_rate, new_rate = int(match.group("old")), int(match.group("new"))
    if old_rate > _MAX_PLAUSIBLE_RATE or new_rate > _MAX_PLAUSIBLE_RATE:
        return None
    effective_from = _parse_effective_date(text, match.end())
    if effective_from is None:
        return None
    start = max(0, match.start() - 80)
    end = min(len(text), match.end() + 200)
    return RateChange(
        old_rate=old_rate,
        new_rate=new_rate,
        effective_from=effective_from,
        snippet=clean_text(text[start:end]),
    )


# --------------------------------------------------------------------------
# Fetching and extraction
# --------------------------------------------------------------------------


def extract_text(pdf_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def check_da_order(seen: dict[str, Any], *, force: bool, session: Any = None) -> dict[str, Any] | None:
    """Fetch the fixed-path order; an action dict if its content looks new."""
    try:
        fetched = fetch([DA_ORDER_URL], session=session)
    except Exception as error:  # noqa: BLE001 - reported, not fatal to the run
        log(f"! could not fetch {DA_ORDER_URL}: {type(error).__name__}: {error}")
        return None

    digest = fetched.sha256
    previous = seen.get("da-order") or {}
    real_change = previous.get("sha256") != digest
    is_new = force or real_change
    # Only touch the seen-entry's timestamp on a REAL change (or a forced
    # run, which documents that it refreshes the seen-list). An unforced run
    # that found nothing new must leave `seen` byte-identical to what is on
    # disk, or every quiet monthly cron would still produce a diff on
    # data/_meta/seen-orders.json's `seenAt` alone — exactly the "a run that
    # changes nothing must write nothing" rule `ingest_common.
    # write_if_content_changed` states for every other dataset here.
    if real_change or force:
        seen["da-order"] = {"url": DA_ORDER_URL, "sha256": digest, "seenAt": fetched.fetched_at}

    if not is_new:
        log(f"da-order: unchanged ({digest[:12]}…)")
        return None

    log(f"da-order: {'forced' if force else 'new content'} at {DA_ORDER_URL} ({digest[:12]}…)")
    try:
        text = extract_text(fetched.content)
    except Exception as error:  # noqa: BLE001 - pdfplumber raises on anything that is not a real PDF
        # A 200 response with accurate Content-Length that simply is not a
        # PDF — an HTML error page, a WAF challenge, an empty body — sails
        # straight through `fetch()`, which only checks the HTTP status and
        # the transfer's own byte count, never the content's actual shape.
        # `pdfplumber.open()` raises on it (confirmed against an empty body
        # and against an HTML page during this session's edge-case pass).
        # Without this, that single bad fetch would crash the whole run —
        # no pull request, no issue, not even the resilient "read this by
        # hand" this script exists to fall back to — which is the one
        # failure mode a monthly, unattended cron cannot recover from on
        # its own.
        log(f"! {DA_ORDER_URL} did not parse as a PDF: {type(error).__name__}: {error}")
        return {
            "kind": "manual-review",
            "title": DA_ORDER_LABEL,
            "url": DA_ORDER_URL,
            "reason": (
                f"The fetched content did not parse as a PDF at all ({type(error).__name__}: {error}). "
                "This may be a temporary server-side error page rather than a real order — check the "
                "URL in a browser before assuming DoE published something malformed."
            ),
        }

    change = find_rate_change(text)
    if change is None:
        reason = (
            "No usable text layer — this is a scanned order, the ordinary case for a DoE Dearness "
            "Allowance order (CLAUDE.md's note on this). Read the order and update "
            "data/pay/da-history.json by hand."
            if len(text.strip()) < 40
            else "Fetched and extracted text, but it did not match the expected 'enhanced from the "
            "existing rate of X% to Y% ... with effect from <date>' sentence. Read the order by hand."
        )
        return {"kind": "manual-review", "title": DA_ORDER_LABEL, "url": DA_ORDER_URL, "reason": reason}

    return {
        "kind": "da-rate-change",
        "title": DA_ORDER_LABEL,
        "url": DA_ORDER_URL,
        "fetchedAt": fetched.fetched_at,
        "change": change,
    }


def check_allowances_index(seen: dict[str, Any], *, force: bool, session: Any = None) -> list[dict[str, Any]]:
    """New HRA/TA/CEA-keyword PDF links on the one DoE page found to list them.

    Never proposes a data edit — every hit here is a manual-review item. See
    the module docstring for why.
    """
    try:
        fetched = fetch([ALLOWANCES_INDEX_URL], session=session)
    except Exception as error:  # noqa: BLE001
        log(f"! could not fetch {ALLOWANCES_INDEX_URL}: {type(error).__name__}: {error}")
        return []

    soup = BeautifulSoup(fetched.text, "lxml")
    previously_seen: set[str] = set(seen.get("allowancesSeenUrls") or [])
    current_urls: set[str] = set()
    actions: list[dict[str, Any]] = []

    # DoE's own page is a Drupal Views table: the link's own text is never
    # more than the word "Download" (see fixtures/pay-orders/doe-index.html,
    # a real, fetched copy of this page — a first version of this parser
    # matched against the link text alone and silently found nothing at all).
    # The real title lives in a sibling `<td class="views-field-title">` cell
    # of the same `<tr>`, so rows are walked rather than links.
    for row in soup.find_all("tr"):
        link = row.find("a", href=lambda h: bool(h) and h.lower().endswith(".pdf"))
        if link is None:
            continue
        href = link["href"]
        url = href if href.startswith("http") else f"https://doe.gov.in{href}"
        current_urls.add(url)

        title_cell = row.find(class_=lambda c: bool(c) and "views-field-title" in c)
        title = clean_text(title_cell.get_text()) if title_cell else clean_text(link.get_text())
        title = title or url
        haystack = f"{title} {url}".lower()
        matched = [kind for kind, keywords in KEYWORD_GROUPS.items() if any(k in haystack for k in keywords)]
        if not matched or (url in previously_seen and not force):
            continue

        actions.append(
            {
                "kind": "manual-review",
                "title": title,
                "url": url,
                "reason": f"New {'/'.join(k.upper() for k in matched)} order listed on {ALLOWANCES_INDEX_URL}.",
            }
        )

    seen["allowancesSeenUrls"] = sorted(current_urls)
    log(f"allowances index: {len(current_urls)} pdf(s) listed, {len(actions)} new keyword match(es)")
    return actions


# --------------------------------------------------------------------------
# Applying a parsed change
# --------------------------------------------------------------------------


class AlreadyRecorded(ValueError):
    """The parsed date already has a `notified` or `frozen` entry in the dataset."""


def apply_da_rate_change(change: RateChange, *, source_url: str, fetched_at: str) -> tuple[bool, list[str]]:
    """Write the notified rate into ``data/pay/da-history.json``.

    Returns ``(changed, warnings)``. Raises :class:`AlreadyRecorded` rather
    than overwriting a rate this dataset already has `status: "notified"` OR
    `status: "frozen"` for the same date — a parsed order disagreeing with an
    already-recorded figure is a reason to read both by hand, not a reason to
    pick one. `"frozen"` matters here too, not only `"notified"`: the 2020
    COVID-era rows in this dataset ARE `"frozen"`, a real historical fact
    (an announced installment that was withheld, not merely projected), and
    silently replacing one the way a projection gets replaced would destroy
    that fact rather than update it — confirmed to actually happen before
    this guard existed, by constructing a `"frozen"` row and applying a
    change against its date (see `test_pay_orders.py`).

    A standing ``projected`` entry for the same date IS silently replaced,
    because a notified order is exactly what a projection exists to be
    replaced by — `"projected"` is the only status this function treats that
    way.
    """
    payload = read_json(DA_HISTORY_FILE)
    if payload is None:
        raise FileNotFoundError(DA_HISTORY_FILE)

    rates: list[dict[str, Any]] = payload["rates"]
    existing = next((r for r in rates if r["effectiveFrom"] == change.effective_from), None)
    if existing is not None and existing["status"] != "projected":
        raise AlreadyRecorded(
            f"{change.effective_from} is already recorded as {existing['status']} at {existing['rate']}% "
            f"(the order parsed as {change.new_rate}%)"
        )

    warnings: list[str] = []
    prior_notified = [
        r for r in rates if r["effectiveFrom"] < change.effective_from and r["status"] == "notified"
    ]
    if prior_notified:
        latest = max(prior_notified, key=lambda r: r["effectiveFrom"])
        if latest["rate"] != change.old_rate:
            warnings.append(
                f"The order says the previous rate was {change.old_rate}%, but the dataset's latest "
                f"notified rate before {change.effective_from} is {latest['rate']}% "
                f"(effective {latest['effectiveFrom']}). Read the order before merging."
            )

    new_rate = {
        "effectiveFrom": change.effective_from,
        "rate": change.new_rate,
        "status": "notified",
        "note": {
            "en": (
                "Read from the order fetched by the automated Dearness Allowance check "
                "(scripts/ingest/pay_orders.py). Verify against the order before relying on it."
            ),
            "hi": (
                "स्वचालित महँगाई भत्ता जाँच (scripts/ingest/pay_orders.py) द्वारा प्राप्त आदेश से पढ़ा गया। "
                "इस पर निर्भर रहने से पहले आदेश से पुष्टि करें।"
            ),
        },
        "source": {
            "name": "Department of Expenditure, Ministry of Finance — Dearness Allowance orders (7th CPC)",
            "url": source_url,
            "note": {
                "en": (
                    "The Department of Expenditure serves the current Dearness Allowance order at this "
                    "fixed path and replaces it on the next revision, so the file at this URL will change."
                ),
                "hi": (
                    "व्यय विभाग इस निश्चित पथ पर वर्तमान महँगाई भत्ता आदेश देता है और अगले पुनरीक्षण पर उसे "
                    "बदल देता है, अतः इस यूआरएल की फ़ाइल बदल जाएगी।"
                ),
            },
        },
        "fetchedAt": fetched_at,
        "verify": True,
    }

    remaining = [r for r in rates if r["effectiveFrom"] != change.effective_from]
    remaining.append(new_rate)
    remaining.sort(key=lambda r: r["effectiveFrom"])
    payload = {**payload, "generatedAt": fetched_at[:10], "rates": remaining}

    validate(payload, "pay-da-history.schema.json")
    changed, digest = write_json(DA_HISTORY_FILE, payload)
    if changed:
        update_versions(
            {
                "da-history": {
                    "version": payload["version"],
                    "updated": payload["generatedAt"],
                    "label": {"en": "Dearness Allowance history", "hi": "महँगाई भत्ता इतिहास"},
                    "rows": len(payload["rates"]),
                    "sha256": digest,
                    "source": {"name": new_rate["source"]["name"]},
                }
            },
            generated_at=fetched_at,
        )
    return changed, warnings


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--force",
        action="store_true",
        help="treat the current state as new for THIS run's report, regardless of the seen-list "
        "(a fresh seen-list is still written) — for a manual workflow_dispatch demonstrating the "
        "pipeline without waiting for DoE to publish something new",
    )
    parser.add_argument("--check", action="store_true", help="fetch and report only; write nothing")
    args = parser.parse_args()

    seen = read_json(SEEN_FILE, default={}) or {}
    working = dict(seen)

    result: dict[str, Any] = {"daHistoryChanged": False, "daOrder": None, "manualReview": []}

    da_action = check_da_order(working, force=args.force)
    if da_action is not None:
        if da_action["kind"] == "da-rate-change":
            change: RateChange = da_action["change"]
            try:
                changed, warnings = (
                    (False, [])
                    if args.check
                    else apply_da_rate_change(change, source_url=da_action["url"], fetched_at=da_action["fetchedAt"])
                )
                result["daHistoryChanged"] = changed
                result["daOrder"] = {
                    "url": da_action["url"],
                    "oldRate": change.old_rate,
                    "newRate": change.new_rate,
                    "effectiveFrom": change.effective_from,
                    "snippet": change.snippet,
                    "warnings": warnings,
                }
            except AlreadyRecorded as error:
                result["manualReview"].append(
                    {"title": da_action["title"], "url": da_action["url"], "reason": str(error)}
                )
            except Exception as error:  # noqa: BLE001 - a write must never crash the run; see the comment
                # Defense in depth alongside `_MAX_PLAUSIBLE_RATE`: that
                # guard is what SHOULD stop an implausible parse from
                # reaching here, but this is the backstop for anything it
                # does not anticipate — a future schema constraint, a
                # corrupt da-history.json already on disk, anything. A
                # write that fails must degrade to "read this by hand",
                # never take the whole monthly run down with it.
                log(f"! apply_da_rate_change raised {type(error).__name__}: {error}")
                result["manualReview"].append(
                    {
                        "title": da_action["title"],
                        "url": da_action["url"],
                        "reason": (
                            f"Parsed {change.new_rate}% effective {change.effective_from}, but writing it "
                            f"failed: {type(error).__name__}: {error}. Read the order by hand."
                        ),
                    }
                )
        else:
            result["manualReview"].append(
                {"title": da_action["title"], "url": da_action["url"], "reason": da_action["reason"]}
            )

    result["manualReview"].extend(
        {"title": a["title"], "url": a["url"], "reason": a["reason"]}
        for a in check_allowances_index(working, force=args.force)
    )

    if not args.check:
        write_json(SEEN_FILE, working)

    log(
        f"da order: {'change proposed' if result['daOrder'] else 'no change'}; "
        f"{len(result['manualReview'])} item(s) for manual review"
    )
    # The workflow parses exactly this one stdout line. Everything above is
    # progress, on stderr, for a human reading the run.
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
