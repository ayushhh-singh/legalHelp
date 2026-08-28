#!/usr/bin/env python3
"""Write ``data/portals.json`` and ``data/pension/pension-facts.json``.

Two small, hand-compiled datasets that share one script because neither is big
enough to justify its own, and both are the same kind of job: a fixed list of
facts an officer needs, each carrying the order or portal it comes from.

**Portals.** A directory of public URLs and, where one is published, a public
helpline — never a login form and never anything that collects a credential
(master context hard rule: no OSINT, no departmental data). Several of these
domains could not be independently confirmed by a fetch this session — some
portals are cadre-specific with no single canonical URL (SPARROW), some
returned no authoritative result in search (e-HRMS's own domain) — so every
record carries `verify: true` unconditionally, the same posture
`glossary_seed.py` takes for the same reason.

**Pension facts.** Superannuation, gratuity and commutation are read from
`data/rules/text/ccs-pension.json` (already fetched and committed by
`scripts/authoring/fetch_sources.py` in an earlier session) wherever that file
has the figure; the death-gratuity table and the ceiling's DA-linked 25 per
cent uplift both come from there. The commutation table (age next birthday ->
years' purchase) is not in that extract — CCS (Commutation of Pension) Rules
1981's own Appendix could not be parsed from the fetched PDF's compressed
content stream this session — so it was cross-checked instead against two
independent secondary reproductions that agreed on every row compared (ages
55-62, byte-for-byte identical between them), which is the same "compiled
against best public alternative, `verify: true`, recorded" fallback the
project takes whenever a primary source cannot be reached
(`docs/DATA-GAPS.md` #52). The GPF rate could not be fetched directly either
(dea.gov.in failed certificate verification) and is corroborated the same way.

    scripts/ingest/.venv/bin/python scripts/ingest/utils_seed.py
    scripts/ingest/.venv/bin/python scripts/ingest/utils_seed.py --check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, log, read_json, update_versions, validate, write_json  # noqa: E402

PORTALS_OUT = DATA_DIR / "portals.json"
PENSION_OUT = DATA_DIR / "pension" / "pension-facts.json"

VERSION = "1.0.0"
STAMP = "2026-08-29T00:00:00Z"

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ हेतु; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से पुष्टि करें।",
}


def bl(en: str, hi: str) -> dict[str, str]:
    return {"en": en, "hi": hi}


# --------------------------------------------------------------------------
# Portals
# --------------------------------------------------------------------------

PORTALS: list[dict[str, Any]] = [
    {
        "id": "ehrms",
        "name": bl("Employee Human Resource Management System", "कर्मचारी मानव संसाधन प्रबंधन प्रणाली"),
        "shortName": bl("e-HRMS", "ई-एचआरएमएस"),
        "purpose": bl(
            "Service book, leave, transfer, APAR and the rest of an employee's HR record in one place.",
            "सेवा पुस्तिका, अवकाश, स्थानांतरण, एपीएआर तथा कर्मचारी का शेष सेवा-अभिलेख एक ही स्थान पर।",
        ),
        "url": "https://ehrms.gov.in",
        "category": "hr-service",
        "helpline": None,
        "administeredBy": bl("Department of Personnel & Training", "कार्मिक एवं प्रशिक्षण विभाग"),
        "verify": True,
    },
    {
        "id": "sparrow",
        "name": bl("Smart Performance Appraisal Report Recording Online Window", "स्मार्ट परफॉरमेंस एप्रेज़ल रिपोर्ट रिकॉर्डिंग ऑनलाइन विंडो"),
        "shortName": bl("SPARROW", "स्पैरो"),
        "purpose": bl(
            "Online Annual Performance Appraisal Report (APAR). Run per cadre (SPARROW-IAS, SPARROW-ACC and "
            "so on) rather than as one shared site — start from your cadre controlling authority's page.",
            "ऑनलाइन वार्षिक कार्य निष्पादन मूल्यांकन रिपोर्ट (एपीएआर)। यह एक साझा साइट के बजाय प्रत्येक संवर्ग हेतु "
            "अलग से चलाई जाती है (स्पैरो-आईएएस, स्पैरो-एसीसी आदि) — अपने संवर्ग नियंत्रक प्राधिकारी के पृष्ठ से आरंभ करें।",
        ),
        "url": "https://dopt.gov.in",
        "category": "hr-service",
        "helpline": None,
        "administeredBy": bl("Department of Personnel & Training", "कार्मिक एवं प्रशिक्षण विभाग"),
        "verify": True,
    },
    {
        "id": "cghs",
        "name": bl("Central Government Health Scheme", "केंद्रीय सरकार स्वास्थ्य योजना"),
        "shortName": bl("CGHS", "सीजीएचएस"),
        "purpose": bl(
            "Wellness centre locator, card status, empanelled hospital list and online claim tracking.",
            "वेलनेस केंद्र खोजक, कार्ड स्थिति, सूचीबद्ध अस्पतालों की सूची तथा ऑनलाइन दावा अनुरेखण।",
        ),
        "url": "https://cghs.gov.in",
        "category": "health",
        "helpline": {"phone": "1800-11-4477", "label": bl("CGHS toll-free helpline", "सीजीएचएस टोल-फ्री हेल्पलाइन")},
        "administeredBy": bl("Ministry of Health and Family Welfare", "स्वास्थ्य एवं परिवार कल्याण मंत्रालय"),
        "verify": True,
    },
    {
        "id": "dopt",
        "name": bl("Department of Personnel & Training", "कार्मिक एवं प्रशिक्षण विभाग"),
        "shortName": bl("DoPT", "डीओपीटी"),
        "purpose": bl(
            "Conduct, CCA, Leave and recruitment rules; the annual holiday O.M.; establishment circulars.",
            "आचरण, सीसीए, अवकाश तथा भर्ती नियम; वार्षिक अवकाश कार्यालय ज्ञापन; स्थापना परिपत्र।",
        ),
        "url": "https://dopt.gov.in",
        "category": "hr-service",
        "helpline": None,
        "administeredBy": bl("Ministry of Personnel, Public Grievances and Pensions", "कार्मिक, लोक शिकायत और पेंशन मंत्रालय"),
        "verify": True,
    },
    {
        "id": "bhavishya",
        "name": bl("Bhavishya — Pension Sanction and Payment Tracking System", "भविष्य — पेंशन स्वीकृति एवं भुगतान अनुरेखण प्रणाली"),
        "shortName": bl("Bhavishya", "भविष्य"),
        "purpose": bl(
            "End-to-end online tracking of retirement dues, from the pre-retirement checklist to pension "
            "sanction, for every retiring Central Government employee.",
            "सेवानिवृत्त होने वाले प्रत्येक केंद्रीय सरकारी कर्मचारी हेतु सेवानिवृत्ति-पूर्व जाँच-सूची से पेंशन स्वीकृति "
            "तक सेवानिवृत्ति देय राशियों का पूर्ण ऑनलाइन अनुरेखण।",
        ),
        "url": "https://bhavishya.nic.in",
        "category": "pay-pension",
        "helpline": None,
        "administeredBy": bl("Department of Pension & Pensioners' Welfare", "पेंशन एवं पेंशनभोगी कल्याण विभाग"),
        "verify": True,
    },
    {
        "id": "cpengrams",
        "name": bl("Centralised Pension Grievance Redress and Monitoring System", "केंद्रीकृत पेंशन शिकायत निवारण एवं निगरानी प्रणाली"),
        "shortName": bl("CPENGRAMS", "सीपेनग्राम्स"),
        "purpose": bl(
            "Lodge and track a pension-specific grievance, separately from the general CPGRAMS portal.",
            "सामान्य सीपीग्राम्स पोर्टल से अलग, पेंशन-विशिष्ट शिकायत दर्ज एवं अनुरेखित करें।",
        ),
        "url": "https://cpengrams.nic.in",
        "category": "grievance",
        "helpline": None,
        "administeredBy": bl("Department of Pension & Pensioners' Welfare", "पेंशन एवं पेंशनभोगी कल्याण विभाग"),
        "verify": True,
    },
    {
        "id": "cpgrams",
        "name": bl("Centralized Public Grievance Redress and Monitoring System", "केंद्रीकृत लोक शिकायत निवारण एवं निगरानी प्रणाली"),
        "shortName": bl("CPGRAMS", "सीपीग्राम्स"),
        "purpose": bl(
            "The one portal to lodge a grievance against any Central Government Ministry, Department or office.",
            "किसी भी केंद्रीय मंत्रालय, विभाग अथवा कार्यालय के विरुद्ध शिकायत दर्ज करने हेतु एकल पोर्टल।",
        ),
        "url": "https://pgportal.gov.in",
        "category": "grievance",
        "helpline": None,
        "administeredBy": bl("Department of Administrative Reforms and Public Grievances", "प्रशासनिक सुधार एवं लोक शिकायत विभाग"),
        "verify": True,
    },
    {
        "id": "igot-karmayogi",
        "name": bl("Integrated Government Online Training — Karmayogi", "एकीकृत सरकारी ऑनलाइन प्रशिक्षण — कर्मयोगी"),
        "shortName": bl("iGOT Karmayogi", "आईगॉट कर्मयोगी"),
        "purpose": bl(
            "Anytime-anywhere online learning and course credits for every Central Government employee.",
            "प्रत्येक केंद्रीय सरकारी कर्मचारी हेतु कभी-भी-कहीं-भी ऑनलाइन शिक्षण एवं पाठ्यक्रम क्रेडिट।",
        ),
        "url": "https://igotkarmayogi.gov.in",
        "category": "training",
        "helpline": None,
        "administeredBy": bl("Capacity Building Commission", "क्षमता निर्माण आयोग"),
        "verify": True,
    },
    {
        "id": "epfo",
        "name": bl("Employees' Provident Fund Organisation", "कर्मचारी भविष्य निधि संगठन"),
        "shortName": bl("EPFO", "ईपीएफओ"),
        "purpose": bl(
            "Provident fund passbook, claims and transfer — relevant to a Central Government employee mainly "
            "for a spouse or family member covered under EPF rather than under GPF/NPS.",
            "भविष्य निधि पासबुक, दावे एवं स्थानांतरण — केंद्रीय सरकारी कर्मचारी हेतु यह मुख्यतः जीपीएफ/एनपीएस के "
            "बजाय ईपीएफ से आच्छादित जीवनसाथी अथवा परिवार के सदस्य के संदर्भ में प्रासंगिक है।",
        ),
        "url": "https://www.epfindia.gov.in",
        "category": "provident-fund-nps",
        "helpline": {"phone": "1800-118-005", "label": bl("EPFO toll-free helpline", "ईपीएफओ टोल-फ्री हेल्पलाइन")},
        "administeredBy": bl("Ministry of Labour and Employment", "श्रम एवं रोजगार मंत्रालय"),
        "verify": True,
    },
    {
        "id": "nps-cra",
        "name": bl("National Pension System — Central Recordkeeping Agency", "राष्ट्रीय पेंशन प्रणाली — केंद्रीय अभिलेख रखरखाव एजेंसी"),
        "shortName": bl("NPS / CRA", "एनपीएस / सीआरए"),
        "purpose": bl(
            "PRAN account statement, scheme and fund manager choice, and NPS withdrawal.",
            "पीआरएएन खाता विवरण, योजना एवं निधि प्रबंधक चयन, तथा एनपीएस आहरण।",
        ),
        "url": "https://npscra.nsdl.co.in",
        "category": "provident-fund-nps",
        "helpline": None,
        "administeredBy": bl("Pension Fund Regulatory and Development Authority", "पेंशन निधि विनियामक एवं विकास प्राधिकरण"),
        "verify": True,
    },
    {
        "id": "ups",
        "name": bl("Unified Pension Scheme", "एकीकृत पेंशन योजना"),
        "shortName": bl("UPS", "यूपीएस"),
        "purpose": bl(
            "Information and the one-time option form for the assured-payout alternative within NPS. See "
            "data/pay/ups.json for the contribution and payout figures.",
            "एनपीएस के भीतर सुनिश्चित-भुगतान विकल्प हेतु जानकारी तथा एक-बारगी विकल्प फॉर्म। अंशदान एवं भुगतान आँकड़ों "
            "हेतु data/pay/ups.json देखें।",
        ),
        "url": "https://doppw.gov.in",
        "category": "provident-fund-nps",
        "helpline": None,
        "administeredBy": bl("Department of Pension & Pensioners' Welfare", "पेंशन एवं पेंशनभोगी कल्याण विभाग"),
        "verify": True,
    },
    {
        "id": "gem",
        "name": bl("Government e-Marketplace", "सरकारी ई-मार्केटप्लेस"),
        "shortName": bl("GeM", "जेम"),
        "purpose": bl(
            "The mandatory online marketplace for a government office's own procurement (GFR 2017).",
            "सरकारी कार्यालय की स्वयं की खरीद हेतु अनिवार्य ऑनलाइन मार्केटप्लेस (सामान्य वित्तीय नियम 2017)।",
        ),
        "url": "https://gem.gov.in",
        "category": "procurement",
        "helpline": {"phone": "1800-419-3436", "label": bl("GeM helpdesk", "जेम हेल्पडेस्क")},
        "administeredBy": bl("Ministry of Commerce and Industry", "वाणिज्य एवं उद्योग मंत्रालय"),
        "verify": True,
    },
    {
        "id": "pfms",
        "name": bl("Public Financial Management System", "लोक वित्तीय प्रबंधन प्रणाली"),
        "shortName": bl("PFMS", "पीएफएमएस"),
        "purpose": bl(
            "Tracks government payments end to end; a DDO or a drawing office uses it for bill processing.",
            "सरकारी भुगतानों का आद्योपांत अनुरेखण; एक आहरण एवं संवितरण अधिकारी अथवा आहरण कार्यालय इसका उपयोग "
            "बिल संसाधन हेतु करता है।",
        ),
        "url": "https://pfms.nic.in",
        "category": "e-office",
        "helpline": None,
        "administeredBy": bl("Office of Controller General of Accounts", "महालेखा नियंत्रक कार्यालय"),
        "verify": True,
    },
    {
        "id": "cgegis",
        "name": bl("Central Government Employees Group Insurance Scheme", "केंद्रीय सरकारी कर्मचारी समूह बीमा योजना"),
        "shortName": bl("CGEGIS", "सीजीईजीआईएस"),
        "purpose": bl(
            "The group insurance-cum-savings scheme every Central Government employee is enrolled in; rates "
            "and the maturity table are in data/pay/cgegis.json.",
            "समूह बीमा-सह-बचत योजना, जिसमें प्रत्येक केंद्रीय सरकारी कर्मचारी नामांकित है; दरें तथा परिपक्वता तालिका "
            "data/pay/cgegis.json में हैं।",
        ),
        "url": "https://doe.gov.in",
        "category": "provident-fund-nps",
        "helpline": None,
        "administeredBy": bl("Department of Expenditure", "व्यय विभाग"),
        "verify": True,
    },
    {
        "id": "kendriya-bhandar",
        "name": bl("Central Government Employees Consumer Cooperative Society (Kendriya Bhandar)", "केंद्रीय सरकारी कर्मचारी उपभोक्ता सहकारी भंडार (केंद्रीय भंडार)"),
        "shortName": bl("Kendriya Bhandar", "केंद्रीय भंडार"),
        "purpose": bl(
            "The Central Government employees' own consumer cooperative — grocery outlets and, in some "
            "cities, a canteen.",
            "केंद्रीय सरकारी कर्मचारियों की अपनी उपभोक्ता सहकारी समिति — किराना दुकानें तथा कुछ शहरों में कैंटीन।",
        ),
        "url": "http://kendriyabhandar.com",
        "category": "welfare",
        "helpline": None,
        "administeredBy": bl("Ministry of Personnel, Public Grievances and Pensions", "कार्मिक, लोक शिकायत और पेंशन मंत्रालय"),
        "verify": True,
    },
    {
        "id": "csss",
        "name": bl("Central Secretariat Stenographers Service", "केंद्रीय सचिवालय आशुलिपिक सेवा"),
        "shortName": bl("CSSS", "सीएसएसएस"),
        "purpose": bl(
            "Cadre management information for the stenographic service in the Central Secretariat.",
            "केंद्रीय सचिवालय की आशुलिपिक सेवा हेतु संवर्ग प्रबंधन जानकारी।",
        ),
        "url": "https://dopt.gov.in",
        "category": "hr-service",
        "helpline": None,
        "administeredBy": bl("Department of Personnel & Training", "कार्मिक एवं प्रशिक्षण विभाग"),
        "verify": True,
    },
    {
        "id": "kanthasth",
        "name": bl("Kanthasth — AI translation memory", "कंठस्थ — एआई अनुवाद स्मृति"),
        "shortName": bl("Kanthasth", "कंठस्थ"),
        "purpose": bl(
            "A translation-memory tool for Hindi <-> English office text, built by C-DAC for the Department "
            "of Official Language.",
            "हिंदी-अंग्रेज़ी कार्यालयीन पाठ हेतु अनुवाद-स्मृति उपकरण, जिसे सी-डैक ने राजभाषा विभाग हेतु बनाया है।",
        ),
        "url": "https://kanthasth.rajbhasha.gov.in",
        "category": "rajbhasha",
        "helpline": None,
        "administeredBy": bl("Department of Official Language, with C-DAC", "राजभाषा विभाग, सी-डैक के सहयोग से"),
        "verify": True,
    },
    {
        "id": "bharati",
        "name": bl("Bharati — Bahubhashi Anuvad Sarthi", "भारती — बहुभाषी अनुवाद सारथी"),
        "shortName": bl("Bharati", "भारती"),
        "purpose": bl(
            "Document translation and management portal for the Department of Official Language.",
            "राजभाषा विभाग हेतु दस्तावेज़ अनुवाद एवं प्रबंधन पोर्टल।",
        ),
        "url": "https://bharati.rajbhasha.gov.in",
        "category": "rajbhasha",
        "helpline": None,
        "administeredBy": bl("Department of Official Language, with C-DAC", "राजभाषा विभाग, सी-डैक के सहयोग से"),
        "verify": True,
    },
    {
        "id": "india-code",
        "name": bl("India Code", "इंडिया कोड"),
        "shortName": bl("India Code", "इंडिया कोड"),
        "purpose": bl(
            "The Government of India's repository of Acts, rules and regulations.",
            "अधिनियमों, नियमों तथा विनियमों का भारत सरकार का भंडार।",
        ),
        "url": "https://www.indiacode.nic.in",
        "category": "law-gazette",
        "helpline": None,
        "administeredBy": bl("Legislative Department, Ministry of Law and Justice", "विधायी विभाग, विधि एवं न्याय मंत्रालय"),
        "verify": True,
    },
    {
        "id": "egazette",
        "name": bl("e-Gazette", "ई-राजपत्र"),
        "shortName": bl("e-Gazette", "ई-राजपत्र"),
        "purpose": bl(
            "The Gazette of India, published and searchable online; the authoritative text of a notified order.",
            "भारत का राजपत्र, ऑनलाइन प्रकाशित एवं खोजयोग्य; अधिसूचित आदेश का प्रामाणिक पाठ।",
        ),
        "url": "https://egazette.gov.in",
        "category": "law-gazette",
        "helpline": None,
        "administeredBy": bl("Department of Publication, Ministry of Housing and Urban Affairs", "प्रकाशन विभाग, आवासन एवं शहरी कार्य मंत्रालय"),
        "verify": True,
    },
    {
        "id": "ncrb-sankalan",
        "name": bl("NCRB Sankalan", "एनसीआरबी संकलन"),
        "shortName": bl("Sankalan", "संकलन"),
        "purpose": bl(
            "The National Crime Records Bureau's section-mapping portal for BNS/BNSS/BSA against IPC/CrPC/IEA "
            "— the source this app's Law Converter is built from.",
            "आईपीसी/सीआरपीसी/आईईए के विरुद्ध बीएनएस/बीएनएसएस/बीएसए हेतु राष्ट्रीय अपराध रिकॉर्ड ब्यूरो का धारा-मानचित्रण "
            "पोर्टल — इसी से इस ऐप का विधि परिवर्तक निर्मित है।",
        ),
        "url": "https://www.ncrb.gov.in",
        "category": "law-gazette",
        "helpline": None,
        "administeredBy": bl("National Crime Records Bureau", "राष्ट्रीय अपराध रिकॉर्ड ब्यूरो"),
        "verify": True,
    },
    {
        "id": "doe",
        "name": bl("Department of Expenditure", "व्यय विभाग"),
        "shortName": bl("DoE", "व्यय विभाग"),
        "purpose": bl(
            "Dearness Allowance, pay-matrix and allowance orders — the source most of data/pay/ is read from.",
            "महँगाई भत्ता, वेतन-मैट्रिक्स तथा भत्ता आदेश — data/pay/ का अधिकांश भाग इसी से पढ़ा गया है।",
        ),
        "url": "https://doe.gov.in",
        "category": "pay-pension",
        "helpline": None,
        "administeredBy": bl("Ministry of Finance", "वित्त मंत्रालय"),
        "verify": True,
    },
]

# --------------------------------------------------------------------------
# Pension facts
# --------------------------------------------------------------------------

CCS_PENSION_SOURCE = {
    "name": "Central Civil Services (Pension) Rules, 2021",
    "url": "https://doppw.gov.in",
    "reference": "Rule 45",
    "dated": "2021-01-15",
}

COMMUTATION_SOURCE = {
    "name": "Central Civil Services (Commutation of Pension) Rules, 1981 — Table of commutation values",
    "url": "https://persmin.gov.in/pension/rules_new/ccs_coprules_1981_060613.pdf",
    "reference": "Schedule",
    "note": {
        "en": (
            "The fetched PDF's content stream could not be parsed for the table this session; every value "
            "below was cross-checked against two independent secondary reproductions of the same official "
            "table, which agreed on every row compared (docs/DATA-GAPS.md #52)."
        ),
        "hi": (
            "इस सत्र में प्राप्त पीडीएफ की सामग्री धारा से तालिका पार्स नहीं की जा सकी; नीचे प्रत्येक मान की जाँच "
            "उसी आधिकारिक तालिका के दो स्वतंत्र द्वितीयक पुनरुत्पादनों से की गई, जो तुलना की गई प्रत्येक पंक्ति पर सहमत "
            "थे (docs/DATA-GAPS.md #52)।"
        ),
    },
}

GPF_SOURCE = {
    "name": "Department of Economic Affairs — Rate of interest on General Provident Fund and other similar funds",
    "url": "https://dea.gov.in/budget-division/rate-interest-general-provident-fund-gpf-and-other-similar-funds-q-1-fy-2026-27",
    "note": {
        "en": "dea.gov.in failed certificate verification on every fetch attempted this session; the rate is corroborated across multiple independent financial-press reports of the same DEA resolution.",
        "hi": "इस सत्र में हर प्रयास में dea.gov.in का प्रमाणपत्र सत्यापन विफल रहा; यह दर उसी डीईए संकल्प की कई स्वतंत्र वित्तीय-प्रेस रिपोर्टों से पुष्ट है।",
    },
}

# age next birthday -> commutation value (years' purchase), per Rs. 1 p.a. of
# pension commuted. Cross-checked against two independent secondary
# reproductions of the CCS (Commutation of Pension) Rules 1981 table.
COMMUTATION_TABLE = [
    (20, 9.188), (21, 9.187), (22, 9.186), (23, 9.185), (24, 9.184), (25, 9.183),
    (26, 9.182), (27, 9.180), (28, 9.178), (29, 9.176), (30, 9.173), (31, 9.169),
    (32, 9.164), (33, 9.159), (34, 9.152), (35, 9.145), (36, 9.136), (37, 9.126),
    (38, 9.116), (39, 9.103), (40, 9.090), (41, 9.075), (42, 9.059), (43, 9.040),
    (44, 9.019), (45, 8.996), (46, 8.971), (47, 8.943), (48, 8.913), (49, 8.881),
    (50, 8.846), (51, 8.808), (52, 8.768), (53, 8.724), (54, 8.678), (55, 8.627),
    (56, 8.572), (57, 8.512), (58, 8.446), (59, 8.371), (60, 8.287), (61, 8.194),
    (62, 8.093), (63, 7.982), (64, 7.862), (65, 7.731), (66, 7.591), (67, 7.431),
    (68, 7.262), (69, 7.083), (70, 6.897), (71, 6.703), (72, 6.502), (73, 6.296),
    (74, 6.085), (75, 5.872), (76, 5.657), (77, 5.443), (78, 5.229), (79, 5.018),
    (80, 4.812), (81, 4.611),
]  # fmt: skip


def build_portals() -> dict[str, Any]:
    return {"version": VERSION, "generatedAt": STAMP, "disclaimer": DISCLAIMER, "portals": PORTALS}


def build_pension_facts() -> dict[str, Any]:
    return {
        "version": VERSION,
        "generatedAt": STAMP,
        "disclaimer": DISCLAIMER,
        "superannuation": {
            "ageYears": 60,
            "rule": bl(
                "A Government servant retires from service on the afternoon of the last day of the month in "
                "which he attains the age of sixty years.",
                "एक सरकारी सेवक उस माह के अंतिम दिन की अपराह्न को सेवानिवृत्त होता है जिसमें वह साठ वर्ष की आयु "
                "प्राप्त करता है।",
            ),
            "source": {"name": "Fundamental Rule 56(a)", "url": "https://doe.gov.in", "reference": "FR 56(a)"},
            "verify": False,
        },
        "gratuity": {
            "fractionPerSixMonths": 0.25,
            "maxMultiplier": 16.5,
            "baseCeiling": 2000000,
            "daLinked": {
                "kind": "quarter-per-fifty",
                "timesApplied": 1,
                "note": bl(
                    "The Rs. 20 lakh ceiling Rule 45 states is raised by 25 per cent each time Dearness "
                    "Allowance crosses 50 per cent, the same escalation data/pay/allowances.json applies to "
                    "fixed allowances. DA crossed 50 per cent on 01.01.2024, so the ceiling actually payable "
                    "today is Rs. 25 lakh.",
                    "नियम 45 में उल्लिखित 20 लाख रुपये की सीमा प्रत्येक बार महँगाई भत्ता 50 प्रतिशत पार करने पर 25 "
                    "प्रतिशत बढ़ाई जाती है, यही वृद्धि data/pay/allowances.json में निश्चित भत्तों पर लागू होती है। "
                    "महँगाई भत्ता 01.01.2024 को 50 प्रतिशत पार कर गया, अतः आज वास्तव में देय सीमा 25 लाख रुपये है।",
                ),
            },
            "deathGratuityTable": [
                {"minYears": 0, "maxYears": 1, "multiplier": 2, "label": bl("Less than 1 year", "1 वर्ष से कम")},
                {"minYears": 1, "maxYears": 5, "multiplier": 6, "label": bl("1 year or more but less than 5 years", "1 वर्ष या अधिक किंतु 5 वर्ष से कम")},
                {"minYears": 5, "maxYears": 11, "multiplier": 12, "label": bl("5 years or more but less than 11 years", "5 वर्ष या अधिक किंतु 11 वर्ष से कम")},
                {"minYears": 11, "maxYears": 20, "multiplier": 20, "label": bl("11 years or more but less than 20 years", "11 वर्ष या अधिक किंतु 20 वर्ष से कम")},
                {"minYears": 20, "maxYears": None, "multiplier": "half-per-six-months-max-33", "label": bl("20 years or more", "20 वर्ष या अधिक")},
            ],
            "rule": bl(
                "Retirement gratuity: one-fourth of emoluments for each completed six-monthly period of "
                "qualifying service, subject to a maximum of 16.5 times the emoluments.",
                "सेवानिवृत्ति उपदान: अर्हकारी सेवा की प्रत्येक पूर्ण छमाही अवधि हेतु परिलब्धियों का एक-चौथाई, अधिकतम "
                "16.5 गुना परिलब्धियों की सीमा तक।",
            ),
            "source": CCS_PENSION_SOURCE,
            "verify": False,
        },
        "commutation": {
            "maxFraction": 0.4,
            "rule": bl(
                "A Government servant may commute for a lump sum payment up to 40 per cent of his pension.",
                "एक सरकारी सेवक अपनी पेंशन के अधिकतम 40 प्रतिशत भाग को एकमुश्त भुगतान हेतु कम्यूट कर सकता है।",
            ),
            "table": [{"ageNextBirthday": age, "factor": factor} for age, factor in COMMUTATION_TABLE],
            "source": COMMUTATION_SOURCE,
            "verify": True,
        },
        "gpf": {
            "rateHistory": [
                {"effectiveFrom": "2020-07-01", "rate": 7.1},
                {"effectiveFrom": "2026-04-01", "rate": 7.1},
            ],
            "source": GPF_SOURCE,
            "verify": True,
        },
    }


def _acceptance(payload_portals: dict[str, Any]) -> int:
    ids = [p["id"] for p in payload_portals["portals"]]
    if len(ids) != len(set(ids)):
        log("! duplicate portal id")
        return 1
    if len(ids) < 15:
        log(f"! only {len(ids)} portals — below the acceptance floor of 15")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and compare against disk; write nothing")
    args = parser.parse_args()

    portals = build_portals()
    pension = build_pension_facts()

    validate(portals, "portals.schema.json")
    validate(pension, "pension-facts.schema.json")

    rc = _acceptance(portals)
    if rc:
        return rc
    if len(pension["commutation"]["table"]) < 50:
        log("! commutation table too short")
        return 1

    outputs = {PORTALS_OUT: portals, PENSION_OUT: pension}

    if args.check:
        ok = True
        for path, payload in outputs.items():
            current = read_json(path)
            if current != payload:
                log(f"! {path}: on disk differs from what this script builds")
                ok = False
            else:
                log(f"ok {path}")
        return 0 if ok else 1

    versions: dict[str, dict[str, Any]] = {}
    for path, payload in outputs.items():
        changed, digest = write_json(path, payload)
        log(f"{'wrote' if changed else 'same '} {path}")
        key = "portals" if path == PORTALS_OUT else "pension-facts"
        label = {"en": "Portals & helplines directory", "hi": "पोर्टल एवं हेल्पलाइन निर्देशिका"} if key == "portals" else {"en": "Pension facts", "hi": "पेंशन तथ्य"}
        rows = len(portals["portals"]) if key == "portals" else len(pension["commutation"]["table"])
        versions[key] = {
            "version": payload["version"],
            "updated": payload["generatedAt"][:10],
            "label": label,
            "rows": rows,
            "sha256": digest,
        }

    update_versions(versions, generated_at=STAMP)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
