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
    "drafting/structure-terms.json": "drafting-terms.schema.json",
    "drafting/phrases.json": "drafting-phrases.schema.json",
    "drafting/index.json": "drafting-index.schema.json",
    "drafting/templates/circular.json": "drafting-template.schema.json",
    "drafting/templates/demi-official.json": "drafting-template.schema.json",
    "drafting/templates/endorsement.json": "drafting-template.schema.json",
    "drafting/templates/id-note.json": "drafting-template.schema.json",
    "drafting/templates/leave-application.json": "drafting-template.schema.json",
    "drafting/templates/letter.json": "drafting-template.schema.json",
    "drafting/templates/notification.json": "drafting-template.schema.json",
    "drafting/templates/noting.json": "drafting-template.schema.json",
    "drafting/templates/office-memorandum.json": "drafting-template.schema.json",
    "drafting/templates/representation.json": "drafting-template.schema.json",
    "drafting/templates/rti-reply.json": "drafting-template.schema.json",
    "drafting/templates/show-cause-reply.json": "drafting-template.schema.json",
    "drafting/templates/ta-bill-cover.json": "drafting-template.schema.json",
    "drafting/templates/tour-programme.json": "drafting-template.schema.json",
    "rules/index.json": "rules-index.schema.json",
    "rules/text/ccs-cca.json": "rules-text.schema.json",
    "rules/text/ccs-conduct.json": "rules-text.schema.json",
    "rules/text/ccs-leave.json": "rules-text.schema.json",
    "rules/text/ccs-pension.json": "rules-text.schema.json",
    "rules/text/csmop.json": "rules-text.schema.json",
    "rules/text/fr-sr.json": "rules-text.schema.json",
    "rules/text/gfr.json": "rules-text.schema.json",
    "rules/text/ol-act.json": "rules-text.schema.json",
    "rules/text/ol-rules.json": "rules-text.schema.json",
    "rules/text/osa.json": "rules-text.schema.json",
    "rules/text/posh.json": "rules-text.schema.json",
    "rules/text/rti.json": "rules-text.schema.json",
    "rules/cards/ccs-cca.json": "rules-cards.schema.json",
    "rules/cards/ccs-conduct.json": "rules-cards.schema.json",
    "rules/cards/ccs-leave.json": "rules-cards.schema.json",
    "rules/cards/ccs-pension.json": "rules-cards.schema.json",
    "rules/cards/csmop.json": "rules-cards.schema.json",
    "rules/cards/fr-sr.json": "rules-cards.schema.json",
    "rules/cards/gfr.json": "rules-cards.schema.json",
    "rules/cards/ol-act.json": "rules-cards.schema.json",
    "rules/cards/ol-rules.json": "rules-cards.schema.json",
    "rules/cards/osa.json": "rules-cards.schema.json",
    "rules/cards/posh.json": "rules-cards.schema.json",
    "rules/cards/rti.json": "rules-cards.schema.json",
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
