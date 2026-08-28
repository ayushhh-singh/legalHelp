"""Tests for the drafting seed.

Run with the rest of the ingest suite:

    scripts/ingest/.venv/bin/python -m unittest discover -s scripts/ingest -t scripts/ingest

The Vitest side reads the committed JSON and checks what it says. This side
checks the thing that produces it — in particular that ``self_check`` actually
rejects the malformed templates it claims to, since every one of those failures
would otherwise reach an officer as a ``{{signatoryName}}`` in a signed
document.
"""

from __future__ import annotations

import copy
import unittest

import drafting_seed as seed
from ingest_common import DATA_DIR, read_json


def a_template() -> dict:
    """A deep copy of the Office Memorandum, to be broken in peace."""
    return copy.deepcopy(next(t for t in seed.TEMPLATES if t["id"] == "office-memorandum"))


class SelfCheck(unittest.TestCase):
    def test_the_committed_templates_pass(self) -> None:
        self.assertEqual(seed.self_check(seed.TEMPLATES), [])

    def test_rejects_a_placeholder_with_no_field(self) -> None:
        broken = a_template()
        broken["layout"]["en"].append({"role": "footer", "lines": ["Signed by {{whoever}}"]})
        problems = seed.self_check([broken])
        self.assertTrue(any("unknown field(s) ['whoever']" in p for p in problems), problems)

    def test_rejects_layouts_that_place_different_blocks(self) -> None:
        broken = a_template()
        broken["layout"]["hi"] = broken["layout"]["hi"][:-1]
        problems = seed.self_check([broken])
        self.assertTrue(any("different blocks" in p for p in problems), problems)

    def test_rejects_a_source_that_is_not_a_list_field(self) -> None:
        broken = a_template()
        broken["layout"]["en"][0]["source"] = "subject"
        broken["layout"]["hi"][0]["source"] = "subject"
        problems = seed.self_check([broken])
        self.assertTrue(any("not a list or paras field" in p for p in problems), problems)

    def test_rejects_a_checklist_rule_naming_a_field_that_does_not_exist(self) -> None:
        broken = a_template()
        broken["checklist"][0]["rule"] = {"kind": "required", "field": "nonesuch"}
        problems = seed.self_check([broken])
        self.assertTrue(any("unknown field(s) ['nonesuch']" in p for p in problems), problems)

    def test_rejects_a_required_field_with_an_empty_sample(self) -> None:
        broken = a_template()
        field = next(f for f in broken["fields"] if f["id"] == "subject")
        field["sample"] = {"en": "", "hi": ""}
        problems = seed.self_check([broken])
        self.assertEqual(2, sum("empty" in p for p in problems), problems)

    def test_rejects_a_select_sample_that_is_not_one_of_its_options(self) -> None:
        broken = a_template()
        field = next(f for f in broken["fields"] if f["id"] == "urgency")
        field["sample"] = {"en": "quite urgent", "hi": "quite urgent"}
        problems = seed.self_check([broken])
        self.assertTrue(any("is not one of" in p for p in problems), problems)

    def test_rejects_a_duplicate_template_id(self) -> None:
        problems = seed.self_check([a_template(), a_template()])
        self.assertTrue(any("duplicate template id" in p for p in problems), problems)

    def test_rejects_a_chassis_that_names_no_template(self) -> None:
        broken = a_template()
        broken["csmopRef"]["chassis"] = "telegram"
        problems = seed.self_check([broken])
        self.assertTrue(any("chassis 'telegram'" in p for p in problems), problems)

    def test_rejects_a_phrase_pointed_at_a_template_that_does_not_exist(self) -> None:
        # self_check reads PHRASES; narrowing the template list is enough to
        # make every real phrase target unknown.
        problems = seed.self_check([a_template()])
        self.assertTrue(any("appliesTo names unknown template(s)" in p for p in problems), problems)


class Build(unittest.TestCase):
    def setUp(self) -> None:
        self.files = seed.build()

    def test_writes_one_file_per_template_plus_three(self) -> None:
        self.assertEqual(len(seed.TEMPLATES) + 3, len(self.files))
        self.assertEqual(14, len(seed.TEMPLATES))

    def test_the_index_lists_every_template_and_nothing_else(self) -> None:
        index = {entry["id"] for entry in self.files["drafting/index.json"]["templates"]}
        self.assertEqual({t["id"] for t in seed.TEMPLATES}, index)

    def test_the_internal_group_key_never_reaches_the_data(self) -> None:
        for relative, payload in self.files.items():
            self.assertNotIn("_group", str(payload), relative)

    def test_is_deterministic(self) -> None:
        # A second run with nothing changed must produce identical bytes, or
        # `--check` reports a diff on a tree nobody touched.
        self.assertEqual(self.files, seed.build())

    def test_matches_what_is_on_disk(self) -> None:
        for relative, payload in self.files.items():
            with self.subTest(relative):
                self.assertEqual(payload, read_json(DATA_DIR / relative))

    def test_every_dataset_it_writes_is_in_the_validator_manifest(self) -> None:
        import validate_data

        for relative in self.files:
            self.assertIn(relative, validate_data.MANIFEST)

    def test_ids_are_unique(self) -> None:
        for records, key in ((seed.TERMS, "terms"), (seed.PHRASES, "phrases")):
            ids = [record["id"] for record in records]
            self.assertEqual(len(ids), len(set(ids)), key)


class Content(unittest.TestCase):
    def test_every_record_carries_a_source_and_a_fetched_at(self) -> None:
        records = list(seed.TERMS) + list(seed.PHRASES) + list(seed.TEMPLATES)
        for record in records:
            with self.subTest(record["id"]):
                self.assertIn("source", record)
                self.assertTrue(record["source"]["url"].startswith("https://"))
                self.assertEqual(seed.STAMP, record["fetchedAt"])
                self.assertIsInstance(record["verify"], bool)

    def test_an_unverified_record_cites_the_manual_and_a_paragraph(self) -> None:
        for term in seed.TERMS:
            if not term["verify"]:
                with self.subTest(term["id"]):
                    self.assertIn("darpg.gov.in", term["source"]["url"])
                    self.assertIn("csmopRef", term)

    def test_the_manuals_own_hindi_wins_over_the_expected_translation(self) -> None:
        by_id = {term["id"]: term for term in seed.TERMS}
        # CSMOP 2022 prints these; the common renderings are aliases, not the
        # primary form. Both were read off the rendered Hindi pages.
        self.assertEqual("परम अग्रता", by_id["top-priority"]["hi"])
        self.assertIn("सर्वोच्च अग्रता", by_id["top-priority"]["alsoHi"])
        self.assertEqual("अर्ध-सरकारी पत्र", by_id["demi-official-letter"]["hi"])
        self.assertIn("अर्ध-शासकीय पत्र", by_id["demi-official-letter"]["alsoHi"])
        self.assertEqual("अंतर-विभागीय टिप्पणी", by_id["id-note"]["hi"])
        self.assertIn("अशासकीय टिप्पणी", by_id["id-note"]["alsoHi"])

    def test_every_phrase_keeps_the_same_slots_in_both_languages(self) -> None:
        import re

        slots = lambda text: sorted(re.findall(r"\{([a-zA-Z]+)\}", text))  # noqa: E731
        for phrase in seed.PHRASES:
            with self.subTest(phrase["id"]):
                self.assertEqual(slots(phrase["text"]["en"]), slots(phrase["text"]["hi"]))


if __name__ == "__main__":
    unittest.main()
