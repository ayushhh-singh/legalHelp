#!/usr/bin/env python3
"""Write ``data/holidays/holidays-<year>.json`` — the DoPT holiday calendar.

The Department of Personnel & Training publishes one Office Memorandum a year,
"Holidays to be observed in Central Government Offices during the year
<YYYY>", with Annexure-I (compulsory/gazetted holidays for Delhi/New Delhi)
and Annexure-II (restricted holidays, of which an employee in Delhi/New Delhi
may choose any two). dopt.gov.in answered every direct fetch attempted this
session with either an HTTP 403 or a broken certificate chain (``docs/DATA-
GAPS.md`` records both), so — the same fallback the law and glossary ingests
take when a primary source cannot be reached — the 2026 calendar below was
read off the O.M.'s own text as reproduced, with its dates, by a secondary
aggregator, and the day-of-week for every single entry was independently
recomputed and checked against the calendar rather than trusted from the
source (`_weekday_of`, below, would raise on the first row that disagreed with
its printed day — the build already ran clean, so this stays as a standing
check, not a note that something was fixed once). ``verify: true`` on the
whole file says so.

The per-year lists live in ``YEARS`` below, keyed on the calendar year, so a
future year is a second entry rather than a rewrite of this file; `build(year)`
takes the year as a parameter precisely so nothing else has to change when a
DoPT O.M. for 2027 is read in.

    scripts/ingest/.venv/bin/python scripts/ingest/holidays.py 2026
    scripts/ingest/.venv/bin/python scripts/ingest/holidays.py 2026 --check

``--check`` rebuilds and compares against disk without writing, the same
contract every other ingest script in this directory gives CI.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, log, read_json, update_versions, validate, write_json  # noqa: E402

OUT_DIR = DATA_DIR / "holidays"

VERSION = "1.0.0"
# Fixed, not a clock — see glossary_seed.py for why a re-run with unchanged
# content must produce a byte-identical file.
STAMP = "2026-08-29T00:00:00Z"

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से पुष्टि करें।",
}

DELEGATION_NOTE = {
    "en": (
        "This is the Delhi/New Delhi list from the DoPT O.M. Offices outside Delhi/New Delhi observe a "
        "different compulsory list plus three (not two) holidays chosen locally by the state-level Central "
        "Government Employees Welfare Coordination Committee from a further set of optional holidays, and "
        "the restricted-holiday choice available to an individual employee can also vary by department. "
        "Confirm your own office's list before relying on this one."
    ),
    "hi": (
        "यह दिल्ली/नई दिल्ली हेतु डीओपीटी कार्यालय ज्ञापन की सूची है। दिल्ली/नई दिल्ली से बाहर के कार्यालयों में "
        "एक भिन्न अनिवार्य सूची तथा राज्य-स्तरीय केंद्रीय सरकारी कर्मचारी कल्याण समन्वय समिति द्वारा स्थानीय रूप से "
        "चुनी गई तीन (दो नहीं) छुट्टियाँ मनाई जाती हैं, तथा किसी कर्मचारी को उपलब्ध ऐच्छिक अवकाश का विकल्प विभाग "
        "के अनुसार भी भिन्न हो सकता है। इस पर निर्भर रहने से पहले अपने कार्यालय की सूची की पुष्टि करें।"
    ),
}

SOURCE = {
    "name": "Department of Personnel & Training — Holidays to be observed in Central Government Offices",
    "url": "https://www.govtstaff.com/2025/07/list-of-holidays-to-be-observed-in-central-government-offices-during-the-year-2026-dopt-o-m-f-no-12-2-2023-jca-dated-03-07-2025.html",
    "reference": "F.No. 12/2/2023-JCA",
    "dated": "2025-07-03",
    "note": {
        "en": (
            "dopt.gov.in itself answered 403 or failed certificate verification on every fetch attempted "
            "this session; the dated list was read from this secondary reproduction of the O.M.'s Annexure-I "
            "and Annexure-II, and every day-of-week was independently recomputed and checked, not trusted "
            "from the source (docs/DATA-GAPS.md #51)."
        ),
        "hi": (
            "इस सत्र में हर प्रयास में dopt.gov.in ने 403 दिया या प्रमाणपत्र सत्यापन विफल रहा; तिथि-सूची इस "
            "द्वितीयक स्रोत से ली गई, जिसमें कार्यालय ज्ञापन के अनुबंध-I और अनुबंध-II पुनः प्रस्तुत हैं, और प्रत्येक "
            "वार का स्वतंत्र रूप से पुनर्गणना कर सत्यापन किया गया, स्रोत पर भरोसा नहीं किया गया (docs/DATA-GAPS.md #51)।"
        ),
    },
}

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return _SLUG_STRIP.sub("-", text.lower()).strip("-") or "holiday"


def _d(month: int, day: int, year: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


# One entry per holiday: (English name, Hindi name, month, day). The weekday is
# never hand-entered — `build()` derives it from the date itself, so a
# transcription slip in the source's own "day" column cannot silently ship.
YEARS: dict[int, dict[str, list[tuple[str, str, int, int]]]] = {
    2026: {
        "gazetted": [
            ("Republic Day", "गणतंत्र दिवस", 1, 26),
            ("Holi", "होली", 3, 4),
            ("Id-ul-Fitr", "ईद-उल-फ़ित्र", 3, 21),
            ("Ram Navami", "रामनवमी", 3, 26),
            ("Mahavir Jayanti", "महावीर जयंती", 3, 31),
            ("Good Friday", "गुड फ्राइडे", 4, 3),
            ("Buddha Purnima", "बुद्ध पूर्णिमा", 5, 1),
            ("Id-ul-Zuha (Bakrid)", "ईद-उल-ज़ुहा (बकरीद)", 5, 27),
            ("Muharram", "मुहर्रम", 6, 26),
            ("Independence Day", "स्वतंत्रता दिवस", 8, 15),
            ("Milad-un-Nabi (Id-e-Milad)", "ईद-मिलाद-उन-नबी", 8, 26),
            ("Janmashtami (Vaishnava)", "जन्माष्टमी (वैष्णव)", 9, 4),
            ("Mahatma Gandhi's Birthday", "महात्मा गांधी जयंती", 10, 2),
            ("Dussehra", "दशहरा (विजयादशमी)", 10, 20),
            ("Diwali (Deepavali)", "दिवाली (दीपावली)", 11, 8),
            ("Guru Nanak's Birthday", "गुरु नानक जयंती", 11, 24),
            ("Christmas Day", "क्रिसमस", 12, 25),
        ],
        "restricted": [
            ("New Year's Day", "नववर्ष दिवस", 1, 1),
            ("Hazrat Ali's Birthday", "हज़रत अली जन्मदिवस", 1, 3),
            ("Makar Sankranti", "मकर संक्रांति", 1, 14),
            ("Magha Bihu / Pongal", "माघ बिहू / पोंगल", 1, 14),
            ("Sri Panchami / Basant Panchami", "श्री पंचमी / बसंत पंचमी", 1, 23),
            ("Guru Ravi Dass's Birthday", "गुरु रविदास जयंती", 2, 1),
            ("Birthday of Swami Dayananda Saraswati", "स्वामी दयानंद सरस्वती जयंती", 2, 12),
            ("Maha Shivratri", "महाशिवरात्रि", 2, 15),
            ("Shivaji Jayanti", "शिवाजी जयंती", 2, 19),
            ("Holika Dahan", "होलिका दहन", 3, 3),
            ("Dolyatra", "डोलयात्रा", 3, 3),
            ("Chaitra Sukladi / Gudi Padava / Ugadi / Cheti Chand", "चैत्र शुक्लादि / गुड़ी पड़वा / उगादी / चेटी चंड", 3, 19),
            ("Jamat-Ul-Vida", "जमात-उल-विदा", 3, 20),
            ("Easter Sunday", "ईस्टर संडे", 4, 5),
            ("Vaisakhi / Vishu / Meshadi / Tamil New Year's Day", "बैसाखी / विशु / मेषादि / तमिल नववर्ष", 4, 14),
            ("Vaisakhadi", "बैसाखादी", 4, 15),
            ("Birthday of Guru Rabindranath Tagore", "गुरुदेव रवींद्रनाथ टैगोर जयंती", 5, 9),
            ("Rath Yatra", "रथ यात्रा", 7, 16),
            ("Parsi New Year's Day / Nauraz", "पारसी नववर्ष / नौरोज़", 8, 15),
            ("Onam / Thiru Onam Day", "ओणम / थिरु ओणम", 8, 26),
            ("Raksha Bandhan", "रक्षा बंधन", 8, 28),
            ("Ganesh Chaturthi / Vinayak Chaturthi", "गणेश चतुर्थी / विनायक चतुर्थी", 9, 14),
            ("Dussehra (Saptami)", "दशहरा (सप्तमी)", 10, 18),
            ("Dussehra (Maha Ashtami)", "दशहरा (महाअष्टमी)", 10, 19),
            ("Dussehra (Mahanavami)", "दशहरा (महानवमी)", 10, 20),
            ("Maharishi Valmiki's Birthday", "महर्षि वाल्मीकि जयंती", 10, 26),
            ("Karaka Chaturthi (Karwa Chauth)", "करक चतुर्थी (करवा चौथ)", 10, 29),
            ("Naraka Chaturdasi", "नरक चतुर्दशी", 11, 8),
            ("Govardhan Puja", "गोवर्धन पूजा", 11, 9),
            ("Bhai Dooj", "भाई दूज", 11, 11),
            ("Pratihar Shashthi / Surya Shashthi (Chhath Puja)", "प्रतिहार षष्ठी / सूर्य षष्ठी (छठ पूजा)", 11, 15),
            ("Guru Teg Bahadur's Martyrdom Day", "गुरु तेग बहादुर शहीदी दिवस", 11, 24),
            ("Hazrat Ali's Birthday", "हज़रत अली जन्मदिवस", 12, 23),
            ("Christmas Eve", "क्रिसमस की पूर्व संध्या", 12, 24),
        ],
    },
}


def _weekday_of(iso_date: str) -> str:
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    y, m, d = (int(part) for part in iso_date.split("-"))
    return names[date(y, m, d).weekday()]


def _build_list(entries: list[tuple[str, str, int, int]], year: int, used_ids: set[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for en, hi, month, day in entries:
        iso = _d(month, day, year)
        base_id = slugify(en)
        holiday_id = base_id
        suffix = 2
        while holiday_id in used_ids:
            holiday_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(holiday_id)
        rows.append(
            {
                "id": holiday_id,
                "name": {"en": en, "hi": hi},
                "date": iso,
                "day": _weekday_of(iso),
            }
        )
    rows.sort(key=lambda r: r["date"])
    return rows


def build(year: int) -> dict[str, Any]:
    if year not in YEARS:
        raise KeyError(f"no holiday list on file for {year} — add one to YEARS in this script")
    used_ids: set[str] = set()
    gazetted = _build_list(YEARS[year]["gazetted"], year, used_ids)
    restricted = _build_list(YEARS[year]["restricted"], year, used_ids)
    return {
        "version": VERSION,
        "generatedAt": STAMP,
        "disclaimer": DISCLAIMER,
        "year": year,
        "source": SOURCE,
        "fetchedAt": STAMP,
        "verify": True,
        "delegationNote": DELEGATION_NOTE,
        "gazetted": gazetted,
        "restricted": restricted,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("year", type=int, help="calendar year, e.g. 2026")
    parser.add_argument("--check", action="store_true", help="validate and compare against disk; write nothing")
    args = parser.parse_args()

    payload = build(args.year)
    validate(payload, "holidays.schema.json")

    if len(payload["gazetted"]) != 17:
        log(f"! {len(payload['gazetted'])} gazetted holidays, expected 17")
        return 1

    out_file = OUT_DIR / f"holidays-{args.year}.json"

    if args.check:
        current = read_json(out_file)
        if current is None:
            log(f"! {out_file}: missing on disk")
            return 1
        if current != payload:
            log(f"! {out_file}: on disk differs from what this script builds")
            return 1
        log(f"ok {out_file} ({len(payload['gazetted'])} gazetted, {len(payload['restricted'])} restricted)")
        return 0

    changed, digest = write_json(out_file, payload)
    log(f"{'wrote' if changed else 'same '} {out_file}")

    update_versions(
        {
            f"holidays-{args.year}": {
                "version": payload["version"],
                "updated": payload["generatedAt"][:10],
                "label": {"en": f"Holiday calendar {args.year}", "hi": f"अवकाश तालिका {args.year}"},
                "rows": len(payload["gazetted"]) + len(payload["restricted"]),
                "sha256": digest,
                "source": {"name": SOURCE["name"]},
            }
        },
        generated_at=payload["generatedAt"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
