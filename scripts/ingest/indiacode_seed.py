#!/usr/bin/env python3
"""One-off India Code seed for authoritative section text, English and Hindi.

India Code (https://indiacode.gov.in) is the Legislative Department's official
repository of central Acts. Its ``robots.txt`` on the legacy DSpace host allows
``/handle`` and ``/bitstream`` and disallows ``/discover`` and ``/simple-search``;
CLAUDE.md is stricter still and says to fetch manually, one-off, and never on a
cron. This script is therefore **not** wired into ``.github/workflows/ingest-law.yml``.
It is run by hand, it writes only ``data/law/overlays/indiacode-seed.json``, and
the weekly NCRB refresh merges that overlay without ever regenerating it.

Politeness is not optional here and is not configurable:

  * one request every 3 seconds, wall-clock, including redirects;
  * a User-Agent that names the project so an operator can identify us;
  * a hard stop on the first 403 - no retry, no mirror, no backing off and
    trying again. A refusal is an answer.
  * ``/discover`` and ``/simple-search`` are never requested, matching robots.txt.

Two ways to give it work:

  --urls scripts/ingest/indiacode_urls.json
      The manual path the brief describes. Assemble the section URLs by
      browsing India Code yourself and list them in that file. This is the
      path to use.

  --discover
      Best-effort: find each Sanhita's Act page from India Code's own listing
      and follow it to the sections. Kept because it makes the manual list
      easier to assemble when the site is up, not because it is trusted.

Coverage - what was requested, what came back, and what has Hindi - is written
to ``scripts/ingest/reports/indiacode-coverage.json`` either way, including when
nothing came back at all.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import (  # noqa: E402
    OVERLAY_DIR,
    REPORT_DIR,
    USER_AGENT,
    Forbidden,
    clean_text,
    log,
    normalise_section,
    read_json,
    utc_now,
    write_json,
)

HOSTS = [
    "https://indiacode.gov.in",
    "https://www.indiacode.nic.in",
]

RATE_LIMIT_SECONDS = 3.0
DISALLOWED = ("/discover", "/simple-search")

DEVANAGARI = re.compile(r"[ऀ-ॿ]")

ACT_TITLES = {
    "BNS": "The Bharatiya Nyaya Sanhita, 2023",
    "BNSS": "The Bharatiya Nagarik Suraksha Sanhita, 2023",
    "BSA": "The Bharatiya Sakshya Adhiniyam, 2023",
}


def is_spa_shell(html: str) -> bool:
    """True for a single-page-app shell: markup, but no content until JS runs.

    India Code was rebuilt as an Angular application. Its HTML response is a
    stylesheet and a mount point - fewer than a handful of links, none of them
    an Act. Parsing it yields an empty result that looks like "this Act is not
    on India Code", which is a different and much worse answer than "this page
    cannot be read without a browser".
    """
    soup = BeautifulSoup(html, "lxml")
    if soup.find("app-root") is not None:
        return True
    links = [a for a in soup.find_all("a", href=True) if clean_text(a.get_text(" ", strip=True))]
    body = soup.find("body")
    text = clean_text(body.get_text(" ", strip=True)) if body else ""
    return len(links) < 3 and len(text) < 400


class RateLimiter:
    """One request every ``RATE_LIMIT_SECONDS``, measured from the last request."""

    def __init__(self, seconds: float = RATE_LIMIT_SECONDS) -> None:
        self.seconds = seconds
        self._last = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last
        if self._last and elapsed < self.seconds:
            time.sleep(self.seconds - elapsed)
        self._last = time.monotonic()


class Client:
    """A deliberately slow, deliberately loud HTTP client."""

    def __init__(self, *, timeout: int = 45) -> None:
        self.session = requests.Session()
        self.limiter = RateLimiter()
        self.timeout = timeout
        self.requests_made = 0
        self.failures: list[dict[str, Any]] = []

    def get(self, url: str) -> str | None:
        if any(part in url for part in DISALLOWED):
            raise ValueError(f"robots.txt disallows this path: {url}")

        self.limiter.wait()
        self.requests_made += 1
        try:
            response = self.session.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=self.timeout, allow_redirects=True
            )
        except requests.RequestException as exc:
            self.failures.append({"url": url, "error": f"{type(exc).__name__}: {exc}"})
            log(f"    {type(exc).__name__}: {url}")
            return None

        if response.status_code == 403:
            raise Forbidden(
                f"India Code answered 403 for {url}. Stopping: a refusal is an answer, not a rate to tune."
            )
        if response.status_code != 200:
            self.failures.append({"url": url, "error": f"HTTP {response.status_code}"})
            log(f"    HTTP {response.status_code}: {url}")
            return None

        # Two ways this host answers 200 with nothing usable, both of which have
        # to be recorded as failures rather than parsed into an empty result.
        if "Site Migration" in response.text and len(response.text) < 4000:
            self.failures.append({"url": url, "error": "migration placeholder, no content"})
            log(f"    migration placeholder: {url}")
            return None

        if is_spa_shell(response.text):
            self.failures.append(
                {
                    "url": url,
                    "error": "client-rendered shell: the page carries no content without executing JavaScript",
                }
            )
            log(f"    client-rendered shell (no server-side content): {url}")
            return None

        return response.text


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def extract_section(html: str) -> dict[str, str] | None:
    """Pull the section heading and body out of an India Code section page.

    India Code renders a section as a heading followed by the provision text.
    The markup has changed more than once, so this reads the densest text block
    rather than trusting one class name, and returns None when nothing plausible
    is found instead of returning a page chrome fragment.
    """
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    candidates: list[str] = []
    for selector in ("#content", ".act-section", ".section-content", "main", "article", "body"):
        node = soup.select_one(selector)
        if node is None:
            continue
        text = clean_text(node.get_text("\n", strip=True))
        if len(text) > 120:
            candidates.append(text)
    if not candidates:
        return None

    text = min(candidates, key=len)
    heading = text.split("\n", 1)[0][:200]
    return {"heading": heading, "text": text}


def has_hindi(value: str) -> bool:
    return bool(DEVANAGARI.search(value))


# --------------------------------------------------------------------------
# Discovery (best effort)
# --------------------------------------------------------------------------


def discover_act_pages(client: Client) -> dict[str, str]:
    """Find each Sanhita's page on India Code by matching its title on a listing page."""
    from rapidfuzz import fuzz

    found: dict[str, str] = {}
    for host in HOSTS:
        html = client.get(f"{host}/")
        if not html:
            continue
        soup = BeautifulSoup(html, "lxml")
        for anchor in soup.find_all("a", href=True):
            label = clean_text(anchor.get_text(" ", strip=True))
            if len(label) < 12:
                continue
            for act, title in ACT_TITLES.items():
                if act in found:
                    continue
                if fuzz.partial_ratio(label.lower(), title.lower()) >= 92:
                    href = anchor["href"]
                    found[act] = href if href.startswith("http") else host.rstrip("/") + "/" + href.lstrip("/")
        if len(found) == len(ACT_TITLES):
            break
    return found


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def load_targets(path: Path) -> list[dict[str, Any]]:
    payload = read_json(path)
    if payload is None:
        raise FileNotFoundError(f"no such URL list: {path}")
    targets = payload.get("targets") or []
    for target in targets:
        target["section"] = normalise_section(str(target["section"]))
    return targets


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--urls",
        type=Path,
        default=Path(__file__).resolve().parent / "indiacode_urls.json",
        help="JSON file listing the sections to seed and the URL(s) for each",
    )
    parser.add_argument("--discover", action="store_true", help="try to locate the Act pages automatically first")
    parser.add_argument("--limit", type=int, default=0, help="stop after N sections (for a trial run)")
    args = parser.parse_args(argv)

    targets = load_targets(args.urls)
    if args.limit:
        targets = targets[: args.limit]
    log(f"India Code seed: {len(targets)} sections requested, one request every {RATE_LIMIT_SECONDS:.0f}s")

    client = Client()
    discovered: dict[str, str] = {}
    stopped_early: str | None = None

    try:
        if args.discover:
            log("discovery: looking for the three Sanhitas on India Code")
            discovered = discover_act_pages(client)
            log(f"  found {len(discovered)}: {', '.join(sorted(discovered)) or 'none'}")

        seeded: dict[str, dict[str, dict[str, Any]]] = {}
        results: list[dict[str, Any]] = []

        for target in targets:
            act, section = target["act"], target["section"]
            urls = [u for u in (target.get("urls") or []) if u]
            if not urls and discovered.get(act):
                urls = [discovered[act]]
            if not urls:
                results.append({"act": act, "section": section, "status": "no-url"})
                continue

            record: dict[str, Any] | None = None
            for url in urls:
                html = client.get(url)
                if not html:
                    continue
                extracted = extract_section(html)
                if extracted:
                    record = {**extracted, "url": url}
                    break

            if record is None:
                results.append({"act": act, "section": section, "status": "unreachable"})
                continue

            language = "hi" if has_hindi(record["text"]) else "en"
            seeded.setdefault(act, {})[section] = {
                "text": {language: record["text"]},
                "sourceUrl": record["url"],
            }
            results.append({"act": act, "section": section, "status": "ok", "language": language})

    except Forbidden as exc:
        stopped_early = str(exc)
        log(f"STOP: {exc}")
        seeded = locals().get("seeded") or {}
        results = locals().get("results") or []

    ok = [r for r in results if r["status"] == "ok"]
    with_hindi = [r for r in ok if r.get("language") == "hi"]
    coverage = {
        "generatedAt": utc_now(),
        "requested": len(targets),
        "fetched": len(ok),
        "withHindi": len(with_hindi),
        "requestsMade": client.requests_made,
        "rateLimitSeconds": RATE_LIMIT_SECONDS,
        "stoppedEarly": stopped_early,
        "hostsTried": HOSTS,
        "failures": client.failures[:40],
        "failureCount": len(client.failures),
        "results": results,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "indiacode-coverage.json", coverage)
    log(f"coverage: {len(ok)}/{len(targets)} fetched, {len(with_hindi)} with Hindi")

    if not seeded:
        log("nothing fetched; leaving data/law/overlays/indiacode-seed.json untouched")
        return 0

    overlay_path = OVERLAY_DIR / "indiacode-seed.json"
    existing = read_json(overlay_path) or {}
    overlay = {
        "$comment": (
            "Authoritative section text seeded from India Code by scripts/ingest/indiacode_seed.py. "
            "Run by hand, never on a cron: India Code's robots.txt restricts crawling and CLAUDE.md forbids "
            "scheduling it. The weekly NCRB refresh merges this file and never rewrites it."
        ),
        "id": "indiacode-seed",
        "provenance": {
            "kind": "official",
            "source": "India Code (Legislative Department, Ministry of Law and Justice)",
            "seededOn": utc_now()[:10],
            "official": True,
        },
        "sourceRef": "indiacode",
        "sourceDefinition": {
            "id": "indiacode",
            "name": {
                "en": "India Code — Legislative Department, Ministry of Law and Justice",
                "hi": "इंडिया कोड — विधायी विभाग, विधि एवं न्याय मंत्रालय",
            },
            "url": "https://indiacode.gov.in",
            "fetchedAt": utc_now(),
        },
        "actSections": {
            act: {section: {"text": entry["text"]} for section, entry in sorted(sections.items())}
            for act, sections in seeded.items()
        },
        "sourceUrls": {
            act: {section: entry["sourceUrl"] for section, entry in sorted(sections.items())}
            for act, sections in seeded.items()
        },
    }
    if existing == overlay:
        log("overlay unchanged")
        return 0
    write_json(overlay_path, overlay)
    log(f"wrote {overlay_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
