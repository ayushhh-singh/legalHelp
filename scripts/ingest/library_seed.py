#!/usr/bin/env python3
"""Build ``data/library/`` — the Library module's reading structure.

STRUCTURE OVER EXISTING BYTES. This script fetches nothing and copies no
statutory text. Every work file is a POINTER into a corpus this repository
already ships (``data/rules/text/<act>.json`` or ``data/law/<code>.json``) plus
the structure a reader needs to navigate it: a table of contents, a reading
order, an estimate of how long it takes to read, and the citation.

Three rules the rest of this file follows:

1. **Never copy the text.** A work file carries unit *ids* and *headings*; the
   body of every rule and section stays in the one place that owns it, so a
   dataset refresh corrects the Library for free. ``tests/library-data.test.ts``
   is what proves the pointers resolve.

2. **Never invent structure.** A table of contents is grouped only where the
   corpus already says how: ``data/law/*.json`` records a ``chapter`` per
   section, and CSMOP numbers its paragraphs ``<chapter>.<para>``. The other
   eleven rule books publish no chapter division this repository holds, so their
   TOC is flat and ``tocSource`` says so out loud rather than guessing at
   headings the source never gave us (``docs/DATA-GAPS.md`` #70).

3. **Hindi headings are authored or curated, never extracted, so every work
   carries ``verify: true``.** The rule books' Hindi headings come from
   ``scripts/authoring/hindi/<act>.json`` — the same file ``make_cards.py``
   reads, so the Library and the Trainer cannot disagree about a heading. The
   Sanhitas' come from ``data/law/overlays/*-hindi-curated.json``, already
   merged into the law datasets and already flagged there.

Run by hand; on no cron. A rule book changes when a Ministry amends it, which
is a reading job, not a re-publication.

    scripts/ingest/.venv/bin/python scripts/ingest/library_seed.py
    scripts/ingest/.venv/bin/python scripts/ingest/library_seed.py --check
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import (  # noqa: E402
    DATA_DIR,
    log,
    read_json,
    section_sort_key,
    strip_volatile,
    update_versions,
    utc_now,
    validate,
    write_json,
)

VERSION = "1.0.0"
STAMP = utc_now()[:10]

LIBRARY_DIR = DATA_DIR / "library"
WORKS_DIR = LIBRARY_DIR / "works"
INDEX_OUT = LIBRARY_DIR / "index.json"
AUTHORED_HINDI = Path(__file__).resolve().parent.parent / "authoring" / "hindi"

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ के लिए; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से सत्यापित करें।",
}

# Words per minute. English prose at 180; Devanagari at 140, because a
# Devanagari word carries more of a sentence than an English one does and is
# read more slowly per token. Both are estimates and the UI says "about".
WPM_EN = 180
WPM_HI = 140

# ---------------------------------------------------------------------------
# The fifteen works
# ---------------------------------------------------------------------------
#
# `category`, `description` and `examTags` are this project's own editorial
# labels — how an officer would look for the book, not anything the Ministry
# published. Every tag must have a bilingual label in `src/lib/library/tags.ts`,
# which is a compile-time exhaustive map, and `tests/library-data.test.ts`
# asserts the two agree.

RULE_WORKS: list[dict[str, Any]] = [
    {
        "id": "ccs-conduct",
        "year": 1964,
        "category": "service-rules",
        "examTags": ["conduct", "vigilance", "probation", "departmental-exam"],
        "description": {
            "en": "What a Government servant may and may not do — integrity, gifts, private trade, "
            "property returns, political activity and the conduct rules a disciplinary case is built on.",
            "hi": "सरकारी सेवक क्या कर सकता है और क्या नहीं — सत्यनिष्ठा, उपहार, निजी व्यापार, "
            "संपत्ति विवरणी, राजनीतिक गतिविधि तथा वे आचरण नियम जिन पर अनुशासनिक कार्रवाई आधारित होती है।",
        },
    },
    {
        "id": "ccs-cca",
        "year": 1965,
        "category": "service-rules",
        "examTags": ["discipline", "vigilance", "departmental-exam", "ldce"],
        "description": {
            "en": "Classification of services, the penalties that may be imposed, who may impose them, "
            "and the inquiry and appeal procedure every disciplinary proceeding must follow.",
            "hi": "सेवाओं का वर्गीकरण, अधिरोपित की जा सकने वाली शास्तियाँ, उन्हें अधिरोपित करने वाला "
            "प्राधिकारी, तथा प्रत्येक अनुशासनिक कार्यवाही में अपनाई जाने वाली जाँच और अपील प्रक्रिया।",
        },
    },
    {
        "id": "ccs-leave",
        "year": 1972,
        "category": "service-rules",
        "examTags": ["leave", "establishment", "departmental-exam"],
        "description": {
            "en": "Every kind of leave a central Government servant can earn or take — earned leave, "
            "half pay, commuted, maternity, paternity, child care, study and extraordinary leave.",
            "hi": "केंद्रीय सरकारी सेवक द्वारा अर्जित या ली जा सकने वाली प्रत्येक प्रकार की छुट्टी — "
            "अर्जित अवकाश, अर्ध वेतन, परिवर्तित, प्रसूति, पितृत्व, शिशु देखभाल, अध्ययन तथा असाधारण छुट्टी।",
        },
    },
    {
        "id": "ccs-pension",
        "year": 2021,
        "category": "service-rules",
        "examTags": ["pension", "retirement", "establishment"],
        "description": {
            "en": "Qualifying service, superannuation, retirement and death gratuity, family pension, "
            "commutation and the papers a retiring officer's office has to put together.",
            "hi": "अर्हक सेवा, अधिवर्षिता, सेवानिवृत्ति और मृत्यु उपदान, पारिवारिक पेंशन, संराशीकरण "
            "तथा सेवानिवृत्त हो रहे अधिकारी के कार्यालय द्वारा तैयार किए जाने वाले दस्तावेज़।",
        },
    },
    {
        "id": "fr-sr",
        "year": 1922,
        "category": "service-rules",
        "examTags": ["pay-and-allowances", "establishment", "departmental-exam", "ldce"],
        "description": {
            "en": "The Fundamental and Supplementary Rules — pay fixation, joining time, foreign service, "
            "compensatory allowances and the definitions the rest of establishment work rests on.",
            "hi": "मूल तथा अनुपूरक नियम — वेतन निर्धारण, कार्यग्रहण अवधि, विदेश सेवा, प्रतिकर भत्ते "
            "तथा वे परिभाषाएँ जिन पर शेष स्थापना-कार्य आधारित है।",
        },
    },
    {
        "id": "gfr",
        "year": 2017,
        "category": "finance",
        "examTags": ["procurement", "finance", "departmental-exam"],
        "description": {
            "en": "The General Financial Rules — how public money is spent: budgeting, procurement of "
            "goods, works and services, GeM, contracts, grants-in-aid and the audit trail behind each.",
            "hi": "सामान्य वित्तीय नियम — सार्वजनिक धन कैसे व्यय होता है: बजट, माल, कार्य और सेवाओं की "
            "खरीद, जेम, संविदाएँ, सहायता अनुदान तथा प्रत्येक के पीछे का लेखा-परीक्षा अभिलेख।",
        },
    },
    {
        "id": "csmop",
        "year": 2022,
        "category": "office-procedure",
        "examTags": ["noting-and-drafting", "file-management", "induction"],
        "description": {
            "en": "The Central Secretariat Manual of Office Procedure — how a file is opened, noted on, "
            "referred, and how every kind of official communication is drafted and issued.",
            "hi": "केंद्रीय सचिवालय कार्यालय प्रक्रिया नियमावली — फ़ाइल कैसे खोली जाती है, उस पर टिप्पणी "
            "कैसे लिखी जाती है, तथा प्रत्येक प्रकार का सरकारी पत्राचार कैसे प्रारूपित और जारी किया जाता है।",
        },
    },
    {
        "id": "rti",
        "year": 2005,
        "category": "transparency",
        "examTags": ["rti", "transparency", "departmental-exam"],
        "description": {
            "en": "The Right to Information Act — what a public authority must publish, the thirty-day "
            "clock, the exemptions under section 8, third-party procedure and the appeal route.",
            "hi": "सूचना का अधिकार अधिनियम — लोक प्राधिकरण द्वारा प्रकाशित की जाने वाली सूचना, तीस दिन "
            "की समय-सीमा, धारा 8 की छूटें, तृतीय-पक्ष प्रक्रिया तथा अपील का मार्ग।",
        },
    },
    {
        "id": "osa",
        "year": 1923,
        "category": "security",
        "examTags": ["security", "vigilance"],
        "description": {
            "en": "The Official Secrets Act — prohibited places, wrongful communication of information, "
            "and the offences an officer handling classified material is expected to know by heart.",
            "hi": "शासकीय गुप्त बात अधिनियम — प्रतिषिद्ध स्थान, सूचना का दोषपूर्ण संसूचन, तथा वर्गीकृत "
            "सामग्री संभालने वाले अधिकारी से अपेक्षित अपराधों की जानकारी।",
        },
    },
    {
        "id": "posh",
        "year": 2013,
        "category": "workplace",
        "examTags": ["workplace-safety", "establishment", "induction"],
        "description": {
            "en": "Sexual harassment of women at the workplace — the Internal Committee, the complaint "
            "and inquiry procedure, timelines, and the employer's own statutory duties.",
            "hi": "कार्यस्थल पर महिलाओं का लैंगिक उत्पीड़न — आंतरिक समिति, शिकायत एवं जाँच प्रक्रिया, "
            "समय-सीमाएँ, तथा नियोजक के अपने वैधानिक कर्तव्य।",
        },
    },
    {
        "id": "ol-act",
        "year": 1963,
        "category": "official-language",
        "examTags": ["official-language", "induction"],
        "description": {
            "en": "The Official Languages Act — where Hindi is to be used, where English continues, and "
            "the statutory basis of every Rajbhasha instruction an office receives.",
            "hi": "राजभाषा अधिनियम — हिंदी का प्रयोग कहाँ किया जाना है, अंग्रेज़ी कहाँ जारी रहेगी, तथा "
            "कार्यालय को प्राप्त प्रत्येक राजभाषा अनुदेश का वैधानिक आधार।",
        },
    },
    {
        "id": "ol-rules",
        "year": 1976,
        "category": "official-language",
        "examTags": ["official-language", "noting-and-drafting"],
        "description": {
            "en": "The Official Languages Rules — regions A, B and C, when a communication must be "
            "bilingual, translation duties and the returns an office files.",
            "hi": "राजभाषा नियम — क, ख और ग क्षेत्र, पत्राचार कब द्विभाषी होना चाहिए, अनुवाद संबंधी "
            "कर्तव्य तथा कार्यालय द्वारा भेजी जाने वाली विवरणियाँ।",
        },
    },
]

LAW_WORKS: list[dict[str, Any]] = [
    {
        "id": "bns",
        "year": 2023,
        "category": "criminal-law",
        "examTags": ["criminal-law", "investigation", "departmental-exam"],
        "description": {
            "en": "The Bharatiya Nyaya Sanhita — the substantive criminal law that replaced the Indian "
            "Penal Code on 1 July 2024. Offences, general exceptions and punishments, chapter by chapter.",
            "hi": "भारतीय न्याय संहिता — वह मूल दंड विधि जिसने 1 जुलाई 2024 को भारतीय दण्ड संहिता का "
            "स्थान लिया। अपराध, साधारण अपवाद तथा दंड, अध्यायवार।",
        },
    },
    {
        "id": "bnss",
        "year": 2023,
        "category": "criminal-law",
        "examTags": ["criminal-procedure", "investigation", "departmental-exam"],
        "description": {
            "en": "The Bharatiya Nagarik Suraksha Sanhita — criminal procedure from first information to "
            "appeal, replacing the Code of Criminal Procedure, 1973.",
            "hi": "भारतीय नागरिक सुरक्षा संहिता — प्रथम सूचना से अपील तक की दंड प्रक्रिया, जिसने दंड "
            "प्रक्रिया संहिता, 1973 का स्थान लिया।",
        },
    },
    {
        "id": "bsa",
        "year": 2023,
        "category": "criminal-law",
        "examTags": ["evidence", "investigation"],
        "description": {
            "en": "The Bharatiya Sakshya Adhiniyam — relevancy, admissibility, electronic records, burden "
            "of proof and witnesses, replacing the Indian Evidence Act, 1872.",
            "hi": "भारतीय साक्ष्य अधिनियम — सुसंगति, ग्राह्यता, इलेक्ट्रॉनिक अभिलेख, सबूत का भार तथा "
            "साक्षी, जिसने भारतीय साक्ष्य अधिनियम, 1872 का स्थान लिया।",
        },
    },
]

# Where the official text itself is published, as opposed to `source`, which is
# the document this repository actually read. For the three Sanhitas the two
# genuinely differ: the section text comes from NCRB Sankalan's chapter pages,
# the correspondence table from its section table. Neither is invented — both
# are URLs already cited by `data/law/*.json`.

# ---------------------------------------------------------------------------
# Amendment notes
# ---------------------------------------------------------------------------
#
# A slot for "this provision has changed and the text below has not caught up".
#
# It exists because the alternative is worse in both directions. Editing the
# base text would make `data/library` a second, divergent copy of a statute the
# ingest owns — the exact thing ADR-038 §1 refuses. Saying nothing would leave
# an officer reading the RTI Act's section 8 in this app the old clause (j),
# with no hint that Parliament substituted it. So the STRUCTURE layer carries a
# dated, sourced note and the reader renders it as a banner above the unit,
# and the text underneath stays exactly what the source publishes.
#
# EVERY NOTE IS HAND-WRITTEN AND HAND-SOURCED. Nothing here is extracted, and
# `self_check` refuses a note whose unit is not in the work's own reading order,
# so a renumbered corpus fails the build rather than silently dropping a banner.
# The list is deliberately short: these are the amendments an officer using this
# app in 2026 will actually trip over, not a change history.

AMENDMENTS: dict[str, dict[str, list[dict[str, Any]]]] = {
    "rti": {
        "rti-8": [
            {
                "date": "2025-11-13",
                "note": {
                    "en": "Clause (j) of sub-section (1) was SUBSTITUTED by section 44(3) of the Digital "
                    "Personal Data Protection Act, 2023, which came into force on 13 November 2025 "
                    "(G.S.R. 843(E)). The substituted clause exempts \u201cinformation which relates to "
                    "personal information\u201d, without the public-activity, unwarranted-invasion and "
                    "larger-public-interest wording printed below. The text below is the Act as this "
                    "repository last read it and does not yet reflect the substitution.",
                    "hi": "उपधारा (1) के खंड (ज) को डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 की धारा "
                    "44(3) द्वारा प्रतिस्थापित किया गया, जो 13 नवंबर 2025 को प्रवृत्त हुई (जी.एस.आर. "
                    "843(अ))। प्रतिस्थापित खंड \u201cऐसी सूचना जो व्यक्तिगत सूचना से संबंधित है\u201d को "
                    "छूट देता है, तथा नीचे मुद्रित लोक-गतिविधि, अनुचित अतिक्रमण और वृहत्तर लोकहित संबंधी "
                    "शब्दावली उसमें नहीं है। नीचे दिया गया पाठ वही है जो इस भंडार ने अंतिम बार पढ़ा था और "
                    "उसमें यह प्रतिस्थापन अभी सम्मिलित नहीं है।",
                },
                "source": {
                    "name": "The Digital Personal Data Protection Act, 2023 (No. 22 of 2023), s. 44(3)",
                    "url": "https://egazette.gov.in/WriteReadData/2023/248045.pdf",
                },
            }
        ]
    },
    "bns": {
        "1": [
            {
                "date": "2024-07-01",
                "note": {
                    "en": "Brought into force on 1 July 2024 by S.O. 850(E) of 23 February 2024, EXCEPT "
                    "sub-section (2) of section 106, which has not been brought into force. An offence "
                    "committed before that date is dealt with under the Indian Penal Code, 1860.",
                    "hi": "23 फरवरी 2024 की अधिसूचना एस.ओ. 850(अ) द्वारा 1 जुलाई 2024 से प्रवृत्त, धारा "
                    "106 की उपधारा (2) को छोड़कर, जो प्रवृत्त नहीं की गई है। उस तिथि से पूर्व किए गए अपराध "
                    "पर भारतीय दण्ड संहिता, 1860 लागू होती है।",
                },
                "source": {
                    "name": "Ministry of Home Affairs, S.O. 850(E), 23 February 2024",
                    "url": "https://www.mha.gov.in/sites/default/files/BhartiyaNyayaSanhita_24022024.pdf",
                },
            }
        ],
        "106": [
            {
                "date": "2024-07-01",
                "note": {
                    "en": "Sub-section (2) of this section is NOT in force. The commencement notification "
                    "brought the Sanhita into force from 1 July 2024 except this sub-section.",
                    "hi": "इस धारा की उपधारा (2) प्रवृत्त नहीं है। प्रवर्तन अधिसूचना ने इस उपधारा को छोड़कर "
                    "संहिता को 1 जुलाई 2024 से प्रवृत्त किया।",
                },
                "source": {
                    "name": "Ministry of Home Affairs, S.O. 850(E), 23 February 2024",
                    "url": "https://www.mha.gov.in/sites/default/files/BhartiyaNyayaSanhita_24022024.pdf",
                },
            }
        ],
    },
    "bnss": {
        "1": [
            {
                "date": "2024-07-01",
                "note": {
                    "en": "Brought into force on 1 July 2024 by the Ministry of Home Affairs notification "
                    "of 23 February 2024. A proceeding pending immediately before that date continues "
                    "under the Code of Criminal Procedure, 1973 \u2014 see section 531.",
                    "hi": "गृह मंत्रालय की 23 फरवरी 2024 की अधिसूचना द्वारा 1 जुलाई 2024 से प्रवृत्त। उस "
                    "तिथि से ठीक पूर्व लंबित कार्यवाही दंड प्रक्रिया संहिता, 1973 के अधीन जारी रहती है "
                    "\u2014 धारा 531 देखें।",
                },
                "source": {
                    "name": "Ministry of Home Affairs notification, 23 February 2024",
                    "url": "https://www.mha.gov.in/sites/default/files/BharatiyaNagarikSurakshaSanhita_24022024.pdf",
                },
            }
        ]
    },
    "bsa": {
        "1": [
            {
                "date": "2024-07-01",
                "note": {
                    "en": "Brought into force on 1 July 2024 by the Ministry of Home Affairs notification "
                    "of 23 February 2024, replacing the Indian Evidence Act, 1872.",
                    "hi": "गृह मंत्रालय की 23 फरवरी 2024 की अधिसूचना द्वारा 1 जुलाई 2024 से प्रवृत्त, जिसने "
                    "भारतीय साक्ष्य अधिनियम, 1872 का स्थान लिया।",
                },
                "source": {
                    "name": "Ministry of Home Affairs notification, 23 February 2024",
                    "url": "https://www.mha.gov.in/sites/default/files/BharatiyaSakshyaAdhiniyam_24022024.pdf",
                },
            }
        ]
    },
}


def amendments_for(work_id: str, reading_order: list[str]) -> dict[str, list[dict[str, Any]]]:
    """This work's notes, keyed by unit id. Empty for a work with none."""
    known = set(reading_order)
    notes = AMENDMENTS.get(work_id, {})
    return {unit: entries for unit, entries in sorted(notes.items()) if unit in known}


LAW_OFFICIAL_SOURCE_ID = "ncrb-sankalan-chapters"


def word_count(text: str) -> tuple[int, int]:
    """(latin words, devanagari words) in one string."""
    words = text.split()
    hi = sum(1 for w in words if re.search(r"[ऀ-ॿ]", w))
    return len(words) - hi, hi


def minutes_for(latin: int, devanagari: int) -> int:
    """At least one minute: a two-line rule still takes a moment to read."""
    return max(1, math.ceil(latin / WPM_EN + devanagari / WPM_HI))


def authored_hindi(act_id: str) -> dict[str, str]:
    """Hindi rule headings, keyed by rule number. `_note` is not a rule."""
    raw = read_json(AUTHORED_HINDI / f"{act_id}.json", default={})
    return {k: v for k, v in raw.items() if not k.startswith("_")}


# How long a navigation excerpt may be. Long enough to tell two rules apart,
# short enough that nobody mistakes it for the provision.
EXCERPT_CHARS = 96


def excerpt_of(text: dict[str, str]) -> dict[str, str]:
    """The first sentence-ish of a unit, for a unit that has no heading.

    Four of the twelve rule books print no heading their extractor could read —
    the whole of FR/SR and CSMOP, thirteen GFR rules and a handful of others —
    so an English table of contents over them would be a column of bare numbers.
    `make_cards.py` already solved this the same way, and a card built on FR/SR
    Rule 1 reads "These rules may be called the Fundamental Rules… — which rule?".
    This is that fallback, and it is a QUOTATION for navigation, not a copy of
    the corpus: it exists only where the heading is missing, it is capped, and
    the reader page reads the provision itself from the corpus as always.
    """
    out: dict[str, str] = {}
    for lang in ("en", "hi"):
        body = " ".join((text.get(lang) or "").split())
        if len(body) > EXCERPT_CHARS:
            body = body[:EXCERPT_CHARS].rsplit(" ", 1)[0] + "\u2026"
        out[lang] = body
    return out


def leaf(
    node_id: str,
    number: str,
    heading: dict[str, str],
    unit_id: str,
    text: dict[str, str],
) -> dict[str, Any]:
    node: dict[str, Any] = {"id": node_id, "number": number, "heading": heading, "unitIds": [unit_id]}
    # Only where a heading is actually missing. A work whose headings are all
    # present carries no excerpts at all, which is most of them.
    if not heading["en"].strip() or not heading["hi"].strip():
        node["excerpt"] = excerpt_of(text)
    return node


def served_card_counts(act_id: str) -> dict[str, int]:
    """How many APPROVED Trainer cards cite each rule of this act.

    Counted here, at build time, from `data/rules/cards/<act>.json` — which is
    up to 1.1 MB and is exactly the wrong thing to download at read time to
    answer "is there anything to practise on this rule". The result is a few
    kilobytes of integers keyed by the same `ruleRef.textId` the cards carry and
    the same unit id the reading order uses, so the reader page can offer the
    link without loading a single card.

    Only `approved` is counted, because only `approved` is ever served
    (`isServed` in src/modules/trainer/schema.ts). A rule whose four cards are
    all awaiting Hindi has nothing to practise, and saying otherwise would send
    a reader to an empty review.
    """
    cards = read_json(DATA_DIR / "rules" / "cards" / f"{act_id}.json")
    if cards is None:
        return {}
    counts: dict[str, int] = {}
    for card in cards["cards"]:
        if card.get("reviewState") != "approved":
            continue
        text_id = (card.get("ruleRef") or {}).get("textId")
        if text_id:
            counts[text_id] = counts.get(text_id, 0) + 1
    return counts


def build_rules_work(meta: dict[str, Any]) -> dict[str, Any]:
    act_id: str = meta["id"]
    corpus = read_json(DATA_DIR / "rules" / "text" / f"{act_id}.json")
    if corpus is None:
        raise FileNotFoundError(f"data/rules/text/{act_id}.json is missing")

    hindi = authored_hindi(act_id)
    act = corpus["act"]

    latin = devanagari = 0
    reading_order: list[str] = []
    leaves: list[dict[str, Any]] = []

    for rule in corpus["rules"]:
        unit_id = rule["id"]
        reading_order.append(unit_id)
        body = " ".join(
            [rule["text"]["en"], rule["text"]["hi"]]
            + [s["text"][lang] for s in rule.get("subRules", []) for lang in ("en", "hi")]
        )
        a, b = word_count(body)
        latin += a
        devanagari += b
        heading = {
            "en": rule["heading"]["en"],
            # The corpus's own `heading.hi` is empty for every one of these
            # twelve books — no Ministry publishes a Hindi issue with a readable
            # text layer (ADR-023). What fills it here is the authored heading
            # `make_cards.py` already uses, so a rule reads the same in the
            # Library and on a Trainer card. Hence `verify: true` on the work.
            "hi": rule["heading"]["hi"] or hindi.get(rule["number"], ""),
        }
        leaves.append(leaf(f"n-{unit_id}", rule["number"], heading, unit_id, rule["text"]))

    # CSMOP is the one rule book whose own numbering carries a division:
    # paragraph "4.7" is paragraph 7 of chapter 4. Grouping by the part before
    # the dot reads structure the document prints; the chapter TITLES are not in
    # this corpus, so the node is labelled by its number alone rather than by a
    # heading nobody published (docs/DATA-GAPS.md #70).
    if act_id == "csmop" and all(re.fullmatch(r"\d+\.\d+[A-Za-z]?", n["number"]) for n in leaves):
        toc: list[dict[str, Any]] = []
        for node in leaves:
            chapter = node["number"].split(".")[0]
            if not toc or toc[-1]["number"] != chapter:
                toc.append(
                    {
                        "id": f"ch-{chapter}",
                        "number": chapter,
                        "heading": {"en": f"Chapter {chapter}", "hi": f"अध्याय {chapter}"},
                        "children": [],
                        "unitIds": [],
                    }
                )
            toc[-1]["children"].append(node)
            toc[-1]["unitIds"].extend(node["unitIds"])
        toc_source = "numbering"
    else:
        toc = leaves
        toc_source = "flat"

    return {
        "$schema": "../../../schemas/library-work.schema.json",
        "version": VERSION,
        "generatedAt": STAMP,
        "id": act_id,
        "title": act["name"],
        "shortTitle": act["short"],
        "year": meta["year"],
        "category": meta["category"],
        "description": meta["description"],
        "corpus": {"kind": "rules", "file": f"rules/text/{act_id}.json"},
        "unitLabel": act["unit"],
        "publisher": act["publisher"],
        "tocSource": toc_source,
        "toc": toc,
        "readingOrder": reading_order,
        "estimatedMinutes": minutes_for(latin, devanagari),
        "practiseCounts": {
            unit_id: count
            for unit_id, count in sorted(served_card_counts(act_id).items())
            if unit_id in set(reading_order)
        },
        "examTags": meta["examTags"],
        "amendments": amendments_for(act_id, reading_order),
        "officialUrl": corpus["source"]["url"],
        "source": corpus["source"],
        "disclaimer": DISCLAIMER,
        # Every rule book's Hindi headings are authored rather than extracted,
        # so no work in this dataset is unconditionally trustworthy Hindi.
        "verify": True,
    }


def build_law_work(meta: dict[str, Any]) -> dict[str, Any]:
    code: str = meta["id"]
    corpus = read_json(DATA_DIR / "law" / f"{code}.json")
    if corpus is None:
        raise FileNotFoundError(f"data/law/{code}.json is missing")

    sections = corpus["sections"]
    order = sorted(sections, key=section_sort_key)

    latin = devanagari = 0
    toc: list[dict[str, Any]] = []

    for key in order:
        record = sections[key]
        body = " ".join(filter(None, [record["text"].get("en", ""), record["text"].get("hi", "")]))
        a, b = word_count(body)
        latin += a
        devanagari += b

        chapter = record.get("chapter") or {}
        number = str(chapter.get("number") or "")
        title = chapter.get("title") or {"en": "", "hi": ""}
        if not toc or toc[-1]["number"] != number:
            toc.append(
                {
                    "id": f"ch-{number or 'none'}-{len(toc)}",
                    "number": number,
                    # The chapter TITLE has no Hindi on NCRB Sankalan and none was
                    # authored: a chapter heading is not a provision, and inventing
                    # one would put unsourced Hindi in a navigation control
                    # (docs/DATA-GAPS.md #70).
                    "heading": {"en": title.get("en", ""), "hi": title.get("hi", "")},
                    "children": [],
                    "unitIds": [],
                }
            )
        toc[-1]["children"].append(
            leaf(
                f"n-{key}",
                key,
                {"en": record["heading"]["en"], "hi": record["heading"]["hi"]},
                key,
                record["text"],
            )
        )
        toc[-1]["unitIds"].append(key)

    primary = next(s for s in corpus["sources"] if s["id"] == "ncrb-sankalan-table")
    official = next(s for s in corpus["sources"] if s["id"] == LAW_OFFICIAL_SOURCE_ID)

    return {
        "$schema": "../../../schemas/library-work.schema.json",
        "version": VERSION,
        "generatedAt": STAMP,
        "id": code,
        "title": corpus["newAct"]["name"],
        "shortTitle": {"en": corpus["newAct"]["id"], "hi": corpus["newAct"]["id"]},
        "year": meta["year"],
        "category": meta["category"],
        "description": meta["description"],
        "corpus": {"kind": "law", "file": f"law/{code}.json"},
        "unitLabel": {"en": "Section", "hi": "धारा"},
        "publisher": "National Crime Records Bureau (Sankalan)",
        "tocSource": "chapters",
        "toc": toc,
        "readingOrder": order,
        "estimatedMinutes": minutes_for(latin, devanagari),
        # Nothing in `data/rules/cards` cites a law section — every card's
        # `ruleRef.textId` resolves into `data/rules/text`. Written as an empty
        # map rather than omitted, so a consumer never has to test for absence.
        "practiseCounts": {},
        "examTags": meta["examTags"],
        "amendments": amendments_for(code, order),
        "officialUrl": official["url"],
        "source": {"name": primary["name"]["en"], "url": primary["url"]},
        "disclaimer": DISCLAIMER,
        # The Hindi headings on these 1,059 records are curated by this project,
        # not published by NCRB — data/law/overlays/*-hindi-curated.json.
        "verify": True,
    }


def build_index(works: list[dict[str, Any]]) -> dict[str, Any]:
    """What `/library` needs to draw fifteen cards, and nothing else.

    Deliberately free of `toc` and `readingOrder`: the hub renders a grid of
    names and counts, and the fifteen work files together are ~700 KB. Same
    arrangement `data/drafting/index.json` has (ADR-020).
    """
    return {
        "$schema": "../../schemas/library-index.schema.json",
        "version": VERSION,
        "generatedAt": STAMP,
        "disclaimer": DISCLAIMER,
        "totals": {
            "works": len(works),
            "units": sum(len(w["readingOrder"]) for w in works),
            "minutes": sum(w["estimatedMinutes"] for w in works),
        },
        "works": [
            {
                "id": w["id"],
                "title": w["title"],
                "shortTitle": w["shortTitle"],
                **({"year": w["year"]} if w.get("year") else {}),
                "category": w["category"],
                "description": w["description"],
                "unitLabel": w["unitLabel"],
                "publisher": w["publisher"],
                "corpus": w["corpus"],
                "tocSource": w["tocSource"],
                "unitCount": len(w["readingOrder"]),
                "estimatedMinutes": w["estimatedMinutes"],
                "examTags": w["examTags"],
                "officialUrl": w["officialUrl"],
                "source": w["source"],
                "file": f"works/{w['id']}.json",
                "verify": w["verify"],
            }
            for w in works
        ],
    }


def self_check(works: list[dict[str, Any]], index: dict[str, Any]) -> int:
    """Cross-references a JSON Schema cannot see."""
    failures = 0

    def bad(message: str) -> None:
        nonlocal failures
        log(f"  ! {message}")
        failures += 1

    for work in works:
        wid = work["id"]
        units = set(work["readingOrder"])
        if len(units) != len(work["readingOrder"]):
            bad(f"{wid}: readingOrder repeats a unit id")

        # Every id the TOC names has to be a unit, and every unit has to be
        # reachable from the TOC — a work whose TOC omits a rule is a work with
        # a rule nobody can navigate to.
        in_toc: list[str] = []

        def walk(nodes: list[dict[str, Any]]) -> None:
            for node in nodes:
                in_toc.extend(node["unitIds"])
                children = node.get("children") or []
                if children:
                    flattened = [u for child in children for u in child["unitIds"]]
                    if flattened != node["unitIds"]:
                        bad(f"{wid}: node {node['id']} does not carry its children's unit ids")
                    walk(children)

        walk(work["toc"])
        leaves_only = [u for u in in_toc if u]
        if sorted(set(leaves_only)) != sorted(units):
            bad(f"{wid}: TOC and readingOrder cover different units")
        if [u for u in leaves_only if u not in units]:
            bad(f"{wid}: TOC names a unit that is not in readingOrder")

        corpus_path = DATA_DIR / work["corpus"]["file"]
        if not corpus_path.exists():
            bad(f"{wid}: corpus pointer {work['corpus']['file']} does not exist")
            continue
        corpus = read_json(corpus_path)
        if work["corpus"]["kind"] == "rules":
            real = {r["id"] for r in corpus["rules"]}
        else:
            real = set(corpus["sections"])
        missing = units - real
        if missing:
            bad(f"{wid}: {len(missing)} unit id(s) not in the corpus, e.g. {sorted(missing)[:3]}")

        stray = set(work["practiseCounts"]) - units
        if stray:
            bad(f"{wid}: practiseCounts names {len(stray)} unit(s) not in this work")
        if any(count < 1 for count in work["practiseCounts"].values()):
            bad(f"{wid}: practiseCounts holds a zero, which should be an absent key")

        if not work["description"]["hi"].strip():
            bad(f"{wid}: no Hindi description")
        if not work["examTags"]:
            bad(f"{wid}: no exam tags")

        # An amendment note is a banner rendered ABOVE a specific unit. A note
        # keyed to a unit this work does not have renders nowhere at all, which
        # is the failure this catches: `amendments_for` filters against the
        # reading order, so a key that survives to here means the two disagree.
        # A renumbered corpus fails the build rather than silently dropping the
        # one thing on the page that says the text below is out of date.
        for unit_id, notes in work.get("amendments", {}).items():
            if unit_id not in units:
                bad(f"{wid}: amendment note on {unit_id}, which is not a unit of this work")
            for note in notes:
                if not note["note"]["hi"].strip():
                    bad(f"{wid}: amendment note on {unit_id} has no Hindi")
                if not note["source"]["url"].startswith("http"):
                    bad(f"{wid}: amendment note on {unit_id} has no source URL")

    ids = [w["id"] for w in index["works"]]
    if len(ids) != len(set(ids)):
        bad("index repeats a work id")
    if len(ids) != 15:
        bad(f"expected 15 works, built {len(ids)}")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="rebuild and compare against disk; write nothing")
    args = parser.parse_args()

    works = [build_rules_work(meta) for meta in RULE_WORKS]
    works += [build_law_work(meta) for meta in LAW_WORKS]
    works.sort(key=lambda w: w["id"])
    index = build_index(works)

    for work in works:
        validate(work, "library-work.schema.json")
    validate(index, "library-index.schema.json")

    failures = self_check(works, index)
    if failures:
        log(f"! {failures} self-check failure(s)")
        return 1

    outputs: dict[Path, Any] = {WORKS_DIR / f"{w['id']}.json": w for w in works}
    outputs[INDEX_OUT] = index

    if args.check:
        ok = True
        for path, payload in outputs.items():
            # Compare the CONTENT, not the run stamp. Every payload carries a
            # `generatedAt` of today, so a bare `!=` reported all sixteen files
            # as differing on any day after they were written — a check that
            # could never pass, and so one nobody could put in CI. It is the
            # same masking `ingest_common.write_if_content_changed` already
            # does for the weekly law cron, and `generatedAt` was already in
            # `VOLATILE_KEYS`; this was the one caller not using it.
            if strip_volatile(read_json(path)) != strip_volatile(payload):
                log(f"! {path}: on disk differs from what this script builds")
                ok = False
        log(f"{'ok' if ok else 'FAILED'}: {len(outputs)} file(s) compared")
        return 0 if ok else 1

    for path, payload in outputs.items():
        changed, _ = write_json(path, payload)
        log(f"{'wrote' if changed else 'same '} {path.relative_to(DATA_DIR.parent)}")

    update_versions(
        {
            "library": {
                "version": VERSION,
                "updated": STAMP,
                "label": {"en": "Library reading structure", "hi": "पुस्तकालय पठन-संरचना"},
                "rows": len(works),
                "units": index["totals"]["units"],
            }
        },
        generated_at=utc_now(),
    )

    log(f"  {len(works)} works, {index['totals']['units']} units, ~{index['totals']['minutes']} minutes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
