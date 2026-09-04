#!/usr/bin/env python3
"""Write ``data/exams/index.json`` and ``data/exams/profiles/*.json``.

An exam profile is PUBLIC syllabus structure over PUBLIC law and nothing else.
It records which papers an examination has, what each is worth, and which of the
rule books this app already ships each syllabus head maps on to. It carries no
question paper, no departmental manual, no internally circulated material and
nothing about any organisation's operations. Where a syllabus head names a
document this app does not hold — the Delegation of Financial Powers Rules, the
Indian Railway Establishment Code, the Intelligence Bureau's own standing orders
— the unit is ``{"external": true}``: named, weighted, and left empty, so the
readiness figure counts it against the reader instead of pretending it is not
there.

## One fetched notification, three profiles

Every profile here is read off ONE document:

    Section Officers' / Stenographers' (Grade 'B' / Grade I) Limited
    Departmental Competitive Examination, 2016 & 2017 — Notification of Rules,
    No. 6/1/2020-CS.I(P) dated 15 September 2021, published in the Gazette of
    India, Extraordinary, Part II, Section 3, Sub-section (i).

It is a combined examination, so its Appendix carries one scheme (three written
papers, 500 marks, plus a 100-mark evaluation of record of service) and its
Schedule carries a per-CATEGORY list of reference books. Three of its nine
categories are cadres this app can usefully serve:

* Category I    — Section Officers' Grade of the Central Secretariat Service
* Category III  — Section Officers' Grade of the Railway Board Secretariat Service
* Category VIII — Section Officers' Grade of the Intelligence Bureau

so there are three profiles, and each one's Paper II units are that category's
own reference list, in the notification's own order. The document was fetched
(``PATTERN_SOURCE`` carries the sha256 of the bytes read), so all three carry
``verify: False``.

## What is deliberately NOT here

*Weights.* No notification apportions a paper between its topics — it gives the
paper's marks and stops. So each head named in the Schedule for a paper takes an
equal share of that paper, ``weightBasis`` says exactly that in both languages,
and every surface that renders a weight renders that sentence with it.

*The Official Secrets Act.* The session brief suggested it for the Intelligence
Bureau profile. It is not in the notification's reference list for Category VIII,
so it is not a unit. ``src/modules/onboarding/actHints.ts`` may still switch OSA
cards on for an IB officer — that is a guess about their WORK, which is a
different and much weaker claim than a syllabus.

*Three exams the brief named.* No public notification of a pattern could be
fetched for a CBI departmental examination, a CAPF one, or the Income Tax
Inspector-to-ITO examination; ``docs/DATA-GAPS.md`` records what was tried for
each. A profile with an invented paper list is the exact failure the boundary
exists to prevent, so none was written.

*Hindi from the document.* The notification's Hindi half is typeset from a
legacy font and extracts as byte soup — ``fk)I'-ld wr eii`` for the Ministry's
own name — which is the same thing ``extract_rules.py --audit-hindi`` measured
across every Ministry PDF in this repository. Every Hindi string below is
authored, as it is everywhere else here, and never "corrected" against the
extracted text.

    scripts/ingest/.venv/bin/python scripts/ingest/exams_seed.py
    scripts/ingest/.venv/bin/python scripts/ingest/exams_seed.py --check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, log, read_json, update_versions, validate, write_json  # noqa: E402

OUT_DIR = DATA_DIR / "exams"
INDEX_OUT = OUT_DIR / "index.json"

VERSION = "1.0.0"
GENERATED_AT = "2026-09-04"
STAMP = "2026-09-04T00:00:00Z"

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से पुष्टि करें।",
}

PATTERN_SOURCE = {
    "name": (
        "Section Officers' / Stenographers' (Grade 'B' / Grade I) Limited Departmental Competitive "
        "Examination, 2016 & 2017 — Notification of Rules, No. 6/1/2020-CS.I(P) dated 15.09.2021 "
        "(Gazette of India, Extraordinary, Part II, Section 3, Sub-section (i))"
    ),
    "url": "https://documents.doptcirculars.nic.in/D2/D02csd/SO%20LDCE%202016%202017D3tcU.pdf",
    "fetchedAt": "2026-09-04T00:00:00Z",
    "sha256": "c0a918c1b2e234a5c4e177a4015ab8f9783630c2c6579d75e129f76e988e0c2c",
}

# The Appendix, paragraph 3: "For each question for which a wrong answer has
# been given by the candidate, one third of the marks assigned to that question
# will be deducted as penalty." Stored as the fraction it is; `src/lib/exam/
# mock.ts` is what applies it, and it never penalises a blank.
ONE_THIRD = 0.3333

WEIGHT_BASIS = {
    "en": (
        "Each head named in the notification's own Schedule for a paper carries an equal share of that "
        "paper's marks. No notification apportions a paper between its topics, so this split is this "
        "app's, not the Commission's — use it to decide what to study next, never as a marks table."
    ),
    "hi": (
        "अधिसूचना की अपनी अनुसूची में किसी प्रश्नपत्र हेतु नामित प्रत्येक शीर्ष को उस प्रश्नपत्र के अंकों का "
        "समान भाग दिया गया है। कोई भी अधिसूचना प्रश्नपत्र के अंकों को विषयों में नहीं बाँटती, अतः यह विभाजन "
        "इस ऐप का है, आयोग का नहीं — इसे आगे क्या पढ़ना है यह तय करने हेतु प्रयोग करें, अंक-तालिका के रूप में कभी नहीं।"
    ),
}


def bl(en: str, hi: str) -> dict[str, str]:
    return {"en": en, "hi": hi}


def acts(*ids: str) -> list[dict[str, Any]]:
    """Coverage that resolves into `data/rules/text/<act>.json`."""
    return [{"act": act_id} for act_id in ids]


def external(en: str, hi: str) -> dict[str, Any]:
    """A syllabus head this app holds nothing for. Named, never quietly dropped."""
    return {"external": True, "note": bl(en, hi)}


def unit(unit_id: str, name: dict[str, str], coverage: Any) -> dict[str, Any]:
    """Weight is filled in by `apportion` once the paper's head count is known."""
    return {"id": unit_id, "name": name, "coverage": coverage}


def apportion(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """An equal share each, rounded to 4 dp, with the last unit taking the remainder.

    The remainder matters: 1/7 rounded seven times is 0.9997, and a paper whose
    weights do not sum to 1 makes every readiness figure over it slightly wrong
    in a direction nobody would notice. `self_check` asserts the sum.
    """
    share = round(1 / len(units), 4)
    out = []
    for index, item in enumerate(units):
        weight = round(1 - share * (len(units) - 1), 4) if index == len(units) - 1 else share
        out.append({**item, "weight": weight})
    return out


# --------------------------------------------------------------------------
# The three written papers. The Appendix's own table, verbatim in structure.
# --------------------------------------------------------------------------

PAPER_I_UNITS = [
    unit(
        "current-affairs",
        bl(
            "Current affairs, the Five Year Plans, the Indian economy and major developmental schemes",
            "सामयिक घटनाएँ, पंचवर्षीय योजनाएँ, भारतीय अर्थव्यवस्था तथा प्रमुख विकास योजनाएँ",
        ),
        external(
            "Not in this app. A daily newspaper and the Ministry's own scheme pages are the sources the notification points at.",
            "इस ऐप में नहीं। अधिसूचना जिन स्रोतों की ओर संकेत करती है वे दैनिक समाचार पत्र तथा संबंधित मंत्रालय के योजना पृष्ठ हैं।",
        ),
    ),
    unit(
        "constitution",
        bl("Principles of the Constitution of India", "भारत के संविधान के सिद्धांत"),
        external(
            "Not in this app. This app ships the criminal codes and the service rules, not the Constitution.",
            "इस ऐप में नहीं। यह ऐप दंड संहिताएँ तथा सेवा नियम रखता है, संविधान नहीं।",
        ),
    ),
    unit(
        "parliament-procedure",
        bl(
            "Rules of Procedure and Conduct of Business in the Lok Sabha and the Rajya Sabha",
            "लोक सभा तथा राज्य सभा में प्रक्रिया एवं कार्य संचालन के नियम",
        ),
        external(
            "Not in this app. Both Houses publish their own Rules of Procedure.",
            "इस ऐप में नहीं। दोनों सदन अपनी प्रक्रिया-नियमावली स्वयं प्रकाशित करते हैं।",
        ),
    ),
    unit(
        "machinery-of-government",
        bl(
            "Organisation of the machinery of the Government of India — allocation of subjects between Ministries, Departments and attached and subordinate offices",
            "भारत सरकार के तंत्र का संगठन — मंत्रालयों, विभागों तथा संलग्न एवं अधीनस्थ कार्यालयों के बीच विषयों का आवंटन",
        ),
        external(
            "Not in this app. The Government of India (Allocation of Business) Rules are the source.",
            "इस ऐप में नहीं। इसका स्रोत भारत सरकार (कार्य आवंटन) नियम हैं।",
        ),
    ),
    unit(
        "rti-act",
        bl("The Right to Information Act, 2005", "सूचना का अधिकार अधिनियम, 2005"),
        acts("rti"),
    ),
]

PAPER_III_UNITS = [
    unit(
        "noting-drafting-precis",
        bl("Noting and drafting on a given problem, and precis of a passage", "दी गई समस्या पर टिप्पणी एवं प्रारूपण, तथा गद्यांश का सार-लेखन"),
        external(
            "A written paper with no key, so this app cannot set a mock for it. Practise it in the Drafting Studio, which carries the CSMOP 2022 forms and a checklist for each.",
            "यह लिखित प्रश्नपत्र है जिसकी कोई उत्तर-कुंजी नहीं, अतः इस हेतु यह ऐप मॉक नहीं बना सकता। प्रारूपण कक्ष में अभ्यास करें, जिसमें सीएसएमओपी 2022 के प्रपत्र तथा प्रत्येक हेतु जाँच-सूची है।",
        ),
    ),
]


def paper_one() -> dict[str, Any]:
    return {
        "id": "paper-1",
        "name": bl(
            "Paper I — General Studies and General Knowledge",
            "प्रश्नपत्र I — सामान्य अध्ययन तथा सामान्य ज्ञान",
        ),
        "marks": 150,
        "durationMinutes": 120,
        "objective": True,
        "negativeMarking": ONE_THIRD,
        "units": apportion(PAPER_I_UNITS),
    }


def paper_two(units: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": "paper-2",
        "name": bl(
            "Paper II — Procedure and practice in the Government of India Secretariat, and General Financial and Service Rules",
            "प्रश्नपत्र II — भारत सरकार सचिवालय में प्रक्रिया एवं कार्यपद्धति, तथा सामान्य वित्तीय एवं सेवा नियम",
        ),
        "marks": 150,
        "durationMinutes": 120,
        "objective": True,
        "negativeMarking": ONE_THIRD,
        "units": apportion(units),
    }


def paper_three() -> dict[str, Any]:
    return {
        "id": "paper-3",
        "name": bl("Paper III — Noting and Drafting, Precis Writing", "प्रश्नपत्र III — टिप्पणी एवं प्रारूपण, सार-लेखन"),
        "marks": 200,
        "durationMinutes": 180,
        # Subjective, so the Appendix's one-third penalty does not apply and no
        # `negativeMarking` is recorded. Absent means none, and that is a fact
        # about the paper rather than a figure that could not be found.
        "objective": False,
        "units": apportion(PAPER_III_UNITS),
    }


# --------------------------------------------------------------------------
# Paper II's reference lists, per category, in the Schedule's own order
# --------------------------------------------------------------------------

MOP = unit(
    "manual-of-office-procedure",
    bl("Manual of Office Procedure (latest edition)", "कार्यालय प्रक्रिया नियमावली (नवीनतम संस्करण)"),
    acts("csmop"),
)
ISTM_NOTES = unit(
    "istm-office-procedure-notes",
    bl(
        "Notes on office procedure issued by the Institute of Secretariat Training and Management",
        "सचिवालय प्रशिक्षण एवं प्रबंधन संस्थान द्वारा जारी कार्यालय प्रक्रिया संबंधी टिप्पणियाँ",
    ),
    external(
        "ISTM publishes this reading material itself; it is not a rule book this app ships.",
        "यह पठन-सामग्री आईएसटीएम स्वयं प्रकाशित करता है; यह इस ऐप में उपलब्ध नियम-पुस्तक नहीं है।",
    ),
)
OL_HANDBOOK = unit(
    "official-language-handbook",
    bl(
        "Handbook of orders regarding use of Hindi for the official purposes of the Union",
        "संघ के राजकीय प्रयोजनों हेतु हिंदी के प्रयोग संबंधी आदेशों की पुस्तिका",
    ),
    acts("ol-act", "ol-rules"),
)
FR_SR = unit(
    "fundamental-and-supplementary-rules",
    bl("Fundamental and Supplementary Rules", "मूल तथा अनुपूरक नियम"),
    acts("fr-sr"),
)
CCS_PENSION = unit(
    "ccs-pension-rules",
    bl("The Central Civil Services (Pension) Rules", "केंद्रीय सिविल सेवा (पेंशन) नियम"),
    acts("ccs-pension"),
)
CCS_CONDUCT = unit(
    "ccs-conduct-rules",
    bl("The Central Civil Services (Conduct) Rules", "केंद्रीय सिविल सेवा (आचरण) नियम"),
    acts("ccs-conduct"),
)
CCS_CCA = unit(
    "ccs-cca-rules",
    bl(
        "The Central Civil Services (Classification, Control and Appeal) Rules",
        "केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण तथा अपील) नियम",
    ),
    acts("ccs-cca"),
)
CCS_LEAVE = unit(
    "ccs-leave-rules",
    bl("The Central Civil Services (Leave) Rules", "केंद्रीय सिविल सेवा (अवकाश) नियम"),
    acts("ccs-leave"),
)
GFR = unit(
    "general-financial-rules",
    bl("Compilation of the General Financial Rules", "सामान्य वित्तीय नियमों का संकलन"),
    acts("gfr"),
)
DFPR = unit(
    "delegation-of-financial-powers-rules",
    bl("Delegation of Financial Powers Rules", "वित्तीय शक्तियों का प्रत्यायोजन नियम"),
    external(
        "Not in this app. The Department of Expenditure publishes these rules; this app ships the General Financial Rules but not the delegation rules.",
        "इस ऐप में नहीं। ये नियम व्यय विभाग प्रकाशित करता है; इस ऐप में सामान्य वित्तीय नियम हैं, प्रत्यायोजन नियम नहीं।",
    ),
)

CATEGORY_I_PAPER_II = [MOP, ISTM_NOTES, OL_HANDBOOK, FR_SR, CCS_PENSION, CCS_CONDUCT, CCS_CCA, CCS_LEAVE, GFR, DFPR]

# The Schedule's list for Category VIII is the same as Category I's WITHOUT the
# Hindi handbook — item 3 is marked "(for Category I & IV only)" — and WITH one
# addition, "Intelligence Bureau Standing Orders (for Category VIII only)".
# That standing order is an internal departmental document. It is named, because
# a candidate who does not know it is on the syllabus is worse off; it is empty,
# because this app holds no departmental material and never will.
IB_STANDING_ORDERS = unit(
    "intelligence-bureau-standing-orders",
    bl("Intelligence Bureau Standing Orders", "आसूचना ब्यूरो स्थायी आदेश"),
    external(
        "An internal departmental document. This app holds no departmental manual or internally circulated material and never will — study this from your own office's copy.",
        "यह आंतरिक विभागीय दस्तावेज़ है। इस ऐप में कोई विभागीय नियमावली अथवा आंतरिक रूप से परिचालित सामग्री नहीं है और कभी नहीं होगी — इसे अपने कार्यालय की प्रति से पढ़ें।",
    ),
)

CATEGORY_VIII_PAPER_II = [MOP, ISTM_NOTES, FR_SR, CCS_PENSION, CCS_CONDUCT, CCS_CCA, CCS_LEAVE, GFR, DFPR, IB_STANDING_ORDERS]

# Category III's list is a different set of books entirely: the Railway Board's
# own Manual of Office Procedure, and the Railway Services (Conduct) Rules 1966
# and Railway Servants (Discipline and Appeal) Rules 1968 — which are NOT the
# CCS rules of the same shape and must not be mapped on to them. Only the Hindi
# handbook is common, so this profile is honestly almost all self-study, and the
# picker says so before the reader chooses it.
CATEGORY_III_PAPER_II = [
    unit(
        "railway-board-manual-of-office-procedure",
        bl(
            "Manual of Office Procedure issued by the Ministry of Railways (Railway Board)",
            "रेल मंत्रालय (रेलवे बोर्ड) द्वारा जारी कार्यालय प्रक्रिया नियमावली",
        ),
        external(
            "The Railway Board's own manual, not the Central Secretariat Manual of Office Procedure this app ships. The two are different documents.",
            "यह रेलवे बोर्ड की अपनी नियमावली है, इस ऐप में उपलब्ध केंद्रीय सचिवालय कार्यालय प्रक्रिया नियमावली नहीं। दोनों भिन्न दस्तावेज़ हैं।",
        ),
    ),
    OL_HANDBOOK,
    unit(
        "indian-railway-administration-and-finance",
        bl("Indian Railway Administration and Finance", "भारतीय रेल प्रशासन तथा वित्त"),
        external(
            "Not in this app. Excludes Chapters V, VI, VIII and IX, per the notification.",
            "इस ऐप में नहीं। अधिसूचना के अनुसार अध्याय V, VI, VIII तथा IX इसमें सम्मिलित नहीं हैं।",
        ),
    ),
    unit(
        "indian-railway-financial-code",
        bl("Indian Railway Financial Code, Volume I", "भारतीय रेल वित्त संहिता, खंड I"),
        external(
            "Not in this app. Excludes Chapters II and VI, per the notification.",
            "इस ऐप में नहीं। अधिसूचना के अनुसार अध्याय II तथा VI इसमें सम्मिलित नहीं हैं।",
        ),
    ),
    unit(
        "indian-railway-establishment-code",
        bl("Indian Railway Establishment Code, Volume I", "भारतीय रेल स्थापना संहिता, खंड I"),
        external("Not in this app.", "इस ऐप में नहीं।"),
    ),
    unit(
        "railway-services-conduct-rules",
        bl("The Railway Services (Conduct) Rules, 1966", "रेल सेवा (आचरण) नियम, 1966"),
        external(
            "A separate rule book from the CCS (Conduct) Rules this app ships. They are close in shape and different in text — do not study one for the other.",
            "यह इस ऐप में उपलब्ध सीसीएस (आचरण) नियमों से भिन्न नियम-पुस्तक है। दोनों का ढाँचा मिलता-जुलता है किंतु पाठ भिन्न है — एक के स्थान पर दूसरा न पढ़ें।",
        ),
    ),
    unit(
        "railway-servants-discipline-and-appeal-rules",
        bl("The Railway Servants (Discipline and Appeal) Rules, 1968", "रेल सेवक (अनुशासन तथा अपील) नियम, 1968"),
        external(
            "A separate rule book from the CCS (CCA) Rules this app ships. Do not study one for the other.",
            "यह इस ऐप में उपलब्ध सीसीएस (सीसीए) नियमों से भिन्न नियम-पुस्तक है। एक के स्थान पर दूसरा न पढ़ें।",
        ),
    ),
]

RECORD_OF_SERVICE_EN = (
    "Selection also counts a separate evaluation of record of service worth 100 marks, in which the "
    "notification requires a minimum of 40 per cent; the three written papers below carry 500 of the "
    "600 total marks. This is a competitive examination, not a qualifying one."
)
RECORD_OF_SERVICE_HI = (
    "चयन में सेवा-अभिलेख का पृथक मूल्यांकन भी गिना जाता है, जो 100 अंकों का है और जिसमें अधिसूचना के अनुसार "
    "न्यूनतम 40 प्रतिशत अंक अनिवार्य हैं; नीचे दिए गए तीन लिखित प्रश्नपत्र कुल 600 में से 500 अंकों के हैं। "
    "यह प्रतियोगी परीक्षा है, अर्हक परीक्षा नहीं।"
)


def profile(
    profile_id: str,
    name: dict[str, str],
    organisation: dict[str, str],
    eligibility: dict[str, str],
    paper_ii_units: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "$schema": "../../../schemas/exam-profile.schema.json",
        "version": VERSION,
        "generatedAt": GENERATED_AT,
        "id": profile_id,
        "name": name,
        "organisation": organisation,
        "examType": "ldce",
        "eligibilityNote": eligibility,
        "papers": [paper_one(), paper_two(paper_ii_units), paper_three()],
        "patternSource": PATTERN_SOURCE,
        "weightBasis": WEIGHT_BASIS,
        "disclaimer": DISCLAIMER,
        # The notification was fetched and its bytes hashed, so the pattern is
        # not a figure that could not be confirmed. The weights are, and
        # `weightBasis` is where that is said — a `verify` flag that is true on
        # every record carries no information.
        "verify": False,
    }


def build_profiles() -> dict[str, dict[str, Any]]:
    return {
        "css-so-ldce": profile(
            "css-so-ldce",
            bl(
                "Section Officers' Grade LDCE — Central Secretariat Service",
                "अनुभाग अधिकारी ग्रेड सीमित विभागीय प्रतियोगी परीक्षा — केंद्रीय सचिवालय सेवा",
            ),
            bl("Central Secretariat Service (Category I)", "केंद्रीय सचिवालय सेवा (श्रेणी I)"),
            bl(
                "Assistant Section Officers of the Central Secretariat Service, and Personal Assistants "
                "(Stenographer Grade 'C') of the Central Secretariat Stenographers' Service, with not less "
                "than five years' approved service and at least four Annual Performance Appraisal Reports in "
                "that grade on the crucial date; a Personal Assistant of the CSSS must hold a Bachelor's "
                "degree. " + RECORD_OF_SERVICE_EN,
                "केंद्रीय सचिवालय सेवा के सहायक अनुभाग अधिकारी तथा केंद्रीय सचिवालय आशुलिपिक सेवा के वैयक्तिक सहायक "
                "(आशुलिपिक ग्रेड 'ग'), जिनकी उस ग्रेड में निर्णायक तिथि को कम से कम पाँच वर्ष की अनुमोदित सेवा हो तथा "
                "कम से कम चार वार्षिक कार्य निष्पादन मूल्यांकन रिपोर्ट हों; सीएसएसएस के वैयक्तिक सहायक के पास स्नातक "
                "उपाधि होनी चाहिए। " + RECORD_OF_SERVICE_HI,
            ),
            CATEGORY_I_PAPER_II,
        ),
        "ib-so-ldce": profile(
            "ib-so-ldce",
            bl(
                "Section Officers' Grade LDCE — Intelligence Bureau (ministerial cadre)",
                "अनुभाग अधिकारी ग्रेड सीमित विभागीय प्रतियोगी परीक्षा — आसूचना ब्यूरो (लिपिकीय संवर्ग)",
            ),
            bl("Intelligence Bureau, Ministry of Home Affairs (Category VIII)", "आसूचना ब्यूरो, गृह मंत्रालय (श्रेणी VIII)"),
            bl(
                "Assistants and Stenographers Grade II (Personal Assistants) of the Intelligence Bureau: not "
                "less than four years' approved and continuous service where the officer was appointed on the "
                "result of a competitive or limited departmental competitive examination held not less than "
                "five years before the 1st July of the examination year, or not less than five years' "
                "approved and continuous service where appointed by seniority. "
                "NOTE: the notification names the Assistant and Stenographer grades — the ministerial "
                "cadre. It is NOT the examination for the executive line (Assistant Central Intelligence "
                "Officer and above); no public notification of a pattern for that line could be found, so "
                "this app carries none. " + RECORD_OF_SERVICE_EN,
                "आसूचना ब्यूरो के सहायक तथा आशुलिपिक ग्रेड II (वैयक्तिक सहायक): जहाँ अधिकारी की नियुक्ति किसी प्रतियोगी "
                "अथवा सीमित विभागीय प्रतियोगी परीक्षा के परिणाम पर हुई हो जो परीक्षा वर्ष की 1 जुलाई से कम से कम पाँच वर्ष "
                "पूर्व आयोजित हुई हो, वहाँ कम से कम चार वर्ष की अनुमोदित एवं निरंतर सेवा; तथा जहाँ नियुक्ति वरिष्ठता के "
                "आधार पर हुई हो, वहाँ कम से कम पाँच वर्ष की अनुमोदित एवं निरंतर सेवा। "
                "टिप्पणी: अधिसूचना में सहायक तथा आशुलिपिक ग्रेड नामित हैं — अर्थात् लिपिकीय संवर्ग। यह कार्यकारी "
                "संवर्ग (सहायक केंद्रीय आसूचना अधिकारी तथा उससे ऊपर) की परीक्षा नहीं है; उस संवर्ग हेतु किसी "
                "पैटर्न की सार्वजनिक अधिसूचना नहीं मिल सकी, अतः इस ऐप में वह नहीं है। " + RECORD_OF_SERVICE_HI,
            ),
            CATEGORY_VIII_PAPER_II,
        ),
        "railway-so-ldce": profile(
            "railway-so-ldce",
            bl(
                "Section Officers' Grade LDCE — Railway Board Secretariat Service",
                "अनुभाग अधिकारी ग्रेड सीमित विभागीय प्रतियोगी परीक्षा — रेलवे बोर्ड सचिवालय सेवा",
            ),
            bl("Railway Board Secretariat Service (Category III)", "रेलवे बोर्ड सचिवालय सेवा (श्रेणी III)"),
            bl(
                "Assistant Section Officers of the Railway Board Secretariat Service, and Grade II / Grade C "
                "of the Railway Board Secretariat Stenographers' Service, with not less than five years' "
                "approved and continuous service. Most of this examination's Paper II is railway rule books "
                "this app does not hold — check the ratio on the profile card before relying on it. "
                + RECORD_OF_SERVICE_EN,
                "रेलवे बोर्ड सचिवालय सेवा के सहायक अनुभाग अधिकारी तथा रेलवे बोर्ड सचिवालय आशुलिपिक सेवा के ग्रेड II / "
                "ग्रेड सी, जिनकी कम से कम पाँच वर्ष की अनुमोदित एवं निरंतर सेवा हो। इस परीक्षा के प्रश्नपत्र II का अधिकांश "
                "भाग रेलवे की उन नियम-पुस्तकों पर है जो इस ऐप में नहीं हैं — इस पर निर्भर होने से पूर्व प्रोफ़ाइल कार्ड पर "
                "अनुपात देखें। " + RECORD_OF_SERVICE_HI,
            ),
            CATEGORY_III_PAPER_II,
        ),
    }


# --------------------------------------------------------------------------
# Self-check — the cross-references a JSON Schema cannot see
# --------------------------------------------------------------------------


def self_check(profiles: dict[str, dict[str, Any]]) -> int:
    """Everything a JSON Schema cannot express, plus the corpus resolution.

    The last of these is the one that matters: a `coverage` entry naming an act
    that is not in `data/rules/index.json` is a syllabus unit pointing at
    nothing, and it would show as a unit the reader can never make progress on.
    `tests/exam-data.test.ts` asserts the same thing from the TypeScript side.
    """
    failures = 0
    index = read_json(DATA_DIR / "rules" / "index.json", {})
    known_acts = {act["id"] for act in index.get("acts", [])}
    if not known_acts:
        log("! data/rules/index.json has no acts — cannot resolve coverage")
        return 1

    for profile_id, payload in profiles.items():
        if payload["id"] != profile_id:
            log(f"! {profile_id}: id inside the file is {payload['id']}")
            failures += 1

        paper_ids: set[str] = set()
        for paper in payload["papers"]:
            if paper["id"] in paper_ids:
                log(f"! {profile_id}: duplicate paper id {paper['id']}")
                failures += 1
            paper_ids.add(paper["id"])

            total = round(sum(u["weight"] for u in paper["units"]), 6)
            if total != 1.0:
                log(f"! {profile_id}/{paper['id']}: unit weights sum to {total}, not 1")
                failures += 1

            unit_ids: set[str] = set()
            for u in paper["units"]:
                if u["id"] in unit_ids:
                    log(f"! {profile_id}/{paper['id']}: duplicate unit id {u['id']}")
                    failures += 1
                unit_ids.add(u["id"])

                coverage = u["coverage"]
                if isinstance(coverage, dict):
                    if not coverage.get("note"):
                        log(f"! {profile_id}/{u['id']}: external with no note saying what to study instead")
                        failures += 1
                    continue
                for ref in coverage:
                    if ref["act"] not in known_acts:
                        log(f"! {profile_id}/{u['id']}: coverage names unknown act {ref['act']}")
                        failures += 1

            # A subjective paper cannot be drawn as a mock, so one that also
            # carried a negative-marking rate would be describing a scoring rule
            # nothing can ever apply.
            if not paper["objective"] and "negativeMarking" in paper:
                log(f"! {profile_id}/{paper['id']}: subjective paper carries a negative-marking rate")
                failures += 1

        # A profile with no objective paper can never produce a mock, which is
        # half of what this module is for. Not fatal, but it must be deliberate.
        if not any(paper["objective"] for paper in payload["papers"]):
            log(f"! {profile_id}: no objective paper — nothing could ever be mocked")
            failures += 1

        if payload["verify"] is False and "fetchedAt" not in payload["patternSource"]:
            log(f"! {profile_id}: verify is false but the pattern source was never fetched")
            failures += 1

    return failures


def count_units(payload: dict[str, Any]) -> tuple[int, int]:
    mapped = external_count = 0
    for paper in payload["papers"]:
        for u in paper["units"]:
            if isinstance(u["coverage"], dict):
                external_count += 1
            else:
                mapped += 1
    return mapped, external_count


def build_index(profiles: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entries = []
    for profile_id in sorted(profiles):
        payload = profiles[profile_id]
        mapped, external_count = count_units(payload)
        entries.append(
            {
                "id": profile_id,
                "name": payload["name"],
                "organisation": payload["organisation"],
                "examType": payload["examType"],
                "file": f"profiles/{profile_id}.json",
                "paperCount": len(payload["papers"]),
                "totalMarks": sum(paper["marks"] for paper in payload["papers"]),
                "mappedUnits": mapped,
                "externalUnits": external_count,
                "verify": payload["verify"],
            }
        )
    return {
        "$schema": "../../schemas/exam-index.schema.json",
        "version": VERSION,
        "generatedAt": GENERATED_AT,
        "disclaimer": DISCLAIMER,
        "profiles": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and compare against disk; write nothing")
    args = parser.parse_args()

    profiles = build_profiles()
    index = build_index(profiles)

    for payload in profiles.values():
        validate(payload, "exam-profile.schema.json")
    validate(index, "exam-index.schema.json")

    failures = self_check(profiles)
    if failures:
        log(f"! {failures} self-check failure(s)")
        return 1

    outputs: dict[Path, Any] = {INDEX_OUT: index}
    for profile_id, payload in profiles.items():
        outputs[OUT_DIR / "profiles" / f"{profile_id}.json"] = payload

    if args.check:
        ok = True
        for path, payload in outputs.items():
            if read_json(path) != payload:
                log(f"! {path}: on disk differs from what this script builds")
                ok = False
            else:
                log(f"ok {path}")
        return 0 if ok else 1

    digests: dict[str, str] = {}
    for path, payload in outputs.items():
        changed, digest = write_json(path, payload)
        digests[path.name] = digest
        log(f"{'wrote' if changed else 'same '} {path}")

    update_versions(
        {
            "exam-profiles": {
                "version": VERSION,
                "updated": GENERATED_AT,
                "label": {"en": "Departmental exam profiles", "hi": "विभागीय परीक्षा प्रोफ़ाइल"},
                "rows": len(profiles),
                "sha256": digests["index.json"],
                "source": {"name": PATTERN_SOURCE["name"], "url": PATTERN_SOURCE["url"]},
            }
        },
        generated_at=STAMP,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
