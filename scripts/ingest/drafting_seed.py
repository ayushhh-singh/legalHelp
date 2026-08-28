#!/usr/bin/env python3
"""Write ``data/drafting`` — the CSMOP 2022 templates, terms and phrases.

Like ``pay_matrix.py`` this script reaches no host at all. Everything it writes
was read out of two documents that were fetched once, by hand, and are cited in
every record:

* the **Central Secretariat Manual of Office Procedure, 2022** (sixteenth
  edition, DARPG) — both the English and the Hindi issue. Paragraph and page
  references throughout are to the printed page numbers of that edition, and
  ``docs/CSMOP-FORMATS.md`` is the reading of it that this file encodes.
* the **Saral Prashasanik Shabdavali** of the Department of Official Language,
  for the handful of structural terms the manual itself never names.

Two things about the Hindi are worth knowing before editing it.

The Hindi CSMOP's *text layer* is unusable: the PDF was typeset from a legacy
font and its glyph map produces "अभधकायी" where the page renders "अधिकारी". The
pages themselves are correct, so every Hindi string here that is attributed to
CSMOP was read off a rendering of the page, not copied out of the text stream —
the same route ADR-016 records for the scanned pay orders. ``docs/DATA-GAPS.md``
#33 has the detail.

And the manual's own Hindi is the authority, not the usual translation. It
prints ``परम अग्रता`` for Top Priority, not the ``सर्वोच्च अग्रता`` one would guess,
and ``अर्ध-सरकारी पत्र`` for a demi-official letter, not ``अर्ध-शासकीय पत्र``. Both
of the guesses are in ``alsoHi`` because an officer will meet them; neither is
what this app prints.

    scripts/ingest/.venv/bin/python scripts/ingest/drafting_seed.py
    scripts/ingest/.venv/bin/python scripts/ingest/drafting_seed.py --check

``--check`` rebuilds everything, validates it, and compares it against what is
on disk without writing — which is what CI runs. This script is deliberately on
no cron: the manual is revised about once every three years, by a new edition,
and a new edition is a reading job, not a fetch.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, log, read_json, validate, write_json  # noqa: E402

OUT_DIR = DATA_DIR / "drafting"
TEMPLATE_DIR = OUT_DIR / "templates"

VERSION = "1.0.0"
# Fixed, not a clock: a re-run whose content has not changed must produce
# byte-identical files, or `--check` in CI reports a diff on every run.
STAMP = "2026-08-28T00:00:00Z"

CSMOP_EN_URL = "https://www.darpg.gov.in/static/uploads/2025/10/774e0b8f427b7875158363d842fa431f.pdf"
CSMOP_HI_URL = "https://www.darpg.gov.in/static/uploads/2025/10/8b5d6eb6c7c47bc69e271e25f1c2cc43.pdf"
SHABDAVALI_URL = "https://rajbhasha.gov.in/sites/default/files/saralshabdavali.pdf"

EDITION = "CSMOP 2022, sixteenth edition"

CSMOP = {
    "name": "Central Secretariat Manual of Office Procedure, 2022 (16th edition), DARPG",
    "url": CSMOP_EN_URL,
    "reference": EDITION,
    "dated": "2022-08-05",
}
CSMOP_HINDI = {
    "name": "केंद्रीय सचिवालय कार्यालय प्रक्रिया नियमावली, 2022 (16वाँ संस्करण), प्रशासनिक सुधार और लोक शिकायत विभाग",
    "url": CSMOP_HI_URL,
    "reference": EDITION + " (Hindi issue)",
    "dated": "2022-08-05",
}
SHABDAVALI = {
    "name": "Saral Prashasanik Shabdavali, Department of Official Language",
    "url": SHABDAVALI_URL,
    "reference": "Central Translation Bureau, Rajbhasha Vibhag",
}

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ के लिए; सरकारी राजपत्र/आदेश या अपने डीडीओ से सत्यापित करें।",
}


def bl(en: str, hi: str) -> dict[str, str]:
    return {"en": en, "hi": hi}


def envelope(body: dict[str, Any]) -> dict[str, Any]:
    return {"version": VERSION, "generatedAt": STAMP, "disclaimer": DISCLAIMER, **body}


def sourced(source: dict[str, Any], verify: bool = False, **extra: Any) -> dict[str, Any]:
    return {"source": dict(source), "fetchedAt": STAMP, "verify": verify, **extra}


# --------------------------------------------------------------------------- #
# 1. Structural terms
#
# `hi` is what the sixteenth edition prints, read off the rendered page; the
# page it was read from is in `csmopRef`. A term the manual never names carries
# verify: true and cites the Department of Official Language instead.
# --------------------------------------------------------------------------- #


def term(
    tid: str,
    category: str,
    en: str,
    hi: str,
    *,
    csmop: str | None = None,
    also: list[str] | None = None,
    note: dict[str, str] | None = None,
    verify: bool = False,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"id": tid, "category": category, "en": en, "hi": hi}
    if also:
        record["alsoHi"] = also
    if note:
        record["note"] = note
    if csmop:
        record["csmopRef"] = csmop
    record.update(sourced(source or (CSMOP_HINDI if not verify else SHABDAVALI), verify))
    return record


TERMS: list[dict[str, Any]] = [
    # ---- the forms themselves (CSMOP 8.4, read from the Hindi issue) --------
    term("letter", "form", "Letter", "पत्र", csmop="8.4(1)"),
    term(
        "demi-official-letter",
        "form",
        "Demi-official letter",
        "अर्ध-सरकारी पत्र",
        csmop="8.4(2)",
        also=["अर्ध-शासकीय पत्र", "डी.ओ. पत्र"],
        note=bl(
            "The manual prints अर्ध-सरकारी. अर्ध-शासकीय is the older and still widely used form.",
            "नियमावली में अर्ध-सरकारी छपा है। अर्ध-शासकीय पुराना और अब भी प्रचलित रूप है।",
        ),
    ),
    term("office-memorandum", "form", "Office Memorandum", "कार्यालय ज्ञापन", csmop="8.4(3), Appendix 8.1"),
    term("office-order", "form", "Office Order", "कार्यालय आदेश", csmop="8.4(4), Appendix 8.1"),
    term("order", "form", "Order", "आदेश", csmop="8.4(5), Appendix 8.1"),
    term(
        "id-note",
        "form",
        "Inter-Departmental note",
        "अंतर-विभागीय टिप्पणी",
        csmop="8.1, Appendix 8.1",
        also=["अशासकीय टिप्पणी", "यू.ओ. टिप्पणी"],
        note=bl(
            "CSMOP 2022 renamed the U.O. note the Inter-Departmental note; अशासकीय टिप्पणी is what the earlier editions and most sections still call it.",
            "सीएसएमओपी 2022 ने यू.ओ. टिप्पणी का नाम बदलकर अंतर-विभागीय टिप्पणी कर दिया; पुराने संस्करणों और अधिकांश अनुभागों में इसे अब भी अशासकीय टिप्पणी कहा जाता है।",
        ),
    ),
    term("notification", "form", "Notification", "अधिसूचना", csmop="8.4(6), Appendix 8.1"),
    term("resolution", "form", "Resolution", "संकल्प", csmop="8.4(7)"),
    term("press-communique", "form", "Press Communiqué / Press Note", "प्रेस विज्ञप्ति / प्रेस नोट", csmop="8.4(8)"),
    term("endorsement", "form", "Endorsement", "पृष्ठांकन", csmop="8.4(9), Appendix 8.1"),
    term("minutes", "form", "Minutes", "कार्यवृत्त", csmop="8.4(10)", verify=True, source=SHABDAVALI),
    term(
        "circular",
        "form",
        "Circular",
        "परिपत्र",
        verify=True,
        source=SHABDAVALI,
        note=bl(
            "CSMOP 8.4 does not list the circular; it is an Office Memorandum addressed to everyone. The Hindi is the Department of Official Language's.",
            "सीएसएमओपी 8.4 में परिपत्र सूचीबद्ध नहीं है; यह सभी को संबोधित कार्यालय ज्ञापन है। हिंदी राजभाषा विभाग की है।",
        ),
    ),
    term("noting", "form", "Note / noting on a file", "टिप्पणी", csmop="7.1"),
    # ---- parts of a document ------------------------------------------------
    term("number", "part", "Number", "संख्या", csmop="Appendix 8.1"),
    term("government-of-india", "part", "Government of India", "भारत सरकार", csmop="Appendix 8.1"),
    term("ministry", "part", "Ministry", "मंत्रालय", csmop="Appendix 8.1"),
    term("department", "part", "Department", "विभाग", csmop="Appendix 8.1"),
    term(
        "date-line",
        "part",
        "Place and date line",
        "स्थान और दिनांक पंक्ति",
        csmop="Appendix 8.1",
        also=["तारीख"],
        note=bl(
            "The specimens print both: दिनांक in the letter, तारीख in the Office Memorandum and Order.",
            "नमूनों में दोनों छपे हैं: पत्र में दिनांक, कार्यालय ज्ञापन और आदेश में तारीख।",
        ),
    ),
    term("to", "part", "To (addressee)", "सेवा में", csmop="Appendix 8.1"),
    term("subject", "part", "Subject", "विषय", csmop="Appendix 8.1"),
    term("reference", "part", "Reference", "संदर्भ", csmop="Appendix 8.1"),
    term("salutation", "part", "Salutation", "संबोधन", csmop="8.4(1)", also=["अभिवादन"]),
    term("sir-madam", "part", "Sir / Madam", "महोदय / महोदया", csmop="8.4(1), Appendix 8.1"),
    term("my-dear", "part", "My dear / Dear Shri", "प्रिय श्री", csmop="Appendix 8.1"),
    term("subscription", "part", "Subscription", "मानार्थ संबोधन", csmop="8.4(3)"),
    term("yours-faithfully", "part", "Yours faithfully", "भवदीय", csmop="8.4(1), Appendix 8.1"),
    term(
        "yours-sincerely",
        "part",
        "Yours sincerely",
        "भवदीय",
        csmop="Appendix 8.1",
        also=["सादर", "आपका"],
        note=bl(
            "The Hindi specimen of a demi-official letter closes भवदीय, the same word it uses for Yours faithfully; सादर is the usual friendlier alternative.",
            "अर्ध-सरकारी पत्र के हिंदी नमूने का समापन भवदीय से होता है, वही शब्द जो भवदीय (Yours faithfully) के लिए है; सादर सामान्य आत्मीय विकल्प है।",
        ),
    ),
    term("with-regards", "part", "With regards", "शुभकामनाओं सहित", csmop="Appendix 8.1"),
    term("signature", "part", "Signature", "हस्ताक्षर", csmop="Appendix 8.1"),
    term("signed", "part", "Sd/- (signed)", "हस्ताक्षरित/-", csmop="Appendix 8.1"),
    term("telephone", "part", "Telephone number", "दूरभाष संख्या", csmop="Appendix 8.1"),
    term("email", "part", "Email", "ई-मेल", csmop="Appendix 8.1"),
    term("copy-to", "part", "Copy to", "प्रतिलिपि", csmop="Appendix 8.1"),
    term(
        "copy-forwarded",
        "part",
        "Copy forwarded for information / necessary action",
        "प्रति सूचना/आवश्यक कार्रवाई के लिए अग्रेषित",
        csmop="Appendix 8.1",
    ),
    term("copy-forwarded-info", "part", "Copy forwarded for information", "प्रतिलिपि सूचनार्थ प्रेषित", csmop="Appendix 8.1"),
    term(
        "enclosure",
        "part",
        "Enclosure",
        "संलग्नक",
        verify=True,
        source=SHABDAVALI,
        note=bl(
            "CSMOP 9.2(vii) requires the count at the bottom left of the draft — 'Encl. 3'; it prints no Hindi form of the line.",
            "सीएसएमओपी 9.2(vii) के अनुसार मसौदे के नीचे बाईं ओर संख्या दी जाती है — 'Encl. 3'; इस पंक्ति का हिंदी रूप उसमें नहीं छपा है।",
        ),
    ),
    term("enclosure-as-above", "part", "Encl.: as above", "संलग्नक : उपर्युक्तानुसार", verify=True, source=SHABDAVALI),
    term("annexure", "part", "Annexure", "अनुलग्नक", verify=True, source=SHABDAVALI),
    term("list-of-papers", "part", "List of papers forwarded", "अग्रेषित कागजातों की सूची", csmop="Appendix 8.1"),
    term("attention", "part", "Attention", "कृपया ध्यान दें", csmop="9.4", verify=True, source=SHABDAVALI),
    term("id-number", "part", "I.D. No.", "आई.डी. सं.", csmop="Appendix 8.1"),
    term("gazette", "part", "The Gazette of India", "भारत का राजपत्र", csmop="Appendix 8.1, Appendix 8.2"),
    term("gazette-part", "part", "Part / Section of the Gazette", "भाग / खंड", csmop="Appendix 8.1"),
    term("government-press", "part", "Government of India Press", "भारत सरकार मुद्रणालय", csmop="Appendix 8.1"),
    term("undersigned", "phraseElement", "The undersigned", "अधोहस्ताक्षरी", csmop="Appendix 8.1"),
    term("is-directed", "phraseElement", "is directed to", "को निदेश हुआ है", csmop="Appendix 8.1"),
    term("draft", "process", "Draft (DFA)", "मसौदा", csmop="9.1(iii), 9.2(xiii)", also=["प्रारूप"]),
    term("format", "process", "Format / specimen", "प्रारूप", csmop="Appendix 8.1"),
    # ---- urgency grading (6.13) --------------------------------------------
    term("immediate", "urgency", "Immediate", "तत्काल", csmop="6.13(i)"),
    term("priority", "urgency", "Priority", "अग्रता", csmop="6.13(i)"),
    term(
        "top-priority",
        "urgency",
        "Top Priority",
        "परम अग्रता",
        csmop="6.13(i)",
        also=["सर्वोच्च अग्रता"],
        note=bl(
            "The manual prints परम अग्रता. सर्वोच्च अग्रता is the common rendering and is not what CSMOP 2022 uses.",
            "नियमावली में परम अग्रता छपा है। सर्वोच्च अग्रता प्रचलित अनुवाद है, सीएसएमओपी 2022 का प्रयोग नहीं।",
        ),
    ),
    term(
        "vip",
        "urgency",
        "VIP (Parliament matters)",
        "वीआईपी",
        csmop="6.13(ii), Box-e.6.10",
        note=bl(
            "Lok Sabha / Rajya Sabha questions, motions and Bills go in their own file cover; no other urgency grading is then needed.",
            "लोक सभा/राज्य सभा के प्रश्न, प्रस्ताव और विधेयक अलग विशिष्ट फाइल कवर में रखे जाते हैं; तब किसी अन्य तात्कालिकता ग्रेडिंग की आवश्यकता नहीं।",
        ),
    ),
    # ---- designations -------------------------------------------------------
    term("under-secretary", "designation", "Under Secretary to the Government of India", "अवर सचिव, भारत सरकार", csmop="Appendix 8.1"),
    term("deputy-secretary", "designation", "Deputy Secretary", "उप सचिव", csmop="Appendix 8.1"),
    term("director", "designation", "Director", "निदेशक", verify=True, source=SHABDAVALI),
    term("joint-secretary", "designation", "Joint Secretary", "संयुक्त सचिव", csmop="Appendix 8.1"),
    term("additional-secretary", "designation", "Additional Secretary", "अपर सचिव", verify=True, source=SHABDAVALI),
    term("secretary", "designation", "Secretary to the Government of India", "सचिव, भारत सरकार", csmop="Appendix 8.1"),
    term("section-officer", "designation", "Section Officer", "अनुभाग अधिकारी", csmop="3.1(vi)"),
    term("assistant-section-officer", "designation", "Assistant Section Officer", "सहायक अनुभाग अधिकारी", csmop="3.1(vi)"),
    term("dealing-officer", "designation", "Dealing Officer", "डीलिंग अधिकारी", csmop="3.1(vi)"),
    term("branch-officer", "designation", "Branch Officer", "शाखा अधिकारी", csmop="7.5", verify=True, source=SHABDAVALI),
    term("section", "designation", "Section", "अनुभाग", csmop="3.1(vi)"),
    term("competent-authority", "process", "Competent authority", "सक्षम प्राधिकारी", csmop="7.1(ii)"),
    term("cpio", "designation", "Central Public Information Officer", "केंद्रीय लोक सूचना अधिकारी", verify=True, source=SHABDAVALI),
    term("appellate-authority", "designation", "First Appellate Authority", "प्रथम अपीलीय प्राधिकारी", verify=True, source=SHABDAVALI),
    term("ddo", "designation", "Drawing and Disbursing Officer", "आहरण एवं संवितरण अधिकारी", verify=True, source=SHABDAVALI),
    # ---- process ------------------------------------------------------------
    term("puc", "process", "Paper under consideration (PUC)", "विचाराधीन पत्र", csmop="6.7(iii)", verify=True, source=SHABDAVALI),
    term("fresh-receipt", "process", "Fresh receipt (FR)", "नई प्राप्ति", csmop="6.7(iii)", verify=True, source=SHABDAVALI),
    term("flag", "process", "Flag", "ध्वजांकन", csmop="6.7(iii)", verify=True, source=SHABDAVALI),
    term("referencing", "process", "Referencing", "संदर्भ देना", csmop="6.7"),
    term("docketing", "process", "Docketing", "डॉकेटिंग", csmop="6.8"),
    term("self-contained-note", "process", "Self-contained note", "स्वतःपूर्ण टिप्पणी", csmop="7.2(viii)", verify=True, source=SHABDAVALI),
    term("running-summary", "process", "Running summary of facts", "तथ्यों का चालू सारांश", csmop="7.8", verify=True, source=SHABDAVALI),
    term("level-of-disposal", "process", "Level of disposal", "निपटान का स्तर", csmop="7.6", verify=True, source=SHABDAVALI),
    term("channel-of-submission", "process", "Channel of submission", "प्रस्तुतीकरण का माध्यम", csmop="7.6", verify=True, source=SHABDAVALI),
    term("through-proper-channel", "process", "Through proper channel", "उचित माध्यम से", verify=True, source=SHABDAVALI),
    term("for-approval", "process", "Submitted for approval", "अनुमोदनार्थ प्रस्तुत", verify=True, source=SHABDAVALI),
]


# --------------------------------------------------------------------------- #
# 2. Phrase library
#
# Matched pairs, not translations. Where CSMOP prints the English sentence and
# its Hindi issue prints the Hindi one, the pair is attributed to the manual and
# carries verify: false; everything else is standard secretariat usage and says
# so.
# --------------------------------------------------------------------------- #

EVERY = ["*"]


def phrase(
    pid: str,
    kind: str,
    applies: list[str],
    en: str,
    hi: str,
    *,
    tags: list[str] | None = None,
    csmop: str | None = None,
    verify: bool = True,
    note: dict[str, str] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"id": pid, "kind": kind, "appliesTo": applies, "text": bl(en, hi)}
    if tags:
        record["tags"] = tags
    if note:
        record["note"] = note
    if csmop:
        record["csmopRef"] = csmop
    record.update(sourced(CSMOP_HINDI if not verify else SHABDAVALI, verify))
    return record


PHRASES: list[dict[str, Any]] = [
    # ---- openings -----------------------------------------------------------
    phrase(
        "om-undersigned-directed",
        "opening",
        ["office-memorandum", "circular"],
        "The undersigned is directed to refer to this Department's O.M. No. {number} dated {date} on the subject cited above and to say that",
        "अधोहस्ताक्षरी को इस विभाग के कार्यालय ज्ञापन संख्या {number} दिनांक {date} का संदर्भ लेने तथा यह कहने का निदेश हुआ है कि",
        tags=["reference", "third-person"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "om-undersigned-say",
        "opening",
        ["office-memorandum", "circular"],
        "The undersigned is directed to say that",
        "अधोहस्ताक्षरी को यह कहने का निदेश हुआ है कि",
        tags=["third-person"],
        csmop="Appendix 8.1, 9.2(iii)",
        verify=False,
    ),
    phrase(
        "om-clarify",
        "opening",
        ["office-memorandum", "circular"],
        "Doubts have been expressed whether the provisions of {rule} also apply to {case}. It is hereby clarified that",
        "संदेह व्यक्त किया गया है कि क्या {rule} के प्रावधान {case} पर भी लागू होते हैं। एतद्द्वारा यह स्पष्ट किया जाता है कि",
        tags=["clarification"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "letter-with-reference",
        "opening",
        ["letter", "rti-reply", "ta-bill-cover"],
        "With reference to your letter No. {number} dated {date} on the subject cited above, I am directed to say that",
        "ऊपर उद्धृत विषय पर आपके दिनांक {date} के पत्र क्रमांक {number} के संदर्भ में, मुझे यह कहने का निदेश हुआ है कि",
        tags=["reference", "first-person"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "letter-in-continuation",
        "opening",
        ["letter", "office-memorandum", "circular"],
        "In continuation of this Department's letter No. {number} dated {date}",
        "हमारे/इस विभाग के पत्र क्रमांक {number} दिनांक {date} के क्रम में",
        tags=["reference"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "letter-correspondence-resting",
        "opening",
        ["letter"],
        "With reference to the correspondence resting with your letter No. {number} dated {date}",
        "आपके/इस विभाग के पत्र संख्या {number} दिनांक {date} के पत्राचार के संदर्भ में",
        tags=["reference"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "do-propose",
        "opening",
        ["demi-official"],
        "We propose to draw up a model scheme for {subject}; a copy of the outline prepared in this connection is enclosed.",
        "हम {subject} के लिए एक मॉडल योजना तैयार करने का प्रस्ताव करते हैं, इस संबंध में तैयार की गई रूपरेखा की प्रति संलग्न है।",
        tags=["first-person", "active-voice"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "do-i-notice",
        "opening",
        ["demi-official"],
        "I notice that",
        "मैं देख रहा/रही हूँ कि",
        tags=["first-person", "active-voice"],
        csmop="9.5(i)",
        note=bl(
            "CSMOP 9.5(i) asks for 'I notice' rather than 'It is noticed' in a demi-official letter.",
            "सीएसएमओपी 9.5(i) के अनुसार अर्ध-सरकारी पत्र में 'यह देखा गया है' के स्थान पर 'मैं देख रहा/रही हूँ' लिखा जाए।",
        ),
        verify=False,
    ),
    phrase(
        "do-seek-cooperation",
        "opening",
        ["demi-official"],
        "I seek your cooperation in the matter of {subject}.",
        "{subject} के मामले में मैं आपके सहयोग का आकांक्षी/आकांक्षिणी हूँ।",
        tags=["first-person", "active-voice"],
        csmop="9.5(i)",
        verify=False,
    ),
    phrase(
        "id-note-advice",
        "opening",
        ["id-note"],
        "The present rules regulating {subject} provide, inter alia, that",
        "{subject} को विनियमित करने वाले वर्तमान नियमों में अन्य बातों के साथ-साथ यह है कि",
        tags=["third-person"],
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "id-note-question",
        "opening",
        ["id-note", "noting"],
        "A question has now arisen whether",
        "अब प्रश्न यह उठता है कि क्या",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "endorsement-copy",
        "endorsement",
        ["endorsement", "ta-bill-cover"],
        "A copy each of the papers mentioned below is forwarded for information and necessary action.",
        "नीचे उल्लिखित प्रत्येक कागजात की एक प्रति सूचना एवं आवश्यक कार्रवाई के लिए अग्रेषित की जाती है।",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "notification-appointment",
        "opening",
        ["notification"],
        "Shri {name}, {designation} in the Department of {department}, is appointed to officiate as {newDesignation} in that Department with effect from {date}.",
        "श्री {name}, {department} विभाग में {designation}, को उस विभाग में {date} से {newDesignation} के रूप में कार्य करने के लिए नियुक्त किया जाता है।",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "leave-request",
        "opening",
        ["leave-application"],
        "I request that I may kindly be granted {days} days' earned leave from {from} to {to}.",
        "अनुरोध है कि मुझे दिनांक {from} से {to} तक {days} दिनों का अर्जित अवकाश स्वीकृत करने की कृपा की जाए।",
        tags=["first-person", "request"],
    ),
    phrase(
        "leave-address",
        "transition",
        ["leave-application"],
        "My address during the period of leave will be {address}, telephone {phone}.",
        "अवकाश की अवधि में मेरा पता {address} तथा दूरभाष संख्या {phone} रहेगी।",
        tags=["first-person"],
    ),
    phrase(
        "representation-open",
        "opening",
        ["representation"],
        "I respectfully submit the following representation for kind consideration.",
        "मैं सादर निम्नलिखित अभ्यावेदन कृपया विचारार्थ प्रस्तुत करता/करती हूँ।",
        tags=["first-person", "request"],
    ),
    phrase(
        "representation-through-channel",
        "transition",
        ["representation", "leave-application"],
        "Submitted through proper channel.",
        "उचित माध्यम से प्रस्तुत।",
        tags=["channel"],
    ),
    phrase(
        "rti-reply-open",
        "opening",
        ["rti-reply"],
        "Please refer to your application dated {date} under the Right to Information Act, 2005, received in this office on {receivedOn}. The information sought is furnished point-wise below.",
        "कृपया सूचना का अधिकार अधिनियम, 2005 के अंतर्गत आपके दिनांक {date} के आवेदन का संदर्भ लें, जो इस कार्यालय में दिनांक {receivedOn} को प्राप्त हुआ। माँगी गई सूचना बिंदुवार नीचे दी जा रही है।",
        tags=["statutory"],
    ),
    phrase(
        "rti-appeal",
        "closing",
        ["rti-reply"],
        "If you are not satisfied with this reply, you may prefer a first appeal under Section 19(1) of the Act within 30 days to {appellateAuthority}, {appellateAddress}.",
        "यदि आप इस उत्तर से संतुष्ट नहीं हैं तो आप अधिनियम की धारा 19(1) के अंतर्गत 30 दिन के भीतर {appellateAuthority}, {appellateAddress} को प्रथम अपील कर सकते हैं।",
        tags=["statutory"],
    ),
    phrase(
        "show-cause-open",
        "opening",
        ["show-cause-reply"],
        "Please refer to the show-cause notice No. {number} dated {date}. My reply to the allegations contained therein is submitted below.",
        "कृपया कारण बताओ नोटिस संख्या {number} दिनांक {date} का संदर्भ लें। उसमें लगाए गए आरोपों पर मेरा उत्तर नीचे प्रस्तुत है।",
        tags=["first-person"],
    ),
    phrase(
        "show-cause-close",
        "closing",
        ["show-cause-reply"],
        "In view of the above, I request that the notice may kindly be withdrawn and the matter dropped.",
        "उपर्युक्त को देखते हुए अनुरोध है कि नोटिस वापस लेकर मामला समाप्त करने की कृपा की जाए।",
        tags=["request"],
    ),
    phrase(
        "tour-approval",
        "closing",
        ["tour-programme"],
        "The tour programme is submitted for approval.",
        "दौरा कार्यक्रम अनुमोदनार्थ प्रस्तुत है।",
        tags=["approval"],
    ),
    phrase(
        "ta-bill-forward",
        "opening",
        ["ta-bill-cover"],
        "The travelling allowance bill in respect of the tour undertaken from {from} to {to} is forwarded herewith for arranging payment.",
        "दिनांक {from} से {to} तक किए गए दौरे का यात्रा भत्ता बिल भुगतान की व्यवस्था हेतु इसके साथ अग्रेषित है।",
        tags=["forwarding"],
    ),
    # ---- transitions --------------------------------------------------------
    phrase(
        "it-is-requested",
        "transition",
        EVERY,
        "It is requested that",
        "अनुरोध है कि",
        tags=["request"],
    ),
    phrase(
        "requested-by-date",
        "transition",
        EVERY,
        "It is requested that the information may be sent by {date}.",
        "अनुरोध है कि सूचना दिनांक {date} तक भेज दी जाए।",
        tags=["request", "time-limit"],
        csmop="9.2(v)",
        note=bl(
            "CSMOP 9.2(v): name the date. 'may be sent immediately' is what it tells you not to write.",
            "सीएसएमओपी 9.2(v): तारीख लिखें। 'तुरंत भेजी जाए' वही है जिससे यह मना करता है।",
        ),
        verify=False,
    ),
    phrase(
        "you-are-requested",
        "transition",
        ["letter", "office-memorandum", "circular"],
        "You are requested to furnish the information called for above by {date}.",
        "आपसे अनुरोध है कि उपर्युक्त माँगी गई सूचना दिनांक {date} तक उपलब्ध कराएँ।",
        tags=["request", "time-limit"],
    ),
    phrase(
        "may-be-brought-to-notice",
        "transition",
        ["circular", "office-memorandum"],
        "This may be brought to the notice of all concerned in your Ministry / Department.",
        "इसे आपके मंत्रालय/विभाग के सभी संबंधितों की जानकारी में लाया जाए।",
        tags=["circulation"],
    ),
    phrase(
        "issues-with-approval",
        "transition",
        ["office-memorandum", "circular", "notification"],
        "This issues with the approval of the competent authority.",
        "यह सक्षम प्राधिकारी के अनुमोदन से जारी किया जाता है।",
        tags=["authority"],
        csmop="9.2(iii)",
        verify=False,
    ),
    phrase(
        "issues-with-concurrence",
        "transition",
        ["office-memorandum", "notification"],
        "This issues with the concurrence of the Integrated Finance Division vide their Dy. No. {number} dated {date}.",
        "यह एकीकृत वित्त प्रभाग की सहमति से उनके उप संख्या {number} दिनांक {date} द्वारा जारी किया जाता है।",
        tags=["finance"],
    ),
    phrase(
        "in-supersession",
        "transition",
        ["office-memorandum", "notification", "circular"],
        "In supersession of this Department's O.M. of even number dated {date}",
        "इस विभाग के समसंख्यक कार्यालय ज्ञापन दिनांक {date} के अधिक्रमण में",
        tags=["reference"],
    ),
    phrase(
        "advice-sought",
        "transition",
        ["id-note"],
        "This Department will be grateful for the advice of the {department} on the issue raised in para {para} above.",
        "यह विभाग उपर्युक्त पैरा {para} में उठाए गए मुद्दे पर {department} की सलाह के लिए आभारी रहेगा।",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "time-limit-id-note",
        "transition",
        ["id-note"],
        "The comments of the Department are requested by {date}, please.",
        "विभाग की टिप्पणियाँ दिनांक {date} तक अपेक्षित हैं।",
        tags=["time-limit"],
        csmop="8.1.2(i)",
        verify=False,
    ),
    # ---- noting -------------------------------------------------------------
    phrase(
        "noting-submitted-approval",
        "noting",
        ["noting"],
        "Submitted for approval.",
        "अनुमोदनार्थ प्रस्तुत।",
        tags=["approval"],
    ),
    phrase(
        "noting-submitted-orders",
        "noting",
        ["noting"],
        "Submitted for orders, please.",
        "आदेशार्थ प्रस्तुत।",
        tags=["approval"],
    ),
    phrase(
        "noting-submitted-information",
        "noting",
        ["noting"],
        "Submitted for information, please.",
        "सूचनार्थ प्रस्तुत।",
        tags=["information"],
        csmop="7.2(ii)",
        verify=False,
    ),
    phrase(
        "noting-puc",
        "noting",
        ["noting"],
        "The paper under consideration at page {page}/c is a {what} from {who}.",
        "पृष्ठ {page}/पत्राचार पर विचाराधीन पत्र {who} का {what} है।",
        tags=["referencing"],
        csmop="6.7(iii)",
        verify=False,
    ),
    phrase(
        "noting-rule-position",
        "noting",
        ["noting"],
        "The rule position is at flag '{flag}'. Rule {rule} provides that",
        "नियम की स्थिति ध्वज '{flag}' पर है। नियम {rule} में उपबंध है कि",
        tags=["referencing"],
        csmop="6.7(v), 7.2(vii)",
        verify=False,
    ),
    phrase(
        "noting-precedent",
        "noting",
        ["noting"],
        "A precedent in a similar case is at flag '{flag}', decided at the level of {level}.",
        "इसी प्रकार के मामले की मिसाल ध्वज '{flag}' पर है, जिसका निर्णय {level} के स्तर पर किया गया था।",
        tags=["referencing"],
        csmop="7.3(viii)",
        verify=False,
    ),
    phrase(
        "noting-proposal",
        "noting",
        ["noting"],
        "In view of the above, it is proposed that {proposal}. If approved, a draft {form} is placed below for signature.",
        "उपर्युक्त को देखते हुए प्रस्ताव है कि {proposal}। अनुमोदन होने पर हस्ताक्षर के लिए {form} का मसौदा नीचे रखा गया है।",
        tags=["proposal"],
        csmop="7.3(ix), 9.1(ii)",
        verify=False,
    ),
    phrase(
        "noting-competent-authority",
        "noting",
        ["noting"],
        "{designation} is the competent authority to decide this case.",
        "इस मामले का निर्णय करने के लिए {designation} सक्षम प्राधिकारी हैं।",
        tags=["authority"],
        csmop="7.3(x)",
        verify=False,
    ),
    phrase(
        "noting-approved",
        "noting",
        ["noting"],
        "Approved. Please issue.",
        "अनुमोदित। कृपया जारी करें।",
        tags=["approval"],
    ),
    phrase(
        "noting-discussed",
        "noting",
        ["noting"],
        "Discussed. As desired, a self-contained note is put up.",
        "चर्चा हुई। यथावांछित, स्वतःपूर्ण टिप्पणी प्रस्तुत है।",
        tags=["discussion"],
        csmop="7.5(ii)",
        verify=False,
    ),
    # ---- closings -----------------------------------------------------------
    phrase(
        "receipt-acknowledged",
        "closing",
        ["letter", "office-memorandum"],
        "Receipt of this communication may kindly be acknowledged.",
        "कृपया इस पत्र की प्राप्ति सूचित करें।",
    ),
    phrase(
        "early-action",
        "closing",
        ["letter", "office-memorandum", "demi-official"],
        "An early action in the matter will be appreciated.",
        "इस मामले में शीघ्र कार्रवाई सराहनीय होगी।",
    ),
    phrase(
        "do-grateful",
        "closing",
        ["demi-official"],
        "I shall be grateful if you would let me have your comments as soon as possible.",
        "यदि आप मुझे यथाशीघ्र अपनी टिप्पणी दें तो मैं आपका आभारी रहूँगा/रहूँगी।",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "do-regards",
        "courtesy",
        ["demi-official"],
        "With regards,",
        "शुभकामनाओं सहित,",
        csmop="Appendix 8.1",
        verify=False,
    ),
    phrase(
        "reasons-courteous",
        "closing",
        ["letter", "rti-reply"],
        "The request cannot be acceded to for the reasons stated above; the inconvenience caused is regretted.",
        "उपर्युक्त कारणों से अनुरोध स्वीकार नहीं किया जा सका; असुविधा के लिए खेद है।",
        csmop="8.9(iv)",
        verify=False,
    ),
    phrase(
        "interim-reply",
        "closing",
        ["letter"],
        "This is an interim reply. A final reply will be sent by {date}.",
        "यह अंतरिम उत्तर है। अंतिम उत्तर दिनांक {date} तक भेज दिया जाएगा।",
        tags=["time-limit"],
        csmop="8.9(ii)",
        verify=False,
    ),
    phrase(
        "hindi-and-english",
        "closing",
        EVERY,
        "This communication issues in Hindi and in English; the Hindi version will prevail in case of doubt.",
        "यह पत्र हिंदी और अंग्रेज़ी में जारी किया जाता है; संदेह की स्थिति में हिंदी रूपांतर मान्य होगा।",
        tags=["rajbhasha"],
        csmop="8.11",
    ),
]


# --------------------------------------------------------------------------- #
# 3. Templates
#
# A layout is a list of blocks. The engine knows the block roles and nothing
# about any particular document type — so a new form is a new JSON file, never
# a new branch in src/lib/drafting/engine.ts.
# --------------------------------------------------------------------------- #


def field(
    fid: str,
    label: dict[str, str],
    ftype: str,
    required: bool,
    sample: Any,
    *,
    hint: dict[str, str] | None = None,
    options: list[dict[str, Any]] | None = None,
    max_words: int | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"id": fid, "label": label, "type": ftype, "required": required, "sample": sample}
    if hint:
        record["hint"] = hint
    if options:
        record["options"] = options
    if max_words:
        record["maxWords"] = max_words
    return record


def block(role: str, **kwargs: Any) -> dict[str, Any]:
    record: dict[str, Any] = {"role": role}
    for key in ("align", "emphasis", "lines", "lead", "source", "numbered", "numberFrom", "itemPrefix", "omitWhenEmpty"):
        value = kwargs.pop(key, None)
        if value is not None:
            record[key] = value
    if kwargs:
        raise ValueError(f"unknown block keys: {sorted(kwargs)}")
    return record


def check(
    cid: str,
    label: dict[str, str],
    why: dict[str, str],
    severity: str,
    rule: dict[str, Any],
    csmop: str | None = None,
) -> dict[str, Any]:
    record = {"id": cid, "label": label, "why": why, "severity": severity, "rule": rule}
    if csmop:
        record["csmopRef"] = csmop
    return record


URGENCY_OPTIONS = [
    {"value": "none", "label": bl("None", "कोई नहीं")},
    {"value": "immediate", "label": bl("IMMEDIATE", "तत्काल")},
    {"value": "priority", "label": bl("PRIORITY", "अग्रता")},
    {"value": "top-priority", "label": bl("TOP PRIORITY", "परम अग्रता")},
]

# ---- fields that nearly every form shares ---------------------------------


def f_urgency() -> dict[str, Any]:
    return field(
        "urgency",
        bl("Urgency grading", "तात्कालिकता ग्रेडिंग"),
        "select",
        False,
        bl("none", "none"),
        hint=bl(
            "Marked by or under the orders of an officer not lower than a Section Officer (9.2(xi)).",
            "अनुभाग अधिकारी से अनिम्न अधिकारी द्वारा या उनके आदेश से अंकित (9.2(xi))।",
        ),
        options=URGENCY_OPTIONS,
    )


def f_file_number() -> dict[str, Any]:
    return field(
        "fileNumber",
        bl("File / communication number", "फाइल / पत्र संख्या"),
        "text",
        True,
        bl("A-11011/2/2026-Estt.", "ए-11011/2/2026-स्थापना"),
        hint=bl(
            "Every draft put up on a file bears the file number (9.2(vi)).",
            "फाइल पर प्रस्तुत प्रत्येक मसौदे पर फाइल संख्या होती है (9.2(vi))।",
        ),
    )


def f_ministry() -> dict[str, Any]:
    return field(
        "ministry",
        bl("Ministry", "मंत्रालय"),
        "text",
        True,
        bl("Ministry of Personnel, Public Grievances and Pensions", "कार्मिक, लोक शिकायत तथा पेंशन मंत्रालय"),
    )


def f_department() -> dict[str, Any]:
    return field(
        "department",
        bl("Department", "विभाग"),
        "text",
        True,
        bl("Department of Personnel and Training", "कार्मिक और प्रशिक्षण विभाग"),
    )


def f_place() -> dict[str, Any]:
    return field("place", bl("Place", "स्थान"), "text", True, bl("New Delhi", "नई दिल्ली"))


def f_date(label: dict[str, str] | None = None) -> dict[str, Any]:
    return field(
        "date",
        label or bl("Date", "दिनांक"),
        "date",
        True,
        bl("2026-08-28", "2026-08-28"),
        hint=bl("dd.mm.yyyy in English; दिनांक dd.mm.yyyy in Hindi.", "अंग्रेज़ी में dd.mm.yyyy; हिंदी में दिनांक dd.mm.yyyy।"),
    )


def f_subject() -> dict[str, Any]:
    return field(
        "subject",
        bl("Subject", "विषय"),
        "text",
        True,
        bl(
            "Grant of Children Education Allowance — clarification regarding.",
            "बाल शिक्षा भत्ते की स्वीकृति — स्पष्टीकरण के संबंध में।",
        ),
    )


def f_paras(sample_en: list[str], sample_hi: list[str], hint: dict[str, str] | None = None) -> dict[str, Any]:
    return field(
        "paras",
        bl("Body paragraphs", "मुख्य पैराग्राफ"),
        "paras",
        True,
        {"en": sample_en, "hi": sample_hi},
        hint=hint
        or bl(
            "One paragraph per line. The first is left unnumbered and the rest are numbered from 2.",
            "प्रति पंक्ति एक पैराग्राफ। पहला बिना संख्या के रहता है और शेष 2 से क्रमांकित होते हैं।",
        ),
    )


def f_signatory(designation_en: str = "Under Secretary to the Govt. of India", designation_hi: str = "अवर सचिव, भारत सरकार") -> list[dict[str, Any]]:
    return [
        field("signatoryName", bl("Name of the signatory", "हस्ताक्षरकर्ता का नाम"), "text", True, bl("A.B.C.", "ए.बी.सी.")),
        field(
            "signatoryDesignation",
            bl("Designation", "पदनाम"),
            "text",
            True,
            bl(designation_en, designation_hi),
        ),
        field("phone", bl("Telephone number", "दूरभाष संख्या"), "text", True, bl("011-2309 2590", "011-2309 2590")),
        field("email", bl("Email", "ई-मेल"), "text", True, bl("us-estt@nic.in", "us-estt@nic.in")),
    ]


def f_enclosures(sample_en: list[str] | None = None, sample_hi: list[str] | None = None) -> dict[str, Any]:
    return field(
        "enclosures",
        bl("Enclosures", "संलग्नक"),
        "list",
        False,
        {"en": sample_en or [], "hi": sample_hi or []},
        hint=bl(
            "The count goes at the bottom left of the draft — 'Encl. 3' (9.2(vii)).",
            "मसौदे के नीचे बाईं ओर संख्या दी जाती है — 'Encl. 3' (9.2(vii))।",
        ),
    )


def f_copy_to(sample_en: list[str], sample_hi: list[str]) -> dict[str, Any]:
    return field("copyTo", bl("Copy to", "प्रतिलिपि"), "list", False, {"en": sample_en, "hi": sample_hi})


# ---- block sets -----------------------------------------------------------

URGENCY_EN = block("urgency", align="right", emphasis="bold", lines=["{{urgency}}"], omitWhenEmpty=True)
URGENCY_HI = block("urgency", align="right", emphasis="bold", lines=["{{urgency}}"], omitWhenEmpty=True)


def head_en(number_prefix: str = "No. ", urgency: bool = True) -> list[dict[str, Any]]:
    return [
        *([URGENCY_EN] if urgency else []),
        block("fileNumber", align="left", lines=[number_prefix + "{{fileNumber}}"]),
        block("header", align="center", lines=["Government of India", "{{ministry}}", "{{department}}"]),
        block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
    ]


def head_hi(number_prefix: str = "संख्या ", urgency: bool = True) -> list[dict[str, Any]]:
    return [
        *([URGENCY_HI] if urgency else []),
        block("fileNumber", align="left", lines=[number_prefix + "{{fileNumber}}"]),
        block("header", align="center", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]),
        block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
    ]


SIGN_EN = block(
    "signature",
    align="right",
    lines=["-Sd/-", "({{signatoryName}})", "{{signatoryDesignation}}", "Tele. No.: {{phone}}", "Email: {{email}}"],
)
SIGN_HI = block(
    "signature",
    align="right",
    lines=["-हस्ताक्षरित/-", "({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष संख्या : {{phone}}", "ई-मेल : {{email}}"],
)

ENCL_EN = block(
    "enclosures", align="left", source="enclosures", lead="List of enclosures:", itemPrefix="ordinal", omitWhenEmpty=True
)
ENCL_HI = block(
    "enclosures", align="left", source="enclosures", lead="संलग्नकों की सूची :", itemPrefix="ordinal", omitWhenEmpty=True
)

COPY_EN = block(
    "copyTo",
    align="left",
    source="copyTo",
    lead="Copy forwarded for information / necessary action to:",
    itemPrefix="ordinal",
    omitWhenEmpty=True,
)
COPY_HI = block(
    "copyTo",
    align="left",
    source="copyTo",
    lead="प्रति सूचना/आवश्यक कार्रवाई के लिए अग्रेषित :",
    itemPrefix="ordinal",
    omitWhenEmpty=True,
)

BODY_EN = block("body", align="left", source="paras", numbered=True)
BODY_HI = block("body", align="left", source="paras", numbered=True)


# ---- checks that recur -----------------------------------------------------

CHECK_NO_PLACEHOLDERS = check(
    "no-placeholders",
    bl("No placeholder is left unfilled", "कोई प्लेसहोल्डर अधूरा नहीं छूटा"),
    bl(
        "A draft that goes out with {{…}} still in it has not been read.",
        "जिस मसौदे में {{…}} रह जाए, उसे पढ़ा ही नहीं गया।",
    ),
    "must",
    {"kind": "noPlaceholders"},
)

CHECK_NUMBER_DATE = check(
    "number-and-date",
    bl("Number and date are on the draft", "मसौदे पर संख्या और दिनांक हैं"),
    bl(
        "Every draft put up on a file bears the file number, and the number and date of the last communication in the series must be quoted.",
        "फाइल पर प्रस्तुत प्रत्येक मसौदे पर फाइल संख्या होती है, और शृंखला के अंतिम पत्र की संख्या तथा दिनांक उद्धृत की जानी चाहिए।",
    ),
    "must",
    {"kind": "allRequired", "fields": ["fileNumber", "date"]},
    "9.2(iv), 9.2(vi)",
)

CHECK_SUBJECT = check(
    "subject",
    bl("The subject is stated", "विषय लिखा गया है"),
    bl(
        "The specimens in Appendix 8.1 carry a subject line above the body on every form that is addressed to anyone.",
        "परिशिष्ट 8.1 के नमूनों में हर संबोधित प्रपत्र पर मुख्य भाग के ऊपर विषय पंक्ति होती है।",
    ),
    "must",
    {"kind": "blockPresent", "role": "subject"},
    "Appendix 8.1",
)

CHECK_PARA_NUMBERING = check(
    "para-numbering",
    bl("Paragraphs are serially numbered", "पैराग्राफ क्रमानुसार संख्यांकित हैं"),
    bl(
        "The specimens leave the first paragraph unnumbered and number the rest from 2.",
        "नमूनों में पहला पैराग्राफ बिना संख्या के रहता है और शेष 2 से क्रमांकित होते हैं।",
    ),
    "must",
    {"kind": "paraNumbering"},
    "Appendix 8.1",
)

CHECK_ENCLOSURES = check(
    "enclosures",
    bl("Enclosures mentioned in the text are listed", "पाठ में उल्लिखित संलग्नक सूचीबद्ध हैं"),
    bl(
        "A draft should clearly specify the enclosures which are to accompany the fair copy, and the number goes at the bottom left.",
        "मसौदे में स्पष्ट रूप से बताया जाना चाहिए कि स्वच्छ प्रति के साथ कौन-से संलग्नक जाएँगे, और संख्या नीचे बाईं ओर दी जाती है।",
    ),
    "must",
    {"kind": "enclosuresConsistent"},
    "9.2(vii)",
)

CHECK_SIGNATURE = check(
    "signature-block",
    bl("Signature block carries designation, telephone and email", "हस्ताक्षर खंड में पदनाम, दूरभाष और ई-मेल हैं"),
    bl(
        "The name, designation, telephone number, fax number and e-mail address of the signing officer must invariably be on the draft.",
        "हस्ताक्षर करने वाले अधिकारी का नाम, पदनाम, दूरभाष संख्या, फैक्स संख्या और ई-मेल पता मसौदे पर अनिवार्यतः होना चाहिए।",
    ),
    "must",
    {"kind": "allRequired", "fields": ["signatoryName", "signatoryDesignation", "phone", "email"]},
    "9.2(xii)",
)

CHECK_REPLY_DATE = check(
    "reply-date",
    bl("A date is named where information is called for", "जहाँ सूचना माँगी गई है वहाँ तारीख दी गई है"),
    bl(
        "Instead of 'may be sent immediately', state 'may be sent by 28.02.2026'.",
        "'तुरंत भेजी जाए' के स्थान पर 'दिनांक 28.02.2026 तक भेजी जाए' लिखें।",
    ),
    "should",
    {"kind": "replyDate"},
    "9.2(v)",
)


def check_third_person() -> dict[str, Any]:
    return check(
        "third-person",
        bl("Written in the third person", "अन्य पुरुष में लिखा गया"),
        bl(
            "An Office Memorandum is written in the third person and bears no salutation or subscription.",
            "कार्यालय ज्ञापन अन्य पुरुष में लिखा जाता है और उसमें कोई अभिवादन या मानार्थ संबोधन नहीं होता।",
        ),
        "must",
        {"kind": "person", "value": "third"},
        "8.4(3)",
    )


def template(
    tid: str,
    *,
    group: str,
    name: dict[str, str],
    short: dict[str, str],
    person: str,
    used_by: dict[str, str],
    when: dict[str, str],
    csmop: dict[str, Any],
    fields: list[dict[str, Any]],
    layout_en: list[dict[str, Any]],
    layout_hi: list[dict[str, Any]],
    checklist: list[dict[str, Any]],
    salutation: dict[str, str] | None = None,
    subscription: dict[str, str] | None = None,
    notes: list[dict[str, Any]] | None = None,
    verify: bool = False,
    urgency_allowed: bool = True,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": tid,
        "name": name,
        "shortName": short,
        "person": person,
        "usedBy": used_by,
        "whenToUse": when,
        "salutation": salutation,
        "subscription": subscription,
        "urgencyAllowed": urgency_allowed,
        "csmopRef": csmop,
        "fields": fields,
        "layout": {"en": layout_en, "hi": layout_hi},
        "checklist": checklist,
    }
    if notes:
        record["notes"] = notes
    record.update(sourced(CSMOP, verify))
    record["_group"] = group
    return record


def ref(paras: list[str], pages: list[int] | None = None, chassis: str | None = None, note: dict[str, str] | None = None) -> dict[str, Any]:
    record: dict[str, Any] = {"edition": EDITION, "paras": paras}
    if pages:
        record["pages"] = pages
    if chassis:
        record["chassis"] = chassis
    if note:
        record["note"] = note
    return record


TEMPLATES: list[dict[str, Any]] = []

# --------------------------------------------------------------- 1. Letter --
TEMPLATES.append(
    template(
        "letter",
        group="communication",
        name=bl("Letter", "पत्र"),
        short=bl("Letter", "पत्र"),
        person="first",
        used_by=bl(
            "A Department writing to a State Government, the UPSC or another constitutional body, the head of an attached or subordinate office, a public enterprise, a statutory authority, a public body or a member of the public.",
            "राज्य सरकारों, संघ लोक सेवा आयोग और अन्य संवैधानिक निकायों, संबद्ध तथा अधीनस्थ कार्यालयों के अध्यक्षों, सार्वजनिक उद्यमों, वैधानिक प्राधिकरणों, सार्वजनिक निकायों और जनसाधारण को लिखने के लिए।",
        ),
        when=bl(
            "The formal form. Addressed on behalf of the Department to the head of the organisation by designation, opening 'Sir / Madam' and ending 'Yours faithfully'. An Office Memorandum must never be sent to a constitutional or statutory authority — the letter is the form for that.",
            "औपचारिक रूप। विभाग की ओर से संगठन के अध्यक्ष को पदनाम द्वारा संबोधित, 'महोदय/महोदया' से आरंभ और 'भवदीय' पर समाप्त। संवैधानिक या वैधानिक प्राधिकरण को कार्यालय ज्ञापन कभी न भेजें — उसके लिए पत्र ही रूप है।",
        ),
        csmop=ref(["8.4(1)", "8.8 Table 8.1", "Appendix 8.1"], [79, 87]),
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_urgency(),
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("Addressee", "संबोधित"),
                "textarea",
                True,
                bl(
                    "The Chief Secretary\nGovernment of Rajasthan\nSecretariat, Jaipur - 302005",
                    "मुख्य सचिव\nराजस्थान सरकार\nसचिवालय, जयपुर - 302005",
                ),
                hint=bl("Addressed by designation, not by name.", "पदनाम द्वारा संबोधित किया जाता है, नाम से नहीं।"),
            ),
            field(
                "attention",
                bl("Attention (officer by name)", "कृपया ध्यान दें (नामित अधिकारी)"),
                "text",
                False,
                bl("", ""),
                hint=bl(
                    "Written above the subject, and only where the matter needs that officer's personal attention (9.4).",
                    "विषय के ऊपर लिखा जाता है, और केवल तब जब मामले पर उस अधिकारी का व्यक्तिगत ध्यान अपेक्षित हो (9.4)।",
                ),
            ),
            f_subject(),
            f_paras(
                [
                    "With reference to your letter No. F.3/17/2026-GAD dated 04.08.2026 on the subject cited above, I am directed to say that the revised rates of Children Education Allowance apply to the officers of the All India Services serving in connection with the affairs of the State.",
                    "The relevant orders of the Department of Expenditure are enclosed for ready reference.",
                    "It is requested that the position may be brought to the notice of all concerned and a compliance report sent to this Department by 30.09.2026.",
                ],
                [
                    "ऊपर उद्धृत विषय पर आपके दिनांक 04.08.2026 के पत्र संख्या एफ.3/17/2026-सामान्य प्रशासन विभाग के संदर्भ में मुझे यह कहने का निदेश हुआ है कि बाल शिक्षा भत्ते की संशोधित दरें राज्य के कार्यकलापों के संबंध में सेवारत अखिल भारतीय सेवाओं के अधिकारियों पर लागू होती हैं।",
                    "व्यय विभाग के संबंधित आदेश सुविधा हेतु संलग्न हैं।",
                    "अनुरोध है कि यह स्थिति सभी संबंधितों की जानकारी में लाई जाए और अनुपालन रिपोर्ट इस विभाग को दिनांक 30.09.2026 तक भेजी जाए।",
                ],
            ),
            *f_signatory(),
            f_enclosures(
                ["Department of Expenditure O.M. No. 12011/03/2008-Estt.(AL) dated 11.11.2008 (2 pages)"],
                ["व्यय विभाग का कार्यालय ज्ञापन संख्या 12011/03/2008-स्थापना(अ.ले.) दिनांक 11.11.2008 (2 पृष्ठ)"],
            ),
            f_copy_to(
                ["The Accountant General (A&E), Rajasthan, Jaipur", "Guard file"],
                ["महालेखाकार (लेखा एवं हकदारी), राजस्थान, जयपुर", "गार्ड फाइल"],
            ),
        ],
        layout_en=[
            *head_en(),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("attention", align="left", lines=["Attention: {{attention}}"], omitWhenEmpty=True),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            SIGN_EN,
            ENCL_EN,
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("attention", align="left", lines=["कृपया ध्यान दें : {{attention}}"], omitWhenEmpty=True),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            SIGN_HI,
            ENCL_HI,
            COPY_HI,
        ],
        checklist=[
            CHECK_NUMBER_DATE,
            CHECK_SUBJECT,
            check(
                "salutation-subscription",
                bl("Salutation and subscription are present", "अभिवादन और मानार्थ संबोधन मौजूद हैं"),
                bl(
                    "A letter begins with 'Sir / Madam' and ends with 'Yours faithfully'.",
                    "पत्र 'महोदय/महोदया' से आरंभ होकर 'भवदीय' पर समाप्त होता है।",
                ),
                "must",
                {"kind": "blockPresent", "role": "salutation"},
                "8.4(1)",
            ),
            check(
                "under-direction",
                bl("Written under the directions of Government", "सरकार के निदेश के अधीन लिखा गया"),
                bl(
                    "A communication conveying the views or orders of the Government of India must be expressed to have been written under the directions of Government — 'I am directed to say'.",
                    "भारत सरकार के विचार या आदेश संप्रेषित करने वाले पत्र में स्पष्ट रूप से यह व्यक्त होना चाहिए कि वह सरकार के निदेश के अधीन लिखा गया है — 'मुझे यह कहने का निदेश हुआ है'।",
                ),
                "should",
                {"kind": "contains", "text": bl("directed", "निदेश")},
                "9.2(iii)",
            ),
            CHECK_PARA_NUMBERING,
            CHECK_ENCLOSURES,
            CHECK_SIGNATURE,
            CHECK_REPLY_DATE,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "endorsement",
                "title": bl("Endorsing a copy", "प्रतिलिपि का पृष्ठांकन"),
                "body": bl(
                    "The copy-to list on a letter is the endorsement. Copies are not normally endorsed to State Governments or to statutory or constitutional bodies — those get a letter of their own.",
                    "पत्र की प्रतिलिपि सूची ही पृष्ठांकन है। सामान्यतः राज्य सरकारों तथा वैधानिक या संवैधानिक निकायों को प्रतिलिपि पृष्ठांकित नहीं की जाती — उन्हें अलग पत्र भेजा जाता है।",
                ),
                "csmopRef": "8.4(9)",
            }
        ],
    )
)

# ------------------------------------------------- 2. Demi-official letter --
TEMPLATES.append(
    template(
        "demi-official",
        group="communication",
        name=bl("Demi-official letter (D.O.)", "अर्ध-सरकारी पत्र (डी.ओ.)"),
        short=bl("D.O. letter", "अ.स. पत्र"),
        person="first",
        used_by=bl(
            "One Government officer writing to another to draw their personal attention to an official matter of importance or urgency; also to a non-official, and by a Minister to another Minister or a Member of Parliament.",
            "एक सरकारी अधिकारी द्वारा दूसरे को महत्वपूर्ण या अत्यावश्यक सरकारी मामले में व्यक्तिगत ध्यानाकर्षण हेतु; अशासकीय व्यक्तियों को भी, तथा मंत्री द्वारा अन्य मंत्री या संसद सदस्य को।",
        ),
        when=bl(
            "Written in the first person in a personal and friendly tone, and addressed to an officer of the same level as far as possible — or at most one or two levels below. It should not exceed one page; put the argument in appendices instead.",
            "प्रथम पुरुष में, व्यक्तिगत और मैत्रीपूर्ण लहजे में लिखा जाता है, और यथासंभव समान स्तर के अधिकारी को संबोधित — अधिक से अधिक एक या दो स्तर नीचे तक। यह एक पृष्ठ से अधिक न हो; विस्तृत तर्क परिशिष्ट में रखें।",
        ),
        csmop=ref(["8.4(2)", "9.5", "Appendix 8.1"], [79, 88, 104]),
        salutation=bl("My dear Shri / Dear Shri", "प्रिय श्री"),
        subscription=bl("Yours sincerely,", "भवदीय,"),
        urgency_allowed=False,
        fields=[
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "addresseeName",
                bl("Addressee (name in the salutation)", "संबोधित (अभिवादन में नाम)"),
                "text",
                True,
                bl("Shri R. K. Sharma", "श्री आर. के. शर्मा"),
            ),
            field(
                "addressee",
                bl("Addressee block (foot of the letter)", "संबोधित खंड (पत्र के नीचे)"),
                "textarea",
                True,
                bl(
                    "Shri R. K. Sharma\nJoint Secretary\nMinistry of Finance\nDepartment of Expenditure\nNorth Block, New Delhi - 110001",
                    "श्री आर. के. शर्मा\nसंयुक्त सचिव\nवित्त मंत्रालय\nव्यय विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001",
                ),
            ),
            field(
                "subject",
                bl("Subject (optional in a D.O.)", "विषय (अर्ध-सरकारी पत्र में वैकल्पिक)"),
                "text",
                False,
                bl("", ""),
                hint=bl(
                    "The specimen in Appendix 8.1 carries no subject line; add one only if the matter needs it.",
                    "परिशिष्ट 8.1 के नमूने में विषय पंक्ति नहीं है; आवश्यक होने पर ही जोड़ें।",
                ),
            ),
            f_paras(
                [
                    "We propose to draw up a model scheme for the training of newly recruited Assistant Section Officers; a copy of the outline prepared in this connection is enclosed.",
                    "I shall be grateful if you would let me have your comments as soon as possible. I may add that we intend circulating the draft scheme formally to all Departments in due course for their comments.",
                ],
                [
                    "हम नवनियुक्त सहायक अनुभाग अधिकारियों के प्रशिक्षण के लिए एक मॉडल योजना तैयार करने का प्रस्ताव करते हैं, इस संबंध में तैयार की गई रूपरेखा की प्रति संलग्न है।",
                    "यदि आप मुझे यथाशीघ्र अपनी टिप्पणी दें तो मैं आपका आभारी रहूँगा। मैं यह भी कहना चाहूँगा कि हम मसौदा योजना को टिप्पणियों के लिए सभी विभागों को यथासमय औपचारिक रूप से परिचालित करने का प्रयोजन रखते हैं।",
                ],
                hint=bl(
                    "One page at most. Use the active voice — 'I notice', not 'It is noticed'.",
                    "अधिकतम एक पृष्ठ। कर्तृवाच्य का प्रयोग करें — 'मैं देख रहा हूँ', न कि 'यह देखा गया है'।",
                ),
            ),
            *f_signatory("Deputy Secretary to the Govt. of India", "उप सचिव, भारत सरकार"),
            f_enclosures(
                ["Outline of the proposed model training scheme (4 pages)"],
                ["प्रस्तावित मॉडल प्रशिक्षण योजना की रूपरेखा (4 पृष्ठ)"],
            ),
        ],
        layout_en=[
            block(
                "header",
                align="left",
                lines=["{{signatoryName}}", "{{signatoryDesignation}}", "Tele.: {{phone}}", "Email: {{email}}"],
            ),
            block("fileNumber", align="right", lines=["D.O. No. {{fileNumber}}"]),
            block("header", align="right", lines=["Government of India", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"], omitWhenEmpty=True),
            block("salutation", align="left", lines=["My dear {{addresseeName}},"]),
            BODY_EN,
            block("closing", align="left", lines=["With regards,"]),
            block("closing", align="right", lines=["Yours sincerely,"]),
            block("signature", align="right", lines=["({{signatoryName}})"]),
            block("addressee", align="left", lines=["{{addressee}}"]),
            ENCL_EN,
        ],
        layout_hi=[
            block(
                "header",
                align="left",
                lines=["{{signatoryName}}", "{{signatoryDesignation}}", "दूरभाष : {{phone}}", "ई-मेल : {{email}}"],
            ),
            block("fileNumber", align="right", lines=["अर्ध-सरकारी पत्र संख्या {{fileNumber}}"]),
            block("header", align="right", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"], omitWhenEmpty=True),
            block("salutation", align="left", lines=["प्रिय {{addresseeName}},"]),
            BODY_HI,
            block("closing", align="left", lines=["शुभकामनाओं सहित,"]),
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})"]),
            block("addressee", align="left", lines=["{{addressee}}"]),
            ENCL_HI,
        ],
        checklist=[
            check(
                "first-person",
                bl("Written in the first person", "प्रथम पुरुष में लिखा गया"),
                bl(
                    "The object of a D.O. is to invite the addressee's personal attention, so the style is direct, personal and friendly.",
                    "अर्ध-सरकारी पत्र का उद्देश्य संबोधित व्यक्ति का व्यक्तिगत ध्यानाकर्षण है, इसलिए शैली सीधी, व्यक्तिगत और मैत्रीपूर्ण होती है।",
                ),
                "must",
                {"kind": "person", "value": "first"},
                "9.5(i)",
            ),
            check(
                "active-voice",
                bl("Active voice, not 'It is noticed'", "कर्तृवाच्य, 'यह देखा गया है' नहीं"),
                bl(
                    "CSMOP asks for 'I notice' rather than 'It is noticed' in a demi-official letter.",
                    "सीएसएमओपी अर्ध-सरकारी पत्र में 'यह देखा गया है' के स्थान पर 'मैं देख रहा हूँ' चाहता है।",
                ),
                "should",
                {
                    "kind": "regexAbsent",
                    "role": "body",
                    "pattern": "(?:it is (?:noticed|observed|felt|seen))|(?:यह (?:देखा|पाया|महसूस किया) गया है)",
                },
                "9.5(i)",
            ),
            check(
                "one-page",
                bl("One page at most", "अधिकतम एक पृष्ठ"),
                bl(
                    "A D.O. letter should preferably not exceed one page; a longer message is condensed and the argument moved to appendices.",
                    "अर्ध-सरकारी पत्र अधिमानतः एक पृष्ठ से अधिक न हो; लंबे संदेश को संक्षिप्त करके तर्क परिशिष्टों में रखें।",
                ),
                "should",
                {"kind": "maxWords", "role": "body", "count": 300},
                "9.5(ii)",
            ),
            check(
                "signature-name",
                bl("Signed by name, with the sender's designation at the head", "नाम सहित हस्ताक्षरित, प्रेषक का पदनाम शीर्ष पर"),
                bl(
                    "A D.O. carries the writer's name and designation at the top left and is signed by name — it is a personal communication.",
                    "अर्ध-सरकारी पत्र में लेखक का नाम और पदनाम ऊपर बाईं ओर होता है और वह नाम से हस्ताक्षरित होता है — यह व्यक्तिगत पत्र है।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["signatoryName", "signatoryDesignation", "phone"]},
                "Appendix 8.1",
            ),
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "who-fairs-it",
                "title": bl("Who fairs and issues it", "कौन स्वच्छ प्रति बनाकर जारी करता है"),
                "body": bl(
                    "A draft D.O. letter is faired by the personal staff of the officer who signs it, and issued by them — unless enclosures have still to be attached, in which case the Section issues it.",
                    "अर्ध-सरकारी पत्र के मसौदे की स्वच्छ प्रति हस्ताक्षर करने वाले अधिकारी का निजी स्टाफ बनाता और जारी करता है — यदि संलग्नक लगाए जाने शेष हों तो अनुभाग जारी करता है।",
                ),
                "csmopRef": "9.5(ii), Table 9.1",
            },
            {
                "key": "emblem",
                "title": bl("Colour code and emblem", "रंग संहिता और राजचिह्न"),
                "body": bl(
                    "The colour code and the use of the National Emblem on D.O. stationery follow the instructions issued by the Ministry of Home Affairs from time to time.",
                    "अर्ध-सरकारी पत्र की स्टेशनरी पर रंग संहिता और राष्ट्रीय प्रतीक का प्रयोग गृह मंत्रालय द्वारा समय-समय पर जारी अनुदेशों के अनुसार होगा।",
                ),
                "csmopRef": "9.5(iii)",
            },
        ],
    )
)

# --------------------------------------------- 3. Office Memorandum (O.M.) --
OM_PARAS_EN = [
    "The undersigned is directed to refer to this Department's O.M. No. A-11011/2/2025-Estt. dated 12.03.2025 on the subject cited above and to say that the question of reimbursement of Children Education Allowance in respect of a child studying under the National Institute of Open Schooling has been under consideration.",
    "Doubts have been expressed whether the provisions of the said O.M. also apply to such a child. It is hereby clarified that reimbursement is admissible on production of a certificate of enrolment from the institution, subject to the two-child limit.",
    "This issues with the approval of the competent authority.",
]
OM_PARAS_HI = [
    "अधोहस्ताक्षरी को इस विभाग के कार्यालय ज्ञापन संख्या ए-11011/2/2025-स्थापना दिनांक 12.03.2025 का संदर्भ लेने तथा यह कहने का निदेश हुआ है कि राष्ट्रीय मुक्त विद्यालयी शिक्षा संस्थान के अंतर्गत अध्ययनरत बच्चे के संबंध में बाल शिक्षा भत्ते की प्रतिपूर्ति का प्रश्न विचाराधीन रहा है।",
    "संदेह व्यक्त किया गया है कि क्या उक्त कार्यालय ज्ञापन के प्रावधान ऐसे बच्चे पर भी लागू होते हैं। एतद्द्वारा यह स्पष्ट किया जाता है कि संस्थान से नामांकन प्रमाणपत्र प्रस्तुत करने पर, दो बच्चों की सीमा के अधीन, प्रतिपूर्ति देय है।",
    "यह सक्षम प्राधिकारी के अनुमोदन से जारी किया जाता है।",
]

TEMPLATES.append(
    template(
        "office-memorandum",
        group="communication",
        name=bl("Office Memorandum (O.M.)", "कार्यालय ज्ञापन"),
        short=bl("O.M.", "का.ज्ञा."),
        person="third",
        used_by=bl(
            "A Department communicating a decision to other Departments including its attached and subordinate offices, calling for or providing information, writing to its own employees, and exchanging information between sections within a Ministry.",
            "अन्य विभागों — अपने संबद्ध और अधीनस्थ कार्यालयों सहित — को निर्णय संप्रेषित करने, सूचना माँगने या देने, अपने कर्मचारियों को लिखने, तथा मंत्रालय के भीतर अनुभागों के बीच सूचना के आदान-प्रदान के लिए।",
        ),
        when=bl(
            "The everyday form. Written in the third person, with no salutation and no subscription; the name, designation, email, telephone and fax number of the signing officer are shown. Never send one to a constitutional or statutory authority.",
            "रोज़मर्रा का रूप। अन्य पुरुष में लिखा जाता है, कोई अभिवादन और कोई मानार्थ संबोधन नहीं; हस्ताक्षरकर्ता अधिकारी का नाम, पदनाम, ई-मेल, दूरभाष और फैक्स संख्या दर्शाई जाती है। संवैधानिक या वैधानिक प्राधिकरण को यह कभी न भेजें।",
        ),
        csmop=ref(["8.4(3)", "8.8 Table 8.1", "Appendix 8.1"], [79, 80, 89]),
        salutation=None,
        subscription=None,
        fields=[
            f_urgency(),
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            f_subject(),
            f_paras(OM_PARAS_EN, OM_PARAS_HI),
            *f_signatory(),
            field(
                "addressee",
                bl("To", "सेवा में"),
                "textarea",
                True,
                bl(
                    "All Ministries / Departments of the Government of India\n(as per standard list)",
                    "भारत सरकार के सभी मंत्रालय / विभाग\n(मानक सूची के अनुसार)",
                ),
                hint=bl(
                    "On an Office Memorandum the addressee is written at the foot, below the signature.",
                    "कार्यालय ज्ञापन में संबोधित पक्ष हस्ताक्षर के नीचे, पत्र के अंत में लिखा जाता है।",
                ),
            ),
            f_enclosures([], []),
            f_copy_to(
                ["The Pay and Accounts Officer, Department of Personnel and Training", "Guard file", "Hindi Section — for Hindi version"],
                ["वेतन एवं लेखा अधिकारी, कार्मिक और प्रशिक्षण विभाग", "गार्ड फाइल", "हिंदी अनुभाग — हिंदी रूपांतर हेतु"],
            ),
        ],
        layout_en=[
            *head_en(),
            block("title", align="center", emphasis="title", lines=["OFFICE MEMORANDUM"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            BODY_EN,
            SIGN_EN,
            block("addressee", align="left", lines=["To", "{{addressee}}"]),
            ENCL_EN,
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(),
            block("title", align="center", emphasis="title", lines=["कार्यालय ज्ञापन"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            BODY_HI,
            SIGN_HI,
            block("addressee", align="left", lines=["सेवा में", "{{addressee}}"]),
            ENCL_HI,
            COPY_HI,
        ],
        checklist=[
            check_third_person(),
            check(
                "undersigned-directed",
                bl("Opens 'The undersigned is directed'", "'अधोहस्ताक्षरी को निदेश हुआ है' से आरंभ"),
                bl(
                    "An O.M. conveying the views or orders of the Government must say it was written under the directions of Government; the specimen opens with exactly this phrase.",
                    "सरकार के विचार या आदेश संप्रेषित करने वाले कार्यालय ज्ञापन में यह व्यक्त होना चाहिए कि वह सरकार के निदेश के अधीन लिखा गया है; नमूना इसी वाक्यांश से आरंभ होता है।",
                ),
                "should",
                {"kind": "contains", "role": "body", "text": bl("undersigned is directed", "अधोहस्ताक्षरी को")},
                "9.2(iii), Appendix 8.1",
            ),
            CHECK_NUMBER_DATE,
            CHECK_SUBJECT,
            CHECK_PARA_NUMBERING,
            CHECK_ENCLOSURES,
            check(
                "copy-to",
                bl("Copies are endorsed to everyone concerned", "प्रतिलिपियाँ सभी संबंधितों को पृष्ठांकित हैं"),
                bl(
                    "Copies are endorsed to all the persons and authorities concerned; the guard file is one of them.",
                    "प्रतिलिपियाँ सभी संबंधित व्यक्तियों/प्राधिकारियों को पृष्ठांकित की जाती हैं; गार्ड फाइल उनमें एक है।",
                ),
                "should",
                {"kind": "listNonEmpty", "field": "copyTo"},
                "8.4(4)",
            ),
            CHECK_SIGNATURE,
            CHECK_REPLY_DATE,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "not-to-authorities",
                "title": bl("Never to a constitutional or statutory authority", "संवैधानिक या वैधानिक प्राधिकरण को कभी नहीं"),
                "body": bl(
                    "Communications to the Election Commission, TRAI, SEBI and the like are made in the letter form, addressed to the Principal Secretary or Secretary. In no case is an Office Memorandum sent to such an authority.",
                    "निर्वाचन आयोग, ट्राई, सेबी आदि को पत्र के रूप में, प्रधान सचिव या सचिव को संबोधित करके लिखा जाता है। ऐसे प्राधिकरण को किसी भी स्थिति में कार्यालय ज्ञापन नहीं भेजा जाता।",
                ),
                "csmopRef": "8.8 Table 8.1(5)",
            }
        ],
    )
)

# ------------------------------------------------------------- 4. Circular --
TEMPLATES.append(
    template(
        "circular",
        group="communication",
        name=bl("Circular", "परिपत्र"),
        short=bl("Circular", "परिपत्र"),
        person="third",
        used_by=bl(
            "A Department bringing one instruction to the notice of everyone at once — all sections, all officers, or all Ministries.",
            "एक ही अनुदेश को एक साथ सबकी जानकारी में लाने के लिए — सभी अनुभागों, सभी अधिकारियों या सभी मंत्रालयों को।",
        ),
        when=bl(
            "The Office Memorandum's format with a general addressee. CSMOP 8.4 does not list the circular separately, so it borrows the O.M. chassis: third person, no salutation, no subscription, signature block with designation and telephone.",
            "सामान्य संबोधन के साथ कार्यालय ज्ञापन का प्रारूप। सीएसएमओपी 8.4 में परिपत्र अलग से सूचीबद्ध नहीं है, इसलिए यह कार्यालय ज्ञापन का ढाँचा लेता है: अन्य पुरुष, कोई अभिवादन नहीं, कोई मानार्थ संबोधन नहीं, पदनाम और दूरभाष सहित हस्ताक्षर खंड।",
        ),
        csmop=ref(
            ["8.4(3)", "Appendix 8.1"],
            [79, 89],
            chassis="office-memorandum",
            note=bl(
                "The circular is not one of the ten forms in CSMOP 8.4. This template is the Office Memorandum format with a general addressee, which is what the Central Secretariat actually issues.",
                "परिपत्र सीएसएमओपी 8.4 के दस रूपों में नहीं है। यह टेम्पलेट सामान्य संबोधन के साथ कार्यालय ज्ञापन का प्रारूप है, जो केंद्रीय सचिवालय में वास्तव में जारी किया जाता है।",
            ),
        ),
        verify=True,
        fields=[
            f_urgency(),
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Observance of office timings and use of the biometric attendance system — regarding.",
                    "कार्यालय समय का पालन तथा बायोमेट्रिक उपस्थिति प्रणाली का उपयोग — के संबंध में।",
                ),
            ),
            f_paras(
                [
                    "It has been observed that office timings are not being adhered to uniformly across sections. All officers and staff are reminded that the prescribed office hours are 9.00 a.m. to 5.30 p.m., with a half-hour lunch break.",
                    "Attendance is to be marked on the biometric attendance system on arrival and before leaving. Late arrival on more than two occasions in a month will be regulated in accordance with the instructions on the subject.",
                    "All Heads of Divisions are requested to bring this to the notice of every officer and member of the staff working under them by 15.09.2026.",
                ],
                [
                    "यह देखा गया है कि सभी अनुभागों में कार्यालय समय का एकसमान पालन नहीं हो रहा है। सभी अधिकारियों और कर्मचारियों को स्मरण कराया जाता है कि निर्धारित कार्यालय समय पूर्वाह्न 9.00 बजे से अपराह्न 5.30 बजे तक है, जिसमें आधे घंटे का भोजनावकाश सम्मिलित है।",
                    "आगमन पर तथा प्रस्थान से पूर्व बायोमेट्रिक उपस्थिति प्रणाली पर उपस्थिति दर्ज की जाए। एक माह में दो से अधिक बार विलंब से आने पर इस विषय के अनुदेशों के अनुसार कार्रवाई की जाएगी।",
                    "सभी प्रभाग प्रमुखों से अनुरोध है कि वे इसे अपने अधीन कार्यरत प्रत्येक अधिकारी और कर्मचारी की जानकारी में दिनांक 15.09.2026 तक लाएँ।",
                ],
            ),
            *f_signatory(),
            field(
                "addressee",
                bl("To", "सेवा में"),
                "textarea",
                True,
                bl(
                    "All officers and staff of the Department\nAll Heads of Divisions",
                    "विभाग के सभी अधिकारी और कर्मचारी\nसभी प्रभाग प्रमुख",
                ),
            ),
            f_enclosures([], []),
            f_copy_to(
                ["Notice board", "Departmental website", "Guard file"],
                ["सूचना पट्ट", "विभागीय वेबसाइट", "गार्ड फाइल"],
            ),
        ],
        layout_en=[
            *head_en(),
            block("title", align="center", emphasis="title", lines=["CIRCULAR"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            BODY_EN,
            SIGN_EN,
            block("addressee", align="left", lines=["To", "{{addressee}}"]),
            ENCL_EN,
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(),
            block("title", align="center", emphasis="title", lines=["परिपत्र"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            BODY_HI,
            SIGN_HI,
            block("addressee", align="left", lines=["सेवा में", "{{addressee}}"]),
            ENCL_HI,
            COPY_HI,
        ],
        checklist=[
            check_third_person(),
            CHECK_NUMBER_DATE,
            CHECK_SUBJECT,
            CHECK_PARA_NUMBERING,
            check(
                "general-addressee",
                bl("Addressed to everyone it is meant for", "उन सबको संबोधित जिनके लिए यह है"),
                bl(
                    "A circular that names no addressee is an O.M. that will be filed and forgotten.",
                    "जिस परिपत्र में संबोधित पक्ष का उल्लेख नहीं, वह ऐसा कार्यालय ज्ञापन है जो फाइल होकर भुला दिया जाएगा।",
                ),
                "must",
                {"kind": "required", "field": "addressee"},
            ),
            CHECK_REPLY_DATE,
            CHECK_SIGNATURE,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# --------------------------------------- 5. Inter-Departmental note (U.O.) --
TEMPLATES.append(
    template(
        "id-note",
        group="internal",
        name=bl("Inter-Departmental note (U.O. note)", "अंतर-विभागीय टिप्पणी (यू.ओ. टिप्पणी)"),
        short=bl("I.D. note", "अं.वि. टिप्पणी"),
        person="third",
        used_by=bl(
            "One Ministry or Department consulting another — for advice, views, comments or concurrence on a proposal, or for a clarification of existing rules from the nodal Department. Also between a Department and its attached and subordinate offices.",
            "एक मंत्रालय या विभाग द्वारा दूसरे से परामर्श — किसी प्रस्ताव पर सलाह, विचार, टिप्पणी या सहमति के लिए, या नोडल विभाग से वर्तमान नियमों के स्पष्टीकरण के लिए। विभाग और उसके संबद्ध तथा अधीनस्थ कार्यालयों के बीच भी।",
        ),
        when=bl(
            "Either recorded on the file being referred, or sent as an independent self-contained note. It is made with the approval of an officer not below Joint Secretary and issued under the signature of an officer not below Under Secretary. State the points on which advice is sought in the concluding paragraph, and prescribe a time limit.",
            "या तो संदर्भित की जा रही फाइल पर दर्ज, या स्वतंत्र स्वतःपूर्ण टिप्पणी के रूप में भेजी जाती है। यह संयुक्त सचिव से अनिम्न अधिकारी के अनुमोदन से की जाती है और अवर सचिव से अनिम्न अधिकारी के हस्ताक्षर से जारी होती है। जिन बिंदुओं पर सलाह चाहिए उन्हें अंतिम पैराग्राफ में लिखें, और समय-सीमा निर्धारित करें।",
        ),
        csmop=ref(["8.1", "8.1.2(v)", "8.1.2(vi)", "9.6(iv)", "Appendix 8.1"], [75, 76, 92, 106]),
        urgency_allowed=True,
        fields=[
            f_urgency(),
            f_ministry(),
            f_department(),
            f_subject(),
            f_paras(
                [
                    "The present rules regulating the issue of identity cards provide, inter alia, that a card is to be surrendered on the date of superannuation.",
                    "A question has now arisen whether an officer re-employed immediately on superannuation may retain the card issued to him before retirement.",
                    "The matter has been examined in this Department. The rules are silent on re-employment, and no precedent is available on the file.",
                    "It is felt that a card carrying the pre-retirement designation would be misleading and that a fresh card should be issued.",
                    "This Department will be grateful for the advice of the Department of Legal Affairs on the issue raised in para 4 above. Comments are requested by 30.09.2026, please.",
                ],
                [
                    "पहचान पत्र जारी करने को विनियमित करने वाले वर्तमान नियमों में अन्य बातों के साथ-साथ यह है कि पत्र अधिवर्षिता की तारीख को अभ्यर्पित कर दिया जाएगा।",
                    "अब प्रश्न यह उठता है कि क्या अधिवर्षिता पर तत्काल पुनर्नियोजित अधिकारी सेवानिवृत्ति से पूर्व जारी पहचान पत्र अपने पास रख सकता है।",
                    "इस विभाग में मामले की जाँच की गई है। नियम पुनर्नियोजन पर मौन हैं और फाइल पर कोई मिसाल उपलब्ध नहीं है।",
                    "ऐसा प्रतीत होता है कि सेवानिवृत्ति-पूर्व पदनाम वाला पहचान पत्र भ्रामक होगा और नया पत्र जारी किया जाना चाहिए।",
                    "यह विभाग उपर्युक्त पैरा 4 में उठाए गए मुद्दे पर विधि कार्य विभाग की सलाह के लिए आभारी रहेगा। टिप्पणियाँ दिनांक 30.09.2026 तक अपेक्षित हैं।",
                ],
                hint=bl(
                    "Number every paragraph, including the first: the specimen in Appendix 8.1 starts at 1.",
                    "पहले सहित प्रत्येक पैराग्राफ को संख्या दें: परिशिष्ट 8.1 का नमूना 1 से आरंभ होता है।",
                ),
            ),
            *f_signatory("Deputy Secretary", "उप सचिव"),
            field(
                "addressee",
                bl("Department consulted", "जिस विभाग से परामर्श किया जा रहा है"),
                "textarea",
                True,
                bl(
                    "Department of Legal Affairs (Vidhi Karya Vibhag), Shri A. K. Menon, Shastri Bhawan, New Delhi",
                    "विधि कार्य विभाग, श्री ए. के. मेनन, शास्त्री भवन, नई दिल्ली",
                ),
            ),
            field(
                "idNumber",
                bl("I.D. number", "आई.डी. संख्या"),
                "text",
                True,
                bl("A-11011/2/2026-Estt.", "ए-11011/2/2026-स्थापना"),
            ),
            f_date(),
            f_enclosures(
                ["Draft instructions proposed to be issued (1 page)"],
                ["जारी किए जाने के लिए प्रस्तावित अनुदेशों का मसौदा (1 पृष्ठ)"],
            ),
        ],
        layout_en=[
            URGENCY_EN,
            block("header", align="center", lines=["Government of India", "{{ministry}}", "{{department}}"]),
            block("title", align="center", emphasis="title", lines=["INTER-DEPARTMENTAL NOTE"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("body", align="left", source="paras", numbered=True, numberFrom=1),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele. No. / Email: {{phone}} / {{email}}"]),
            block("addressee", align="left", lines=["{{addressee}}"]),
            ENCL_EN,
            block("footer", align="left", lines=["_______________________________________________", "{{department}} I.D. No. {{idNumber}} dated {{date}}"]),
        ],
        layout_hi=[
            URGENCY_HI,
            block("header", align="center", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]),
            block("title", align="center", emphasis="title", lines=["अंतर-विभागीय टिप्पणी"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("body", align="left", source="paras", numbered=True, numberFrom=1),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष संख्या / ई-मेल : {{phone}} / {{email}}"]),
            block("addressee", align="left", lines=["{{addressee}}"]),
            ENCL_HI,
            block("footer", align="left", lines=["_______________________________________________", "{{department}} आई.डी. सं. {{idNumber}} दिनांक {{date}}"]),
        ],
        checklist=[
            check(
                "numbered-from-one",
                bl("Every paragraph is numbered, from 1", "प्रत्येक पैराग्राफ 1 से संख्यांकित है"),
                bl(
                    "The Appendix 8.1 specimen of an I.D. note numbers its first paragraph 1, unlike a letter or an O.M.",
                    "परिशिष्ट 8.1 के अंतर-विभागीय टिप्पणी नमूने में पहला पैराग्राफ 1 से संख्यांकित है, पत्र या कार्यालय ज्ञापन के विपरीत।",
                ),
                "must",
                {"kind": "paraNumbering"},
                "Appendix 8.1",
            ),
            check(
                "points-stated",
                bl("The point on which advice is sought is in the last paragraph", "जिस बिंदु पर सलाह चाहिए वह अंतिम पैराग्राफ में है"),
                bl(
                    "Clearly state the points on which the advice or concurrence of the other Department is sought, preferably in the concluding paragraph.",
                    "जिन बिंदुओं पर दूसरे विभाग की सलाह या सहमति चाहिए उन्हें स्पष्ट रूप से, अधिमानतः समापन पैराग्राफ में लिखें।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("advice", "सलाह")},
                "8.1.2(vi)",
            ),
            check(
                "time-limit",
                bl("A time limit is prescribed", "समय-सीमा निर्धारित है"),
                bl(
                    "Prescribe a time limit when calling for advice or concurrence; without one the originating Ministry has nothing to wait until.",
                    "सलाह या सहमति माँगते समय समय-सीमा निर्धारित करें; इसके बिना आरंभकर्ता मंत्रालय के पास प्रतीक्षा की कोई सीमा नहीं होती।",
                ),
                "must",
                {"kind": "replyDate"},
                "8.1.2(i)",
            ),
            check(
                "id-number-date",
                bl("I.D. number and date are at the foot", "आई.डी. संख्या और दिनांक नीचे हैं"),
                bl(
                    "The specimen closes with 'Department of … I.D. No. … dated …' below a rule.",
                    "नमूना एक रेखा के नीचे '… विभाग आई.डी. सं. … दिनांक …' से समाप्त होता है।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["idNumber", "date"]},
                "Appendix 8.1",
            ),
            check(
                "signed-at-level",
                bl("Signed at Under Secretary level or above", "अवर सचिव या उससे ऊपर के स्तर पर हस्ताक्षरित"),
                bl(
                    "Inter-Departmental references are made with the approval of an officer not below Joint Secretary, under the signature of an officer not below Under Secretary.",
                    "अंतर-विभागीय संदर्भ संयुक्त सचिव से अनिम्न अधिकारी के अनुमोदन से, अवर सचिव से अनिम्न अधिकारी के हस्ताक्षर से किए जाते हैं।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["signatoryName", "signatoryDesignation"]},
                "8.1.2(v)",
            ),
            CHECK_SUBJECT,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "self-contained",
                "title": bl("Self-contained, or on the file", "स्वतःपूर्ण, या फाइल पर"),
                "body": bl(
                    "An I.D. note is either recorded on the file being referred or sent as an independent self-contained note. Where more than one Department is to be consulted, consult them simultaneously by self-contained notes — unless the second consultation only makes sense after the first Department has replied.",
                    "अंतर-विभागीय टिप्पणी या तो संदर्भित की जा रही फाइल पर दर्ज की जाती है या स्वतंत्र स्वतःपूर्ण टिप्पणी के रूप में भेजी जाती है। यदि एक से अधिक विभागों से परामर्श करना हो तो स्वतःपूर्ण टिप्पणियों द्वारा एक साथ परामर्श करें — जब तक कि दूसरा परामर्श पहले विभाग के उत्तर के बाद ही सार्थक न हो।",
                ),
                "csmopRef": "8.1.1(ii), 8.1.2(viii)",
            },
            {
                "key": "drafts-with-it",
                "title": bl("Put the draft orders with it", "प्रस्तावित आदेशों का मसौदा साथ रखें"),
                "body": bl(
                    "Place the drafts of the orders proposed to be issued along with the I.D. note to the Department being consulted.",
                    "जारी किए जाने के लिए प्रस्तावित आदेशों के मसौदे परामर्श किए जा रहे विभाग को भेजी जा रही अंतर-विभागीय टिप्पणी के साथ रखें।",
                ),
                "csmopRef": "8.1.2(vii)",
            },
        ],
    )
)

# --------------------------------------------------------------- 6. Noting --
TEMPLATES.append(
    template(
        "noting",
        group="internal",
        name=bl("Note on a file (noting)", "फाइल पर टिप्पणी"),
        short=bl("Noting", "टिप्पणी"),
        person="third",
        used_by=bl(
            "The Dealing Officer and every officer above in the channel of submission, recording a note on the notes portion of a file so that the competent authority can decide.",
            "डीलिंग अधिकारी तथा प्रस्तुतीकरण के माध्यम में उससे ऊपर का प्रत्येक अधिकारी, फाइल के टिप्पणी भाग पर टिप्पणी दर्ज करके, ताकि सक्षम प्राधिकारी निर्णय ले सके।",
        ),
        when=bl(
            "A note is a precis of previous papers, an analysis of the issues, the financial and legal implications, a suggestion with its justification, and the authority competent to decide. Keep it to the quantum the case deserves: no note at all on an ephemeral case, three or four sentences on a correspondence case, a standard process sheet on a repetitive one, a structured note on a problem-solving case.",
            "टिप्पणी में पिछले कागजातों का सार, मुद्दों का विश्लेषण, वित्तीय और विधिक निहितार्थ, औचित्य सहित सुझाव, तथा निर्णय के लिए सक्षम प्राधिकारी होते हैं। मामले के अनुरूप मात्रा रखें: क्षणभंगुर मामले पर कोई टिप्पणी नहीं, पत्राचार मामले पर तीन-चार वाक्य, पुनरावर्ती मामले पर मानक प्रक्रिया पत्रक, समस्या-समाधान मामले पर संरचित टिप्पणी।",
        ),
        csmop=ref(["7.1", "7.2", "7.3", "7.6", "7.14", "6.7", "6.8"], [61, 62, 64, 66, 69, 42, 44]),
        urgency_allowed=True,
        fields=[
            f_urgency(),
            f_file_number(),
            f_subject(),
            field(
                "noteType",
                bl("Kind of case", "मामले का प्रकार"),
                "select",
                True,
                bl("problem-solving", "problem-solving"),
                hint=bl(
                    "The functional approach to noting decides how much to write.",
                    "नोटिंग का कार्यात्मक दृष्टिकोण तय करता है कि कितना लिखना है।",
                ),
                options=[
                    {"value": "ephemeral", "label": bl("Ephemeral — no noting", "क्षणभंगुर — कोई टिप्पणी नहीं")},
                    {"value": "correspondence", "label": bl("Action in correspondence — a few sentences", "पत्राचार में कार्रवाई — कुछ वाक्य")},
                    {"value": "repetitive", "label": bl("Repetitive — standard process sheet", "पुनरावर्ती — मानक प्रक्रिया पत्रक")},
                    {"value": "problem-solving", "label": bl("Problem solving — structured note", "समस्या-समाधान — संरचित टिप्पणी")},
                    {"value": "policy", "label": bl("Policy or planning — detailed note", "नीति या योजना — विस्तृत टिप्पणी")},
                ],
            ),
            field(
                "references",
                bl("Referencing", "संदर्भ"),
                "list",
                False,
                {
                    "en": [
                        "PUC at page 7/c — application of Shri X.Y.Z. dated 04.08.2026",
                        "Flag 'A' — CCS (Leave) Rules, 1972, Rule 26",
                        "Flag 'B' — File No. A-11011/9/2024-Estt., page 12/n (precedent)",
                    ],
                    "hi": [
                        "विचाराधीन पत्र पृष्ठ 7/पत्राचार — श्री एक्स.वाई.ज़ेड. का दिनांक 04.08.2026 का आवेदन",
                        "ध्वज 'क' — केंद्रीय सिविल सेवा (छुट्टी) नियम, 1972, नियम 26",
                        "ध्वज 'ख' — फाइल संख्या ए-11011/9/2024-स्थापना, पृष्ठ 12/टिप्पणी (मिसाल)",
                    ],
                },
                hint=bl(
                    "Quote the page numbers in the margin; flags come off, page numbers do not.",
                    "पृष्ठ संख्याएँ हाशिये में उद्धृत करें; ध्वज हट जाते हैं, पृष्ठ संख्याएँ नहीं।",
                ),
            ),
            f_paras(
                [
                    "The paper under consideration at page 7/c is an application from Shri X.Y.Z., Section Officer, for 30 days' earned leave from 01.10.2026 to 30.10.2026, with permission to prefix 30.09.2026 and suffix 31.10.2026, both public holidays.",
                    "The rule position is at flag 'A'. Rule 26 of the CCS (Leave) Rules, 1972 permits earned leave up to 180 days at a time, and prefixing and suffixing of holidays is admissible unless the leave is on medical grounds followed by fitness certification.",
                    "The applicant has 96 days of earned leave to his credit as on 01.10.2026, as verified from the leave account at page 9/c. The Section can be managed by Shri P.Q.R. during the period.",
                    "A precedent in a similar case is at flag 'B', decided at the level of the Under Secretary.",
                    "In view of the above, it is proposed that the leave applied for may be sanctioned. If approved, a draft Office Order is placed below for signature.",
                    "Under Secretary (Administration) is the competent authority to sanction earned leave to a Section Officer. Submitted for approval.",
                ],
                [
                    "पृष्ठ 7/पत्राचार पर विचाराधीन पत्र श्री एक्स.वाई.ज़ेड., अनुभाग अधिकारी का आवेदन है, जिसमें दिनांक 01.10.2026 से 30.10.2026 तक 30 दिनों के अर्जित अवकाश की माँग की गई है, साथ ही दिनांक 30.09.2026 को उपसर्ग तथा 31.10.2026 को प्रत्यय के रूप में जोड़ने की अनुमति चाही गई है, ये दोनों सार्वजनिक अवकाश हैं।",
                    "नियम की स्थिति ध्वज 'क' पर है। केंद्रीय सिविल सेवा (छुट्टी) नियम, 1972 का नियम 26 एक बार में 180 दिन तक अर्जित अवकाश की अनुमति देता है, और चिकित्सा आधार पर अवकाश के अतिरिक्त अन्य मामलों में अवकाश से पूर्व और पश्चात के सार्वजनिक अवकाश जोड़े जा सकते हैं।",
                    "पृष्ठ 9/पत्राचार पर अवकाश लेखा से सत्यापित किया गया है कि दिनांक 01.10.2026 को आवेदक के खाते में 96 दिन का अर्जित अवकाश शेष है। इस अवधि में अनुभाग का कार्य श्री पी.क्यू.आर. द्वारा संभाला जा सकता है।",
                    "इसी प्रकार के मामले की मिसाल ध्वज 'ख' पर है, जिसका निर्णय अवर सचिव के स्तर पर किया गया था।",
                    "उपर्युक्त को देखते हुए प्रस्ताव है कि माँगा गया अवकाश स्वीकृत किया जाए। अनुमोदन होने पर हस्ताक्षर के लिए कार्यालय आदेश का मसौदा नीचे रखा गया है।",
                    "अनुभाग अधिकारी को अर्जित अवकाश स्वीकृत करने के लिए अवर सचिव (प्रशासन) सक्षम प्राधिकारी हैं। अनुमोदनार्थ प्रस्तुत।",
                ],
                hint=bl(
                    "Every paragraph is numbered, from 1. Summarise the PUC — do not reproduce it.",
                    "प्रत्येक पैराग्राफ 1 से संख्यांकित होता है। विचाराधीन पत्र का सार दें — उसे दोहराएँ नहीं।",
                ),
            ),
            field(
                "levelOfDisposal",
                bl("Competent authority / level of disposal", "सक्षम प्राधिकारी / निपटान का स्तर"),
                "text",
                True,
                bl("Under Secretary (Administration)", "अवर सचिव (प्रशासन)"),
            ),
            field("signatoryName", bl("Name of the officer noting", "टिप्पणी करने वाले अधिकारी का नाम"), "text", True, bl("S. Iyer", "एस. अय्यर")),
            field(
                "signatoryDesignation",
                bl("Designation", "पदनाम"),
                "text",
                True,
                bl("Assistant Section Officer", "सहायक अनुभाग अधिकारी"),
            ),
            f_date(bl("Date of the note", "टिप्पणी की तारीख")),
        ],
        layout_en=[
            URGENCY_EN,
            block("fileNumber", align="left", lines=["File No. {{fileNumber}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", source="references", lead="Referencing:", itemPrefix="none", omitWhenEmpty=True),
            block("body", align="left", source="paras", numbered=True, numberFrom=1),
            block("signature", align="left", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "{{date}}"]),
            block("footer", align="left", lines=["Level of disposal: {{levelOfDisposal}}"]),
        ],
        layout_hi=[
            URGENCY_HI,
            block("fileNumber", align="left", lines=["फाइल संख्या {{fileNumber}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", source="references", lead="संदर्भ :", itemPrefix="none", omitWhenEmpty=True),
            block("body", align="left", source="paras", numbered=True, numberFrom=1),
            block("signature", align="left", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "{{date}}"]),
            block("footer", align="left", lines=["निपटान का स्तर : {{levelOfDisposal}}"]),
        ],
        checklist=[
            check(
                "numbered-paras",
                bl("Divided into serially numbered paragraphs", "क्रमानुसार संख्यांकित पैराग्राफों में विभाजित"),
                bl(
                    "A note will be divided into serially numbered paragraphs; in a problem-solving or policy case the paragraphs may carry brief titles.",
                    "टिप्पणी क्रमानुसार संख्यांकित पैराग्राफों में विभाजित होगी; समस्या-समाधान या नीति मामले में पैराग्राफों के संक्षिप्त शीर्षक हो सकते हैं।",
                ),
                "must",
                {"kind": "paraNumbering"},
                "7.2(xiv)",
            ),
            check(
                "signature-with-date",
                bl("Full signature with the complete date", "पूरी तारीख सहित पूर्ण हस्ताक्षर"),
                bl(
                    "The Dealing Officer affixes a full signature with the complete date (dd/mm/yyyy) on the left below the note; a Section Officer and above sign on the right.",
                    "डीलिंग अधिकारी टिप्पणी के नीचे बाईं ओर पूरी तारीख (dd/mm/yyyy) सहित पूर्ण हस्ताक्षर करता है; अनुभाग अधिकारी और उससे ऊपर दाईं ओर हस्ताक्षर करते हैं।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["signatoryName", "signatoryDesignation", "date"]},
                "7.3(xi), 7.4(iv)",
            ),
            check(
                "competent-authority",
                bl("The competent authority is named", "सक्षम प्राधिकारी का उल्लेख है"),
                bl(
                    "Indicate the authority competent to take the decision, along with the delegation of powers relied on.",
                    "निर्णय लेने के लिए सक्षम प्राधिकारी का उल्लेख करें, साथ ही जिस शक्ति-प्रत्यायोजन पर भरोसा किया गया है उसका भी।",
                ),
                "must",
                {"kind": "required", "field": "levelOfDisposal"},
                "7.3(x)",
            ),
            check(
                "referencing",
                bl("Rules, precedents and the PUC are referenced", "नियम, मिसालें और विचाराधीन पत्र संदर्भित हैं"),
                bl(
                    "Place the relevant extracts on the file and draw attention to them in the note, quoting the page numbers in the margin — rather than reproducing the provisions in the note.",
                    "संबंधित उद्धरण फाइल पर रखें और टिप्पणी में हाशिये में पृष्ठ संख्या उद्धृत करते हुए उनकी ओर ध्यान दिलाएँ — प्रावधानों को टिप्पणी में दोहराने के बजाय।",
                ),
                "should",
                {"kind": "listNonEmpty", "field": "references"},
                "7.2(vii), 6.7(iii)",
            ),
            check(
                "proposal",
                bl("A course of action is proposed", "कार्रवाई का मार्ग प्रस्तावित है"),
                bl(
                    "Suggest the course of action to be taken with justification, along with the alternatives for the competent authority to consider.",
                    "औचित्य सहित की जाने वाली कार्रवाई का सुझाव दें, साथ ही सक्षम प्राधिकारी के विचारार्थ विकल्प भी।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("proposed", "प्रस्ताव")},
                "7.3(ix)",
            ),
            check(
                "concise",
                bl("Concise — no verbatim reproduction", "संक्षिप्त — शब्दशः पुनरुत्पादन नहीं"),
                bl(
                    "A note must be concise and to the point; verbatim reproduction of the paper under consideration is to be avoided in favour of a summary.",
                    "टिप्पणी संक्षिप्त और सारगर्भित होनी चाहिए; विचाराधीन पत्र का शब्दशः पुनरुत्पादन टालकर सारांश दिया जाए।",
                ),
                "should",
                {"kind": "maxWords", "role": "body", "count": 600},
                "7.2(iii)",
            ),
            CHECK_SUBJECT,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "quantum",
                "title": bl("How much to write", "कितना लिखें"),
                "body": bl(
                    "Ephemeral case: no noting — the Section Officer records briefly why no action is needed and files it at the dak stage. Correspondence case: three or four sentences. Repetitive case: a standard process sheet, no conventional note at all. Problem-solving case: what the problem is, how it arose, the rule or precedent, the possible solutions, the best one and why, its consequences, whether another Department must be consulted, and who is competent to decide.",
                    "क्षणभंगुर मामला: कोई टिप्पणी नहीं — अनुभाग अधिकारी संक्षेप में लिखता है कि कार्रवाई क्यों अपेक्षित नहीं और डाक स्तर पर ही फाइल कर देता है। पत्राचार मामला: तीन-चार वाक्य। पुनरावर्ती मामला: मानक प्रक्रिया पत्रक, कोई पारंपरिक टिप्पणी नहीं। समस्या-समाधान मामला: समस्या क्या है, कैसे उठी, नियम या मिसाल, संभावित समाधान, सर्वोत्तम कौन-सा और क्यों, उसके परिणाम, क्या किसी अन्य विभाग से परामर्श आवश्यक है, और निर्णय के लिए कौन सक्षम है।",
                ),
                "csmopRef": "7.14, Table 7.1",
            },
            {
                "key": "self-contained-to-secretary",
                "title": bl("A self-contained note for the Secretary or Minister", "सचिव या मंत्री के लिए स्वतःपूर्ण टिप्पणी"),
                "body": bl(
                    "Unless a running summary of facts is on the file, or the last note itself serves that purpose, a self-contained note goes up with every case submitted to the Secretary or the Minister — and at least a quarter of a page is left below the last note.",
                    "जब तक फाइल पर तथ्यों का चालू सारांश न हो, या अंतिम टिप्पणी स्वयं वह प्रयोजन पूरा न करती हो, सचिव या मंत्री को प्रस्तुत प्रत्येक मामले के साथ स्वतःपूर्ण टिप्पणी जाती है — और अंतिम टिप्पणी के नीचे कम से कम एक चौथाई पृष्ठ खाली छोड़ा जाता है।",
                ),
                "csmopRef": "7.2(viii), 7.3(xii)",
            },
            {
                "key": "never-remove",
                "title": bl("A note is never removed", "टिप्पणी कभी हटाई नहीं जाती"),
                "body": bl(
                    "Under no circumstances is a note pasted over or removed from a file. A mistake or a disagreement is dealt with by recording a fresh note, keeping the earlier one on the file.",
                    "किसी भी परिस्थिति में टिप्पणी पर चिपकाया या उसे फाइल से हटाया नहीं जाता। भूल या असहमति की स्थिति में पहले वाली टिप्पणी को फाइल पर रखते हुए नई टिप्पणी दर्ज की जाती है।",
                ),
                "csmopRef": "7.13(ii)",
            },
        ],
    )
)

# ---------------------------------------------------------- 7. Notification --
TEMPLATES.append(
    template(
        "notification",
        group="statutory",
        name=bl("Notification", "अधिसूचना"),
        short=bl("Notification", "अधिसूचना"),
        person="third",
        used_by=bl(
            "A Department notifying the promulgation of statutory rules and orders, and the appointment or promotion of certain categories of officers, through publication in the Gazette of India.",
            "भारत के राजपत्र में प्रकाशन द्वारा वैधानिक नियमों और आदेशों के प्रवर्तन तथा कुछ श्रेणियों के अधिकारियों की नियुक्ति या पदोन्नति की अधिसूचना के लिए।",
        ),
        when=bl(
            "Addressed to the Manager, Government of India Press, for publication, with copies forwarded for information. Orders made in the name of the President are expressed to be so made and signed by an officer of or above the rank of Under Secretary authorised under the Authentication (Orders and Other Instruments) Rules, 2002.",
            "प्रकाशन हेतु प्रबंधक, भारत सरकार मुद्रणालय को संबोधित, सूचनार्थ प्रतिलिपियाँ अग्रेषित करते हुए। राष्ट्रपति के नाम से किए गए आदेश उसी रूप में व्यक्त किए जाते हैं और प्रामाणीकरण (आदेश तथा अन्य लिखत) नियम, 2002 के अधीन प्राधिकृत अवर सचिव या उससे ऊपर के अधिकारी द्वारा हस्ताक्षरित होते हैं।",
        ),
        csmop=ref(["8.4(6)", "9.3", "Appendix 8.1", "Appendix 8.2"], [80, 93, 97, 103]),
        urgency_allowed=False,
        fields=[
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "gazettePart",
                bl("Gazette Part", "राजपत्र भाग"),
                "select",
                True,
                bl("I", "I"),
                hint=bl(
                    "Appendix 8.2 sets out what belongs in each Part and Section of the Gazette.",
                    "परिशिष्ट 8.2 में बताया गया है कि राजपत्र के किस भाग और खंड में क्या प्रकाशित होता है।",
                ),
                options=[
                    {"value": "I", "label": bl("Part I — non-statutory notifications", "भाग I — गैर-वैधानिक अधिसूचनाएँ")},
                    {"value": "II", "label": bl("Part II — Acts, Ordinances and statutory rules", "भाग II — अधिनियम, अध्यादेश और वैधानिक नियम")},
                    {"value": "III", "label": bl("Part III — notifications by other authorities", "भाग III — अन्य प्राधिकारियों की अधिसूचनाएँ")},
                    {"value": "IV", "label": bl("Part IV — advertisements and notices by private bodies", "भाग IV — निजी निकायों के विज्ञापन और नोटिस")},
                ],
            ),
            field("gazetteSection", bl("Gazette Section", "राजपत्र खंड"), "text", True, bl("2", "2")),
            f_paras(
                [
                    "No. A-32014/1/2026-Estt. — Shri X.Y.Z., Under Secretary in the Department of Personnel and Training, is appointed to officiate as Deputy Secretary in that Department with effect from 01.10.2026, vice Shri L.M.N., transferred to the Department of Expenditure.",
                ],
                [
                    "सं. ए-32014/1/2026-स्थापना — श्री एक्स.वाई.ज़ेड., कार्मिक और प्रशिक्षण विभाग में अवर सचिव, को दिनांक 01.10.2026 से उस विभाग में उप सचिव के रूप में कार्य करने के लिए नियुक्त किया जाता है, श्री एल.एम.एन. के स्थान पर, जिनका स्थानांतरण व्यय विभाग में किया गया है।",
                ],
                hint=bl(
                    "The notification number opens the text itself, as in the Appendix 8.1 specimen.",
                    "परिशिष्ट 8.1 के नमूने की भाँति अधिसूचना संख्या पाठ के आरंभ में ही आती है।",
                ),
            ),
            *f_signatory("Joint Secretary to the Govt. of India", "संयुक्त सचिव, भारत सरकार"),
            field(
                "addressee",
                bl("Press addressee", "मुद्रणालय संबोधन"),
                "textarea",
                True,
                bl(
                    "The Manager\nGovernment of India Press\nMinto Road, New Delhi",
                    "प्रबंधक\nभारत सरकार मुद्रणालय\nमिंटो रोड, नई दिल्ली",
                ),
            ),
            f_copy_to(
                ["The officer concerned", "The Pay and Accounts Officer", "Guard file"],
                ["संबंधित अधिकारी", "वेतन एवं लेखा अधिकारी", "गार्ड फाइल"],
            ),
            f_enclosures([], []),
        ],
        layout_en=[
            block("gazetteLine", align="center", lines=["(To be published in the Gazette of India, Part {{gazettePart}}, Section {{gazetteSection}})"]),
            block("fileNumber", align="left", lines=["No. {{fileNumber}}"]),
            block("header", align="center", lines=["Government of India", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("title", align="center", emphasis="title", lines=["NOTIFICATION"]),
            block("body", align="left", source="paras", numbered=True),
            SIGN_EN,
            block("addressee", align="left", lines=["{{addressee}}"]),
            block("copyTo", align="left", source="copyTo", lead="Copy forwarded for information to:", itemPrefix="roman", omitWhenEmpty=True),
            ENCL_EN,
        ],
        layout_hi=[
            block("gazetteLine", align="center", lines=["(भारत के राजपत्र भाग {{gazettePart}}, खंड {{gazetteSection}} में प्रकाशित होने के लिए)"]),
            block("fileNumber", align="left", lines=["संख्या {{fileNumber}}"]),
            block("header", align="center", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("title", align="center", emphasis="title", lines=["अधिसूचना"]),
            block("body", align="left", source="paras", numbered=True),
            SIGN_HI,
            block("addressee", align="left", lines=["{{addressee}}"]),
            block("copyTo", align="left", source="copyTo", lead="प्रतिलिपि सूचनार्थ प्रेषित :", itemPrefix="roman", omitWhenEmpty=True),
            ENCL_HI,
        ],
        checklist=[
            check(
                "gazette-line",
                bl("The Gazette Part and Section are stated at the top", "राजपत्र भाग और खंड शीर्ष पर दिए गए हैं"),
                bl(
                    "The specimen opens '(To be published in the Gazette of India Part I, Section 2)'; Appendix 8.2 says what goes where.",
                    "नमूना '(भारत के राजपत्र भाग I, खंड 2 में प्रकाशित होने के लिए)' से आरंभ होता है; परिशिष्ट 8.2 बताता है कि क्या कहाँ जाएगा।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["gazettePart", "gazetteSection"]},
                "Appendix 8.1, Appendix 8.2",
            ),
            check(
                "press-addressee",
                bl("Addressed to the Government of India Press", "भारत सरकार मुद्रणालय को संबोधित"),
                bl(
                    "A notification is sent to the Manager, Government of India Press for publication; the people it concerns get copies.",
                    "अधिसूचना प्रकाशन हेतु प्रबंधक, भारत सरकार मुद्रणालय को भेजी जाती है; जिनसे संबंधित है उन्हें प्रतिलिपि मिलती है।",
                ),
                "must",
                {"kind": "required", "field": "addressee"},
                "Appendix 8.1",
            ),
            check(
                "authentication",
                bl("Signed at Under Secretary level or above", "अवर सचिव या उससे ऊपर के स्तर पर हस्ताक्षरित"),
                bl(
                    "Orders and instruments made in the name of the President are signed by an officer of or above the rank of Under Secretary, or one specifically authorised under the Authentication (Orders and Other Instruments) Rules, 2002.",
                    "राष्ट्रपति के नाम से किए गए आदेश और लिखत अवर सचिव या उससे ऊपर के अधिकारी द्वारा, या प्रामाणीकरण (आदेश तथा अन्य लिखत) नियम, 2002 के अधीन विशेष रूप से प्राधिकृत अधिकारी द्वारा हस्ताक्षरित होते हैं।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["signatoryName", "signatoryDesignation"]},
                "9.3(i)",
            ),
            CHECK_NUMBER_DATE,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "name-of-government",
                "title": bl("In the name of the Government of India", "भारत सरकार के नाम से"),
                "body": bl(
                    "Where the power to make orders or notifications is conferred by a statute on the Government of India, they are expressed to be made in the name of the Government of India — not in the President's name.",
                    "जहाँ आदेश या अधिसूचना बनाने की शक्ति किसी संविधि द्वारा भारत सरकार को दी गई है, वहाँ वे भारत सरकार के नाम से किए गए व्यक्त किए जाते हैं — राष्ट्रपति के नाम से नहीं।",
                ),
                "csmopRef": "9.3(ii)",
            }
        ],
    )
)

# ---------------------------------------------------------- 8. Endorsement --
TEMPLATES.append(
    template(
        "endorsement",
        group="communication",
        name=bl("Endorsement", "पृष्ठांकन"),
        short=bl("Endorsement", "पृष्ठांकन"),
        person="third",
        used_by=bl(
            "A Department returning a paper in original to its sender, or sending a paper or its copy to another Department or office for information or action, or forwarding a copy of a communication to a party other than the one it is addressed to.",
            "किसी कागजात को मूल रूप में प्रेषक को लौटाने, या कागजात अथवा उसकी प्रति किसी अन्य विभाग या कार्यालय को सूचना या कार्रवाई हेतु भेजने, या पत्र की प्रति उस पक्ष के अतिरिक्त किसी अन्य को अग्रेषित करने के लिए।",
        ),
        when=bl(
            "Not to be used for communicating copies to State Governments or to statutory and constitutional bodies — the appropriate form for them is a letter.",
            "राज्य सरकारों तथा वैधानिक और संवैधानिक निकायों को प्रतिलिपि भेजने के लिए इसका प्रयोग न करें — उनके लिए उपयुक्त रूप पत्र है।",
        ),
        csmop=ref(["8.4(9)", "Appendix 8.1"], [80, 96]),
        fields=[
            f_urgency(),
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            f_paras(
                [
                    "A copy each of the papers mentioned below is forwarded for information and necessary action.",
                ],
                [
                    "नीचे उल्लिखित प्रत्येक कागजात की एक प्रति सूचना एवं आवश्यक कार्रवाई के लिए अग्रेषित की जाती है।",
                ],
            ),
            *f_signatory(),
            field(
                "papers",
                bl("List of papers forwarded", "अग्रेषित कागजातों की सूची"),
                "list",
                True,
                {
                    "en": [
                        "Application of Shri X.Y.Z. dated 04.08.2026 for allotment of General Pool residential accommodation (in original)",
                        "This Department's O.M. No. A-11011/2/2026-Estt. dated 20.08.2026",
                    ],
                    "hi": [
                        "सामान्य पूल आवासीय आवंटन हेतु श्री एक्स.वाई.ज़ेड. का दिनांक 04.08.2026 का आवेदन (मूल रूप में)",
                        "इस विभाग का कार्यालय ज्ञापन संख्या ए-11011/2/2026-स्थापना दिनांक 20.08.2026",
                    ],
                },
            ),
            field(
                "addressee",
                bl("To", "सेवा में"),
                "textarea",
                True,
                bl(
                    "The Director of Estates\nDirectorate of Estates\nNirman Bhawan, New Delhi - 110011",
                    "संपदा निदेशक\nसंपदा निदेशालय\nनिर्माण भवन, नई दिल्ली - 110011",
                ),
            ),
            f_copy_to(["Shri X.Y.Z., Section Officer", "Guard file"], ["श्री एक्स.वाई.ज़ेड., अनुभाग अधिकारी", "गार्ड फाइल"]),
        ],
        layout_en=[
            *head_en(),
            block("title", align="center", emphasis="title", lines=["ENDORSEMENT"]),
            BODY_EN,
            SIGN_EN,
            block("enclosures", align="left", source="papers", lead="List of papers forwarded:", itemPrefix="ordinal"),
            block("addressee", align="left", lines=["To", "{{addressee}}"]),
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(),
            block("title", align="center", emphasis="title", lines=["पृष्ठांकन"]),
            BODY_HI,
            SIGN_HI,
            block("enclosures", align="left", source="papers", lead="अग्रेषित कागजातों की सूची :", itemPrefix="ordinal"),
            block("addressee", align="left", lines=["सेवा में", "{{addressee}}"]),
            COPY_HI,
        ],
        checklist=[
            check(
                "papers-listed",
                bl("The papers being forwarded are listed", "अग्रेषित किए जा रहे कागजात सूचीबद्ध हैं"),
                bl(
                    "The specimen carries a 'List of papers forwarded' below the signature — an endorsement with nothing listed says nothing.",
                    "नमूने में हस्ताक्षर के नीचे 'अग्रेषित कागजातों की सूची' होती है — बिना सूची के पृष्ठांकन कुछ नहीं कहता।",
                ),
                "must",
                {"kind": "listNonEmpty", "field": "papers"},
                "Appendix 8.1",
            ),
            check(
                "not-to-authorities",
                bl("Not being used for a State Government or a statutory body", "राज्य सरकार या वैधानिक निकाय के लिए प्रयोग नहीं"),
                bl(
                    "Copies are not normally communicated to State Governments or statutory and constitutional bodies by endorsement; the appropriate form is a letter.",
                    "सामान्यतः राज्य सरकारों या वैधानिक और संवैधानिक निकायों को पृष्ठांकन द्वारा प्रतिलिपि नहीं भेजी जाती; उपयुक्त रूप पत्र है।",
                ),
                "should",
                {
                    "kind": "regexAbsent",
                    "role": "addressee",
                    "pattern": "(?:government of (?!india)|state government|election commission|राज्य सरकार|निर्वाचन आयोग)",
                },
                "8.4(9)",
            ),
            CHECK_NUMBER_DATE,
            CHECK_SIGNATURE,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# ---------------------------------------------------- 9. Leave application --
TEMPLATES.append(
    template(
        "leave-application",
        group="personal",
        name=bl("Leave application", "अवकाश आवेदन"),
        short=bl("Leave", "अवकाश"),
        person="first",
        used_by=bl(
            "An officer or member of the staff applying for leave to the authority competent to sanction it, through the Section Officer or Branch Officer.",
            "अवकाश स्वीकृत करने के लिए सक्षम प्राधिकारी को, अनुभाग अधिकारी या शाखा अधिकारी के माध्यम से, अवकाश हेतु आवेदन करने वाला अधिकारी या कर्मचारी।",
        ),
        when=bl(
            "CSMOP prescribes no form for the application itself — it prescribes the Office Order by which leave is granted (Appendix 8.1). This template is the application that precedes it: first person, through proper channel, stating the kind of leave, the dates, the prefixing and suffixing sought, the address during leave and the arrangement for the work.",
            "सीएसएमओपी आवेदन के लिए कोई प्रपत्र निर्धारित नहीं करता — वह उस कार्यालय आदेश का प्रारूप देता है जिससे अवकाश स्वीकृत होता है (परिशिष्ट 8.1)। यह टेम्पलेट उससे पहले का आवेदन है: प्रथम पुरुष, उचित माध्यम से, अवकाश का प्रकार, तारीखें, उपसर्ग/प्रत्यय की माँग, अवकाश के दौरान का पता और कार्य की व्यवस्था बताते हुए।",
        ),
        csmop=ref(
            ["8.4(4)", "Appendix 8.1"],
            [79, 90],
            chassis="letter",
            note=bl(
                "The manual gives the format of the Office Order granting leave, not of the application. The sanction rules are in the CCS (Leave) Rules, 1972.",
                "नियमावली अवकाश स्वीकृत करने वाले कार्यालय आदेश का प्रारूप देती है, आवेदन का नहीं। स्वीकृति के नियम केंद्रीय सिविल सेवा (छुट्टी) नियम, 1972 में हैं।",
            ),
        ),
        verify=True,
        urgency_allowed=False,
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("To (sanctioning authority)", "सेवा में (स्वीकृतिकर्ता प्राधिकारी)"),
                "textarea",
                True,
                bl(
                    "The Under Secretary (Administration)\nDepartment of Personnel and Training\nNorth Block, New Delhi - 110001\n(Through the Section Officer, Establishment Section)",
                    "अवर सचिव (प्रशासन)\nकार्मिक और प्रशिक्षण विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001\n(अनुभाग अधिकारी, स्थापना अनुभाग के माध्यम से)",
                ),
            ),
            field(
                "leaveType",
                bl("Kind of leave", "अवकाश का प्रकार"),
                "select",
                True,
                bl("earned", "earned"),
                options=[
                    {"value": "earned", "label": bl("Earned leave", "अर्जित अवकाश")},
                    {"value": "half-pay", "label": bl("Half pay leave", "अर्ध वेतन अवकाश")},
                    {"value": "commuted", "label": bl("Commuted leave", "परिवर्तित अवकाश")},
                    {"value": "casual", "label": bl("Casual leave", "आकस्मिक अवकाश")},
                    {"value": "restricted-holiday", "label": bl("Restricted holiday", "प्रतिबंधित अवकाश")},
                    {"value": "child-care", "label": bl("Child Care Leave", "बाल देखभाल अवकाश")},
                    {"value": "maternity", "label": bl("Maternity leave", "प्रसूति अवकाश")},
                    {"value": "paternity", "label": bl("Paternity leave", "पितृत्व अवकाश")},
                    {"value": "extraordinary", "label": bl("Extraordinary leave", "असाधारण अवकाश")},
                ],
            ),
            field("fromDate", bl("From", "से"), "date", True, bl("2026-10-01", "2026-10-01")),
            field("toDate", bl("To", "तक"), "date", True, bl("2026-10-30", "2026-10-30")),
            field("days", bl("Number of days", "दिनों की संख्या"), "text", True, bl("30", "30")),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl("Application for 30 days' earned leave — regarding.", "30 दिनों के अर्जित अवकाश हेतु आवेदन — के संबंध में।"),
            ),
            f_paras(
                [
                    "I request that I may kindly be granted 30 days' earned leave from 01.10.2026 to 30.10.2026, with permission to prefix 30.09.2026 and suffix 31.10.2026, both public holidays, to the leave.",
                    "The leave is required to attend to a family commitment. My address during the period of leave will be 14, Rajaji Marg, Coimbatore - 641002, telephone 98xxx xxxxx.",
                    "During my absence the work of the Section may kindly be entrusted to Shri P.Q.R., Assistant Section Officer, who has agreed to hold the charge.",
                    "It is certified that I am likely, on the expiry of this leave, to return to duty at the station from which I proceed on leave.",
                ],
                [
                    "अनुरोध है कि मुझे दिनांक 01.10.2026 से 30.10.2026 तक 30 दिनों का अर्जित अवकाश स्वीकृत करने की कृपा की जाए, तथा अवकाश के साथ दिनांक 30.09.2026 को उपसर्ग और 31.10.2026 को प्रत्यय के रूप में जोड़ने की अनुमति दी जाए, ये दोनों सार्वजनिक अवकाश हैं।",
                    "अवकाश एक पारिवारिक दायित्व के निर्वहन हेतु अपेक्षित है। अवकाश की अवधि में मेरा पता 14, राजाजी मार्ग, कोयंबटूर - 641002 तथा दूरभाष 98xxx xxxxx रहेगा।",
                    "मेरी अनुपस्थिति में अनुभाग का कार्य श्री पी.क्यू.आर., सहायक अनुभाग अधिकारी को सौंपने की कृपा की जाए, जिन्होंने कार्यभार संभालने पर सहमति दी है।",
                    "यह प्रमाणित किया जाता है कि इस अवकाश की समाप्ति पर मेरे उसी स्टेशन पर ड्यूटी पर लौटने की संभावना है जहाँ से मैं अवकाश पर जा रहा हूँ।",
                ],
            ),
            field("signatoryName", bl("Your name", "आपका नाम"), "text", True, bl("X. Y. Zachariah", "एक्स. वाई. ज़करिया")),
            field(
                "signatoryDesignation",
                bl("Your designation and Section", "आपका पदनाम और अनुभाग"),
                "text",
                True,
                bl("Section Officer, Establishment Section", "अनुभाग अधिकारी, स्थापना अनुभाग"),
            ),
            field("phone", bl("Telephone / mobile", "दूरभाष / मोबाइल"), "text", True, bl("011-2309 2591", "011-2309 2591")),
            f_enclosures(
                ["Leave account, as verified by the Establishment Section"],
                ["स्थापना अनुभाग द्वारा सत्यापित अवकाश लेखा"],
            ),
        ],
        layout_en=[
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele.: {{phone}}"]),
            ENCL_EN,
        ],
        layout_hi=[
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष : {{phone}}"]),
            ENCL_HI,
        ],
        checklist=[
            check(
                "dates-and-days",
                bl("Kind of leave, dates and number of days are stated", "अवकाश का प्रकार, तारीखें और दिनों की संख्या दी गई है"),
                bl(
                    "An application that does not say which leave, from when and for how many days cannot be sanctioned without going back to the applicant.",
                    "जिस आवेदन में यह न लिखा हो कि कौन-सा अवकाश, कब से और कितने दिन का, वह आवेदक के पास लौटाए बिना स्वीकृत नहीं हो सकता।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["leaveType", "fromDate", "toDate", "days"]},
            ),
            check(
                "through-channel",
                bl("Routed through the proper channel", "उचित माध्यम से भेजा गया"),
                bl(
                    "The application goes to the sanctioning authority through the Section Officer or Branch Officer; the addressee block should say so.",
                    "आवेदन अनुभाग अधिकारी या शाखा अधिकारी के माध्यम से स्वीकृतिकर्ता प्राधिकारी को जाता है; संबोधन खंड में यह लिखा होना चाहिए।",
                ),
                "should",
                {"kind": "regex", "role": "addressee", "pattern": "(?:through|माध्यम से)"},
            ),
            check(
                "return-certificate",
                bl("The certificate of return to duty is included", "ड्यूटी पर लौटने का प्रमाणन शामिल है"),
                bl(
                    "The Office Order granting leave certifies that the applicant is likely to return to duty at the station from which the leave began; the application should support it.",
                    "अवकाश स्वीकृत करने वाला कार्यालय आदेश प्रमाणित करता है कि आवेदक उसी स्टेशन पर ड्यूटी पर लौटेगा जहाँ से अवकाश आरंभ हुआ; आवेदन में इसका आधार होना चाहिए।",
                ),
                "should",
                {"kind": "contains", "role": "body", "text": bl("return to duty", "ड्यूटी पर लौट")},
                "Appendix 8.1",
            ),
            CHECK_SUBJECT,
            CHECK_PARA_NUMBERING,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
        notes=[
            {
                "key": "what-comes-back",
                "title": bl("What the sanction looks like", "स्वीकृति किस रूप में आती है"),
                "body": bl(
                    "Leave is granted by an Office Order, whose specimen is in Appendix 8.1: it names the days, the dates, the holidays prefixed and suffixed, and certifies the likely return to duty. Copies go to the office order file, the cashier, the Section concerned and the applicant.",
                    "अवकाश कार्यालय आदेश द्वारा स्वीकृत होता है, जिसका नमूना परिशिष्ट 8.1 में है: उसमें दिनों की संख्या, तारीखें, जोड़े गए उपसर्ग/प्रत्यय अवकाश और ड्यूटी पर लौटने की संभावना का प्रमाणन होता है। प्रतिलिपियाँ कार्यालय आदेश फाइल, खजांची, संबंधित अनुभाग और आवेदक को जाती हैं।",
                ),
                "csmopRef": "Appendix 8.1",
            }
        ],
    )
)

# ------------------------------------------------------- 10. Representation --
TEMPLATES.append(
    template(
        "representation",
        group="personal",
        name=bl("Representation", "अभ्यावेदन"),
        short=bl("Representation", "अभ्यावेदन"),
        person="first",
        used_by=bl(
            "A Government servant representing to the competent authority on a matter of personal grievance — seniority, pay fixation, transfer, a denied claim — through proper channel.",
            "व्यक्तिगत शिकायत के मामले में — वरिष्ठता, वेतन निर्धारण, स्थानांतरण, अस्वीकृत दावा — सक्षम प्राधिकारी को उचित माध्यम से अभ्यावेदन देने वाला सरकारी सेवक।",
        ),
        when=bl(
            "CSMOP prescribes no format for a representation; it is written on the letter chassis. One representation, one grievance, addressed to the authority competent to redress it, through the proper channel — the head of office forwards it with the Department's comments.",
            "सीएसएमओपी अभ्यावेदन का कोई प्रारूप निर्धारित नहीं करता; यह पत्र के ढाँचे पर लिखा जाता है। एक अभ्यावेदन, एक शिकायत, उसी प्राधिकारी को संबोधित जो उसका निवारण करने में सक्षम है, उचित माध्यम से — कार्यालय प्रमुख इसे विभाग की टिप्पणी सहित अग्रेषित करता है।",
        ),
        csmop=ref(
            ["8.4(1)", "8.9", "Appendix 8.1"],
            [79, 86, 87],
            chassis="letter",
            note=bl(
                "The manual's contribution here is 8.9: a communication from a Government servant, like one from a member of the public, is acknowledged within 15 days and replied to within the next 15.",
                "यहाँ नियमावली का योगदान 8.9 है: सरकारी सेवक का पत्र भी, जनसाधारण के पत्र की भाँति, 15 दिन में स्वीकार किया जाता है और अगले 15 दिन में उसका उत्तर दिया जाता है।",
            ),
        ),
        verify=True,
        urgency_allowed=False,
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("To (competent authority)", "सेवा में (सक्षम प्राधिकारी)"),
                "textarea",
                True,
                bl(
                    "The Joint Secretary (Administration)\nDepartment of Personnel and Training\nNorth Block, New Delhi - 110001\n(Through proper channel)",
                    "संयुक्त सचिव (प्रशासन)\nकार्मिक और प्रशिक्षण विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001\n(उचित माध्यम से)",
                ),
            ),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Representation against fixation of pay on promotion to the post of Section Officer — regarding.",
                    "अनुभाग अधिकारी के पद पर पदोन्नति पर वेतन निर्धारण के विरुद्ध अभ्यावेदन — के संबंध में।",
                ),
            ),
            field(
                "reference",
                bl("Order or communication being represented against", "जिस आदेश या पत्र के विरुद्ध अभ्यावेदन है"),
                "text",
                True,
                bl(
                    "Office Order No. A-11011/4/2026-Estt. dated 12.06.2026",
                    "कार्यालय आदेश संख्या ए-11011/4/2026-स्थापना दिनांक 12.06.2026",
                ),
            ),
            f_paras(
                [
                    "I respectfully submit the following representation for kind consideration against the fixation of my pay on promotion to the post of Section Officer, communicated vide the Office Order cited above.",
                    "I was promoted to the post of Section Officer with effect from 01.05.2026 and my pay was fixed at Level 8, Cell 1 of the Pay Matrix. I had exercised the option under FR 22(I)(a)(1) to have my pay fixed from the date of my next increment, which option is on record at page 11 of my service book.",
                    "The option appears not to have been given effect to. Had it been applied, my pay would have been fixed at Level 8, Cell 2 with effect from 01.07.2026, and the difference works out to Rs. 2,400 per month.",
                    "In similar circumstances, the pay of Shri A.B.C., Section Officer, was re-fixed by this Department vide Office Order No. A-11011/7/2025-Estt. dated 09.09.2025, a copy of which is enclosed.",
                    "I therefore request that my pay may kindly be re-fixed in terms of the option exercised, and the arrears released. I shall be grateful for a decision at an early date.",
                ],
                [
                    "उपर्युक्त कार्यालय आदेश द्वारा संप्रेषित अनुभाग अधिकारी के पद पर पदोन्नति पर मेरे वेतन निर्धारण के विरुद्ध मैं सादर निम्नलिखित अभ्यावेदन कृपया विचारार्थ प्रस्तुत करता हूँ।",
                    "मुझे दिनांक 01.05.2026 से अनुभाग अधिकारी के पद पर पदोन्नत किया गया और मेरा वेतन वेतन मैट्रिक्स के स्तर 8, कोष्ठ 1 में निर्धारित किया गया। मैंने मूल नियम 22(I)(क)(1) के अधीन अपनी अगली वेतनवृद्धि की तारीख से वेतन निर्धारण का विकल्प दिया था, जो मेरी सेवा पुस्तिका के पृष्ठ 11 पर अभिलिखित है।",
                    "प्रतीत होता है कि उस विकल्प को कार्यान्वित नहीं किया गया। यदि उसे लागू किया जाता तो मेरा वेतन दिनांक 01.07.2026 से स्तर 8, कोष्ठ 2 में निर्धारित होता, और अंतर 2,400 रुपये प्रति माह बनता है।",
                    "इसी प्रकार की परिस्थितियों में इस विभाग द्वारा कार्यालय आदेश संख्या ए-11011/7/2025-स्थापना दिनांक 09.09.2025 से श्री ए.बी.सी., अनुभाग अधिकारी का वेतन पुनर्निर्धारित किया गया था, जिसकी प्रति संलग्न है।",
                    "अतः अनुरोध है कि दिए गए विकल्प के अनुसार मेरा वेतन पुनर्निर्धारित कर बकाया जारी करने की कृपा की जाए। शीघ्र निर्णय के लिए मैं आभारी रहूँगा।",
                ],
            ),
            field("signatoryName", bl("Your name", "आपका नाम"), "text", True, bl("X. Y. Zachariah", "एक्स. वाई. ज़करिया")),
            field(
                "signatoryDesignation",
                bl("Your designation and Section", "आपका पदनाम और अनुभाग"),
                "text",
                True,
                bl("Section Officer, Establishment Section", "अनुभाग अधिकारी, स्थापना अनुभाग"),
            ),
            field("phone", bl("Telephone / mobile", "दूरभाष / मोबाइल"), "text", True, bl("011-2309 2591", "011-2309 2591")),
            f_enclosures(
                ["Copy of Office Order No. A-11011/7/2025-Estt. dated 09.09.2025", "Copy of the option exercised under FR 22(I)(a)(1)"],
                ["कार्यालय आदेश संख्या ए-11011/7/2025-स्थापना दिनांक 09.09.2025 की प्रति", "मूल नियम 22(I)(क)(1) के अधीन दिए गए विकल्प की प्रति"],
            ),
        ],
        layout_en=[
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", lines=["Reference: {{reference}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele.: {{phone}}"]),
            ENCL_EN,
        ],
        layout_hi=[
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", lines=["संदर्भ : {{reference}}"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष : {{phone}}"]),
            ENCL_HI,
        ],
        checklist=[
            check(
                "order-referenced",
                bl("The order represented against is identified", "जिस आदेश के विरुद्ध अभ्यावेदन है वह पहचाना गया है"),
                bl(
                    "The number and date of the last communication in the series must always be referred to; a representation against an unidentified order cannot be examined.",
                    "शृंखला के अंतिम पत्र की संख्या और तारीख सदैव उद्धृत की जानी चाहिए; अपहचाने आदेश के विरुद्ध अभ्यावेदन की जाँच नहीं की जा सकती।",
                ),
                "must",
                {"kind": "required", "field": "reference"},
                "9.2(iv)",
            ),
            check(
                "through-channel",
                bl("Routed through the proper channel", "उचित माध्यम से भेजा गया"),
                bl(
                    "A representation goes to the competent authority through the head of office, who forwards it with the Department's comments.",
                    "अभ्यावेदन कार्यालय प्रमुख के माध्यम से सक्षम प्राधिकारी को जाता है, जो उसे विभाग की टिप्पणी सहित अग्रेषित करता है।",
                ),
                "must",
                {"kind": "regex", "role": "addressee", "pattern": "(?:through|माध्यम से)"},
            ),
            check(
                "relief-sought",
                bl("The relief sought is stated", "माँगी गई राहत स्पष्ट है"),
                bl(
                    "Say what you are asking for. A representation that describes a grievance without naming the relief leaves the deciding officer nothing to order.",
                    "जो माँग रहे हैं वह लिखें। जिस अभ्यावेदन में शिकायत तो हो पर माँगी गई राहत का उल्लेख न हो, उसमें निर्णय करने वाले अधिकारी के आदेश देने के लिए कुछ नहीं बचता।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("request", "अनुरोध")},
            ),
            check(
                "temperate-language",
                bl("Courteous and temperate language", "शिष्ट और संयमित भाषा"),
                bl(
                    "Where an error or an opinion has to be countered, observations are made in courteous and temperate language, free from personal remarks.",
                    "जहाँ किसी त्रुटि या मत का प्रतिवाद करना हो, वहाँ टिप्पणियाँ शिष्ट और संयमित भाषा में, व्यक्तिगत टीका-टिप्पणी से मुक्त होकर की जाती हैं।",
                ),
                "should",
                {
                    "kind": "regexAbsent",
                    "role": "body",
                    "pattern": "(?:deliberately|malafide|mala fide|negligence of the|jaan-boojhkar|जान-बूझकर|दुर्भावना)",
                },
                "7.2(xi)",
            ),
            CHECK_SUBJECT,
            CHECK_PARA_NUMBERING,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# ----------------------------------------------------------- 11. RTI reply --
TEMPLATES.append(
    template(
        "rti-reply",
        group="statutory",
        name=bl("Reply to an RTI application", "सूचना का अधिकार आवेदन का उत्तर"),
        short=bl("RTI reply", "सू.अ. उत्तर"),
        person="first",
        used_by=bl(
            "The Central Public Information Officer replying to an application under the Right to Information Act, 2005.",
            "सूचना का अधिकार अधिनियम, 2005 के अंतर्गत आवेदन का उत्तर देने वाला केंद्रीय लोक सूचना अधिकारी।",
        ),
        when=bl(
            "Within 30 days of receipt. Answer point by point in the applicant's own numbering, say plainly where information is not held or is exempt and under which section, and give the name and address of the First Appellate Authority with the 30-day limit — the Act requires it and its absence is itself a ground of appeal.",
            "प्राप्ति से 30 दिन के भीतर। आवेदक की अपनी क्रम-संख्या में बिंदुवार उत्तर दें, जहाँ सूचना उपलब्ध नहीं है या छूट प्राप्त है वहाँ स्पष्ट रूप से और किस धारा के अधीन यह लिखें, तथा प्रथम अपीलीय प्राधिकारी का नाम-पता 30 दिन की सीमा सहित दें — अधिनियम इसकी अपेक्षा करता है और इसका न होना स्वयं अपील का आधार है।",
        ),
        csmop=ref(
            ["8.4(1)", "8.9", "12.5", "Appendix 8.1"],
            [79, 86, 144],
            chassis="letter",
            note=bl(
                "CSMOP 12.5 requires requests under the RTI Act to be monitored for timely disposal; the form and the time limits come from the Act itself.",
                "सीएसएमओपी 12.5 के अनुसार सूचना का अधिकार अधिनियम के अंतर्गत अनुरोधों की समयबद्ध निपटान हेतु निगरानी की जाती है; रूप और समय-सीमाएँ अधिनियम से आती हैं।",
            ),
        ),
        verify=True,
        urgency_allowed=False,
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("Applicant", "आवेदक"),
                "textarea",
                True,
                bl(
                    "Shri Ramesh Kumar\n27, Gandhi Nagar\nMeerut, Uttar Pradesh - 250002",
                    "श्री रमेश कुमार\n27, गांधी नगर\nमेरठ, उत्तर प्रदेश - 250002",
                ),
            ),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Reply to the application dated 04.08.2026 under the Right to Information Act, 2005 — regarding.",
                    "सूचना का अधिकार अधिनियम, 2005 के अंतर्गत दिनांक 04.08.2026 के आवेदन का उत्तर — के संबंध में।",
                ),
            ),
            field("applicationDate", bl("Date of the application", "आवेदन की तारीख"), "date", True, bl("2026-08-04", "2026-08-04")),
            field("receivedOn", bl("Date received in this office", "इस कार्यालय में प्राप्ति की तारीख"), "date", True, bl("2026-08-11", "2026-08-11")),
            f_paras(
                [
                    "Please refer to your application dated 04.08.2026 under the Right to Information Act, 2005, received in this office on 11.08.2026 and registered at No. DOPT/R/2026/60214. The information sought is furnished point-wise below.",
                    "Point 1: The number of posts of Section Officer sanctioned in this Department as on 01.04.2026 is 214, of which 187 are filled. A statement is enclosed.",
                    "Point 2: The information sought relates to the deliberations of a Departmental Promotion Committee and is exempt from disclosure under Section 8(1)(j) of the Act, being personal information the disclosure of which has no relationship to any public activity or interest.",
                    "Point 3: The information sought is not held by this Department. Your application has been transferred in respect of this point to the Central Public Information Officer, Department of Expenditure, under Section 6(3) of the Act, and you are advised accordingly.",
                    "If you are not satisfied with this reply, you may prefer a first appeal under Section 19(1) of the Act within 30 days to Shri A. K. Menon, Deputy Secretary and First Appellate Authority, Department of Personnel and Training, North Block, New Delhi - 110001.",
                ],
                [
                    "कृपया सूचना का अधिकार अधिनियम, 2005 के अंतर्गत आपके दिनांक 04.08.2026 के आवेदन का संदर्भ लें, जो इस कार्यालय में दिनांक 11.08.2026 को प्राप्त हुआ और संख्या डीओपीटी/आर/2026/60214 पर पंजीकृत है। माँगी गई सूचना बिंदुवार नीचे दी जा रही है।",
                    "बिंदु 1 : दिनांक 01.04.2026 को इस विभाग में अनुभाग अधिकारी के स्वीकृत पदों की संख्या 214 है, जिनमें से 187 भरे हुए हैं। विवरण संलग्न है।",
                    "बिंदु 2 : माँगी गई सूचना विभागीय पदोन्नति समिति के विचार-विमर्श से संबंधित है और अधिनियम की धारा 8(1)(ञ) के अधीन प्रकटन से छूट प्राप्त है, क्योंकि यह ऐसी व्यक्तिगत सूचना है जिसके प्रकटन का किसी लोक क्रियाकलाप या हित से कोई संबंध नहीं है।",
                    "बिंदु 3 : माँगी गई सूचना इस विभाग के पास उपलब्ध नहीं है। इस बिंदु के संबंध में आपका आवेदन अधिनियम की धारा 6(3) के अधीन केंद्रीय लोक सूचना अधिकारी, व्यय विभाग को अंतरित कर दिया गया है, और आपको तदनुसार सूचित किया जाता है।",
                    "यदि आप इस उत्तर से संतुष्ट नहीं हैं तो आप अधिनियम की धारा 19(1) के अंतर्गत 30 दिन के भीतर श्री ए. के. मेनन, उप सचिव एवं प्रथम अपीलीय प्राधिकारी, कार्मिक और प्रशिक्षण विभाग, नॉर्थ ब्लॉक, नई दिल्ली - 110001 को प्रथम अपील कर सकते हैं।",
                ],
            ),
            *f_signatory("Under Secretary and Central Public Information Officer", "अवर सचिव एवं केंद्रीय लोक सूचना अधिकारी"),
            field(
                "appellateAuthority",
                bl("First Appellate Authority (name, designation, address)", "प्रथम अपीलीय प्राधिकारी (नाम, पदनाम, पता)"),
                "textarea",
                True,
                bl(
                    "Shri A. K. Menon, Deputy Secretary\nDepartment of Personnel and Training\nNorth Block, New Delhi - 110001",
                    "श्री ए. के. मेनन, उप सचिव\nकार्मिक और प्रशिक्षण विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001",
                ),
            ),
            f_enclosures(
                ["Statement of sanctioned and filled posts of Section Officer as on 01.04.2026 (1 page)"],
                ["दिनांक 01.04.2026 को अनुभाग अधिकारी के स्वीकृत और भरे हुए पदों का विवरण (1 पृष्ठ)"],
            ),
            f_copy_to(
                ["The Central Public Information Officer, Department of Expenditure — for information and necessary action under Section 6(3)"],
                ["केंद्रीय लोक सूचना अधिकारी, व्यय विभाग — धारा 6(3) के अधीन सूचना एवं आवश्यक कार्रवाई हेतु"],
            ),
        ],
        layout_en=[
            *head_en(urgency=False),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", lines=["Reference: Your application dated {{applicationDate}}, received on {{receivedOn}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            SIGN_EN,
            block("footer", align="left", lines=["First Appellate Authority (appeal within 30 days under Section 19(1)):", "{{appellateAuthority}}"]),
            ENCL_EN,
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(urgency=False),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", lines=["संदर्भ : आपका दिनांक {{applicationDate}} का आवेदन, प्राप्ति दिनांक {{receivedOn}}"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            SIGN_HI,
            block("footer", align="left", lines=["प्रथम अपीलीय प्राधिकारी (धारा 19(1) के अधीन 30 दिन के भीतर अपील) :", "{{appellateAuthority}}"]),
            ENCL_HI,
            COPY_HI,
        ],
        checklist=[
            check(
                "appellate-authority",
                bl("The First Appellate Authority is named with the 30-day limit", "प्रथम अपीलीय प्राधिकारी का नाम 30 दिन की सीमा सहित दिया गया है"),
                bl(
                    "Section 7(8) of the Act requires the reply to state the particulars of the appellate authority and the time limit. Its absence is itself a ground of appeal.",
                    "अधिनियम की धारा 7(8) के अनुसार उत्तर में अपीलीय प्राधिकारी का विवरण और समय-सीमा दी जानी चाहिए। इसका न होना स्वयं अपील का आधार है।",
                ),
                "must",
                {"kind": "required", "field": "appellateAuthority"},
            ),
            check(
                "point-wise",
                bl("Answered point by point", "बिंदुवार उत्तर दिया गया"),
                bl(
                    "Reply in the applicant's own numbering. A single paragraph answering four questions leaves the applicant unable to tell which was refused.",
                    "आवेदक की अपनी क्रम-संख्या में उत्तर दें। चार प्रश्नों का उत्तर एक ही पैराग्राफ में देने पर आवेदक यह नहीं जान पाता कि किसे अस्वीकार किया गया।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("Point", "बिंदु")},
            ),
            check(
                "exemption-cited",
                bl("Any refusal cites the section it rests on", "कोई भी अस्वीकृति उस धारा का उल्लेख करती है जिस पर वह आधारित है"),
                bl(
                    "Information withheld must be withheld under a named provision — the section number is what makes the refusal appealable rather than arbitrary.",
                    "रोकी गई सूचना किसी नामित उपबंध के अधीन ही रोकी जानी चाहिए — धारा संख्या ही अस्वीकृति को मनमानी के बजाय अपील-योग्य बनाती है।",
                ),
                "should",
                {"kind": "regex", "role": "body", "pattern": "(?:Section|धारा)\\s*\\d"},
            ),
            check(
                "reply-dates",
                bl("The application date and the date of receipt are both stated", "आवेदन की तारीख और प्राप्ति की तारीख दोनों दी गई हैं"),
                bl(
                    "The 30 days run from receipt, not from the date the applicant wrote. Both dates on the reply are what let anyone check that it was in time.",
                    "30 दिन प्राप्ति से गिने जाते हैं, आवेदक द्वारा लिखने की तारीख से नहीं। उत्तर पर दोनों तारीखें ही किसी को यह जाँचने देती हैं कि उत्तर समय पर था।",
                ),
                "must",
                {"kind": "allRequired", "fields": ["applicationDate", "receivedOn"]},
                "12.5",
            ),
            CHECK_SUBJECT,
            CHECK_SIGNATURE,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# ------------------------------------------------- 12. Show-cause reply -----
TEMPLATES.append(
    template(
        "show-cause-reply",
        group="personal",
        name=bl("Reply to a show-cause notice", "कारण बताओ नोटिस का उत्तर"),
        short=bl("Show-cause reply", "कारण बताओ उत्तर"),
        person="first",
        used_by=bl(
            "A Government servant replying to a show-cause notice or a memorandum of charges issued by the disciplinary authority.",
            "अनुशासनिक प्राधिकारी द्वारा जारी कारण बताओ नोटिस या आरोप ज्ञापन का उत्तर देने वाला सरकारी सेवक।",
        ),
        when=bl(
            "Within the time allowed by the notice. Answer each allegation separately and in its own numbering, admit what is true, explain what is not, and ask for what you want — an extension, the documents relied on, or a personal hearing. Keep the language temperate: CSMOP 7.2(xi) asks for it and a disciplinary file is read years later by people who were not there.",
            "नोटिस में दी गई अवधि के भीतर। प्रत्येक आरोप का अलग-अलग, उसी क्रम-संख्या में उत्तर दें, जो सही है उसे स्वीकार करें, जो नहीं है उसे स्पष्ट करें, और जो चाहिए वह माँगें — अवधि विस्तार, आधारभूत दस्तावेज़, या व्यक्तिगत सुनवाई। भाषा संयमित रखें: सीएसएमओपी 7.2(xi) यही चाहता है और अनुशासनिक फाइल वर्षों बाद उन लोगों द्वारा पढ़ी जाती है जो वहाँ नहीं थे।",
        ),
        csmop=ref(
            ["8.4(1)", "7.2(xi)", "Appendix 8.1"],
            [62, 79, 87],
            chassis="letter",
            note=bl(
                "The manual prescribes no format for this. The procedure is in the CCS (Classification, Control and Appeal) Rules, 1965; what CSMOP contributes is the letter chassis and the requirement of courteous and temperate language.",
                "नियमावली इसके लिए कोई प्रारूप निर्धारित नहीं करती। प्रक्रिया केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 में है; सीएसएमओपी का योगदान पत्र का ढाँचा और शिष्ट तथा संयमित भाषा की अपेक्षा है।",
            ),
        ),
        verify=True,
        urgency_allowed=False,
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("To (disciplinary authority)", "सेवा में (अनुशासनिक प्राधिकारी)"),
                "textarea",
                True,
                bl(
                    "The Deputy Secretary (Vigilance)\nDepartment of Personnel and Training\nNorth Block, New Delhi - 110001\n(Through proper channel)",
                    "उप सचिव (सतर्कता)\nकार्मिक और प्रशिक्षण विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001\n(उचित माध्यम से)",
                ),
            ),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Reply to the show-cause notice dated 12.08.2026 — regarding.",
                    "दिनांक 12.08.2026 के कारण बताओ नोटिस का उत्तर — के संबंध में।",
                ),
            ),
            field(
                "reference",
                bl("Notice being replied to", "जिस नोटिस का उत्तर है"),
                "text",
                True,
                bl(
                    "Show-cause notice No. A-19011/3/2026-Vig. dated 12.08.2026",
                    "कारण बताओ नोटिस संख्या ए-19011/3/2026-सतर्कता दिनांक 12.08.2026",
                ),
            ),
            f_paras(
                [
                    "Please refer to the show-cause notice cited above. My reply to the allegations contained in it is submitted below, with respect.",
                    "Allegation 1 — that the files at Sl. Nos. 4 to 9 of the Annexure were not submitted within the prescribed time. The delay in respect of five of these files is admitted. The files were received in the Section on 02.07.2026, when the Section was working with two of its four posts vacant, as recorded in this Department's own O.M. No. A-12011/2/2026-Estt. dated 08.07.2026.",
                    "Allegation 2 — that the delay was not brought to the notice of the Branch Officer. This is not correct. The position was reported in my note dated 09.07.2026 at page 23/n of File No. A-12011/2/2026-Estt., a copy of which is enclosed.",
                    "I have at no stage acted in disregard of the instructions on timely disposal, and no loss has been caused to the Government.",
                    "In view of the above, I request that the notice may kindly be withdrawn and the matter dropped. Should it be considered necessary, I request an opportunity of a personal hearing before a decision is taken.",
                ],
                [
                    "कृपया उपर्युक्त कारण बताओ नोटिस का संदर्भ लें। उसमें लगाए गए आरोपों पर मेरा उत्तर सादर नीचे प्रस्तुत है।",
                    "आरोप 1 — कि अनुबंध के क्रम संख्या 4 से 9 तक की फाइलें निर्धारित समय में प्रस्तुत नहीं की गईं। इनमें से पाँच फाइलों के संबंध में विलंब स्वीकार है। ये फाइलें अनुभाग में दिनांक 02.07.2026 को प्राप्त हुईं, जब अनुभाग के चार में से दो पद रिक्त थे, जैसा कि इस विभाग के ही कार्यालय ज्ञापन संख्या ए-12011/2/2026-स्थापना दिनांक 08.07.2026 में अभिलिखित है।",
                    "आरोप 2 — कि विलंब की सूचना शाखा अधिकारी को नहीं दी गई। यह सही नहीं है। यह स्थिति फाइल संख्या ए-12011/2/2026-स्थापना के पृष्ठ 23/टिप्पणी पर मेरी दिनांक 09.07.2026 की टिप्पणी में सूचित की गई थी, जिसकी प्रति संलग्न है।",
                    "मैंने किसी भी स्तर पर समयबद्ध निपटान संबंधी अनुदेशों की अवहेलना नहीं की है, और सरकार को कोई हानि नहीं हुई है।",
                    "उपर्युक्त को देखते हुए अनुरोध है कि नोटिस वापस लेकर मामला समाप्त करने की कृपा की जाए। यदि आवश्यक समझा जाए तो निर्णय से पूर्व व्यक्तिगत सुनवाई का अवसर देने का अनुरोध है।",
                ],
            ),
            field("signatoryName", bl("Your name", "आपका नाम"), "text", True, bl("X. Y. Zachariah", "एक्स. वाई. ज़करिया")),
            field(
                "signatoryDesignation",
                bl("Your designation and Section", "आपका पदनाम और अनुभाग"),
                "text",
                True,
                bl("Section Officer, Establishment Section", "अनुभाग अधिकारी, स्थापना अनुभाग"),
            ),
            field("phone", bl("Telephone / mobile", "दूरभाष / मोबाइल"), "text", True, bl("011-2309 2591", "011-2309 2591")),
            f_enclosures(
                ["Copy of the note dated 09.07.2026 at page 23/n of File No. A-12011/2/2026-Estt."],
                ["फाइल संख्या ए-12011/2/2026-स्थापना के पृष्ठ 23/टिप्पणी पर दिनांक 09.07.2026 की टिप्पणी की प्रति"],
            ),
        ],
        layout_en=[
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", lines=["Reference: {{reference}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele.: {{phone}}"]),
            ENCL_EN,
        ],
        layout_hi=[
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", lines=["संदर्भ : {{reference}}"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष : {{phone}}"]),
            ENCL_HI,
        ],
        checklist=[
            check(
                "notice-identified",
                bl("The notice is identified by number and date", "नोटिस संख्या और तारीख से पहचाना गया है"),
                bl(
                    "The number and date of the communication being replied to must always be quoted.",
                    "जिस पत्र का उत्तर दिया जा रहा है उसकी संख्या और तारीख सदैव उद्धृत की जानी चाहिए।",
                ),
                "must",
                {"kind": "required", "field": "reference"},
                "9.2(iv)",
            ),
            check(
                "allegation-wise",
                bl("Each allegation is answered separately", "प्रत्येक आरोप का अलग-अलग उत्तर दिया गया है"),
                bl(
                    "A reply that answers the notice as a whole leaves the disciplinary authority to guess which allegation is admitted and which is denied.",
                    "जो उत्तर नोटिस का समग्र रूप से उत्तर देता है, वह अनुशासनिक प्राधिकारी को अनुमान लगाने पर छोड़ देता है कि कौन-सा आरोप स्वीकार है और कौन-सा अस्वीकार।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("Allegation", "आरोप")},
            ),
            check(
                "temperate-language",
                bl("Courteous and temperate language, free from personal remarks", "शिष्ट और संयमित भाषा, व्यक्तिगत टीका-टिप्पणी से मुक्त"),
                bl(
                    "Where an incorrect statement has to be countered, care is taken to make the observation in courteous and temperate language free from personal remarks.",
                    "जहाँ किसी गलत कथन का प्रतिवाद करना हो, वहाँ ध्यान रखा जाता है कि टिप्पणी शिष्ट और संयमित भाषा में, व्यक्तिगत टीका-टिप्पणी से मुक्त हो।",
                ),
                "must",
                {
                    "kind": "regexAbsent",
                    "role": "body",
                    "pattern": "(?:malafide|mala fide|deliberately false|vendetta|incompetent|दुर्भावना|जान-बूझकर|अक्षम)",
                },
                "7.2(xi)",
            ),
            check(
                "relief-sought",
                bl("What is asked for is stated", "जो माँगा जा रहा है वह लिखा गया है"),
                bl(
                    "Say whether you want the notice withdrawn, more time, the documents relied on, or a personal hearing.",
                    "लिखें कि आप नोटिस वापस लेना चाहते हैं, अधिक समय, आधारभूत दस्तावेज़, या व्यक्तिगत सुनवाई।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("request", "अनुरोध")},
            ),
            CHECK_SUBJECT,
            CHECK_PARA_NUMBERING,
            CHECK_ENCLOSURES,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# ------------------------------------------------------ 13. Tour programme --
TEMPLATES.append(
    template(
        "tour-programme",
        group="personal",
        name=bl("Tour programme", "दौरा कार्यक्रम"),
        short=bl("Tour", "दौरा"),
        person="third",
        used_by=bl(
            "An officer putting up the itinerary of an official tour for the approval of the controlling authority, before the tour is undertaken.",
            "दौरा आरंभ होने से पूर्व नियंत्रक प्राधिकारी के अनुमोदन हेतु सरकारी दौरे का यात्रा-कार्यक्रम प्रस्तुत करने वाला अधिकारी।",
        ),
        when=bl(
            "Approved in advance; the approval is what the travelling allowance bill is later settled against. State the purpose, the itinerary date by date, the mode of travel and the entitlement claimed, and whether headquarters will be left on a holiday.",
            "पूर्व अनुमोदन लिया जाता है; यही अनुमोदन वह आधार है जिसके विरुद्ध बाद में यात्रा भत्ता बिल का निपटान होता है। प्रयोजन, तारीखवार यात्रा-कार्यक्रम, यात्रा का साधन और दावा की गई पात्रता, तथा क्या मुख्यालय अवकाश के दिन छोड़ा जाएगा — यह सब लिखें।",
        ),
        csmop=ref(
            ["8.4(4)", "Appendix 8.1"],
            [79, 90],
            chassis="office-memorandum",
            note=bl(
                "CSMOP prescribes no tour programme format. This is the Office Order chassis with an itinerary; the entitlements are in the Travelling Allowance Rules and the pay module carries them.",
                "सीएसएमओपी दौरा कार्यक्रम का कोई प्रारूप निर्धारित नहीं करता। यह यात्रा-कार्यक्रम सहित कार्यालय आदेश का ढाँचा है; पात्रताएँ यात्रा भत्ता नियमों में हैं और वेतन मॉड्यूल उन्हें रखता है।",
            ),
        ),
        verify=True,
        fields=[
            f_urgency(),
            f_file_number(),
            f_ministry(),
            f_department(),
            f_place(),
            f_date(),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Tour programme of Shri X.Y.Z., Section Officer, from 15.09.2026 to 18.09.2026 — approval regarding.",
                    "श्री एक्स.वाई.ज़ेड., अनुभाग अधिकारी का दिनांक 15.09.2026 से 18.09.2026 तक का दौरा कार्यक्रम — अनुमोदन के संबंध में।",
                ),
            ),
            field("officerName", bl("Officer on tour", "दौरे पर जाने वाला अधिकारी"), "text", True, bl("Shri X. Y. Zachariah", "श्री एक्स. वाई. ज़करिया")),
            field(
                "officerDesignation",
                bl("Designation and Level", "पदनाम और स्तर"),
                "text",
                True,
                bl("Section Officer, Level 8", "अनुभाग अधिकारी, स्तर 8"),
            ),
            field(
                "purpose",
                bl("Purpose of the tour", "दौरे का प्रयोजन"),
                "textarea",
                True,
                bl(
                    "To attend the regional review meeting on implementation of e-Office version 7.0 and to inspect the Central Registration Unit of the Regional Office.",
                    "ई-ऑफिस संस्करण 7.0 के कार्यान्वयन पर क्षेत्रीय समीक्षा बैठक में भाग लेने तथा क्षेत्रीय कार्यालय की केंद्रीय पंजीकरण इकाई का निरीक्षण करने हेतु।",
                ),
            ),
            field(
                "itinerary",
                bl("Itinerary", "यात्रा कार्यक्रम"),
                "list",
                True,
                {
                    "en": [
                        "15.09.2026 — Depart New Delhi 06:00 by Train 12951 (2A); arrive Mumbai 22:30. Halt at Mumbai.",
                        "16.09.2026 — Regional review meeting at the Regional Office, Mumbai, 10:00 to 17:00. Halt at Mumbai.",
                        "17.09.2026 — Inspection of the Central Registration Unit, Regional Office, Mumbai. Halt at Mumbai.",
                        "18.09.2026 — Depart Mumbai 08:00 by Train 12952 (2A); arrive New Delhi 23:35.",
                    ],
                    "hi": [
                        "15.09.2026 — नई दिल्ली से प्रस्थान 06:00 बजे, रेलगाड़ी 12951 (द्वितीय वातानुकूलित); मुंबई आगमन 22:30 बजे। रात्रि विश्राम मुंबई।",
                        "16.09.2026 — क्षेत्रीय कार्यालय, मुंबई में क्षेत्रीय समीक्षा बैठक, 10:00 से 17:00 बजे तक। रात्रि विश्राम मुंबई।",
                        "17.09.2026 — केंद्रीय पंजीकरण इकाई, क्षेत्रीय कार्यालय, मुंबई का निरीक्षण। रात्रि विश्राम मुंबई।",
                        "18.09.2026 — मुंबई से प्रस्थान 08:00 बजे, रेलगाड़ी 12952 (द्वितीय वातानुकूलित); नई दिल्ली आगमन 23:35 बजे।",
                    ],
                },
            ),
            f_paras(
                [
                    "The tour programme of Shri X.Y.Z., Section Officer (Level 8), for the period 15.09.2026 to 18.09.2026 is placed below for approval.",
                    "Travel is proposed by rail in AC 2-tier, which is the entitlement at Level 8, and the officer will not be leaving headquarters on a public holiday. Daily allowance is claimed for three nights of halt at Mumbai.",
                    "The expenditure is debitable to the sanctioned travel budget of the Division for the current financial year, in which a balance of Rs. 3,80,000 is available.",
                ],
                [
                    "श्री एक्स.वाई.ज़ेड., अनुभाग अधिकारी (स्तर 8) का दिनांक 15.09.2026 से 18.09.2026 तक की अवधि का दौरा कार्यक्रम अनुमोदनार्थ नीचे प्रस्तुत है।",
                    "यात्रा रेल द्वारा द्वितीय वातानुकूलित श्रेणी में प्रस्तावित है, जो स्तर 8 पर पात्रता है, और अधिकारी सार्वजनिक अवकाश के दिन मुख्यालय नहीं छोड़ेंगे। मुंबई में तीन रात्रि विश्राम हेतु दैनिक भत्ते का दावा है।",
                    "व्यय चालू वित्त वर्ष के लिए प्रभाग के स्वीकृत यात्रा बजट में नामे है, जिसमें 3,80,000 रुपये का शेष उपलब्ध है।",
                ],
            ),
            *f_signatory(),
            field(
                "approvingAuthority",
                bl("Approving authority", "अनुमोदनकर्ता प्राधिकारी"),
                "text",
                True,
                bl("Joint Secretary (Administration)", "संयुक्त सचिव (प्रशासन)"),
            ),
            f_copy_to(
                ["The officer concerned", "The Drawing and Disbursing Officer", "Guard file"],
                ["संबंधित अधिकारी", "आहरण एवं संवितरण अधिकारी", "गार्ड फाइल"],
            ),
            f_enclosures([], []),
        ],
        layout_en=[
            *head_en(),
            block("title", align="center", emphasis="title", lines=["TOUR PROGRAMME"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", lines=["Officer: {{officerName}}, {{officerDesignation}}", "Purpose: {{purpose}}"]),
            BODY_EN,
            block("body", align="left", source="itinerary", lead="Itinerary:", itemPrefix="ordinal"),
            block("footer", align="left", lines=["Submitted for the approval of {{approvingAuthority}}."]),
            SIGN_EN,
            ENCL_EN,
            COPY_EN,
        ],
        layout_hi=[
            *head_hi(),
            block("title", align="center", emphasis="title", lines=["दौरा कार्यक्रम"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", lines=["अधिकारी : {{officerName}}, {{officerDesignation}}", "प्रयोजन : {{purpose}}"]),
            BODY_HI,
            block("body", align="left", source="itinerary", lead="यात्रा कार्यक्रम :", itemPrefix="ordinal"),
            block("footer", align="left", lines=["{{approvingAuthority}} के अनुमोदनार्थ प्रस्तुत।"]),
            SIGN_HI,
            ENCL_HI,
            COPY_HI,
        ],
        checklist=[
            check(
                "itinerary-listed",
                bl("The itinerary is given date by date", "यात्रा कार्यक्रम तारीखवार दिया गया है"),
                bl(
                    "The travelling allowance bill is settled against the approved itinerary; a programme without dates cannot be checked against a bill.",
                    "यात्रा भत्ता बिल का निपटान अनुमोदित यात्रा-कार्यक्रम के विरुद्ध होता है; बिना तारीखों के कार्यक्रम की बिल से जाँच नहीं हो सकती।",
                ),
                "must",
                {"kind": "listNonEmpty", "field": "itinerary"},
            ),
            check(
                "purpose",
                bl("The purpose of the tour is stated", "दौरे का प्रयोजन लिखा गया है"),
                bl(
                    "The approving authority is approving an expenditure; the purpose is what it is approving it for.",
                    "अनुमोदनकर्ता प्राधिकारी एक व्यय का अनुमोदन कर रहा है; प्रयोजन ही वह है जिसके लिए वह अनुमोदन दे रहा है।",
                ),
                "must",
                {"kind": "required", "field": "purpose"},
            ),
            check(
                "approving-authority",
                bl("The approving authority is named", "अनुमोदनकर्ता प्राधिकारी का उल्लेख है"),
                bl(
                    "Indicate the authority competent to approve, the way a note indicates the level of disposal.",
                    "अनुमोदन के लिए सक्षम प्राधिकारी का उल्लेख करें, जैसे टिप्पणी में निपटान का स्तर दर्शाया जाता है।",
                ),
                "must",
                {"kind": "required", "field": "approvingAuthority"},
                "7.3(x)",
            ),
            CHECK_SUBJECT,
            CHECK_NUMBER_DATE,
            CHECK_SIGNATURE,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)

# ------------------------------------------- 14. T.A. bill covering letter --
TEMPLATES.append(
    template(
        "ta-bill-cover",
        group="personal",
        name=bl("Covering letter for a travelling allowance bill", "यात्रा भत्ता बिल का अग्रेषण पत्र"),
        short=bl("T.A. bill cover", "या.भ. बिल अग्रेषण"),
        person="first",
        used_by=bl(
            "An officer forwarding a completed travelling allowance bill to the Drawing and Disbursing Officer after a tour.",
            "दौरे के पश्चात पूर्ण यात्रा भत्ता बिल आहरण एवं संवितरण अधिकारी को अग्रेषित करने वाला अधिकारी।",
        ),
        when=bl(
            "The covering letter is what makes the bill checkable: it names the tour and its approval, lists what is enclosed — tickets, boarding passes, hotel receipts — and carries the certificates the DDO needs before passing the claim.",
            "अग्रेषण पत्र ही बिल को जाँच-योग्य बनाता है: उसमें दौरे और उसके अनुमोदन का उल्लेख होता है, संलग्न सामग्री — टिकट, बोर्डिंग पास, होटल रसीदें — सूचीबद्ध होती है, और वे प्रमाणन होते हैं जिनकी आहरण एवं संवितरण अधिकारी को दावा पारित करने से पूर्व आवश्यकता होती है।",
        ),
        csmop=ref(
            ["8.4(1)", "8.4(9)", "9.2(vii)", "Appendix 8.1"],
            [79, 80, 87, 103],
            chassis="letter",
            note=bl(
                "The manual prescribes no form for a T.A. bill. This is the letter chassis with the enclosure discipline of 9.2(vii) — which is the whole point of the document.",
                "नियमावली यात्रा भत्ता बिल के लिए कोई प्रपत्र निर्धारित नहीं करती। यह 9.2(vii) के संलग्नक अनुशासन सहित पत्र का ढाँचा है — यही इस दस्तावेज़ का पूरा प्रयोजन है।",
            ),
        ),
        verify=True,
        urgency_allowed=False,
        salutation=bl("Sir / Madam,", "महोदय / महोदया,"),
        subscription=bl("Yours faithfully,", "भवदीय,"),
        fields=[
            f_file_number(),
            f_place(),
            f_date(),
            field(
                "addressee",
                bl("To (Drawing and Disbursing Officer)", "सेवा में (आहरण एवं संवितरण अधिकारी)"),
                "textarea",
                True,
                bl(
                    "The Drawing and Disbursing Officer\nDepartment of Personnel and Training\nNorth Block, New Delhi - 110001",
                    "आहरण एवं संवितरण अधिकारी\nकार्मिक और प्रशिक्षण विभाग\nनॉर्थ ब्लॉक, नई दिल्ली - 110001",
                ),
            ),
            field(
                "subject",
                bl("Subject", "विषय"),
                "text",
                True,
                bl(
                    "Travelling allowance bill in respect of the tour to Mumbai from 15.09.2026 to 18.09.2026 — forwarding regarding.",
                    "दिनांक 15.09.2026 से 18.09.2026 तक मुंबई दौरे का यात्रा भत्ता बिल — अग्रेषण के संबंध में।",
                ),
            ),
            field(
                "reference",
                bl("Tour approval", "दौरा अनुमोदन"),
                "text",
                True,
                bl(
                    "Tour programme approved vide Office Order No. A-24011/6/2026-Admn. dated 08.09.2026",
                    "कार्यालय आदेश संख्या ए-24011/6/2026-प्रशासन दिनांक 08.09.2026 द्वारा अनुमोदित दौरा कार्यक्रम",
                ),
            ),
            field("amount", bl("Amount claimed (Rs.)", "दावा की गई राशि (रुपये)"), "text", True, bl("18,640", "18,640")),
            f_paras(
                [
                    "The travelling allowance bill in respect of the tour undertaken to Mumbai from 15.09.2026 to 18.09.2026, approved vide the Office Order cited above, is forwarded herewith for arranging payment. The amount claimed is Rs. 18,640.",
                    "It is certified that the journeys were performed by the class of accommodation for which the claim is made, that no free transport or hospitality was availed of, and that the daily allowance claimed is for the halts actually made.",
                    "No advance was drawn against this tour.",
                ],
                [
                    "उपर्युक्त कार्यालय आदेश द्वारा अनुमोदित, दिनांक 15.09.2026 से 18.09.2026 तक मुंबई के दौरे का यात्रा भत्ता बिल भुगतान की व्यवस्था हेतु इसके साथ अग्रेषित है। दावा की गई राशि 18,640 रुपये है।",
                    "यह प्रमाणित किया जाता है कि यात्राएँ उसी श्रेणी में की गईं जिसके लिए दावा किया गया है, कोई नि:शुल्क परिवहन या आतिथ्य नहीं लिया गया, और दावा किया गया दैनिक भत्ता वास्तव में किए गए विश्रामों के लिए है।",
                    "इस दौरे के विरुद्ध कोई अग्रिम नहीं लिया गया था।",
                ],
            ),
            field("signatoryName", bl("Your name", "आपका नाम"), "text", True, bl("X. Y. Zachariah", "एक्स. वाई. ज़करिया")),
            field(
                "signatoryDesignation",
                bl("Your designation and Level", "आपका पदनाम और स्तर"),
                "text",
                True,
                bl("Section Officer, Level 8", "अनुभाग अधिकारी, स्तर 8"),
            ),
            field("phone", bl("Telephone / mobile", "दूरभाष / मोबाइल"), "text", True, bl("011-2309 2591", "011-2309 2591")),
            f_enclosures(
                [
                    "Travelling allowance bill in the prescribed form (2 pages)",
                    "Copy of the approved tour programme",
                    "Rail tickets and reservation slips, onward and return",
                    "Hotel receipt for three nights at Mumbai",
                ],
                [
                    "निर्धारित प्रपत्र में यात्रा भत्ता बिल (2 पृष्ठ)",
                    "अनुमोदित दौरा कार्यक्रम की प्रति",
                    "जाने और लौटने के रेल टिकट तथा आरक्षण पर्चियाँ",
                    "मुंबई में तीन रात्रि की होटल रसीद",
                ],
            ),
        ],
        layout_en=[
            block("fileNumber", align="left", lines=["No. {{fileNumber}}"]),
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("addressee", align="left", lines=["To,", "{{addressee}}"]),
            block("subject", align="left", lines=["Subject: {{subject}}"]),
            block("refLine", align="left", lines=["Reference: {{reference}}", "Amount claimed: Rs. {{amount}}"]),
            block("salutation", align="left", lines=["Sir / Madam,"]),
            BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele.: {{phone}}"]),
            ENCL_EN,
        ],
        layout_hi=[
            block("fileNumber", align="left", lines=["संख्या {{fileNumber}}"]),
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("addressee", align="left", lines=["सेवा में,", "{{addressee}}"]),
            block("subject", align="left", lines=["विषय : {{subject}}"]),
            block("refLine", align="left", lines=["संदर्भ : {{reference}}", "दावा की गई राशि : {{amount}} रुपये"]),
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष : {{phone}}"]),
            ENCL_HI,
        ],
        checklist=[
            check(
                "enclosures-listed",
                bl("Every voucher is listed", "प्रत्येक वाउचर सूचीबद्ध है"),
                bl(
                    "A draft should clearly specify the enclosures which are to accompany the fair copy, and the number goes at the bottom left. A T.A. bill without its tickets comes back.",
                    "मसौदे में स्पष्ट रूप से बताया जाना चाहिए कि स्वच्छ प्रति के साथ कौन-से संलग्नक जाएँगे, और संख्या नीचे बाईं ओर दी जाती है। बिना टिकटों के यात्रा भत्ता बिल लौट आता है।",
                ),
                "must",
                {"kind": "listNonEmpty", "field": "enclosures"},
                "9.2(vii)",
            ),
            check(
                "tour-approval",
                bl("The tour approval is cited", "दौरा अनुमोदन उद्धृत है"),
                bl(
                    "The bill is settled against the approved tour programme; cite the order that approved it by number and date.",
                    "बिल का निपटान अनुमोदित दौरा कार्यक्रम के विरुद्ध होता है; अनुमोदन करने वाले आदेश को संख्या और तारीख सहित उद्धृत करें।",
                ),
                "must",
                {"kind": "required", "field": "reference"},
                "9.2(iv)",
            ),
            check(
                "certificates",
                bl("The certificates the DDO needs are included", "आहरण एवं संवितरण अधिकारी के लिए अपेक्षित प्रमाणन शामिल हैं"),
                bl(
                    "Class of travel actually used, no free transport or hospitality availed, daily allowance only for halts actually made, and whether an advance was drawn.",
                    "वास्तव में प्रयुक्त यात्रा श्रेणी, कोई नि:शुल्क परिवहन या आतिथ्य नहीं लिया गया, दैनिक भत्ता केवल वास्तविक विश्रामों के लिए, और क्या अग्रिम लिया गया था।",
                ),
                "must",
                {"kind": "contains", "role": "body", "text": bl("certified", "प्रमाणित")},
            ),
            check(
                "amount",
                bl("The amount claimed is stated", "दावा की गई राशि लिखी गई है"),
                bl(
                    "The covering letter states the amount so the bill can be checked against it.",
                    "अग्रेषण पत्र में राशि लिखी जाती है ताकि बिल की उससे जाँच हो सके।",
                ),
                "must",
                {"kind": "required", "field": "amount"},
            ),
            CHECK_SUBJECT,
            CHECK_NUMBER_DATE,
            CHECK_NO_PLACEHOLDERS,
        ],
    )
)


# --------------------------------------------------------------------------- #
# 4. Build, check, write
# --------------------------------------------------------------------------- #

PLACEHOLDER = __import__("re").compile(r"\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}")

GROUP_ORDER = ["communication", "internal", "personal", "statutory"]

BLOCK_ROLES = {
    "fileNumber",
    "urgency",
    "gazetteLine",
    "header",
    "title",
    "dateLine",
    "addressee",
    "attention",
    "subject",
    "refLine",
    "salutation",
    "body",
    "closing",
    "signature",
    "enclosures",
    "copyTo",
    "endorsement",
    "footer",
}

# Fields that deliberately appear in no layout and in no checklist rule, with
# the reason. Anything else unused is an officer being asked to type something
# that goes nowhere — which is how the demi-official letter came to require an
# e-mail address it never printed.
GUIDANCE_ONLY: dict[str, str] = {
    "noting.noteType": (
        "the functional approach to noting (7.14) — it decides how much to write, "
        "and the Drafting Studio shows the guidance for the kind chosen. A note "
        "does not print the category of its own case."
    ),
}


def self_check(templates: list[dict[str, Any]]) -> list[str]:
    """Everything a JSON Schema cannot say about a template.

    A schema can require that `source` names a field id; it cannot know whether
    that id exists in *this* template. Every failure here is one an officer
    would otherwise meet as a `{{signatoryName}}` in a signed document.
    """
    problems: list[str] = []
    seen_ids: set[str] = set()

    for record in templates:
        tid = record["id"]
        if tid in seen_ids:
            problems.append(f"{tid}: duplicate template id")
        seen_ids.add(tid)

        fields = {f["id"] for f in record["fields"]}
        if len(fields) != len(record["fields"]):
            problems.append(f"{tid}: duplicate field id")

        roles_en = [b["role"] for b in record["layout"]["en"]]
        roles_hi = [b["role"] for b in record["layout"]["hi"]]

        for lang in ("en", "hi"):
            used: set[str] = set()
            for blk in record["layout"][lang]:
                for line in blk.get("lines", []):
                    used |= set(PLACEHOLDER.findall(line))
                for key in ("lead",):
                    if blk.get(key):
                        used |= set(PLACEHOLDER.findall(blk[key]))
                source = blk.get("source")
                if source:
                    used.add(source)
                    kind = next((f["type"] for f in record["fields"] if f["id"] == source), None)
                    if kind not in {"list", "paras"}:
                        problems.append(f"{tid}/{lang}: block source '{source}' is {kind}, not a list or paras field")
                    if blk.get("lines"):
                        # The engine renders one or the other; `lines` would
                        # vanish without a word.
                        problems.append(f"{tid}/{lang}: block '{blk['role']}' has both lines and a source")
                if blk.get("numberFrom") and not blk.get("numbered"):
                    problems.append(f"{tid}/{lang}: block '{blk['role']}' sets numberFrom but is not numbered")
            missing = sorted(used - fields)
            if missing:
                problems.append(f"{tid}/{lang}: layout uses unknown field(s) {missing}")

        # Both layouts must place the same roles, or one language would render a
        # document the other does not.
        if roles_en != roles_hi:
            problems.append(f"{tid}: the en and hi layouts place different blocks: {roles_en} vs {roles_hi}")

        for item in record["checklist"]:
            rule = item["rule"]
            named = ([rule["field"]] if rule.get("field") else []) + list(rule.get("fields", []))
            unknown = sorted(set(named) - fields)
            if unknown:
                problems.append(f"{tid}/{item['id']}: rule names unknown field(s) {unknown}")

            # A rule whose role is a typo matches no block. `blockPresent` then
            # always fails, which someone notices; `regexAbsent` always PASSES,
            # which is a checklist item that silently checks nothing.
            role = rule.get("role")
            if role and role not in BLOCK_ROLES:
                problems.append(f"{tid}/{item['id']}: rule names unknown role '{role}'")
            elif role and role not in roles_en:
                problems.append(f"{tid}/{item['id']}: rule names role '{role}', which this layout never places")

        # An unused field is an officer typing something that goes nowhere.
        used: set[str] = set()
        for lang in ("en", "hi"):
            for blk in record["layout"][lang]:
                for line in list(blk.get("lines") or []) + ([blk["lead"]] if blk.get("lead") else []):
                    used |= set(PLACEHOLDER.findall(line))
                if blk.get("source"):
                    used.add(blk["source"])
        for item in record["checklist"]:
            rule = item["rule"]
            if rule.get("field"):
                used.add(rule["field"])
            used |= set(rule.get("fields", []))
        for orphan in sorted(fields - used):
            if f"{tid}.{orphan}" not in GUIDANCE_ONLY:
                problems.append(
                    f"{tid}/{orphan}: field is in no layout and in no rule — render it, drop it, "
                    "or add it to GUIDANCE_ONLY with the reason"
                )

        # The urgency grading is a select whose options carry the labels, so the
        # field and the block have to agree about whether the form has one.
        has_urgency_field = any(f["id"] == "urgency" for f in record["fields"])
        has_urgency_block = any(b["role"] == "urgency" for b in record["layout"]["en"])
        if bool(record.get("urgencyAllowed")) != has_urgency_field:
            problems.append(f"{tid}: urgencyAllowed says {record.get('urgencyAllowed')} but the urgency field is {has_urgency_field}")
        if has_urgency_field != has_urgency_block:
            problems.append(f"{tid}: has an urgency field but no urgency block, or the reverse")

        for f in record["fields"]:
            if f["required"] and not f["sample"]["en"]:
                problems.append(f"{tid}/{f['id']}: required field has an empty English sample")
            if f["required"] and not f["sample"]["hi"]:
                problems.append(f"{tid}/{f['id']}: required field has an empty Hindi sample")
            if f["type"] == "select":
                values = {o["value"] for o in f.get("options", [])}
                if not values:
                    problems.append(f"{tid}/{f['id']}: select field has no options")
                elif f["sample"]["en"] not in values:
                    problems.append(f"{tid}/{f['id']}: sample '{f['sample']['en']}' is not one of {sorted(values)}")

        if record["_group"] not in GROUP_ORDER:
            problems.append(f"{tid}: unknown group '{record['_group']}'")

    known = seen_ids | {"*"}
    for entry in PHRASES:
        unknown = sorted(set(entry["appliesTo"]) - known)
        if unknown:
            problems.append(f"phrase {entry['id']}: appliesTo names unknown template(s) {unknown}")

    for record in templates:
        chassis = record["csmopRef"].get("chassis")
        if chassis and chassis not in seen_ids:
            problems.append(f"{record['id']}: chassis '{chassis}' is not a template")

    term_ids = [t["id"] for t in TERMS]
    if len(term_ids) != len(set(term_ids)):
        problems.append("structure-terms: duplicate term id")
    phrase_ids = [p["id"] for p in PHRASES]
    if len(phrase_ids) != len(set(phrase_ids)):
        problems.append("phrases: duplicate phrase id")

    return problems


def build() -> dict[str, Any]:
    """Every file this script writes, keyed by its path under data/."""
    problems = self_check(TEMPLATES)
    if problems:
        raise ValueError("template self-check failed:\n  " + "\n  ".join(problems))

    files: dict[str, Any] = {
        "drafting/structure-terms.json": envelope({"terms": TERMS}),
        "drafting/phrases.json": envelope({"phrases": PHRASES}),
    }

    index: list[dict[str, Any]] = []
    for record in TEMPLATES:
        payload = {k: v for k, v in record.items() if k != "_group"}
        files[f"drafting/templates/{record['id']}.json"] = envelope({"template": payload})
        index.append(
            {
                "id": record["id"],
                "name": record["name"],
                "shortName": record["shortName"],
                "group": record["_group"],
                "person": record["person"],
                "csmopParas": record["csmopRef"]["paras"],
                "verify": record["verify"],
            }
        )

    index.sort(key=lambda entry: (GROUP_ORDER.index(entry["group"]), entry["id"]))
    files["drafting/index.json"] = envelope({"templates": index})
    return files


SCHEMA_FOR = {
    "structure-terms.json": "drafting-terms.schema.json",
    "phrases.json": "drafting-phrases.schema.json",
    "index.json": "drafting-index.schema.json",
}


def schema_for(relative: str) -> str:
    return SCHEMA_FOR.get(Path(relative).name if "templates/" not in relative else "", "drafting-template.schema.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and compare against disk; write nothing")
    args = parser.parse_args()

    files = build()
    log(f"built {len(files)} files from {len(TEMPLATES)} templates, {len(TERMS)} terms, {len(PHRASES)} phrases")

    failures = 0
    for relative, payload in sorted(files.items()):
        name = schema_for(relative)
        try:
            validate(payload, name)
        except Exception as error:  # noqa: BLE001 - the message is the report
            log(f"  ! data/{relative}\n{error}")
            failures += 1
            continue

        path = DATA_DIR / relative
        if args.check:
            current = read_json(path)
            if current is None:
                log(f"  ! data/{relative}: missing on disk")
                failures += 1
            elif current != payload:
                log(f"  ! data/{relative}: on disk differs from what this script builds")
                failures += 1
            else:
                log(f"  ok data/{relative} ({name})")
        else:
            changed, _ = write_json(path, payload)
            log(f"  {'wrote' if changed else 'same '} data/{relative} ({name})")

    if failures:
        log(f"{failures} file(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
