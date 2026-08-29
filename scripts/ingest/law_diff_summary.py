#!/usr/bin/env python3
"""Summarise a law refresh for the weekly pull request body: how many
sections were added, changed or deleted, per code.

    scripts/ingest/.venv/bin/python scripts/ingest/law_diff_summary.py <out.md>

Compares the WORKING TREE's `data/law/{bns,bnss,bsa}.json` — what
`ncrb_sankalan.py` just wrote — against the same files as committed at
`HEAD`, i.e. before this run. Run this after the ingest and before the
commit `.github/workflows/ingest-law.yml`'s `create-pull-request` step makes.

Purely descriptive: nothing here decides whether the refresh is correct, and
nothing here is validated against a schema — `ncrb_sankalan.py` already did
that before writing. `strip_volatile` (the same function
`write_if_content_changed` uses to decide whether a re-run actually changed
anything) is what keeps a section that only got a fresh `fetchedAt` out of
the "changed" column; without it, this table would say "358 changed" on
every single run, which tells a reviewer nothing a byte count doesn't
already.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import LAW_DIR, REPO_ROOT, section_sort_key, strip_volatile  # noqa: E402

CODES = ["bns", "bnss", "bsa"]
MAX_LISTED = 20


def committed_json(path: Path) -> dict[str, Any] | None:
    """The file's content as committed at HEAD, or None if it did not exist there."""
    rel = path.relative_to(REPO_ROOT)
    result = subprocess.run(
        ["git", "show", f"HEAD:{rel.as_posix()}"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=False,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def _diff_sections(old: dict[str, Any] | None, new: dict[str, Any] | None) -> dict[str, list[str]]:
    """The pure core: which section numbers were added, changed or removed.

    Takes the two already-parsed payloads (or ``None`` for "did not exist")
    rather than paths, so it needs no filesystem and no ``git`` to test.
    """
    old_sections: dict[str, Any] = (old or {}).get("sections", {})
    new_sections: dict[str, Any] = (new or {}).get("sections", {})

    added = sorted(set(new_sections) - set(old_sections), key=section_sort_key)
    removed = sorted(set(old_sections) - set(new_sections), key=section_sort_key)
    changed = sorted(
        (
            key
            for key in set(old_sections) & set(new_sections)
            if strip_volatile(old_sections[key]) != strip_volatile(new_sections[key])
        ),
        key=section_sort_key,
    )
    return {"added": added, "changed": changed, "removed": removed}


def summarise_code(code: str) -> dict[str, Any]:
    path = LAW_DIR / f"{code}.json"
    old = committed_json(path)
    new = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    return {"code": code, **_diff_sections(old, new)}


def _listed(sections: list[str]) -> str:
    shown = ", ".join(sections[:MAX_LISTED])
    more = f" (+{len(sections) - MAX_LISTED} more)" if len(sections) > MAX_LISTED else ""
    return shown + more


def render(summaries: list[dict[str, Any]]) -> str:
    total = sum(len(s["added"]) + len(s["changed"]) + len(s["removed"]) for s in summaries)
    if total == 0:
        return "No section-level changes — every code's sections are byte-identical to what is committed."

    lines = ["| Code | Added | Changed | Deleted |", "| --- | ---: | ---: | ---: |"]
    for s in summaries:
        lines.append(f"| {s['code'].upper()} | {len(s['added'])} | {len(s['changed'])} | {len(s['removed'])} |")

    detail: list[str] = []
    for s in summaries:
        parts = []
        if s["added"]:
            parts.append(f"added {_listed(s['added'])}")
        if s["changed"]:
            parts.append(f"changed {_listed(s['changed'])}")
        if s["removed"]:
            parts.append(f"**deleted** {_listed(s['removed'])}")
        if parts:
            detail.append(f"- **{s['code'].upper()}**: " + "; ".join(parts))

    return "\n".join(lines) + "\n\n" + "\n".join(detail)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: law_diff_summary.py <out.md>", file=sys.stderr)
        return 2

    summaries = [summarise_code(code) for code in CODES]
    Path(sys.argv[1]).write_text(render(summaries) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
