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
from typing import Any, Callable, Iterable, Sequence

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


# NCRB's server drops connections part-way through the larger documents often
# enough to have done it on the first attempt at the BSA PDF. One dropped
# connection must not be the difference between a weekly refresh and silence.
ATTEMPTS_PER_URL = 3
RETRY_BACKOFF_SECONDS = 2.0


def _is_retryable(status: int) -> bool:
    """5xx and 429 are "come back later". Everything else is an answer."""
    return status >= 500 or status == 429


def fetch(
    urls: Sequence[str],
    *,
    timeout: int = 120,
    delay: float = 0.0,
    session: requests.Session | None = None,
    allow_status: Iterable[int] = (200,),
    attempts: int = ATTEMPTS_PER_URL,
    sleep: Callable[[float], None] = time.sleep,
) -> Fetched:
    """Try each URL in order, with retries, and return the first that answers.

    ``urls`` is a primary followed by mirrors. Three things are deliberate:

    * A **403 aborts everything** - no retry, no mirror. A site that has refused
      us is a decision to respect, not an obstacle to route around.
    * A **4xx other than 403 is not retried** either. It is an answer, and asking
      again more slowly will not change it.
    * A **network-level failure or a 5xx is retried** with a linear backoff,
      because those are the ones that are about the weather rather than about us.

    A truncated body is caught here too: ``requests`` raises
    ``ChunkedEncodingError`` when the connection dies mid-body, and where the
    server sent a ``Content-Length`` the received size is checked against it. A
    short read that parsed would be far worse than one that failed.
    """
    sess = session or requests.Session()
    failures: list[str] = []

    for index, url in enumerate(urls):
        if delay and index > 0:
            sleep(delay)

        for attempt in range(1, attempts + 1):
            try:
                response = sess.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
            except requests.RequestException as exc:  # network-level failure
                failures.append(f"{url} (attempt {attempt}) -> {type(exc).__name__}: {exc}")
                if attempt < attempts:
                    sleep(RETRY_BACKOFF_SECONDS * attempt)
                    continue
                break

            if response.status_code == 403:
                raise Forbidden(f"{url} -> 403 Forbidden. Refusing to retry or try a mirror.")

            if response.status_code not in allow_status:
                failures.append(f"{url} (attempt {attempt}) -> HTTP {response.status_code}")
                if _is_retryable(response.status_code) and attempt < attempts:
                    sleep(RETRY_BACKOFF_SECONDS * attempt)
                    continue
                break

            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and len(response.content) != int(declared):
                failures.append(
                    f"{url} (attempt {attempt}) -> truncated: {len(response.content)} of {declared} bytes"
                )
                if attempt < attempts:
                    sleep(RETRY_BACKOFF_SECONDS * attempt)
                    continue
                break

            return Fetched(url=url, content=response.content, mirror_index=index, fetched_at=utc_now())

    raise FetchError("all sources failed:\n  " + "\n  ".join(failures))


# How many archived copies of each document to keep. Each full run stores about
# 5 MB, so an unpruned raw/ on a developer machine passes 100 MB within a month
# of iterating on the parser. Three is enough to compare "before", "after" and
# "the one that broke it"; CI checks out fresh and never accumulates at all.
RAW_GENERATIONS = 3


def prune_raw(name: str, keep: int = RAW_GENERATIONS) -> list[Path]:
    """Drop all but the newest ``keep`` archived copies of one document."""
    copies = sorted(RAW_DIR.glob(f"*__{name}"))
    removed: list[Path] = []
    for stale in copies[: max(0, len(copies) - keep)]:
        stale.with_suffix(stale.suffix + ".meta.json").unlink(missing_ok=True)
        stale.unlink(missing_ok=True)
        removed.append(stale)
    return removed


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
    prune_raw(name)
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
#
# The `(?![a-z])` on the suffix is load-bearing. Several rows read
# "151 Arrest to prevent commission of cognizable offences." - without it the
# "A" of "Arrest" is read as a suffix and the reference becomes "151A", a
# section that does not exist. A real suffix is followed by a full stop, a
# bracket, or the end of the reference; never by lower-case letters.
SECTION_REF = re.compile(
    r"^(?P<ref>(?P<num>\d{1,4})\s*(?P<alpha>[A-Z]{1,2}(?![a-z]))?(?:\s*\(\s*[0-9a-zA-Z]{1,4}\s*\))*)"
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

    section = tidy_parens(re.sub(r"\s+", "", match.group("ref")))
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


# Keys whose value changes on every run regardless of whether the data did:
# when we fetched, how many bytes came back, and the digest of a document NCRB
# may have re-uploaded byte-for-differently with identical content.
VOLATILE_KEYS = frozenset({"fetchedAt", "generatedAt", "sha256", "bytes", "updated"})


def strip_volatile(value: Any, keys: frozenset[str] = VOLATILE_KEYS) -> Any:
    """A copy with the run-stamp fields removed, at any depth."""
    if isinstance(value, dict):
        return {k: strip_volatile(v, keys) for k, v in value.items() if k not in keys}
    if isinstance(value, list):
        return [strip_volatile(item, keys) for item in value]
    return value


def write_if_content_changed(path: Path, payload: Any) -> tuple[bool, str]:
    """Write only when something other than the run stamps has changed.

    Every run produces a new ``fetchedAt`` and a fresh sha256 of the fetched
    HTML, so a naive comparison says "changed" every single week. The cron would
    then open a pull request every week that reads "1,059 sections, all
    identical, new timestamp", and a reviewer who sees that fifty times stops
    reading the fifty-first — which is the one that matters.

    So the existing file wins when the data is the same: its timestamps stay,
    nothing is written, and the workflow's `git diff` finds nothing to open a
    pull request about.
    """
    existing = read_json(path)
    if existing is not None and strip_volatile(existing) == strip_volatile(payload):
        encoded = path.read_bytes()
        return False, hashlib.sha256(encoded).hexdigest()
    return write_json(path, payload)


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

    for key, entry in entries.items():
        versions["datasets"][key] = entry

    if json.dumps(versions, ensure_ascii=False, sort_keys=True) == before:
        return False

    # Only now. `generatedAt` used to be stamped before the comparison, so a run
    # on a later date changed the file even when every dataset was identical --
    # and the weekly cron would have opened a pull request every single week
    # containing nothing but a new date. A reviewer who dismisses fifty of those
    # is not reading the fifty-first.
    versions["generatedAt"] = generated_at[:10]
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
