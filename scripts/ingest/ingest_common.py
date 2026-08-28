"""Shared plumbing for the Sahayak ingest scripts.

Everything here is deliberately small and dependency-light: fetching with a
named User-Agent and a mirror fallback, archiving the raw bytes before anything
is parsed, section-string normalisation, and deterministic JSON writing.

Determinism matters more than it looks. The weekly cron opens a pull request
only when the JSON actually changed, so any incidental churn — key order, a
timestamp inside a record — would produce a PR every week that a human has to
read and dismiss. Timestamps live in one place per file (``fetchedAt``) and in
``data/_meta/versions.json``, and nowhere else.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import requests

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

INGEST_DIR = Path(__file__).resolve().parent
REPO_ROOT = INGEST_DIR.parent.parent
RAW_DIR = INGEST_DIR / "raw"
REPORT_DIR = INGEST_DIR / "reports"
DATA_DIR = REPO_ROOT / "data"
LAW_DIR = DATA_DIR / "law"
OVERLAY_DIR = LAW_DIR / "overlays"
SCHEMA_DIR = REPO_ROOT / "schemas"
VERSIONS_FILE = DATA_DIR / "_meta" / "versions.json"

# The project names itself in every request it makes. A site operator who wants
# to know who is fetching should be able to find out without guessing.
USER_AGENT = (
    "SahayakIngest/0.2 (Sahayak - offline bilingual reference PWA for Indian "
    "government officers; public-data ingestion; contact via repository issues)"
)


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------


class FetchError(RuntimeError):
    """Every mirror for a document failed."""


class Forbidden(RuntimeError):
    """A source answered 403. Stop; do not retry and do not try a mirror."""


@dataclass(frozen=True)
class Fetched:
    """One retrieved document, plus where it actually came from."""

    url: str
    content: bytes
    mirror_index: int
    fetched_at: str

    @property
    def text(self) -> str:
        # The NCRB pages are UTF-8 with a BOM and no charset header; requests'
        # ISO-8859-1 default would mangle the curly quotes the headings use.
        return self.content.decode("utf-8-sig", errors="replace")

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(
    urls: Sequence[str],
    *,
    timeout: int = 120,
    delay: float = 0.0,
    session: requests.Session | None = None,
    allow_status: Iterable[int] = (200,),
) -> Fetched:
    """Try each URL in order and return the first that answers.

    ``urls`` is a primary followed by mirrors. A 403 aborts immediately rather
    than falling through to the next mirror: a site that has refused us is a
    decision to respect, not an obstacle to route around.
    """
    sess = session or requests.Session()
    failures: list[str] = []

    for index, url in enumerate(urls):
        if delay and index > 0:
            time.sleep(delay)
        try:
            response = sess.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
        except requests.RequestException as exc:  # network-level failure
            failures.append(f"{url} -> {type(exc).__name__}: {exc}")
            continue

        if response.status_code == 403:
            raise Forbidden(f"{url} -> 403 Forbidden. Refusing to retry or try a mirror.")
        if response.status_code not in allow_status:
            failures.append(f"{url} -> HTTP {response.status_code}")
            continue

        return Fetched(url=url, content=response.content, mirror_index=index, fetched_at=utc_now())

    raise FetchError("all sources failed:\n  " + "\n  ".join(failures))


def archive_raw(name: str, fetched: Fetched, *, stamp: str) -> Path:
    """Keep the bytes we parsed, so a later disagreement is settleable.

    ``scripts/ingest/raw/`` is git-ignored apart from its ``.gitkeep`` — this is
    a local forensic trail, not repository content.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{stamp}__{name}"
    path.write_bytes(fetched.content)
    (RAW_DIR / f"{stamp}__{name}.meta.json").write_text(
        json.dumps(
            {
                "url": fetched.url,
                "mirrorIndex": fetched.mirror_index,
                "fetchedAt": fetched.fetched_at,
                "bytes": len(fetched.content),
                "sha256": fetched.sha256,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


# --------------------------------------------------------------------------
# Text and section-number normalisation
# --------------------------------------------------------------------------

_WS = re.compile(r"[\s​ ]+")


def clean_text(value: str) -> str:
    """NFKC, collapse whitespace, normalise the dashes and quotes the source mixes."""
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("–", "-").replace("—", "-").replace("−", "-")
    value = value.replace("“", '"').replace("”", '"').replace("„", '"')
    value = value.replace("‘", "'").replace("’", "'")
    return _WS.sub(" ", value).strip()


_OPEN_PAREN = re.compile(r"\(\s*")
_CLOSE_PAREN = re.compile(r"\s*\)")
_SPACE_BEFORE_PAREN = re.compile(r"(?<=[0-9A-Za-z])\s+\(")
_BETWEEN_PARENS = re.compile(r"\)\s+(?=\()")


def tidy_parens(value: str) -> str:
    r"""``"103 (1)"``, ``"350( 1 )"`` and ``"61(2) (a)"`` all collapse to one form.

    Only whitespace around the brackets of a *reference* is removed, and this is
    applied to the matched reference rather than to a whole cell — a blanket
    ``\s*\)\s*`` substitution would turn the heading "2(f) India" into
    "2(f)India".
    """
    value = _OPEN_PAREN.sub("(", value)
    value = _CLOSE_PAREN.sub(")", value)
    value = _SPACE_BEFORE_PAREN.sub("(", value)
    return _BETWEEN_PARENS.sub(")", value)


def normalise_section(value: str) -> str:
    """Normalise a string that is nothing but a section reference."""
    return tidy_parens(clean_text(value)).strip().rstrip(".").strip()


# A section reference at the head of a cell: a number, an optional letter suffix
# (498A, 65B, 52A), then any number of bracketed sub-parts (61(2)(a), 2(f)).
# Whitespace is tolerated wherever the source puts it and removed afterwards.
SECTION_REF = re.compile(
    r"^(?P<ref>(?P<num>\d{1,4})\s*(?P<alpha>[A-Z]{1,2})?(?:\s*\(\s*[0-9a-zA-Z]{1,4}\s*\))*)"
)


@dataclass(frozen=True)
class SectionRef:
    """A parsed section reference and the heading text that followed it."""

    raw: str
    section: str  # "103(1)" - normalised, sub-parts included
    base: str  # "103"    - what a reader types into a search box
    heading: str  # "Punishment for murder."


def parse_section_ref(text: str) -> SectionRef | None:
    """Pull a section reference out of a table cell.

    Returns ``None`` for chapter rows, markers ("New Section", "Deleted") and
    empty cells - everything the caller must not mistake for a mapping.
    """
    cleaned = clean_text(text)
    if not cleaned:
        return None
    match = SECTION_REF.match(cleaned)
    if not match:
        return None

    section = tidy_parens(match.group("ref")).strip()
    base = match.group("num") + (match.group("alpha") or "")
    heading = cleaned[match.end() :].lstrip(" .-").strip()
    return SectionRef(raw=cleaned, section=section, base=base, heading=heading)


def section_sort_key(section: str) -> tuple[int, str, str]:
    """Order "1", "2", "2(2)", "2(10)", "52A", "103" the way a reader expects."""
    match = re.match(r"^(\d+)([A-Z]*)(.*)$", section)
    if not match:
        return (10**6, "", section)
    parts = re.findall(r"\(([^)]*)\)", match.group(3))
    padded = "".join(p.zfill(4) if p.isdigit() else "~" + p for p in parts)
    return (int(match.group(1)), match.group(2), padded)


# --------------------------------------------------------------------------
# JSON output
# --------------------------------------------------------------------------


def write_json(path: Path, payload: Any) -> tuple[bool, str]:
    """Write pretty, stable, newline-terminated JSON. Returns (changed, sha256)."""
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


def update_versions(entries: dict[str, dict[str, Any]], *, generated_at: str) -> bool:
    """Merge dataset entries into ``data/_meta/versions.json``.

    Only the named datasets are touched; the shell's own entry and anything a
    later session adds are left exactly as they were.
    """
    versions = read_json(VERSIONS_FILE, default={"datasets": {}})
    versions.setdefault("datasets", {})
    before = json.dumps(versions, ensure_ascii=False, sort_keys=True)
    versions["generatedAt"] = generated_at[:10]
    for key, entry in entries.items():
        versions["datasets"][key] = entry
    if before == json.dumps(versions, ensure_ascii=False, sort_keys=True):
        return False
    write_json(VERSIONS_FILE, versions)
    return True


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
        "  " + ("/".join(str(p) for p in e.absolute_path) or "<root>") + ": " + e.message for e in errors[:20]
    ]
    more = f"\n  ... and {len(errors) - 20} more" if len(errors) > 20 else ""
    raise ValueError(f"{schema_name} validation failed ({len(errors)} errors):\n" + "\n".join(lines) + more)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
