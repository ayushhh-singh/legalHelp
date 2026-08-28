"""Shared plumbing for the Sahayak rules-authoring pipeline.

``scripts/ingest/`` turns public *portals* into datasets on a schedule. This
directory turns public *documents* — the rule books an officer is examined on —
into rule text, cards, and questions, and it is never on a cron: a rule book
changes when a Ministry amends it, and an amendment is a reading job.

Three things live here rather than in ``ingest_common``:

* **The act registry.** One table naming every rule book, where its English and
  (where one exists) Hindi issue is published, and how its rules are numbered.
  ``fetch_sources.py``, ``extract_rules.py``, ``make_cards.py`` and
  ``SOURCES.md`` all read this one table, so a new act is one entry.

* **A CA bundle that completes the chain.** Several Government of India hosts
  serve a Let's Encrypt certificate from the new ``gen-Y`` hierarchy and either
  omit the intermediate (``documents.doptcirculars.nic.in``) or chain to a root
  (``ISRG Root YR``) that is newer than the ``certifi`` bundle shipped with our
  pinned ``requests``. Both are *incomplete-chain* problems, not invalid
  certificates, so the fix is to supply the missing links — fetched from
  ``letsencrypt.org`` over a connection that verifies against the roots we
  already trust, with ``ISRG Root YR`` taken in its **cross-signed-by-X1** form
  so nothing is trusted that does not chain to an existing anchor. Verification
  stays on everywhere; ``verify=False`` appears nowhere in this directory and a
  test asserts that.

* **PDF text extraction with a stated reader.** Every extraction records which
  reader produced it (``pymupdf`` or ``pdfplumber``) and how many characters it
  found, because "the text layer is unusable" is a fact about a document that
  has to survive into the report — CSMOP's Hindi issue is the standing example
  (docs/DATA-GAPS.md #36).

NO part of this pipeline calls a language-model API, paid or free. The questions
in ``scripts/authoring/authored/`` were written in-session by Claude Code and
committed as data; ``test_authoring.py`` asserts that no module here so much as
names an inference endpoint.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import requests

AUTHORING_DIR = Path(__file__).resolve().parent
REPO_ROOT = AUTHORING_DIR.parent.parent
SOURCES_DIR = AUTHORING_DIR / "sources"
TERMS_DIR = AUTHORING_DIR / "terms"
AUTHORED_DIR = AUTHORING_DIR / "authored"
REVIEW_DIR = AUTHORING_DIR / "review"
DATA_DIR = REPO_ROOT / "data"
RULES_DIR = DATA_DIR / "rules"
RULES_TEXT_DIR = RULES_DIR / "text"
RULES_CARDS_DIR = RULES_DIR / "cards"
SCHEMA_DIR = REPO_ROOT / "schemas"
REPORTS_DIR = REPO_ROOT / "docs" / "authoring-reports"

USER_AGENT = (
    "SahayakAuthoring/0.1 (Sahayak - offline bilingual reference PWA for Indian "
    "government officers; public-rulebook ingestion; contact via repository issues)"
)

DISCLAIMER = {
    "en": "Reference only; verify with the official gazette/order or your DDO.",
    "hi": "केवल संदर्भ के लिए; आधिकारिक राजपत्र/आदेश अथवा अपने डीडीओ से सत्यापित करें।",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# The act registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Document:
    """One published file (or web page) for one act, in one language."""

    lang: str  # "en" | "hi"
    title: str
    urls: tuple[str, ...]  # primary first, then mirrors
    filename: str
    kind: str = "pdf"  # "pdf" | "html"
    note: str = ""


@dataclass(frozen=True)
class Act:
    """A rule book: how it is published, and how its rules are numbered."""

    id: str
    name_en: str
    name_hi: str
    short_en: str
    short_hi: str
    unit_en: str  # "Rule" | "Section" | "Paragraph"
    unit_hi: str
    publisher: str
    landing_url: str
    documents: tuple[Document, ...]
    # Where the operative text starts, so contents pages and forewords are not
    # read as rules. A regex matched against a whole extracted page.
    body_starts: str | None = None
    # Rule numbers the document uses that are NOT rules (schedules, forms).
    max_rule: int | None = None
    note: str = ""
    tags: tuple[str, ...] = ()


ACTS: tuple[Act, ...] = (
    Act(
        id="ccs-conduct",
        name_en="Central Civil Services (Conduct) Rules, 1964",
        name_hi="केंद्रीय सिविल सेवा (आचरण) नियम, 1964",
        short_en="CCS (Conduct) Rules",
        short_hi="सीसीएस (आचरण) नियम",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Personnel and Training",
        landing_url="https://dopt.gov.in/download/acts",
        max_rule=25,
        documents=(
            Document(
                lang="en",
                title="CCS (Conduct) Rules, 1964 — updated as on 27 February 2015",
                urls=("https://dopt.gov.in/sites/default/files/CCS_Conduct_Rules_1964_Updated_27Feb15_0.pdf",),
                filename="ccs-conduct-en.pdf",
            ),
            Document(
                lang="hi",
                title="केंद्रीय सिविल सेवा (आचरण) नियम, 1964 — पूर्ण हिंदी संस्करण",
                urls=("https://dopt.gov.in/sites/default/files/ccs_conduct_rules_1964_details_Hindi_complete.pdf",),
                filename="ccs-conduct-hi.pdf",
            ),
        ),
    ),
    Act(
        id="ccs-cca",
        name_en="Central Civil Services (Classification, Control and Appeal) Rules, 1965",
        name_hi="केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965",
        short_en="CCS (CCA) Rules",
        short_hi="सीसीएस (सीसीए) नियम",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Personnel and Training",
        landing_url="https://dopt.gov.in/download/acts",
        max_rule=34,
        documents=(
            Document(
                lang="en",
                title="CCS (CCA) Rules, 1965 — consolidated",
                urls=("https://dopt.gov.in/sites/default/files/CCS-CCA-Rules-FINAL.pdf",),
                filename="ccs-cca-en.pdf",
            ),
            Document(
                lang="hi",
                title="केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 — हिंदी",
                urls=("https://dopt.gov.in/sites/default/files/CCS%28CCA%29RulesInHindi.pdf",),
                filename="ccs-cca-hi.pdf",
            ),
        ),
    ),
    Act(
        id="ccs-leave",
        name_en="Central Civil Services (Leave) Rules, 1972",
        name_hi="केंद्रीय सिविल सेवा (छुट्टी) नियम, 1972",
        short_en="CCS (Leave) Rules",
        short_hi="सीसीएस (छुट्टी) नियम",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Personnel and Training",
        landing_url="https://dopt.gov.in/acts/central-civil-services-leave-rules-0",
        max_rule=100,
        documents=(
            Document(
                lang="en",
                title="CCS (Leave) Rules, 1972 — updated as on 24 September 2024",
                urls=(
                    "https://documents.doptcirculars.nic.in/D2/D02est/updatedccsleaverulesN9ExV.pdf",
                ),
                filename="ccs-leave-en.pdf",
                note="The DoPT landing page's own link (…ruleMsnzh.pdf) now 404s; this is the "
                "current consolidation the same host serves.",
            ),
        ),
    ),
    Act(
        id="ccs-pension",
        name_en="Central Civil Services (Pension) Rules, 2021",
        name_hi="केंद्रीय सिविल सेवा (पेंशन) नियम, 2021",
        short_en="CCS (Pension) Rules",
        short_hi="सीसीएस (पेंशन) नियम",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Pension and Pensioners' Welfare",
        landing_url="https://pensionersportal.gov.in/PensionRules3.aspx",
        max_rule=100,
        documents=(
            Document(
                lang="en",
                title="CCS (Pension) Rules, 2021 — gazette notification, English",
                urls=(
                    "https://pensionersportal.gov.in/Document/CCS-Pension-Rules%202021-English.pdf",
                    "https://documents.doptcirculars.nic.in/D3/D03ppw/CCS-Pension-Rules%202021-EnglishiPqOH.pdf",
                ),
                filename="ccs-pension-en.pdf",
            ),
        ),
    ),
    Act(
        id="gfr",
        name_en="General Financial Rules, 2017",
        name_hi="सामान्य वित्तीय नियम, 2017",
        short_en="GFR 2017",
        short_hi="जीएफआर 2017",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Expenditure, Ministry of Finance",
        landing_url="https://doe.gov.in/order-circular/general-financial-rules-2017",
        max_rule=350,
        documents=(
            Document(
                lang="en",
                title="General Financial Rules 2017 — updated up to 31 January 2026",
                urls=("https://doe.gov.in/files/circulars_document/GFRupdatedupto31012026.pdf",),
                filename="gfr-en.pdf",
            ),
        ),
    ),
    Act(
        id="rti",
        name_en="Right to Information Act, 2005",
        name_hi="सूचना का अधिकार अधिनियम, 2005",
        short_en="RTI Act",
        short_hi="आरटीआई अधिनियम",
        unit_en="Section",
        unit_hi="धारा",
        publisher="Department of Personnel and Training",
        landing_url="https://dopt.gov.in/download/acts",
        max_rule=31,
        documents=(
            Document(
                lang="en",
                title="Right to Information Act, 2005 — updated as on 18 November 2025",
                urls=(
                    "https://dopt.gov.in/sites/default/files/RTI%20Act%202005%20%28updated%20as%20on%2018-11-2025%29.pdf",
                ),
                filename="rti-en.pdf",
            ),
            Document(
                lang="hi",
                title="सूचना का अधिकार अधिनियम, 2005 — अद्यतन हिंदी पाठ",
                urls=("https://dopt.gov.in/sites/default/files/RTI%20Act%202005%20Updated-HINDI.pdf",),
                filename="rti-hi.pdf",
            ),
        ),
    ),
    Act(
        id="osa",
        name_en="Official Secrets Act, 1923",
        name_hi="शासकीय गुप्त बात अधिनियम, 1923",
        short_en="OSA 1923",
        short_hi="ओएसए 1923",
        unit_en="Section",
        unit_hi="धारा",
        publisher="Ministry of Home Affairs",
        landing_url="https://www.mha.gov.in/",
        max_rule=16,
        documents=(
            Document(
                lang="en",
                title="The Official Secrets Act, 1923",
                urls=("https://www.mha.gov.in/sites/default/files/Official_Secret_Act1923_2.pdf",),
                filename="osa-en.pdf",
            ),
        ),
    ),
    Act(
        id="posh",
        name_en=(
            "Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013"
        ),
        name_hi=(
            "कार्यस्थल पर महिलाओं का लैंगिक उत्पीड़न (निवारण, प्रतिषेध और प्रतितोष) अधिनियम, 2013"
        ),
        short_en="PoSH Act 2013",
        short_hi="पॉश अधिनियम 2013",
        unit_en="Section",
        unit_hi="धारा",
        publisher="Ministry of Women and Child Development",
        landing_url="https://wcd.gov.in/documents/legislations",
        max_rule=30,
        documents=(
            Document(
                lang="en",
                title="The Sexual Harassment of Women at Workplace Act, 2013",
                urls=(
                    "https://www.indiacode.nic.in/bitstream/123456789/2104/1/A2013-14.pdf",
                    "https://wcd.gov.in/documents/uploaded/1710219823.pdf",
                ),
                filename="posh-en.pdf",
                note="India Code first: the MWCD copy is a scan of the gazette and its OCR reads "
                "'(1)' as '(/)' and 'Committee' as 'Committec'. India Code publishes a digitally "
                "typeset text layer with all thirty sections intact. India Code is fetched by hand "
                "and never on a cron (ADR-012); this script is hand-run.",
            ),
            Document(
                lang="en",
                title="Sexual Harassment of Women at Workplace Rules, 2013",
                urls=("https://wcd.gov.in/documents/uploaded/1719914401_2NUqe91gql.pdf",),
                filename="posh-rules-en.pdf",
                note="Companion rules. Read for context; not itself split into rule records.",
            ),
            Document(
                lang="en",
                title="Handbook on the Sexual Harassment of Women at Workplace Act, 2013",
                urls=("https://wcd.gov.in/documents/uploaded/1716181382_9zygfnpOoU.pdf",),
                filename="posh-handbook-en.pdf",
                note="MWCD handbook — the training text the ISTM guidebook cross-refers to. "
                "Read for context; not itself split into rule records.",
            ),
        ),
    ),
    Act(
        id="ol-act",
        name_en="Official Languages Act, 1963",
        name_hi="राजभाषा अधिनियम, 1963",
        short_en="OL Act 1963",
        short_hi="राजभाषा अधिनियम",
        unit_en="Section",
        unit_hi="धारा",
        publisher="Department of Official Language, Ministry of Home Affairs",
        landing_url="https://rajbhasha.gov.in/en/official-languages-act-1963",
        max_rule=10,
        documents=(
            Document(
                lang="en",
                title="The Official Languages Act, 1963 (as amended, 1967)",
                urls=("https://rajbhasha.gov.in/sites/default/files/rajbhasha_act_1963e.pdf",),
                filename="ol-act-en.pdf",
            ),
            Document(
                lang="hi",
                title="राजभाषा अधिनियम, 1963 (यथासंशोधित, 1967)",
                urls=("https://rajbhasha.gov.in/sites/default/files/rajbhasha_act_1963h.pdf",),
                filename="ol-act-hi.pdf",
            ),
        ),
    ),
    Act(
        id="ol-rules",
        name_en="Official Languages (Use for Official Purposes of the Union) Rules, 1976",
        name_hi="राजभाषा (संघ के शासकीय प्रयोजनों के लिए प्रयोग) नियम, 1976",
        short_en="OL Rules 1976",
        short_hi="राजभाषा नियम 1976",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Official Language, Ministry of Home Affairs",
        landing_url="https://rajbhasha.gov.in/en/official-language-rules-1976",
        max_rule=12,
        documents=(
            Document(
                lang="en",
                title="Official Languages Rules, 1976 (as amended 1987, 2007, 2011)",
                urls=("https://rajbhasha.gov.in/en/official-language-rules-1976",),
                filename="ol-rules-en.html",
                kind="html",
                note="The Department publishes these rules as a web page, not a PDF.",
            ),
        ),
    ),
    Act(
        id="fr-sr",
        name_en="Fundamental Rules and Supplementary Rules",
        name_hi="मूल नियम और अनुपूरक नियम",
        short_en="FR & SR",
        short_hi="एफआर एवं एसआर",
        unit_en="Rule",
        unit_hi="नियम",
        publisher="Department of Personnel and Training",
        landing_url="https://dopt.gov.in/download/acts",
        max_rule=130,
        documents=(
            Document(
                lang="en",
                title="Compilation of Fundamental Rules and Supplementary Rules — English",
                urls=("https://dopt.gov.in/sites/default/files/Compilation_FR_SR_English_2.pdf",),
                filename="fr-sr-en.pdf",
            ),
            Document(
                lang="hi",
                title="मूल नियम और अनुपूरक नियम संकलन — हिंदी",
                urls=("https://dopt.gov.in/sites/default/files/Compilation_FR_SR_Hindi.pdf",),
                filename="fr-sr-hi.pdf",
                note="40 KB — a covering note, not the compilation. Kept so the gap is visible.",
            ),
            Document(
                lang="en",
                title="Fundamental Rules 52, 53 and 54 — English",
                urls=("https://dopt.gov.in/sites/default/files/FR_525354_E_0.pdf",),
                filename="fr-525354-en.pdf",
                note="Read for context; the compilation above is what is split into rules.",
            ),
        ),
    ),
    Act(
        id="csmop",
        name_en="Central Secretariat Manual of Office Procedure, 2022",
        name_hi="केंद्रीय सचिवालय कार्यालय प्रक्रिया नियमावली, 2022",
        short_en="CSMOP 2022",
        short_hi="सीएसएमओपी 2022",
        unit_en="Paragraph",
        unit_hi="पैरा",
        publisher="Department of Administrative Reforms and Public Grievances",
        landing_url="https://www.darpg.gov.in/",
        max_rule=140,
        note="The Hindi issue's text layer is scrambled by a legacy font (DATA-GAPS #36); "
        "its Hindi is read off rendered pages, never extracted.",
        documents=(
            Document(
                lang="en",
                title="Central Secretariat Manual of Office Procedure, 2022 (16th edition) — English",
                urls=("https://www.darpg.gov.in/static/uploads/2025/10/774e0b8f427b7875158363d842fa431f.pdf",),
                filename="csmop-en.pdf",
            ),
            Document(
                lang="hi",
                title="केंद्रीय सचिवालय कार्यालय प्रक्रिया नियमावली, 2022 (16वाँ संस्करण) — हिंदी",
                urls=("https://www.darpg.gov.in/static/uploads/2025/10/8b5d6eb6c7c47bc69e271e25f1c2cc43.pdf",),
                filename="csmop-hi.pdf",
                note="Text layer unusable — see the act note.",
            ),
        ),
    ),
)

ACTS_BY_ID: dict[str, Act] = {act.id: act for act in ACTS}

# Acts that are extracted into rule records. The remaining registry entries are
# fetched and cited but not split — either because the document is a companion
# (PoSH Rules, the handbook) or because its text layer cannot be trusted (the
# Hindi CSMOP).
EXTRACTED_ACT_IDS: tuple[str, ...] = tuple(act.id for act in ACTS)


# ---------------------------------------------------------------------------
# TLS: completing the chain, never bypassing it
# ---------------------------------------------------------------------------

# Let's Encrypt's "gen-Y" hierarchy. ``root-yr-by-x1`` is ISRG Root YR
# cross-signed by ISRG Root X1, which certifi already trusts — so adding it
# introduces no new trust anchor that does not chain to an existing one. The
# intermediates are here because some hosts do not send theirs.
LE_CHAIN_URLS: tuple[str, ...] = (
    "https://letsencrypt.org/certs/gen-y/root-yr-by-x1.pem",
    "https://letsencrypt.org/certs/gen-y/root-ye-by-x2.pem",
    "https://letsencrypt.org/certs/gen-y/int-yr1.pem",
    "https://letsencrypt.org/certs/gen-y/int-yr2.pem",
    "https://letsencrypt.org/certs/gen-y/int-yr3.pem",
    "https://letsencrypt.org/certs/gen-y/int-ye1.pem",
    "https://letsencrypt.org/certs/gen-y/int-ye2.pem",
    "https://letsencrypt.org/certs/gen-y/int-ye3.pem",
)

CA_BUNDLE = SOURCES_DIR / "_ca-bundle.pem"


def build_ca_bundle(*, session: requests.Session | None = None, force: bool = False) -> Path:
    """certifi's roots plus the Let's Encrypt gen-Y chain, as one PEM file.

    Every certificate here is fetched from ``letsencrypt.org`` over a connection
    that verifies against certifi alone. If that fetch fails we return certifi
    unchanged rather than weakening anything — the affected hosts then fail with
    a TLS error, which is the correct outcome and is reported as such.
    """
    import certifi

    if CA_BUNDLE.exists() and not force:
        return CA_BUNDLE

    sess = session or requests.Session()
    parts = [Path(certifi.where()).read_text(encoding="utf-8")]
    for url in LE_CHAIN_URLS:
        try:
            response = sess.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        except requests.RequestException as exc:
            log(f"  ! CA chain: {url} -> {type(exc).__name__}; using certifi alone")
            return Path(certifi.where())
        if response.status_code != 200 or "BEGIN CERTIFICATE" not in response.text:
            log(f"  ! CA chain: {url} -> HTTP {response.status_code}; using certifi alone")
            return Path(certifi.where())
        parts.append(response.text)

    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    CA_BUNDLE.write_text("\n".join(parts), encoding="utf-8")
    return CA_BUNDLE


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


class FetchError(RuntimeError):
    """Every URL for a document failed."""


class Forbidden(RuntimeError):
    """A source answered 403. Stop; do not retry and do not try a mirror."""


@dataclass(frozen=True)
class Fetched:
    url: str
    content: bytes
    fetched_at: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


# India Code is fetched by hand, one document at a time, and never on a cron
# (CLAUDE.md; ADR-012). ``indiacode_seed.py`` rate-limits itself to one request
# every three seconds against that host and this does the same, so the two
# hand-run scripts cannot differ in how politely they behave.
RATE_LIMITED_HOSTS: dict[str, float] = {
    "indiacode.nic.in": 3.0,
    "indiacode.gov.in": 3.0,
}


def _rate_limit(url: str, sleep: Any = None) -> None:
    import time

    host = url.split("/")[2] if "//" in url else ""
    for suffix, seconds in RATE_LIMITED_HOSTS.items():
        if host.endswith(suffix):
            (sleep or time.sleep)(seconds)
            return


def fetch(
    urls: Sequence[str],
    *,
    ca_bundle: Path,
    timeout: int = 180,
    attempts: int = 3,
    session: requests.Session | None = None,
) -> Fetched:
    """Try each URL in order with retries; the first that answers wins.

    Same three rules as ``ingest_common.fetch``: a 403 aborts everything, a
    non-403 4xx is an answer and is not retried, and a 5xx or a network failure
    is weather and is.
    """
    sess = session or requests.Session()
    failures: list[str] = []

    for url in urls:
        _rate_limit(url)
        for attempt in range(1, attempts + 1):
            try:
                response = sess.get(
                    url, headers={"User-Agent": USER_AGENT}, timeout=timeout, verify=str(ca_bundle)
                )
            except requests.RequestException as exc:
                failures.append(f"{url} (attempt {attempt}) -> {type(exc).__name__}: {exc}")
                if attempt < attempts:
                    continue
                break

            if response.status_code == 403:
                raise Forbidden(f"{url} -> 403 Forbidden. Refusing to retry or try a mirror.")
            if response.status_code != 200:
                failures.append(f"{url} (attempt {attempt}) -> HTTP {response.status_code}")
                if response.status_code >= 500 and attempt < attempts:
                    continue
                break

            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and len(response.content) != int(declared):
                failures.append(f"{url} -> truncated: {len(response.content)} of {declared} bytes")
                if attempt < attempts:
                    continue
                break

            return Fetched(url=url, content=response.content, fetched_at=utc_now())

    raise FetchError("all sources failed:\n  " + "\n  ".join(failures))


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

_WS = re.compile(r"[\s​ ]+")

# Devanagari, its digits, and the danda. Used to decide whether a Hindi text
# layer is real text or a legacy-font byte soup.
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def clean_text(value: str) -> str:
    """NFC, collapse whitespace, normalise the dashes and quotes the sources mix.

    NFC rather than the ingest's NFKC: NFKC decomposes some Devanagari
    presentation forms and, worse, folds the Devanagari digits ०-९ into ASCII,
    which would silently rewrite a Hindi rule that cites नियम ११ as "11".
    """
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("–", "-").replace("—", "-").replace("−", "-")
    value = value.replace("“", '"').replace("”", '"').replace("„", '"')
    value = value.replace("‘", "'").replace("’", "'")
    return _WS.sub(" ", value).strip()


def devanagari_ratio(value: str) -> float:
    """Share of the letters that are Devanagari. 0.0 for an empty string."""
    letters = [c for c in value if c.isalpha()]
    if not letters:
        return 0.0
    return len(_DEVANAGARI.findall("".join(letters))) / len(letters)


def normalise_rule_number(value: str) -> str:
    """``"11 A"``, ``"11-A"`` and ``"11A."`` all become ``"11A"``.

    Sub-rules keep their brackets and their case: ``3(1)(i)`` stays as it is,
    because the sub-clause is lower-case and the suffix is upper — the same
    split ``normaliseSectionRef`` preserves on the law side.
    """
    value = clean_text(value).rstrip(". ").strip()
    value = re.sub(r"^(\d+)\s*[-– ]\s*([A-Z]{1,2})\b", r"\1\2", value)
    value = re.sub(r"\s*\(\s*", "(", value)
    value = re.sub(r"\s*\)\s*", ")", value)
    return value.strip()


def rule_sort_key(number: str) -> tuple[int, str, str]:
    """Order "1", "2", "2(2)", "2(10)", "11A", "103" the way a reader expects."""
    match = re.match(r"^(\d+)([A-Z]*)(.*)$", number)
    if not match:
        return (10**6, "", number)
    parts = re.findall(r"\(([^)]*)\)", match.group(3))
    padded = "".join(p.zfill(4) if p.isdigit() else "~" + p for p in parts)
    return (int(match.group(1)), match.group(2), padded)


# ---------------------------------------------------------------------------
# PDF and HTML reading
# ---------------------------------------------------------------------------


@dataclass
class Extraction:
    """Pages of text, plus which reader produced them."""

    reader: str
    pages: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.pages)

    @property
    def characters(self) -> int:
        return sum(len(p) for p in self.pages)


def read_pdf(path: Path, *, reader: str = "pymupdf") -> Extraction:
    """Extract a PDF's text layer, page by page, with the reader named.

    ``pymupdf`` is the default because it keeps Devanagari conjuncts together
    where ``pdfplumber`` sometimes reorders the matra; ``pdfplumber`` is the
    fallback and the second opinion, exactly as in ``ncrb_sankalan.py``.
    """
    if reader == "pymupdf":
        import fitz

        with fitz.open(path) as doc:
            return Extraction(reader="pymupdf", pages=[page.get_text("text") for page in doc])
    if reader == "pdfplumber":
        import pdfplumber

        with pdfplumber.open(path) as doc:
            return Extraction(
                reader="pdfplumber", pages=[(page.extract_text() or "") for page in doc.pages]
            )
    raise ValueError(f"unknown reader: {reader}")


_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"<(script|style)\b.*?</\1>", re.S | re.I)


def read_html(path: Path) -> Extraction:
    """The visible text of a saved page, with ordered lists **numbered**.

    The Department of Official Language publishes the 1976 Rules as an HTML
    page whose rule numbers exist only as ``<ol>`` markers — the browser draws
    them and the document text does not contain them. Stripping tags therefore
    produced a rule book with no rule numbers in it at all, and the parser found
    nothing. So the list markers are reconstructed here: a top-level ``<ol>``
    numbers ``1.``, ``2.``; one nested inside it numbers ``(1)``, ``(2)``; below
    that, ``(a)``, ``(b)`` — which is exactly how the Gazette prints them.
    """
    from bs4 import BeautifulSoup, NavigableString, Tag

    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    for junk in soup(["script", "style", "nav", "header", "footer"]):
        junk.decompose()

    def roman(index: int) -> str:
        numerals = ((10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"))
        out, left = "", index
        for value, glyph in numerals:
            while left >= value:
                out += glyph
                left -= value
        return out

    def marker(list_type: str | None, depth: int, index: int) -> str:
        """The marker the Gazette would print, from the list's own ``type``.

        The page tags its levels ``type="1"``, ``type="a"``, ``type="i"``, which
        is more reliable than counting depth — this document's nesting is
        irregular (see below), so depth is only the fallback.
        """
        style = list_type or ("1" if depth == 0 else "a" if depth == 1 else "i")
        if style == "1":
            return f"{index}."
        if style in {"a", "A"}:
            letter = chr(ord("a") + (index - 1) % 26)
            return f"({letter.upper() if style == 'A' else letter})"
        if style in {"i", "I"}:
            numeral = roman(index)
            return f"({numeral.upper() if style == 'I' else numeral})"
        return f"({index})"

    lines: list[str] = []

    def walk(node: Any, depth: int) -> None:
        if isinstance(node, NavigableString):
            text = clean_text(str(node))
            if text:
                lines.append(text)
            return
        if not isinstance(node, Tag):
            return
        if node.name == "ol":
            # The children are walked in document order rather than via
            # ``find_all("li")``, because this page's markup is malformed in a
            # way that matters: a nested ``<ol>`` is a **sibling** of the
            # ``<li>`` it belongs under, not a child of it. Collecting only the
            # ``<li>`` children therefore produced twelve rule headings with
            # every sub-rule missing — a rule book that looked complete and
            # contained none of its content.
            list_type = node.get("type")
            index = 0
            for child in node.children:
                if isinstance(child, Tag) and child.name == "li":
                    index += 1
                    lines.append(f"\n{marker(list_type, depth, index)} ")
                    walk_children(child, depth + 1)
                    lines.append("\n")
                else:
                    walk(child, depth + 1)
            return
        if node.name in {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul"}:
            lines.append("\n")
        walk_children(node, depth)
        if node.name in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}:
            lines.append("\n")

    def walk_children(node: Tag, depth: int) -> None:
        for child in node.children:
            walk(child, depth)

    body = soup.body or soup
    walk_children(body, 0)

    joined = re.sub(r"[ \t]+", " ", "".join(lines))
    joined = re.sub(r"\n\s*\n+", "\n", joined)
    kept = [line.strip() for line in joined.split("\n")]
    return Extraction(reader="html", pages=["\n".join(line for line in kept if line)])


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------


def write_json(path: Path, payload: Any) -> tuple[bool, str]:
    """Pretty, stable, newline-terminated JSON. Returns (changed, sha256).

    Byte-identical to ``ingest_common.write_json`` on purpose: everything under
    ``data/`` has one formatter, and ``data/rules`` joins ``data/law``,
    ``data/pay`` and ``data/drafting`` in ``.prettierignore`` for that reason.
    """
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    encoded = text.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    changed = not path.exists() or path.read_bytes() != encoded
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encoded)
    return changed, digest


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def validate(payload: Any, schema_name: str) -> None:
    """Validate against ``schemas/<name>``; raise with a readable path on failure."""
    import jsonschema

    schema = read_json(SCHEMA_DIR / schema_name)
    if schema is None:
        raise FileNotFoundError(f"missing schema: {SCHEMA_DIR / schema_name}")
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
    if not errors:
        return
    lines = [
        "  " + ("/".join(str(p) for p in e.absolute_path) or "<root>") + ": " + e.message
        for e in errors[:20]
    ]
    more = f"\n  ... and {len(errors) - 20} more" if len(errors) > 20 else ""
    raise ValueError(f"{schema_name} validation failed ({len(errors)} errors):\n" + "\n".join(lines) + more)


def source_of(act: Act, lang: str = "en") -> dict[str, Any]:
    """The `{ name, url }` every record in `/data` has to carry."""
    doc = next((d for d in act.documents if d.lang == lang), act.documents[0])
    return {"name": f"{act.publisher} — {doc.title}", "url": doc.urls[0]}


def iter_documents() -> Iterable[tuple[Act, Document]]:
    for act in ACTS:
        for document in act.documents:
            yield act, document
