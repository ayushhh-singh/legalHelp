#!/usr/bin/env python3
"""Generate ``data/pay/matrix.json`` — the whole 7th CPC pay matrix.

Why generate rather than transcribe
-----------------------------------
The matrix is 19 levels x up to 40 cells = 653 numbers. It is published only as
a scanned table (the CCS (Revised Pay) Rules, 2016 gazette; the Department of
Expenditure hosts no text-layer copy, and neither does any mirror found). OCR of
a 19-column table is exactly the kind of transcription that gets one digit wrong
in one cell and is never noticed.

The Commission's own construction rule removes the need to transcribe: the first
cell of each level is the pre-revised entry pay multiplied by that level's index
of rationalisation, and every later cell is the previous one raised by 3 percent
and rounded to the nearest hundred (7th CPC report, para 5.1.19 and Chapter 5.1).
Only 19 entry pays and 19 cell counts have to be right, and all 38 of those were
read off the gazette table by eye and are asserted below.

``ANCHORS`` is the audit trail: every value in it was checked against the scanned
Schedule, and ``verify_against_gazette()`` re-checks the generated cells against
the cells that were legible in the OCR of that scan. Run with ``--check`` to run
that verification without writing anything.

Level 13 is the one substitution: the 2016 gazette starts it at 118500 and ends
it at 214100 in cell 21 (index of rationalisation 2.57). The CCS (Revised Pay)
(Amendment) Rules, 2017 (GSR 592(E), 15.06.2017), effective 01.01.2016, replaced
that with a level starting at 123100 and ending at 215900 in cell 20 (index 2.67)
and DoE OM 4-6/2017-IC/E-III(A) of 28.09.2017 records the earlier level as
"non-existent ab-initio". The amended level is what ships.

This script reaches the network for nothing. It is not on the weekly cron: the
pay matrix changes when a Pay Commission is implemented, not when a portal is
re-published.

    python3 scripts/ingest/pay_matrix.py            # write data/pay/matrix.json
    python3 scripts/ingest/pay_matrix.py --check    # verify only, write nothing
"""

from __future__ import annotations

import argparse
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import (  # noqa: E402
    DATA_DIR,
    log,
    update_versions,
    utc_now,
    validate,
    write_if_content_changed,
)

MATRIX_FILE = DATA_DIR / "pay" / "matrix.json"

GAZETTE = {
    "name": "CCS (Revised Pay) Rules, 2016 — Schedule, Part A (Pay Matrix)",
    "url": "https://thc.nic.in/Central%20Governmental%20Rules/Central%20Civil%20Services%20(Revised%20Pay)%20Rules,%202016.pdf",
    "reference": "G.S.R. 721(E)",
    "dated": "2016-07-25",
}

LEVEL_13_AMENDMENT = {
    "name": "DoE O.M. — Modification of Level-13 of the Pay Matrix",
    "url": "https://doe.gov.in/files/pay_related_matters_documents/Modification_of_Level13_Pay_Matrix28092017_1.pdf",
    "reference": "No. 4-6/2017-IC/E-III(A), giving effect to G.S.R. 592(E) of 15.06.2017",
    "dated": "2017-09-28",
}

# level, grade pay, pay band, pre-revised entry pay, index of rationalisation,
# entry pay (cell 1), number of cells.
#
# Entry pay and index of rationalisation: 7th CPC report, Table 4 (para 5.1.19).
# Cell counts: read off the gazette Schedule — Levels 1-10 run to cell 40,
# Level 11 stops at 208700 in cell 39, Level 12 at 209200 in cell 34, Level 13A
# at 216600 in cell 18, Level 14 at 218200 in cell 15, Level 15 at 224100 in
# cell 8, Level 16 at 224400 in cell 4. Levels 17 and 18 are single fixed cells.
ANCHORS: list[tuple[str, int | None, str, str, int | None, float, int, int]] = [
    ("1", 1800, "PB-1", "5200-20200", 7000, 2.57, 18000, 40),
    ("2", 1900, "PB-1", "5200-20200", 7730, 2.57, 19900, 40),
    ("3", 2000, "PB-1", "5200-20200", 8460, 2.57, 21700, 40),
    ("4", 2400, "PB-1", "5200-20200", 9910, 2.57, 25500, 40),
    ("5", 2800, "PB-1", "5200-20200", 11360, 2.57, 29200, 40),
    ("6", 4200, "PB-2", "9300-34800", 13500, 2.62, 35400, 40),
    ("7", 4600, "PB-2", "9300-34800", 17140, 2.62, 44900, 40),
    ("8", 4800, "PB-2", "9300-34800", 18150, 2.62, 47600, 40),
    ("9", 5400, "PB-2", "9300-34800", 20280, 2.62, 53100, 40),
    ("10", 5400, "PB-3", "15600-39100", 21000, 2.67, 56100, 40),
    ("11", 6600, "PB-3", "15600-39100", 25350, 2.67, 67700, 39),
    ("12", 7600, "PB-3", "15600-39100", 29500, 2.67, 78800, 34),
    ("13", 8700, "PB-4", "37400-67000", 46100, 2.67, 123100, 20),
    ("13A", 8900, "PB-4", "37400-67000", 49100, 2.67, 131100, 18),
    ("14", 10000, "PB-4", "37400-67000", 53000, 2.72, 144200, 15),
    ("15", None, "HAG", "67000-79000", 67000, 2.72, 182200, 8),
    ("16", None, "HAG+", "75500-80000", 75500, 2.72, 205400, 4),
    ("17", None, "Apex", "80000 (fixed)", 80000, 2.81, 225000, 1),
    ("18", None, "Cabinet Secretary", "90000 (fixed)", 90000, 2.78, 250000, 1),
]

# The last cell of every level, read off the gazette Schedule (and, for Level 13,
# off the 2017 amendment OM, which states the figure in words). Generated cells
# must land on these exactly — if the 3 percent rule ever failed to reproduce the
# notified table, this is where it would show.
TERMINAL_CELL = {
    "1": 56900,
    "2": 63200,
    "3": 69100,
    "4": 81100,
    "5": 92300,
    "6": 112400,
    "7": 142400,
    "8": 151100,
    "9": 167800,
    "10": 177500,
    "11": 208700,
    "12": 209200,
    "13": 215900,
    "13A": 216600,
    "14": 218200,
    "15": 224100,
    "16": 224400,
    "17": 225000,
    "18": 250000,
}

# A scattering of interior cells taken from the same scan, spread across levels
# and across the width of the table. These catch a rounding rule that is right at
# the ends and wrong in the middle, which a terminal-value check alone would miss.
SPOT_CHECKS = {
    ("1", 9): 22800,
    ("1", 2): 18500,
    ("4", 9): 32300,
    ("7", 9): 56900,
    ("9", 25): 107900,
    ("11", 25): 138000,
    ("12", 30): 185900,
    ("13A", 9): 166100,
    ("14", 13): 205600,
    ("15", 4): 199100,
    ("16", 3): 217900,
}

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से पुष्टि करें।",
}

RULE_DESCRIPTION = {
    "en": (
        "Each cell after the first is the previous cell raised by 3 per cent and rounded to the "
        "nearest hundred rupees. The first cell of a level is the pre-revised entry pay multiplied "
        "by that level's index of rationalisation."
    ),
    "hi": (
        "पहले सेल के बाद प्रत्येक सेल पिछले सेल का 3 प्रतिशत बढ़ाकर निकटतम सौ रुपये तक पूर्णांकित किया गया है। "
        "किसी लेवल का पहला सेल पूर्व-संशोधित प्रवेश वेतन को उस लेवल के युक्तिकरण सूचकांक से गुणा करके प्राप्त होता है।"
    ),
}

LEVEL_NOTES = {
    "9": {
        "en": "No entry pay was prescribed at GP 5400 (PB-2) in the pre-revised structure; the 7th CPC interpolated ₹20,280 from the 6th CPC fitment table.",
        "hi": "पूर्व-संशोधित संरचना में ग्रेड पे 5400 (PB-2) पर कोई प्रवेश वेतन निर्धारित नहीं था; 7वें केंद्रीय वेतन आयोग ने 6वें वेतन आयोग की फिटमेंट तालिका से ₹20,280 का अंतर्वेशन किया।",
    },
    "13": {
        "en": "Substituted level. The 2016 gazette ran this level from ₹1,18,500 to ₹2,14,100 over 21 cells at an index of 2.57; the CCS (Revised Pay) (Amendment) Rules, 2017 replaced it, with effect from 01.01.2016, by a level of 20 cells from ₹1,23,100 to ₹2,15,900 at an index of 2.67. Pay is still fixed with the fitment factor of 2.57, not 2.67.",
        "hi": "प्रतिस्थापित लेवल। 2016 के राजपत्र में यह लेवल 2.57 सूचकांक पर 21 सेल में ₹1,18,500 से ₹2,14,100 तक था; सीसीएस (संशोधित वेतन) (संशोधन) नियम, 2017 ने इसे 01.01.2016 से 2.67 सूचकांक पर 20 सेल में ₹1,23,100 से ₹2,15,900 वाले लेवल से प्रतिस्थापित कर दिया। वेतन निर्धारण अब भी 2.57 फिटमेंट फैक्टर से होता है, 2.67 से नहीं।",
    },
}


def cells_for(entry_pay: int, count: int) -> list[int]:
    """The Commission's rule, applied ``count`` times from ``entry_pay``."""
    out = [entry_pay]
    for _ in range(count - 1):
        raised = Decimal(out[-1]) * Decimal("1.03")
        out.append(int((raised / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) * 100)
    return out


def build() -> dict:
    fetched_at = utc_now()
    levels = []

    for order, (level, grade_pay, band, band_range, pre_revised, ior, entry_pay, count) in enumerate(
        ANCHORS, start=1
    ):
        source = LEVEL_13_AMENDMENT if level == "13" else GAZETTE
        levels.append(
            {
                "level": level,
                "order": order,
                "gradePay": grade_pay,
                "payBand": {"name": band, "range": band_range, "preRevisedEntryPay": pre_revised},
                "indexOfRationalisation": ior,
                "entryPay": entry_pay,
                "cells": cells_for(entry_pay, count),
                "note": LEVEL_NOTES.get(level),
                "source": source,
                "fetchedAt": fetched_at,
                "verify": False,
            }
        )

    return {
        "$schema": "../../schemas/pay-matrix.schema.json",
        "version": "1.0.0",
        "generatedAt": fetched_at[:10],
        "cpc": 7,
        "rule": {
            "multiplier": 1.03,
            "rounding": "nearest-100",
            "description": RULE_DESCRIPTION,
            "fitmentFactor": 2.57,
        },
        "disclaimer": DISCLAIMER,
        "levels": levels,
    }


def verify_against_gazette(payload: dict) -> list[str]:
    """Every check that would catch a wrong anchor. Empty list means clean."""
    problems: list[str] = []
    by_level = {level["level"]: level for level in payload["levels"]}

    if len(by_level) != len(ANCHORS):
        problems.append("duplicate level identifiers")

    for level, expected in TERMINAL_CELL.items():
        got = by_level[level]["cells"][-1]
        if got != expected:
            problems.append(f"L{level} last cell is {got}, gazette says {expected}")

    for (level, cell), expected in SPOT_CHECKS.items():
        got = by_level[level]["cells"][cell - 1]
        if got != expected:
            problems.append(f"L{level} cell {cell} is {got}, gazette says {expected}")

    for level in payload["levels"]:
        cells = level["cells"]
        if cells[0] != level["entryPay"]:
            problems.append(f"L{level['level']} cell 1 is not the entry pay")
        if cells != sorted(cells) or len(set(cells)) != len(cells):
            problems.append(f"L{level['level']} cells do not increase strictly")
        if any(cell % 100 for cell in cells):
            problems.append(f"L{level['level']} has a cell that is not a multiple of 100")
        # The index of rationalisation is published to two decimals, so the
        # product can only pin the entry pay to within half a unit of that last
        # place — 80000 x 2.81 is 2,24,800 against a notified apex pay of
        # 2,25,000, and the report prints the equation anyway. Assert what the
        # published precision can actually support, not exact equality.
        pre_revised = level["payBand"]["preRevisedEntryPay"]
        ior = level["indexOfRationalisation"]
        if pre_revised is not None:
            tolerance = pre_revised * 0.005
            if abs(pre_revised * ior - level["entryPay"]) > tolerance:
                problems.append(
                    f"L{level['level']} entry pay {level['entryPay']} is not {pre_revised} x {ior} "
                    f"(within ±{tolerance:.0f})"
                )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify only; write nothing")
    args = parser.parse_args()

    payload = build()

    problems = verify_against_gazette(payload)
    if problems:
        for problem in problems:
            log(f"  ! {problem}")
        log(f"pay matrix: {len(problems)} disagreement(s) with the gazette — nothing written")
        return 1

    validate(payload, "pay-matrix.schema.json")

    total = sum(len(level["cells"]) for level in payload["levels"])
    log(f"pay matrix: {len(payload['levels'])} levels, {total} cells, verified against the gazette")

    if args.check:
        return 0

    changed, digest = write_if_content_changed(MATRIX_FILE, payload)
    log(f"pay matrix: {'wrote' if changed else 'unchanged'} {MATRIX_FILE.relative_to(MATRIX_FILE.parents[2])}")

    update_versions(
        {
            "pay-matrix": {
                "version": payload["version"],
                "updated": payload["generatedAt"],
                "label": {"en": "7th CPC pay matrix", "hi": "7वाँ केंद्रीय वेतन आयोग वेतन मैट्रिक्स"},
                "rows": len(payload["levels"]),
                "cells": total,
                "sha256": digest,
                "source": {"name": GAZETTE["name"]},
            }
        },
        generated_at=payload["generatedAt"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
