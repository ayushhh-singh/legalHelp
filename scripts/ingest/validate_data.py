#!/usr/bin/env python3
"""Validate every hand-authored dataset in ``/data`` against its JSON Schema.

The generated datasets validate themselves as they are written — the law ingest
and ``pay_matrix.py`` both call ``ingest_common.validate`` before touching disk.
The pay reference tables are authored by hand, so this is where they get the
same treatment. Run it before every commit that touches ``data/pay``:

    scripts/ingest/.venv/bin/python scripts/ingest/validate_data.py

It reaches the network for nothing and writes nothing. A file listed in
``MANIFEST`` that does not exist is a failure, not a skip: a dataset that
silently stops being validated is worse than one that was never validated.
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


def main() -> int:
    failures = 0
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

    log(
        f"{len(MANIFEST) - failures}/{len(MANIFEST)} datasets valid"
        + ("" if failures == 0 else f" — {failures} failed")
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
