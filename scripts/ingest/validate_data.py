#!/usr/bin/env python3
"""Validate every hand-authored dataset in ``/data`` against its JSON Schema.

The generated datasets validate themselves as they are written — the law ingest
and ``pay_matrix.py`` both call ``ingest_common.validate`` before touching disk.
The pay reference tables are authored by hand, so this is where they get the
same treatment. Run it before every commit that touches ``data/pay``:

    scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py

It reaches the network for nothing and writes nothing.

Two failures, both deliberate, both about datasets going unwatched:

* A file listed in ``MANIFEST`` that does not exist is a failure, not a skip.
* A JSON file under ``data/`` that is in neither ``MANIFEST`` nor ``NO_SCHEMA``
  is a failure too. Adding a dataset and forgetting to add it here would
  otherwise leave it validated by nothing at all, and the run would still say
  everything is fine.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_common import DATA_DIR, log, read_json, validate  # noqa: E402

MANIFEST: dict[str, str] = {
    "law/bns.json": "law-mapping.schema.json",
    "law/bnss.json": "law-mapping.schema.json",
    "law/bsa.json": "law-mapping.schema.json",
    "law/index.json": "law-index.schema.json",
    "pay/matrix.json": "pay-matrix.schema.json",
    "pay/da-history.json": "pay-da-history.schema.json",
    "pay/cities.json": "pay-cities.schema.json",
    "pay/allowances.json": "pay-allowances.schema.json",
    "pay/jobs.json": "pay-jobs.schema.json",
    "pay/cghs.json": "pay-scheme.schema.json",
    "pay/cgegis.json": "pay-scheme.schema.json",
    "pay/nps.json": "pay-scheme.schema.json",
    "pay/ups.json": "pay-scheme.schema.json",
    "pay/tax.json": "pay-tax.schema.json",
    "pay/cpc8.json": "pay-cpc8.schema.json",
}

# Files under data/ that legitimately have no schema, each with the reason.
# A file that is in neither this set nor MANIFEST fails the run.
NO_SCHEMA: dict[str, str] = {
    "_meta/versions.json": "dataset metadata, not a dataset; its shape is asserted in tests/pay-data.test.ts and tests/law-data.test.ts",
    "law/overlays/bns-hindi-curated.json": "hand-curated overlay merged by ncrb_sankalan.py, which validates the merged result against law-mapping.schema.json",
    "law/overlays/traps-and-transitional.json": "hand-curated overlay merged by ncrb_sankalan.py, which validates the merged result",
}


def unlisted() -> list[str]:
    """Every JSON under data/ that nothing in this file accounts for."""
    known = set(MANIFEST) | set(NO_SCHEMA)
    found = {str(path.relative_to(DATA_DIR)) for path in DATA_DIR.rglob("*.json")}
    return sorted(found - known)


def main() -> int:
    failures = 0

    for relative in unlisted():
        log(f"  ! data/{relative}: not in MANIFEST and not in NO_SCHEMA — add it to one")
        failures += 1

    for relative, schema_name in MANIFEST.items():
        path = DATA_DIR / relative
        if not path.exists():
            log(f"  ! data/{relative}: missing")
            failures += 1
            continue
        try:
            validate(read_json(path), schema_name)
        except Exception as error:  # noqa: BLE001 - the message is the report
            log(f"  ! data/{relative}\n{error}")
            failures += 1
        else:
            log(f"  ok data/{relative} ({schema_name})")

    for relative, why in NO_SCHEMA.items():
        log(f"  -- data/{relative}: no schema ({why})")

    log(
        f"{len(MANIFEST)} datasets checked, {len(NO_SCHEMA)} deliberately unschemaed"
        + ("" if failures == 0 else f" — {failures} failed")
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
