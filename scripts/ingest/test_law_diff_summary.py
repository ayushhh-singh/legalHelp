"""Tests for ``law_diff_summary.py``.

``committed_json`` is the one function that touches ``git`` (via
``git show HEAD:<path>``); everything else is pure and is tested directly
against constructed section dicts, the same split ``pay_orders.py``'s tests
use between the network-touching ``check_*`` functions and the pure parsing.
"""

from __future__ import annotations

import unittest

import law_diff_summary as lds


def section(num: str, en: str) -> dict:
    return {"section": num, "heading": {"en": en, "hi": ""}, "fetchedAt": "2026-08-28T00:00:00Z"}


class SummariseCode(unittest.TestCase):
    def test_no_change_reports_nothing_in_any_column(self):
        old = {"sections": {"1": section("1", "Murder")}}
        new = {"sections": {"1": section("1", "Murder")}}
        result = lds._diff_sections(old, new)  # the pure core, tested directly
        self.assertEqual(result, {"added": [], "changed": [], "removed": []})

    def test_a_fresh_fetchedat_alone_is_not_a_change(self):
        old = {"sections": {"1": section("1", "Murder")}}
        new = {"sections": {"1": {**section("1", "Murder"), "fetchedAt": "2026-09-01T00:00:00Z"}}}
        result = lds._diff_sections(old, new)
        self.assertEqual(result["changed"], [])

    def test_added_changed_and_removed_are_all_detected(self):
        old = {"sections": {"1": section("1", "Murder"), "2": section("2", "Punishment for murder")}}
        new = {
            "sections": {
                "1": section("1", "Murder (amended)"),
                "3": section("3", "New provision"),
            }
        }
        result = lds._diff_sections(old, new)
        self.assertEqual(result["added"], ["3"])
        self.assertEqual(result["changed"], ["1"])
        self.assertEqual(result["removed"], ["2"])

    def test_sections_are_ordered_the_way_a_reader_expects(self):
        old = {"sections": {}}
        new = {"sections": {"10": section("10", "x"), "2": section("2", "y"), "52A": section("52A", "z")}}
        result = lds._diff_sections(old, new)
        self.assertEqual(result["added"], ["2", "10", "52A"])

    def test_a_missing_committed_file_treats_every_section_as_added(self):
        result = lds._diff_sections(None, {"sections": {"1": section("1", "Murder")}})
        self.assertEqual(result["added"], ["1"])


class Render(unittest.TestCase):
    def test_no_changes_at_all_says_so_in_one_line(self):
        text = lds.render([{"code": "bns", "added": [], "changed": [], "removed": []}])
        self.assertIn("byte-identical", text)

    def test_a_table_row_per_code_and_a_detail_line_for_the_one_with_changes(self):
        text = lds.render(
            [
                {"code": "bns", "added": ["999"], "changed": ["1"], "removed": ["2"]},
                {"code": "bnss", "added": [], "changed": [], "removed": []},
            ]
        )
        self.assertIn("| BNS | 1 | 1 | 1 |", text)
        self.assertIn("| BNSS | 0 | 0 | 0 |", text)
        self.assertIn("added 999", text)
        self.assertIn("changed 1", text)
        self.assertIn("**deleted** 2", text)
        # BNSS contributed nothing, so it gets no detail bullet.
        self.assertNotIn("BNSS**:", text)

    def test_a_long_list_is_capped_with_a_count_of_the_rest(self):
        many = [str(i) for i in range(1, 30)]
        text = lds.render([{"code": "bns", "added": many, "changed": [], "removed": []}])
        self.assertIn("(+9 more)", text)


if __name__ == "__main__":
    unittest.main()
